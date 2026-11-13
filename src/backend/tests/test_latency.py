"""
Latensi live feed: recv() selalu mengirim frame terbaru (frame basi dibuang)
dan tidak menunggu YOLO. Tanpa RTSP/YOLO — sumber & inferensi dipalsukan.
"""
import asyncio
import time
from fractions import Fraction

import numpy as np
from av import VideoFrame

import video.detection_track as dt


class FakeSource:
    def __init__(self):
        self._queue = asyncio.Queue()

    async def recv(self):
        return await self._queue.get()


def _frame(i):
    f = VideoFrame.from_ndarray(np.full((48, 64, 3), i, np.uint8), format="bgr24")
    f.pts = i
    f.time_base = Fraction(1, 90000)
    return f


def test_recv_sends_latest_frame_without_waiting_for_inference(monkeypatch):
    def slow_inference(*_):
        time.sleep(0.5)
        return [(1, 1, 10, 10, 0.9, "ikan")]
    monkeypatch.setattr(dt, "run_inference", slow_inference)
    monkeypatch.setattr(dt, "SAVE_DETECTIONS_ENABLED", False)

    async def run():
        src = FakeSource()
        track = dt.RtspDetectionTrack(src)
        track.size = None
        for i in range(5):  # 5 frame menumpuk karena kita tertinggal
            src._queue.put_nowait(_frame(i))

        t = time.monotonic()
        out = await track.recv()
        assert time.monotonic() - t < 0.3, "recv menunggu inferensi"
        assert out.pts == 4, "harus frame terbaru"
        assert src._queue.empty()

        await asyncio.sleep(0.7)  # inferensi selesai di thread
        src._queue.put_nowait(_frame(5))
        await track.recv()
        assert track.last_dets and track.last_dets[0][5] == "ikan"
        assert track.infer_ms >= 500, "lama YOLO diukur di thread, bukan 1/inference_fps"

        src._queue.put_nowait(None)  # tanda akhir stream tidak hilang saat dibuang
        assert track.drop_stale_frames() is None
        assert src._queue.get_nowait() is None

    asyncio.run(run())


def test_letterbox_keeps_aspect_ratio():
    # 4:3 (640x480) ke 854x480 → gambar 640x480 di tengah, pita hitam kiri-kanan
    out = dt.letterbox(np.full((480, 640, 3), 200, np.uint8), (854, 480))
    assert out.shape == (480, 854, 3)
    assert out[:, :107].max() == 0 and out[:, 747:].max() == 0
    assert out[:, 107:747].min() == 200
    # 16:9 tetap resize biasa tanpa pita
    out = dt.letterbox(np.full((720, 1280, 3), 200, np.uint8), (854, 480))
    assert out.shape == (480, 854, 3) and out.min() == 200
