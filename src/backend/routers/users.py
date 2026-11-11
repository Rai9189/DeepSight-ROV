"""
Router users — menggantikan:
  - src/app/api/users/route.ts         (GET list, POST create)
  - src/app/api/users/[id]/route.ts    (GET, PUT, DELETE by id)

Semua endpoint Admin only via require_admin() dependency.

Password: admin tidak pernah memilih password. Membuat akun / reset menghasilkan
password sementara acak (dikembalikan SEKALI di response) dan
must_change_password=True, jadi pengguna wajib menggantinya saat login.
"""
import logging
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, text
from pydantic import EmailStr, TypeAdapter, ValidationError

from database.connection import engine, get_db
from database.models import User, Role, MonitoringSession
from auth.password import hash_password, generate_temporary_password
from core.dependencies import require_admin
from core.cuid import generate_cuid
from core.validation import safe_str, check_phone
from core.timeutil import iso_utc

logger = logging.getLogger("carter-backend")

router = APIRouter(prefix="/api/users", tags=["Users"])

_email_adapter = TypeAdapter(EmailStr)


# ==========================
# Helper
# ==========================
def _read_user_body(body: dict, default_role: str) -> tuple[str, str, str, str]:
    """
    Ambil & validasi field user dari body mentah → 400 kalau salah.
    Return (username, email, phone_number, role). Field "password" diabaikan:
    password hanya lewat password sementara (create/reset) atau change-password.
    """
    try:
        username = safe_str(body.get("fullName"), "fullName")
        email = safe_str(body.get("email"), "email").lower()
        phone_number = safe_str(body.get("phoneNumber"), "phoneNumber")
        if phone_number:  # kosong ditolak di bawah
            check_phone(phone_number)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not all([username, email, phone_number]):
        raise HTTPException(status_code=400, detail="Name, email and phone number are required")

    role = body.get("role") or default_role
    if role not in ("USER", "ADMIN"):
        raise HTTPException(status_code=400, detail="Role must be USER or ADMIN")

    try:
        _email_adapter.validate_python(email)
    except ValidationError:
        raise HTTPException(status_code=400, detail="Enter a valid email address")

    return username, email, phone_number, role


@contextmanager
def _admin_role_lock():
    """
    Serialkan perubahan role ADMIN dengan named lock MySQL, supaya dua admin
    yang saling menurunkan role pada saat bersamaan diproses bergiliran
    (row lock FOR UPDATE di sini memicu deadlock → 500). Memakai koneksi
    sendiri karena named lock melekat ke koneksi, sedangkan commit di `db`
    mengembalikan koneksinya ke pool.
    """
    with engine.connect() as conn:
        if conn.execute(text("SELECT GET_LOCK('carter_admin_role', 10)")).scalar() != 1:
            raise HTTPException(status_code=409, detail="Another role change is in progress, please try again")
        try:
            yield
        finally:
            conn.execute(text("SELECT RELEASE_LOCK('carter_admin_role')"))


def _ensure_other_admin(db: Session, user_id: str) -> None:
    """
    400 kalau user_id adalah satu-satunya ADMIN. Dipanggil di dalam
    _admin_role_lock; FOR UPDATE = baca data terbaru (bukan snapshot awal
    transaksi) — aman dari deadlock karena hanya satu request di bagian ini.
    """
    admin_ids = [
        uid for (uid,) in
        db.query(User.id).filter(User.role == Role.ADMIN).with_for_update().all()
    ]
    if not any(uid != user_id for uid in admin_ids):
        raise HTTPException(status_code=400, detail="There must be at least one admin")


def _apply_user_update(db: Session, user: User, username: str, email: str,
                       phone_number: str, role: str) -> None:
    """Terapkan field hasil validasi ke user lalu commit (bagian akhir PUT /api/users/{id})."""
    # Cek email tidak dipakai user lain
    if email != user.email:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            raise HTTPException(status_code=400, detail="This email is already used by another account")

    user.username = username
    user.email = email
    user.phone_number = phone_number
    user.role = Role(role)
    user.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(user)


def _format_user(user: User, mission_count: Optional[int] = None) -> dict:
    data = {
        "id": user.id,
        "fullName": user.username,
        "email": user.email,
        "phoneNumber": user.phone_number,
        "role": user.role.value,
        "mustChangePassword": user.must_change_password,
        "createdAt": iso_utc(user.created_at),
        "updatedAt": iso_utc(user.updated_at),
    }
    if mission_count is not None:
        data["missionCount"] = mission_count  # misi yang dialihkan ke admin kalau user dihapus
    return data


def _get_user_or_404(db: Session, user_id: str) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ==========================
# GET /api/users — list dengan cursor pagination
# ==========================
@router.get("")
def get_users(
    cursor: Optional[str] = None,
    limit: int = 10,
    sort: str = "desc",
    role: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    """
    GET list users dengan cursor pagination.
    Port dari src/app/api/users/route.ts GET
    """
    valid_limit = min(max(limit, 1), 50)
    sort_order = sort if sort in ("asc", "desc") else "desc"

    query = db.query(User)

    # Filter role
    if role and role in ("USER", "ADMIN"):
        query = query.filter(User.role == Role(role))

    # Filter search
    if search:
        query = query.filter(
            or_(
                User.username.contains(search),
                User.email.contains(search),
            )
        )

    # Total sesuai filter, sebelum cursor (dulu: jumlah baris halaman ini saja)
    total = query.count()

    # Cursor pagination
    if cursor:
        if sort_order == "desc":
            query = query.filter(User.id < cursor)
        else:
            query = query.filter(User.id > cursor)

    # Sort
    if sort_order == "desc":
        query = query.order_by(User.created_at.desc(), User.id.desc())
    else:
        query = query.order_by(User.created_at.asc(), User.id.asc())

    users = query.limit(valid_limit + 1).all()

    has_more = len(users) > valid_limit
    items = users[:valid_limit]
    next_cursor = items[-1].id if has_more and items else None

    # Jumlah misi per user di halaman ini, 1 query
    missions = dict(
        db.query(MonitoringSession.user_id, func.count(MonitoringSession.id))
        .filter(MonitoringSession.user_id.in_([u.id for u in items]))
        .group_by(MonitoringSession.user_id)
        .all()
    ) if items else {}

    return {
        "items": [_format_user(u, missions.get(u.id, 0)) for u in items],
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "pagination": {
            "limit": valid_limit,
            "total": total,
            "sortOrder": sort_order,
            "filters": {"role": role, "search": search},
        },
    }


# ==========================
# POST /api/users — create user (Admin)
# ==========================
@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """
    POST create user baru oleh admin.
    Port dari src/app/api/users/route.ts POST
    """
    username, email, phone_number, role = _read_user_body(body, "USER")

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=409, detail="This email is already registered")

    temporary_password = generate_temporary_password()
    now = datetime.now(timezone.utc)
    new_user = User(
        id=generate_cuid(),
        username=username,
        email=email,
        password=hash_password(temporary_password),
        phone_number=phone_number,
        role=Role(role),
        must_change_password=True,
        created_at=now,
        updated_at=now,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    logger.info(f"User created: {new_user.email} by admin: {current_user['email']}")
    return {
        "message": "User added",
        "user": _format_user(new_user),
        "temporaryPassword": temporary_password,  # satu-satunya kali password ini terlihat
    }


# ==========================
# GET /api/users/{id}
# ==========================
@router.get("/{user_id}")
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    """
    GET single user by ID.
    Port dari src/app/api/users/[id]/route.ts GET
    """
    return _format_user(_get_user_or_404(db, user_id))


# ==========================
# PUT /api/users/{id}
# ==========================
@router.put("/{user_id}")
def update_user(
    user_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """
    PUT update user.
    Port dari src/app/api/users/[id]/route.ts PUT
    """
    user = _get_user_or_404(db, user_id)
    username, email, phone_number, role = _read_user_body(body, user.role.value)

    # Role: tidak boleh mengubah role sendiri (seperti larangan hapus akun
    # sendiri) dan tidak boleh sampai tidak ada admin sama sekali.
    demote_admin = role != user.role.value and user.role == Role.ADMIN
    if role != user.role.value and user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="You can't change your own role")

    with (_admin_role_lock() if demote_admin else nullcontext()):
        if demote_admin:
            _ensure_other_admin(db, user_id)
        _apply_user_update(db, user, username, email, phone_number, role)

    logger.info(f"User updated: {user.id} by admin: {current_user['email']}")
    return {"message": "Changes saved", "user": _format_user(user)}


# ==========================
# POST /api/users/{id}/reset-password
# ==========================
@router.post("/{user_id}/reset-password")
def reset_password(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """
    Pengganti "lupa password" (tidak ada email di jaringan ROV): admin membuat
    password sementara baru; pengguna wajib menggantinya saat login berikutnya.
    Akun sendiri lewat change-password, karena admin sudah tahu password-nya.
    """
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Use Change password for your own account")
    user = _get_user_or_404(db, user_id)

    temporary_password = generate_temporary_password()
    user.password = hash_password(temporary_password)
    user.must_change_password = True
    user.updated_at = datetime.now(timezone.utc)
    db.commit()

    logger.info(f"Password reset: {user.email} by admin: {current_user['email']}")
    return {"message": "Password reset", "temporaryPassword": temporary_password}


# ==========================
# DELETE /api/users/{id}
# ==========================
@router.delete("/{user_id}")
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """
    DELETE user by ID.
    Port dari src/app/api/users/[id]/route.ts DELETE
    Cegah self-deletion. Misi milik user dialihkan ke admin yang menghapus
    agar data survei tidak ikut terhapus (FK sessions.user_id ON DELETE CASCADE).
    """
    if user_id == current_user["id"]:
        raise HTTPException(
            status_code=400,
            detail="You can't delete your own account"
        )

    user = _get_user_or_404(db, user_id)

    email = user.email
    username = user.username

    # Hapus ADMIN memakai kunci yang sama dengan turunkan role: tanpa ini,
    # "A hapus B" bersamaan "B turunkan A" bisa meninggalkan sistem tanpa admin
    delete_admin = user.role == Role.ADMIN
    with (_admin_role_lock() if delete_admin else nullcontext()):
        if delete_admin:
            _ensure_other_admin(db, user_id)
        # Alihkan misi dulu — kalau tidak, cascade di DB ikut menghapus semua
        # telemetri, deteksi, dan rekaman misi user ini
        reassigned = (
            db.query(MonitoringSession)
            .filter(MonitoringSession.user_id == user_id)
            .update({MonitoringSession.user_id: current_user["id"]}, synchronize_session=False)
        )
        db.delete(user)
        db.commit()

    logger.info(
        f"User deleted: {user_id} ({email}) by admin: {current_user['email']}, "
        f"{reassigned} misi dialihkan ke admin tersebut"
    )
    message = f'Deleted "{username}"'
    if reassigned:
        message += f"; {reassigned} mission{'s' if reassigned != 1 else ''} moved to your account"
    return {"message": message, "reassignedSessions": reassigned}