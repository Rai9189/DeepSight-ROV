import asyncio
import logging
from typing import Dict, Optional, Set, Tuple
from aiortc import RTCPeerConnection, RTCRtpSender, RTCSessionDescription
from aiortc.contrib.media import MediaPlayer, MediaRelay

from config import (
    RTSP_TRANSPORT,
    MAX_BITRATE_KBPS_DEFAULT,
    TARGET_FPS,
    PREFER_CODEC,
    DISABLE_TWCC_REM
)
from video.rtsp_player import make_rtsp_player
from video.detection_track import RtspDetectionTrack, release_saving
from webrtc.bitrate import set_sender_bitrate, periodic_reapply_bitrate, tune_answer_sdp

logger = logging.getLogger("carter-backend")

# Global state
peer_connections: Dict[str, RTCPeerConnection] = {}
detection_tracks: Dict[str, RtspDetectionTrack] = {}  # tab → track bersama (_Hub.track)
bitrate_tasks: Dict[str, asyncio.Task] = {}


class _Hub:
    """
    Satu jalur kamera untuk SEMUA tab: RTSP dibuka, di-decode, dan dideteksi YOLO
    sekali per frame, lalu MediaRelay membagikan hasilnya; tiap tab hanya
    meng-encode WebRTC sendiri. Dulu tiap tab punya jalur sendiri → YOLO antre
    (_infer_lock) dan 2 tab turun dari ±9 ke <1 deteksi/dtk (diukur 2026-11-13).
    """

    def __init__(self, player: MediaPlayer):
        self.player = player
        self.track = RtspDetectionTrack(player.video)
        self.clients: Set[str] = set()

    def alive(self) -> bool:
        return self.player.video is not None and self.player.video.readyState == "live"


_relay = MediaRelay()
_hub: Optional[_Hub] = None
_client_hub: Dict[str, _Hub] = {}
_hub_lock: Optional[asyncio.Lock] = None  # dibuat di event loop yang berjalan (Python 3.8 mengikat loop saat dibuat)


def prefer_codec(transceiver, codec: str) -> None:
    """
    Dahulukan codec pilihan (h264/vp8) untuk transceiver ini. Harus dipanggil sebelum
    setRemoteDescription: aiortc memilih encoder dari urutan ini, bukan dari teks SDP jawaban.
    Codec lain tetap ada sebagai cadangan bila browser tidak mendukung pilihan.
    """
    caps = RTCRtpSender.getCapabilities("video").codecs
    mime = f"video/{codec}".lower()
    transceiver.setCodecPreferences(
        [c for c in caps if c.mimeType.lower() == mime] + [c for c in caps if c.mimeType.lower() != mime]
    )


def _stop_player(player: MediaPlayer) -> None:
    # MediaPlayer tak punya stop(); menghentikan track-nya yang menutup thread decode + koneksi RTSP
    for track in (player.audio, player.video):
        if track:
            track.stop()


async def _open_player(transport: str) -> MediaPlayer:
    # Buka RTSP di thread executor agar tidak memblokir event loop
    # av.open() di MediaPlayer adalah blocking call — jika dijalankan langsung
    # di async function, seluruh event loop (termasuk Ctrl+C) akan terhenti
    loop = asyncio.get_running_loop()

    def open_player():
        # Python 3.8 (Jetson JetPack 5): aiortc membuat asyncio.Queue saat MediaPlayer
        # dibuat, dan Queue 3.8 mengikat event loop thread ini — beri loop utama
        asyncio.set_event_loop(loop)
        return make_rtsp_player(transport)

    try:
        player = await asyncio.wait_for(loop.run_in_executor(None, open_player), timeout=6.0)
    except asyncio.TimeoutError:
        raise RuntimeError("RTSP timeout: MediaMTX did not respond within 6 seconds. Check that a video source is running.")
    except Exception as exc:
        raise RuntimeError(f"RTSP failed: {exc}")

    if not player.video:
        _stop_player(player)
        raise RuntimeError("The RTSP stream has no video track")
    return player


async def _join_hub(client_id: str, transport: str) -> _Hub:
    """Pakai jalur kamera yang sedang jalan; buka baru bila belum ada atau kamera sempat putus."""
    global _hub, _hub_lock
    if _hub_lock is None:
        _hub_lock = asyncio.Lock()
    async with _hub_lock:  # dua tab yang mulai bersamaan tidak membuka RTSP dua kali
        if _hub is None or not _hub.alive():
            if _hub is not None:
                release_saving(_hub.track)  # jalur lama mati; tab lamanya menutup sendiri saat reconnect
            # ponytail: transport RTSP (udp/tcp) ikut tab pertama yang membuka jalur
            _hub = _Hub(await _open_player(transport))
            logger.info(f"Camera pipeline opened (rtsp={transport})")
        _hub.clients.add(client_id)
        _client_hub[client_id] = _hub
        return _hub


async def _leave_hub(client_id: str) -> None:
    """Lepas tab dari jalur kamera; tab terakhir menutup RTSP."""
    global _hub
    hub = _client_hub.pop(client_id, None)
    if hub is None:
        return
    hub.clients.discard(client_id)
    if hub.clients:
        return
    if _hub is hub:
        _hub = None
    release_saving(hub.track)

    # Stop MediaPlayer di executor agar tidak blokir event loop
    try:
        loop = asyncio.get_running_loop()
        await asyncio.wait_for(loop.run_in_executor(None, _stop_player, hub.player), timeout=3.0)
        logger.info(f"Camera pipeline closed (last viewer {client_id} left)")
    except asyncio.TimeoutError:
        logger.warning("Camera pipeline stop timeout, forcing continue")
    except Exception as e:
        logger.warning(f"Error stopping camera pipeline: {e}")


async def handle_offer(websocket, client_id: str, message: dict):
    # Get preferences from offer
    offer_sdp = message.get("sdp")
    if not offer_sdp:
        raise ValueError("The offer message has no 'sdp' field")
    pref_codec = (message.get("codec") or PREFER_CODEC).lower()
    max_kbps = int(message.get("maxBitrateKbps") or MAX_BITRATE_KBPS_DEFAULT)
    if max_kbps <= 0:  # nilai negatif membuat video tidak pernah tampil
        max_kbps = MAX_BITRATE_KBPS_DEFAULT
    fps = int(message.get("fps") or TARGET_FPS)

    # Transport RTSP from query params
    qp = websocket.query_params
    transport = (qp.get("transport") or RTSP_TRANSPORT).lower()

    # Cleanup existing connection
    await cleanup_pc(client_id)

    # Create new peer connection
    pc = RTCPeerConnection()
    peer_connections[client_id] = pc

    try:
        hub = await _join_hub(client_id, transport)
    except Exception:
        peer_connections.pop(client_id, None)
        raise
    detection_tracks[client_id] = hub.track

    # buffered=False: tab yang lambat hanya menerima frame terbaru, tidak menumpuk latensi
    sender = pc.addTrack(_relay.subscribe(hub.track, buffered=False))
    prefer_codec(next(t for t in pc.getTransceivers() if t.sender is sender), pref_codec)

    @pc.on("connectionstatechange")
    async def _on_state():
        logger.info(f"{client_id} state: {pc.connectionState}")
        if pc.connectionState in ("failed", "closed", "disconnected"):
            await cleanup_pc(client_id)

    # Set remote description
    await pc.setRemoteDescription(RTCSessionDescription(sdp=offer_sdp, type="offer"))

    # Set bitrate
    sdp_munger = await set_sender_bitrate(sender, max_kbps * 1000, fps)

    # Create answer
    answer = await pc.createAnswer()
    tuned = tune_answer_sdp(
        raw_sdp=answer.sdp,
        kbps=max_kbps,
        fps=fps,
        prefer=pref_codec,
        disable_twcc=DISABLE_TWCC_REM,
    )
    answer = RTCSessionDescription(sdp=tuned, type=answer.type)
    await pc.setLocalDescription(answer)

    # Start periodic bitrate reapply
    task = asyncio.create_task(
        periodic_reapply_bitrate(client_id, sender, max_kbps * 1000, fps, peer_connections)
    )
    bitrate_tasks[client_id] = task

    # Send answer back to client
    import json
    await websocket.send_text(json.dumps({"type": "answer", "sdp": pc.localDescription.sdp}))
    logger.info(
        f"Answer -> {client_id} | codec={pref_codec}, {max_kbps}kbps, fps={fps}, rtsp={transport}, "
        f"twcc_remb_disabled={DISABLE_TWCC_REM}"
    )


async def cleanup_pc(client_id: str):
    # Stop bitrate task
    task = bitrate_tasks.pop(client_id, None)
    if task:
        task.cancel()

    detection_tracks.pop(client_id, None)

    # Tutup file rekaman + simpan ke video_paths agar tidak jadi orphan
    # saat client disconnect tanpa sempat memanggil /api/recording/stop
    from video.recording import is_recording, stop_recording
    if is_recording(client_id):
        await stop_recording(client_id)

    # Close peer connection
    pc = peer_connections.pop(client_id, None)
    if pc:
        try:
            for s in pc.getSenders():
                try:
                    if s.track:
                        s.track.stop()
                except Exception:
                    pass
            await pc.close()
        except Exception:
            pass
        logger.info(f"PC {client_id} closed")

    await _leave_hub(client_id)


def get_peer_connections() -> Dict[str, RTCPeerConnection]:
    return peer_connections


def get_detection_track(client_id: str) -> Optional[RtspDetectionTrack]:
    return detection_tracks.get(client_id)


def get_average_fps() -> Tuple[float, float]:
    """Rata-rata (fps, inference_fps) dari semua track aktif; (0, 0) jika tidak ada client."""
    tracks = list(detection_tracks.values())
    if not tracks:
        return 0.0, 0.0
    n = len(tracks)
    return (
        sum(t.current_fps for t in tracks) / n,
        sum(t.current_infer_fps for t in tracks) / n,
    )


def get_average_infer_ms() -> float:
    """Rata-rata lama YOLO per frame (ms) dari semua track aktif; 0 jika tidak ada client."""
    tracks = list(detection_tracks.values())
    return sum(t.infer_ms for t in tracks) / len(tracks) if tracks else 0.0


async def cleanup_all():
    for cid in list(peer_connections.keys()):
        await cleanup_pc(cid)
