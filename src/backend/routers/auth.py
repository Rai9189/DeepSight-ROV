"""
Router autentikasi — menggantikan:
  - src/app/api/auth/[...nextauth]/route.ts  (login)
  - src/app/api/auth/register/route.ts       (register)

Endpoint:
  POST /api/auth/login    → return JWT token
  POST /api/auth/register → buat user baru
  POST /api/auth/logout   → hapus cookie token
  GET  /api/auth/me       → data user yang sedang login
  POST /api/auth/change-password → ganti password sendiri (wajib setelah password sementara)
"""
import logging
import math
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from sqlalchemy.orm import Session

from database.connection import get_db
from database.models import User, Role
from auth.password import hash_password, verify_password
from auth.jwt import create_access_token
from core.dependencies import get_current_user, require_admin
from core.cuid import generate_cuid
from core.rate_limit import FailedAttemptLimiter
from config import JWT_EXPIRE_MINUTES, COOKIE_SECURE
from core.timeutil import iso_utc
from core.validation import check_password
from schemas.auth import LoginRequest, RegisterRequest

logger = logging.getLogger("carter-backend")

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

# Batas login gagal. Kunci email+IP (bukan email saja) supaya penyerang
# tidak bisa mengunci akun operator dari komputer lain.
LOGIN_WINDOW_SECONDS = 15 * 60
login_limiter_account = FailedAttemptLimiter(5, LOGIN_WINDOW_SECONDS)   # per email+IP
login_limiter_ip = FailedAttemptLimiter(20, LOGIN_WINDOW_SECONDS)       # per IP
# Tebakan password lama di change-password, per akun: tanpa ini sesi yang
# dicuri bisa menebak password tanpa batas
change_pw_limiter = FailedAttemptLimiter(5, LOGIN_WINDOW_SECONDS)


# ==========================
# Helper: format user response
# ==========================
def _format_user(user: User) -> dict:
    """Format user object ke dict untuk response."""
    return {
        "id": user.id,
        "fullName": user.username,
        "email": user.email,
        "phoneNumber": user.phone_number,
        "role": user.role.value,
        "createdAt": iso_utc(user.created_at),
        "updatedAt": iso_utc(user.updated_at),
        "mustChangePassword": user.must_change_password,
    }


def _issue_token(response: Response, user: User) -> str:
    """Buat JWT untuk user dan pasang sebagai httpOnly cookie (login & ganti password)."""
    access_token = create_access_token(
        user_id=user.id,
        email=user.email,
        role=user.role.value,
        full_name=user.username,
        must_change_password=user.must_change_password,
    )
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,       # Tidak bisa diakses JavaScript
        samesite="lax",      # Proteksi CSRF
        secure=COOKIE_SECURE,  # env COOKIE_SECURE=true kalau pakai HTTPS
        max_age=JWT_EXPIRE_MINUTES * 60,  # samakan dengan umur JWT
    )
    return access_token


# ==========================
# POST /api/auth/login
# ==========================
@router.post("/login")
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Login user dan return JWT token.
    Menggantikan NextAuth credentials provider.

    - Verifikasi email + password
    - Kompatibel dengan hash bcryptjs dari user lama
    - Return token di body DAN set httpOnly cookie
    - Rate limit login gagal: 5x per email+IP / 20x per IP dalam 15 menit
      → 429 + Retry-After (password tidak dicek selama terkunci)
    """
    ip = request.client.host if request.client else "unknown"
    account_key = f"{ip}|{body.email.lower()}"

    wait = max(
        login_limiter_account.retry_after(account_key),
        login_limiter_ip.retry_after(ip),
    )
    if wait:
        logger.warning(f"Login diblokir sementara: {body.email} dari {ip} ({wait}s)")
        minutes = math.ceil(wait / 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Too many failed login attempts. "
                f"Try again in {minutes} minute{'s' if minutes != 1 else ''}."
            ),
            headers={"Retry-After": str(wait)},
        )

    # Cari user berdasarkan email
    user = db.query(User).filter(User.email == body.email).first()

    # Cek user ada dan password cocok
    # verify_password kompatibel dengan hash bcryptjs
    if not user or not verify_password(body.password, user.password):
        login_limiter_account.record_failure(account_key)
        login_limiter_ip.record_failure(ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    # Hitungan per IP sengaja tidak direset: satu akun valid tidak boleh
    # "mencuci" percobaan gagal ke email lain dari IP yang sama.
    login_limiter_account.reset(account_key)

    access_token = _issue_token(response, user)

    logger.info(f"User login: {user.email} ({user.role.value})")

    return {
        "success": True,
        "message": "Signed in",
        "access_token": access_token,
        "token_type": "bearer",
        "user": _format_user(user),
    }


# ==========================
# POST /api/auth/register
# ==========================
@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    body: RegisterRequest,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    """
    Registrasi user baru — hanya ADMIN (body boleh berisi role ADMIN,
    jadi endpoint ini tidak boleh terbuka untuk publik).
    Port dari src/app/api/auth/register/route.ts

    Validasi:
    - Semua field wajib diisi
    - Format email valid
    - Password minimal 8 karakter (core.validation.PASSWORD_MIN_LENGTH)
    - Email belum terdaftar
    """
    # Validasi format email (sudah dilakukan Pydantic EmailStr)
    # Cek email sudah ada
    existing = db.query(User).filter(User.email == body.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email is already registered",
        )

    # Hash password (kompatibel dengan bcryptjs)
    hashed_pw = hash_password(body.password)
    now = datetime.now(timezone.utc)

    # Buat user baru
    new_user = User(
        id=generate_cuid(),
        username=body.fullName,
        email=body.email,
        password=hashed_pw,
        phone_number=body.phoneNumber,
        role=Role(body.role),
        must_change_password=True,  # admin yang memilih password ini
        created_at=now,
        updated_at=now,
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    logger.info(f"User baru terdaftar: {new_user.email} ({new_user.role.value})")

    return {
        "success": True,
        "message": "Account created",
        "user": _format_user(new_user),
    }


# ==========================
# POST /api/auth/logout
# ==========================
@router.post("/logout")
async def logout(response: Response):
    """
    Logout — hapus cookie token.
    """
    # Atribut harus sama dengan saat set_cookie agar browser menghapusnya
    response.delete_cookie("access_token", httponly=True, samesite="lax", secure=COOKIE_SECURE)
    response.delete_cookie("refresh_token", httponly=True, samesite="lax", secure=COOKIE_SECURE)

    return {"success": True, "message": "Signed out"}


# ==========================
# GET /api/auth/me
# ==========================
@router.get("/me")
def get_me(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Dapatkan data user yang sedang login.
    Membutuhkan JWT token yang valid.
    Format `user` sama dengan response login (_format_user) karena frontend
    (verifySession) menyimpannya ke tempat yang sama.
    """
    user = db.query(User).filter(User.id == current_user["id"]).first()
    if not user:
        raise HTTPException(status_code=401, detail="This account no longer exists")
    return {
        "success": True,
        "user": _format_user(user),
    }


# ==========================
# POST /api/auth/change-password
# ==========================
@router.post("/change-password")
def change_password(
    body: dict,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Ganti password sendiri. Wajib sesudah admin membuat/me-reset akun
    (must_change_password); selebihnya boleh kapan saja dari menu profil.
    Token baru dikembalikan + dipasang di cookie (tanda mustChangePassword hilang).
    """
    current = body.get("currentPassword")
    new = body.get("newPassword")
    if not isinstance(current, str) or not isinstance(new, str):
        raise HTTPException(status_code=400, detail="Enter your current and new password")
    try:
        check_password(new)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    wait = change_pw_limiter.retry_after(current_user["id"])
    if wait:
        minutes = math.ceil(wait / 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many wrong attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}.",
            headers={"Retry-After": str(wait)},
        )

    user = db.query(User).filter(User.id == current_user["id"]).first()
    if not verify_password(current, user.password):
        change_pw_limiter.record_failure(current_user["id"])
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    change_pw_limiter.reset(current_user["id"])
    if current == new:
        raise HTTPException(status_code=400, detail="Choose a password different from the current one")

    user.password = hash_password(new)
    user.must_change_password = False
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    logger.info(f"Password changed: {user.email}")
    return {
        "success": True,
        "message": "Password updated",
        "access_token": _issue_token(response, user),
        "user": _format_user(user),
    }