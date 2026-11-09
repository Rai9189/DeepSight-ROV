"""
Router monitoring_sessions — manajemen sesi misi survei ROV.

Tabel monitoring_sessions adalah hub utama yang menghubungkan
semua data operasional (telemetri, deteksi, recording, dll).
Setiap misi survei harus dimulai dengan membuat sesi baru,
dan diakhiri dengan menutup sesi tersebut.

Endpoints:
  POST   /api/sessions          — buat sesi baru (mulai misi)
  GET    /api/sessions          — list semua sesi dengan pagination
  GET    /api/sessions/active   — ambil sesi yang sedang Running
  GET    /api/sessions/{id}     — detail satu sesi
  PATCH  /api/sessions/{id}     — update status sesi (complete/abort)
  DELETE /api/sessions/{id}     — hapus sesi (admin only)

Kebijakan akses: misi adalah data tim bersama (satu ROV, satu misi Running).
Semua user yang login boleh melihat dan menutup (complete/abort) misi siapa
pun; menghapus misi hanya ADMIN.
"""
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, text

from database.connection import engine, get_db
from database.models import (
    MonitoringSession, SessionStatus,
    Detection, Telemetry, AUVStatus, VideoPath
)
from core.dependencies import get_current_user, require_admin
from core.cuid import generate_cuid
from core.validation import safe_str, LIST_MAX_PAGE
from core.timeutil import iso_utc
from routers.recordings import delete_recording_files

logger = logging.getLogger("carter-backend")

router = APIRouter(prefix="/api/sessions", tags=["Monitoring Sessions"])


# ==========================
# POST /api/sessions — buat sesi baru
# SPPI-26 createSession
# ==========================
@router.post("", status_code=status.HTTP_201_CREATED)
def create_session(
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Buat sesi misi baru. Status awal = Running.
    Hanya boleh ada SATU sesi Running pada satu waktu.

    Payload:
        location_name : str — nama lokasi survei (wajib)
    """
    try:
        location_name = safe_str(
            body.get("locationName") or body.get("location_name"), "locationName"
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not location_name:
        raise HTTPException(status_code=400, detail="locationName is required")
    _check_name_length(location_name)

    with _start_mission_lock():
        # FOR UPDATE = baca data terbaru, bukan snapshot awal transaksi
        active = (
            db.query(MonitoringSession)
            .filter(MonitoringSession.status == SessionStatus.RUNNING)
            .with_for_update()
            .first()
        )
        if active:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail=f"A mission is already running: {active.id} ({active.location_name}). "
                       f"Finish it before starting a new one."
            )

        now = datetime.now(timezone.utc)
        session = MonitoringSession(
            id=generate_cuid(),
            user_id=current_user["id"],
            location_name=location_name,
            start_time=now,
            end_time=None,
            status=SessionStatus.RUNNING,
            created_at=now,
            updated_at=now,
        )

        db.add(session)
        db.commit()

    db.refresh(session)

    logger.info(
        f"Session created: {session.id} "
        f"location={location_name} user={current_user['email']}"
    )
    return {"success": True, "data": _format_session(session)}


# ==========================
# GET /api/sessions/active — sesi yang sedang berjalan
# SPPI-27 getActiveSession
# ==========================
@router.get("/active")
def get_active_session(
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    """
    Ambil sesi yang sedang Running.
    Dipakai StreamComponent untuk tahu session_id aktif
    sebelum mulai menyimpan deteksi & telemetri.
    """
    session = (
        db.query(MonitoringSession)
        .filter(MonitoringSession.status == SessionStatus.RUNNING)
        .order_by(MonitoringSession.start_time.desc())
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="No mission is running")

    return {"success": True, "data": _format_session(session)}


# ==========================
# GET /api/sessions — list semua sesi
# SPPI-44 getAllSessions
# ==========================
@router.get("")
def get_sessions(
    page: int = 1,
    limit: int = 20,
    status_filter: Optional[str] = None,
    sort: str = "desc",
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    """
    GET list sesi dengan pagination.
    Opsional filter by status: Running | Completed | Aborted
    """
    limit = min(max(limit, 1), 500)
    page = min(max(page, 1), LIST_MAX_PAGE)
    skip = (page - 1) * limit
    query = db.query(MonitoringSession)

    if status_filter:
        try:
            query = query.filter(
                MonitoringSession.status == SessionStatus(status_filter)
            )
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="status must be Running, Completed or Aborted"
            )

    if sort == "asc":
        query = query.order_by(MonitoringSession.start_time.asc())
    else:
        query = query.order_by(MonitoringSession.start_time.desc())

    total = query.count()
    sessions = query.offset(skip).limit(limit).all()

    return {
        "success": True,
        "data": [_format_session(s) for s in sessions],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit,
        },
    }


# ==========================
# GET /api/sessions/{session_id} — detail sesi + ringkasan data
# SPPI-43 getSessionById
# ==========================
@router.get("/{session_id}")
def get_session(
    session_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    """
    GET detail satu sesi beserta ringkasan data yang terkumpul:
    jumlah deteksi, jumlah telemetri, jumlah recording.
    """
    session = db.query(MonitoringSession).filter(
        MonitoringSession.id == session_id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Mission not found")

    # Ringkasan data dalam sesi
    detection_count = db.query(func.count(Detection.id)).filter(
        Detection.session_id == session_id
    ).scalar() or 0

    telemetry_count = db.query(func.count(Telemetry.id)).filter(
        Telemetry.session_id == session_id
    ).scalar() or 0

    recording_count = db.query(func.count(VideoPath.id)).filter(
        VideoPath.session_id == session_id
    ).scalar() or 0

    # Spesies yang terdeteksi dalam sesi
    species = (
        db.query(Detection.species_name, func.count(Detection.id).label("count"))
        .filter(Detection.session_id == session_id)
        .group_by(Detection.species_name)
        .order_by(func.count(Detection.id).desc())
        .all()
    )

    data = _format_session(session)
    data["summary"] = {
        "detectionCount": detection_count,
        "telemetryCount": telemetry_count,
        "recordingCount": recording_count,
        "speciesDetected": [
            {"speciesName": sp, "count": cnt}
            for sp, cnt in species
        ],
    }

    return {"success": True, "data": data}


# ==========================
# PATCH /api/sessions/{session_id} — update status sesi
# SPPI-28 updateSession (complete / abort)
# ==========================
@router.patch("/{session_id}")
def update_session(
    session_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Update status sesi menjadi Completed atau Aborted.
    Otomatis set end_time ke waktu sekarang.

    Payload:
        status : "Completed" | "Aborted"

    Tanpa status = ganti nama saja (rename): boleh untuk misi apa pun,
    hanya oleh admin atau pemilik misi.
    """
    session = db.query(MonitoringSession).filter(
        MonitoringSession.id == session_id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Mission not found")

    try:
        new_status = safe_str(body.get("status"), "status")
        location_name = safe_str(body.get("locationName"), "locationName")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _check_name_length(location_name)

    if not new_status:
        if not location_name:
            raise HTTPException(status_code=400, detail="Mission name is required")
        if current_user["role"] != "ADMIN" and session.user_id != current_user["id"]:
            raise HTTPException(status_code=403, detail="Only an admin or the mission owner can rename it")
        session.location_name = location_name
        session.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(session)
        logger.info(f"Session {session_id} renamed by user={current_user['email']}")
        return {"success": True, "data": _format_session(session)}

    if new_status not in ("Completed", "Aborted"):
        raise HTTPException(
            status_code=400,
            detail="status must be Completed or Aborted"
        )

    if session.status != SessionStatus.RUNNING:
        raise HTTPException(
            status_code=400,
            detail=f"The mission is already {session.status.value} and can't be changed"
        )

    now = datetime.now(timezone.utc)
    session.status     = SessionStatus(new_status)
    session.end_time   = now
    session.updated_at = now

    if location_name:
        session.location_name = location_name

    db.commit()
    db.refresh(session)

    logger.info(
        f"Session {session_id} → {new_status} "
        f"by user={current_user['email']}"
    )
    return {"success": True, "data": _format_session(session)}


# ==========================
# DELETE /api/sessions/{session_id} — hapus sesi (admin only)
# ==========================
@router.delete("/{session_id}")
def delete_session(
    session_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    """
    Hapus sesi beserta semua data terkait (cascade).
    Admin only.
    """
    session = db.query(MonitoringSession).filter(
        MonitoringSession.id == session_id
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Mission not found")

    if session.status == SessionStatus.RUNNING:
        raise HTTPException(
            status_code=400,
            detail="A running mission can't be deleted. "
                   "Finish it first."
        )

    file_names = [v.file_name for v in session.video_paths]
    db.delete(session)
    db.commit()
    delete_recording_files(file_names)

    logger.info(f"Session deleted: {session_id}")
    return {"success": True, "message": f"Mission {session_id} deleted"}


# ==========================
# Helper
# ==========================
def _check_name_length(name: Optional[str]) -> None:
    """Kolom location_name VARCHAR(255): lebih panjang = 400, bukan DataError → 500."""
    if name and len(name) > 255:
        raise HTTPException(status_code=400, detail="Mission name is too long (max 255 characters)")


@contextmanager
def _start_mission_lock():
    """
    Serialkan pembuatan misi: tanpa ini request paralel (klik ganda Start) sama-sama
    melihat "tidak ada misi Running" lalu membuat misi masing-masing. Memakai koneksi
    sendiri karena named lock MySQL melekat ke koneksi, sedangkan commit di `db`
    mengembalikan koneksinya ke pool. ponytail: hanya menjaga POST ini; bila ada jalur
    lain yang membuat misi Running, ganti dengan unique index.
    """
    with engine.connect() as conn:
        if conn.execute(text("SELECT GET_LOCK('carter_start_mission', 10)")).scalar() != 1:
            raise HTTPException(status_code=409, detail="Another mission is starting, please try again")
        try:
            yield
        finally:
            conn.execute(text("SELECT RELEASE_LOCK('carter_start_mission')"))


def _format_session(s: MonitoringSession) -> dict:
    return {
        "id": s.id,
        "userId": s.user_id,
        "locationName": s.location_name,
        "startTime": iso_utc(s.start_time),
        "endTime": iso_utc(s.end_time),
        "status": s.status.value,
        "createdAt": iso_utc(s.created_at),
        "updatedAt": iso_utc(s.updated_at),
    }