"""
Password hashing utility menggunakan passlib[bcrypt].

Kompatibel 100% dengan bcryptjs yang dipakai Next.js sebelumnya,
sehingga user lama TIDAK perlu reset password.

Alasan kompatibel:
- bcryptjs (Node.js) dan passlib bcrypt (Python) keduanya
  mengimplementasikan algoritma bcrypt yang sama (cost factor $2b$)
- Hash yang dibuat bcryptjs bisa diverifikasi passlib, dan sebaliknya
"""
import secrets

from passlib.context import CryptContext

# Konfigurasi bcrypt context
# schemes=["bcrypt"] → pakai algoritma bcrypt
# deprecated="auto" → hash lama otomatis di-upgrade kalau ada scheme baru
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    """
    Hash password menggunakan bcrypt.
    Output kompatibel dengan bcryptjs (Next.js).

    Contoh:
        hashed = hash_password("mypassword123")
        # "$2b$12$..." — format sama dengan bcryptjs
    """
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifikasi password terhadap hash yang tersimpan di DB.
    Bekerja untuk hash yang dibuat bcryptjs MAUPUN passlib.

    Contoh:
        ok = verify_password("mypassword123", "$2b$12$...")
        # True jika password cocok
    """
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        # Kalau hash formatnya tidak valid, anggap salah
        return False

# Kata pendek bertema laut — password sementara mudah dibaca & diketik ulang
_WORDS = (
    "anchor bay beacon buoy cape coral cove crab current deck delta dock dune "
    "ebb fin fjord gull harbor helm hull inlet island keel kelp lagoon "
    "lantern marlin mast pearl pier port reef ridge sail sand shell shoal "
    "shore skiff sonar sound spray squid star storm surf swell tide trench "
    "wake wave whale wharf wind anemone atoll barnacle drift gale mooring"
).split()


def generate_temporary_password() -> str:
    """
    Password sementara, mis. "kelp-harbor-4821" — dipakai admin saat membuat/
    me-reset akun dan wajib diganti saat login (users.must_change_password).
    ponytail: ~26 bit entropi; cukup karena login dibatasi 5x/15 menit dan
    hanya berlaku sampai login pertama. Tambah kata/angka kalau aturan berubah.
    """
    a, b = secrets.choice(_WORDS), secrets.choice(_WORDS)
    return f"{a}-{b}-{secrets.randbelow(10000):04d}"
