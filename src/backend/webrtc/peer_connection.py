import asyncio
import logging
from typing import Dict, Optional, Tuple
from aiortc import RTCPeerConnection, RTCRtpSender, RTCSessionDescription
from aiortc.contrib.media import MediaPlayer

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
detection_tracks: Dict[str, RtspDetectionTrack] = {}
bitrate_tasks: Dict[str, asyncio.Task] = {}
media_players: Dict[str, MediaPlayer] = {}


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
        player = await asyncio.wait_for(
            loop.run_in_executor(None, open_player),
            timeout=6.0
        )
    except asyncio.TimeoutError:
        peer_connections.pop(client_id, None)
        raise RuntimeError("RTSP timeout: MediaMTX did not respond within 6 seconds. Check that a video source is running.")
    except Exception as exc:
        peer_connections.pop(client_id, None)
        raise RuntimeError(f"RTSP failed: {exc}")

    if not player.video:
        peer_connections.pop(client_id, None)
        _stop_player(player)
        raise RuntimeError("The RTSP stream has no video track")

    media_players[client_id] = player

    # Create detection track
    det_track = RtspDetectionTrack(player.video)
    detection_tracks[client_id] = det_track

    sender = pc.addTrack(det_track)
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

    release_saving(detection_tracks.pop(client_id, None))

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

    # Stop MediaPlayer di executor agar tidak blokir event loop
    player = media_players.pop(client_id, None)
    if player:
        try:
            loop = asyncio.get_running_loop()
            await asyncio.wait_for(
                loop.run_in_executor(None, _stop_player, player),
                timeout=3.0
            )
            logger.info(f"MediaPlayer {client_id} stopped")
        except asyncio.TimeoutError:
            logger.warning(f"MediaPlayer {client_id} stop timeout, forcing continue")
        except Exception as e:
            logger.warning(f"Error stopping MediaPlayer {client_id}: {e}")


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
