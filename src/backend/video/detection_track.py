import av
import cv2
import time
import asyncio
import logging
import numpy as np
import queue
import threading
from fractions import Fraction
from typing import Optional, List, Tuple
from aiortc import VideoStreamTrack
from av import VideoFrame

from config import (
    RESIZE_WIDTH,
    RESIZE_HEIGHT,
    YOLO_CONF_THRESHOLD,
    YOLO_IOU_THRESHOLD,
    YOLO_MAX_DETECTIONS,
    SAVE_DETECTIONS_ENABLED,
    SAVE_INTERVAL_SECONDS,
    MIN_DETECTIONS_TO_SAVE
)
from models.yolo_detector import run_inference
from database.crud.detections import save_detection_to_db  # GANTI: dari database.detections

logger = logging.getLogger("carter-backend")

# Rekaman: H.264 (libx264) di MP4 terfragmentasi — file tetap bisa diputar
# sampai fragmen terakhir walau backend mati sebelum stop.
RECORD_TIME_BASE = Fraction(1, 1000)  # pts dalam milidetik jam dinding
RECORD_MOVFLAGS = "frag_keyframe+empty_moov+default_base_moof"
RECORD_GOP = 30  # keyframe tiap 30 frame = batas fragmen; crash kehilangan < 1 fragmen
RECORD_QUEUE_SIZE = 60
STATS_LOG_SECONDS = 10  # ringkasan fps/inferensi di log backend untuk diagnosis latensi

# Hanya satu stream yang menyimpan deteksi (keputusan 2026-11-09): tiap tab
# punya stream sendiri, jadi tanpa ini log deteksi tercatat dobel. Stream
# pertama yang menyimpan memegang peran ini sampai ditutup.
_saving_track: Optional["RtspDetectionTrack"] = None


def _claim_saving(track: "RtspDetectionTrack") -> bool:
    global _saving_track
    if _saving_track is None:
        _saving_track = track
    return _saving_track is track


def release_saving(track: Optional["RtspDetectionTrack"]) -> None:
    global _saving_track
    if track is not None and _saving_track is track:
        _saving_track = None


def letterbox(img: np.ndarray, size: Tuple[int, int]) -> np.ndarray:
    """
    Resize ke size (w, h) tanpa menarik gambar: sumber yang rasionya beda
    (mis. kamera 4:3 ke 854x480) diberi pita hitam, ukuran keluaran tetap.
    """
    w, h = size
    ih, iw = img.shape[:2]
    scale = min(w / iw, h / ih)
    nw, nh = round(iw * scale), round(ih * scale)
    if nw >= w - 2 and nh >= h - 2:  # rasio (hampir) sama: 1280x720→854x480 selisih 1 px pembulatan
        return cv2.resize(img, size, interpolation=cv2.INTER_LINEAR)
    out = np.zeros((h, w, 3), np.uint8)
    x, y = (w - nw) // 2, (h - nh) // 2
    out[y:y + nh, x:x + nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return out


def timed_inference(img, conf, iou, max_det):
    """run_inference + lama YOLO sebenarnya (ms), diukur di thread inferensi."""
    t = time.perf_counter()
    dets = run_inference(img, conf, iou, max_det)
    return dets, (time.perf_counter() - t) * 1000


def write_recording(filepath: str, frames: "queue.Queue") -> float:
    """
    Tulis frame (monotonic_time, bgr_ndarray) dari antrean ke MP4 sampai
    menerima None. Hanya fungsi ini yang membuka, menulis, dan menutup file,
    jadi tidak ada release dari thread lain saat encoder masih dipakai.
    pts diambil dari jam dinding → durasi video = durasi rekaman nyata walau
    FPS naik-turun atau frame dibuang saat antrean penuh.
    """
    # flush_packets: tiap fragmen langsung ke disk (tanpa ini tertahan di buffer → hilang saat crash)
    container = av.open(filepath, mode="w", format="mp4",
                        options={"movflags": RECORD_MOVFLAGS, "flush_packets": "1"})
    stream = None
    t0 = 0.0
    last_pts = -1
    written = 0
    try:
        while True:
            item = frames.get()
            if item is None:
                break
            t, img = item
            if stream is None:
                h, w = img.shape[:2]
                stream = container.add_stream("libx264", rate=30)
                stream.width, stream.height = w - w % 2, h - h % 2  # yuv420p wajib genap
                stream.pix_fmt = "yuv420p"
                stream.time_base = RECORD_TIME_BASE
                stream.codec_context.time_base = RECORD_TIME_BASE
                stream.codec_context.gop_size = RECORD_GOP
                stream.options = {"preset": "ultrafast", "tune": "zerolatency"}
                t0 = t
            pts = max(int((t - t0) * 1000), last_pts + 1)
            last_pts = pts
            frame = VideoFrame.from_ndarray(img[:stream.height, :stream.width], format="bgr24")
            frame.pts = pts
            frame.time_base = RECORD_TIME_BASE
            container.mux(stream.encode(frame))
            written += 1
        if stream is not None:
            container.mux(stream.encode())  # flush encoder
    except Exception:
        logger.exception(f"Error writing recording {filepath}")
    finally:
        container.close()
    seconds = max(last_pts, 0) / 1000
    logger.info(f"Video writer stopped: {filepath} ({written} frames, {seconds:.1f}s)")
    return seconds  # panjang video di file, bukan jam dinding mulai–selesai


class Recorder:
    """
    Satu rekaman (satu tab). Track bersama bisa punya beberapa Recorder sekaligus:
    tiap tab yang menekan Start merekam ke file sendiri dari frame yang sama.
    """

    def __init__(self, filepath: str):
        self.frames: "queue.Queue" = queue.Queue(maxsize=RECORD_QUEUE_SIZE)
        self.recorded_frames = 0
        self.recorded_seconds: Optional[float] = None  # diisi thread penulis saat file ditutup
        self.stopped = False
        self.thread = threading.Thread(target=self._write, args=(filepath,), daemon=True)
        self.thread.start()

    def _write(self, filepath: str):
        self.recorded_seconds = write_recording(filepath, self.frames)

    def push(self, img: np.ndarray):
        try:
            self.frames.put_nowait((time.monotonic(), img.copy()))
            self.recorded_frames += 1
        except queue.Full:
            pass  # encoder tertinggal: frame dibuang, durasi tetap benar (pts jam dinding)

    def stop_recording(self, timeout: float = 10.0) -> bool:
        """
        Blocking (panggil lewat asyncio.to_thread). Kirim tanda selesai ke
        thread penulis lalu tunggu file ditutup. True bila file sudah final.
        """
        if not self.stopped:
            self.stopped = True
            try:
                self.frames.put(None, timeout=timeout)  # penulis sedang menguras antrean, slot pasti terbuka
            except queue.Full:
                pass
        self.thread.join(timeout)
        if self.thread.is_alive():
            # File tetap ditutup oleh thread penulis sendiri begitu selesai
            logger.warning("Video writer belum selesai saat timeout; file difinalisasi di background")
            return False
        return True


class RtspDetectionTrack(VideoStreamTrack):

    def __init__(self, video_source_track):
        super().__init__()
        self.src = video_source_track
        self.frame_skip = 0
        self.skip_n = 0  # 0 = process every frame
        self.last_dets: List[Tuple[int, int, int, int, float, str]] = []

        # Performance counters per track (bukan global) agar FPS tiap client
        # tidak saling menjumlah saat ada >1 client terhubung
        self.frame_count = 0
        self.inference_count = 0
        self.last_fps_time: Optional[float] = None  # diisi saat frame pertama, bukan saat koneksi dibuat
        self.last_infer_time = time.time()
        self.current_fps = 0.0
        self.current_infer_fps = 0.0
        self.infer_ms = 0.0  # lama YOLO per frame (bukan 1/inference_fps)
        self.last_stats_log = time.time()

        self.size = (RESIZE_WIDTH, RESIZE_HEIGHT) if (RESIZE_WIDTH and RESIZE_HEIGHT) else None
        self.conf = YOLO_CONF_THRESHOLD
        self.iou = YOLO_IOU_THRESHOLD
        self.max_det = YOLO_MAX_DETECTIONS

        # Inferensi berjalan di thread; video tidak menunggu hasilnya
        self.infer_task: Optional[asyncio.Task] = None

        # Database saving
        self.last_save_time = time.time()
        self.save_task: Optional[asyncio.Task] = None

        # Rekaman yang sedang berjalan (satu per tab yang merekam)
        self.recorders: set = set()

    def drop_stale_frames(self):
        """
        MediaPlayer aiortc (RTSP) menumpuk frame di antrean tanpa batas; bila
        kita lebih lambat dari kamera, latensi terus bertambah. Buang semua
        frame yang sudah basi agar yang dikirim selalu frame terbaru.
        ponytail: menyentuh _queue privat aiortc (dipin 1.14.0 di requirements);
        cek ulang bila aiortc di-upgrade.
        """
        q = getattr(self.src, "_queue", None)
        latest = None
        while q is not None and not q.empty():
            item = q.get_nowait()
            if item is None:  # tanda akhir stream: kembalikan agar recv berikutnya berhenti
                q.put_nowait(None)
                break
            latest = item
        return latest

    def apply_detections(self, dets, infer_ms: float = 0.0):
        self.last_dets = dets
        self.infer_ms = infer_ms

        # Save detections to database periodically
        now = time.time()
        if (SAVE_DETECTIONS_ENABLED and
            len(dets) >= MIN_DETECTIONS_TO_SAVE and
            now - self.last_save_time >= SAVE_INTERVAL_SECONDS and
            _claim_saving(self)):
            # Save without blocking — langsung ke SQLAlchemy, tidak lewat HTTP
            if self.save_task is None or self.save_task.done():
                self.save_task = asyncio.create_task(
                    save_detection_to_db(dets.copy(), self.frame_skip)
                )
                self.last_save_time = now

        self.inference_count += 1
        if now - self.last_infer_time >= 1.0:
            self.current_infer_fps = self.inference_count / (now - self.last_infer_time)
            self.inference_count = 0
            self.last_infer_time = now

    async def recv(self) -> VideoFrame:
        frame: VideoFrame = await self.src.recv()
        frame = self.drop_stale_frames() or frame
        img = frame.to_ndarray(format="bgr24")

        if self.size:
            img = letterbox(img, self.size)

        # Ambil hasil inferensi yang sudah selesai
        task = self.infer_task
        if task is not None and task.done():
            self.infer_task = None
            try:
                self.apply_detections(*task.result())
            except Exception as e:
                logger.warning(f"Inference error: {e}")

        # Mulai inferensi baru hanya bila thread sedang kosong — frame tidak pernah antre menunggu YOLO.
        # Kotak deteksi tertinggal paling lama satu durasi inferensi dari video.
        if self.infer_task is None and self.frame_skip % (self.skip_n + 1) == 0:
            self.infer_task = asyncio.create_task(asyncio.to_thread(
                timed_inference, img.copy(), self.conf, self.iou, self.max_det
            ))

        self.frame_skip += 1

        # Draw overlay
        for (x1, y1, x2, y2, conf, name) in self.last_dets:
            cv2.rectangle(img, (x1, y1), (x2, y2), (50, 220, 50), 3)
            label = f"{name} {conf:.2f}"
            cv2.putText(img, label, (x1, max(0, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        # Statistik untuk chip web (/api/performance) dan log — tidak digambar ke frame
        now = time.time()
        if self.last_fps_time is None:
            # Membuka RTSP bisa makan beberapa detik; kalau dihitung dari saat koneksi
            # dibuat, FPS pertama ≈ 1 frame / beberapa detik → tampil "FPS 0"
            self.last_fps_time = now
        self.frame_count += 1
        if now - self.last_fps_time >= 1.0:
            self.current_fps = self.frame_count / (now - self.last_fps_time)
            self.frame_count = 0
            self.last_fps_time = now
        if now - self.last_stats_log >= STATS_LOG_SECONDS:
            self.last_stats_log = now
            logger.info(
                f"Stream stats: fps={self.current_fps:.1f}, "
                f"detections/s={self.current_infer_fps:.1f}, yolo={self.infer_ms:.0f}ms"
            )

        self.enqueue_recording_frame(img)

        img = img.astype(np.uint8)
        out = VideoFrame.from_ndarray(img, format="bgr24")
        out.pts = frame.pts
        out.time_base = frame.time_base
        return out

    def enqueue_recording_frame(self, img: np.ndarray):
        for r in list(self.recorders):
            if r.stopped:
                self.recorders.discard(r)
            else:
                r.push(img)

    def start_recording(self, filepath: str) -> Recorder:
        recorder = Recorder(filepath)
        self.recorders.add(recorder)
        logger.info(f"Started recording to {filepath}")
        return recorder
