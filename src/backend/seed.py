"""
Seed script — Carter Island AUV Database
Jalankan dari folder src/backend/ (atau `npm run db:seed -- --fresh` dari root):

    python seed.py --fresh   # KOSONGKAN semua data, lalu buat 1 akun admin
    python seed.py --demo    # tambah data contoh (aman diulang: misi demo lama diganti)
    python seed.py --fresh --demo   # keduanya: database bersih + data contoh

--fresh menghapus semua misi, telemetri, deteksi, rekaman (beserta file video)
dan akun — minta konfirmasi ketik DELETE dulu. Hasilnya seperti instalasi baru.

--demo membuat:
  - akun admin (kalau belum ada) + 1 akun USER
  - 7 monitoring sessions (Completed, 1 sengaja kosong)
  - telemetri, status AUV, deteksi, fish count, dan klip video dummy per sesi

Semua akun yang dibuat memakai password sementara acak (dicetak sekali di
terminal) dan wajib diganti saat login pertama — tidak ada password bawaan.
"""

import sys
import os
import random
from datetime import datetime, timezone, timedelta
from typing import List

# Pastikan path backend bisa diimport
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database.connection import get_db, init_db, check_db_connection
from database.models import (
    User, MonitoringSession, Telemetry, AUVStatus, Detection, FishCount,
    VideoPath, VideoStream, Role, SessionStatus
)
from database.crud.fish_counts import recompute_fish_counts
from config import RECORDINGS_DIR
from routers.recordings import delete_recording_files
from core.cuid import generate_cuid
from auth.password import hash_password, generate_temporary_password

# ── Config ────────────────────────────────────────────────────────────────────

ADMIN = dict(username='Administrator', email='admin@carterisland.com', phone_number='+62-812-3456-7890')
DEMO_USER = dict(username='Carter Island User', email='user@carterisland.com', phone_number='+62-812-3456-7891')

# Harus sama persis dengan nama kelas model YOLO (lihat T8)
SPECIES = ['Kerapu', 'Bandeng', 'Nila', 'Bawal']  # nama kelas model best.pt
HEADINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

# Misi demo milik akun USER (sisanya milik ADMIN)
USER_LOCATIONS = {'Survei Yogya', 'Survei Semarang'}

# Sessions: (location, days_ago, duration_hours, duration_minutes, kosong)
# kosong=True → tanpa telemetri/deteksi/rekaman, untuk uji tampilan "No data"
SESSION_CONFIGS = [
    ('Survei Bali',     49, 1, 45, False),
    ('Survei Jakarta',  42, 2, 30, False),
    ('Survei Solo',     36, 3,  0, False),
    ('Survei Yogya',    30, 1, 50, False),
    ('Survei Semarang', 20, 2, 15, False),
    ('Survei Kosong',   10, 0, 30, True),
    ('Survei Laut',      0, 0, 42, False),  # paling baru
]


def rnd(a: float, b: float, decimals: int = 2) -> float:
    return round(random.uniform(a, b), decimals)


def make_timestamp(base: datetime, offset_minutes: int) -> datetime:
    return base + timedelta(minutes=offset_minutes)


def make_dummy_video(path: str, label: str, seconds: int = 10, fps: int = 10) -> None:
    """
    Klip kecil lewat write_recording milik perekam asli → MP4 H.264 yang sama
    persis dengan rekaman sungguhan, supaya putar/unduh/hapus/thumbnail bisa diuji.
    """
    import queue
    import cv2  # hanya untuk --demo (impor perekam juga memuat torch/aiortc)
    import numpy as np
    from video.detection_track import write_recording
    frames: queue.Queue = queue.Queue()
    for i in range(seconds * fps):
        frame = np.full((240, 320, 3), (90, 60, 20), np.uint8)
        cv2.putText(frame, label, (10, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.putText(frame, f"{i / fps:4.1f}s", (10, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        frames.put((i / fps, frame))  # (detik, frame) — pts = durasi asli klip
    frames.put(None)
    write_recording(path, frames)


# ── Akun ──────────────────────────────────────────────────────────────────────

def create_account(db, role: Role, username: str, email: str, phone_number: str) -> User:
    """Akun baru dengan password sementara (wajib diganti saat login pertama)."""
    temporary_password = generate_temporary_password()
    now = datetime.now(timezone.utc)
    user = User(
        id=generate_cuid(), username=username, email=email, phone_number=phone_number,
        password=hash_password(temporary_password), role=role, must_change_password=True,
        created_at=now, updated_at=now,
    )
    db.add(user)
    db.flush()
    print(f"   {role.value:<5} {email}  password sementara: {temporary_password}")
    return user


def get_or_create(db, role: Role, account: dict) -> User:
    existing = db.query(User).filter(User.email == account['email']).first()
    if existing:
        print(f"   {role.value:<5} {existing.email} sudah ada (password tidak diubah)")
        return existing
    return create_account(db, role, **account)


# ── --fresh ───────────────────────────────────────────────────────────────────

def fresh(db) -> None:
    """Kosongkan semua data lalu buat satu akun admin. Minta konfirmasi dulu."""
    counts = {
        'akun': db.query(User).count(),
        'misi': db.query(MonitoringSession).count(),
        'rekaman': db.query(VideoPath).count(),
    }
    print("--fresh akan MENGHAPUS PERMANEN: " + ", ".join(f"{n} {k}" for k, n in counts.items())
          + " (beserta telemetri, deteksi, dan file video).")
    if input("Ketik DELETE untuk lanjut: ").strip() != "DELETE":
        print("Dibatalkan — tidak ada yang dihapus.")
        sys.exit(1)

    file_names = [name for (name,) in db.query(VideoPath.file_name).all()]
    # Anak dulu, baru induk — tidak bergantung pada CASCADE di skema lama
    for model in (Detection, FishCount, Telemetry, AUVStatus, VideoPath, VideoStream, MonitoringSession, User):
        db.query(model).delete(synchronize_session=False)
    db.commit()
    delete_recording_files(file_names)  # setelah commit: kalau DB gagal, video tidak ikut hilang
    print("Semua data dihapus.\n")

    print("Akun admin:")
    create_account(db, Role.ADMIN, **ADMIN)
    db.commit()
    print("\nDatabase fresh. Login dengan akun di atas lalu ganti password-nya;")
    print("tambahkan pengguna lain lewat halaman Users.")


# ── --demo ────────────────────────────────────────────────────────────────────

def remove_demo_sessions(db) -> None:
    """
    Hapus misi demo lama berdasarkan nama misi di SESSION_CONFIGS — bukan
    berdasarkan akun, supaya misi asli tidak ikut hilang. Telemetri/deteksi/
    fish count/rekaman ikut terhapus lewat cascade; file video dihapus setelah
    commit (pola sama dengan DELETE /api/sessions).
    """
    names = [loc for loc, *_ in SESSION_CONFIGS]
    sessions = db.query(MonitoringSession).filter(MonitoringSession.location_name.in_(names)).all()
    file_names = [v.file_name for s in sessions for v in s.video_paths]
    for s in sessions:
        db.delete(s)
    db.commit()
    delete_recording_files(file_names)
    if sessions:
        print(f"{len(sessions)} misi demo lama diganti ({len(file_names)} file video)\n")


def demo(db) -> None:
    remove_demo_sessions(db)
    print("Menambah data demo...\n")

    print("Akun:")
    admin = get_or_create(db, Role.ADMIN, ADMIN)
    user = get_or_create(db, Role.USER, DEMO_USER)

    print("\nMisi:")
    now = datetime.now(timezone.utc)

    for loc, days_ago, dur_h, dur_m, kosong in SESSION_CONFIGS:
        duration_secs = dur_h * 3600 + dur_m * 60
        # 00:00–02:30 UTC = 07:00–09:30 WIB
        start = (now - timedelta(days=days_ago)).replace(
            hour=random.choice([0, 1, 2]), minute=random.choice([0, 30]), second=0, microsecond=0)
        # misi harus sudah selesai sebelum seed dijalankan
        start = min(start, now - timedelta(seconds=duration_secs + 600)).replace(second=0, microsecond=0)
        end = start + timedelta(seconds=duration_secs) if duration_secs > 0 else None
        status = SessionStatus.COMPLETED if end else SessionStatus.RUNNING

        session = MonitoringSession(
            id=generate_cuid(),
            user_id=user.id if loc in USER_LOCATIONS else admin.id,
            location_name=loc,
            start_time=start,
            end_time=end,
            status=status,
            created_at=start,
            updated_at=end or now,
        )
        db.add(session)
        db.flush()

        print(f"   {loc} ({start.strftime('%Y-%m-%d %H:%M')} → {end.strftime('%H:%M') if end else 'running'}, {dur_h}j {dur_m}m){' [kosong]' if kosong else ''}")

        if kosong:
            continue

        # ── Telemetry (1 per 5 menit) ────────────────────────────────────────
        n_telemetry = max(1, duration_secs // 300) if duration_secs > 0 else 8
        tel_ids = []
        for i in range(n_telemetry):
            t = make_timestamp(start, i * 5)
            tel = Telemetry(
                id=generate_cuid(),
                session_id=session.id,
                timestamp=t,
                depth=rnd(1.5, 5.0),
                ph_level=rnd(7.2, 8.4),
                tds_value=rnd(280, 380),
                dissolved_oxygen=rnd(4.5, 8.5),
                water_temp=rnd(26.0, 30.5),
                is_synced=False,
                created_at=t,
            )
            db.add(tel)
            tel_ids.append(tel.id)
        db.flush()

        # ── AUV Status (1 per 2 menit) ───────────────────────────────────────
        n_auv = max(1, duration_secs // 120) if duration_secs > 0 else 20
        for i in range(n_auv):
            t = make_timestamp(start, i * 2)
            db.add(AUVStatus(
                id=generate_cuid(),
                session_id=session.id,
                timestamp=t,
                roll=rnd(-5.0, 5.0),
                pitch=rnd(-3.0, 3.0),
                yaw=rnd(0.0, 360.0),
                depth=rnd(1.5, 5.0),
                heading=random.choice(HEADINGS),
                speed=rnd(0.5, 3.5),
                gyroscope='{"x":0.01,"y":0.02,"z":0.0}',
                accelerometer='{"x":0.0,"y":0.0,"z":9.8}',
                magnetometer='{"x":25.0,"y":3.0,"z":-42.0}',
                is_synced=False,
                created_at=t,
            ))
        db.flush()

        # ── Detections (per frame, 1–4 ikan per spesies) ─────────────────────
        species_in_session = random.sample(SPECIES, random.randint(2, len(SPECIES)))
        frames = random.sample(range(100, 2000), random.randint(4, 8))

        for frame_no in frames:
            t = make_timestamp(start, random.randint(1, max(1, duration_secs // 60)))
            tel_id = random.choice(tel_ids) if tel_ids else None
            depth = rnd(1.5, 5.0)
            for sp in random.sample(species_in_session, random.randint(1, len(species_in_session))):
                for _ in range(random.randint(1, 4)):
                    db.add(Detection(
                        id=generate_cuid(),
                        session_id=session.id,
                        telemetry_id=tel_id,
                        species_name=sp,
                        confidence=rnd(0.62, 0.97),
                        depth_at_detection=depth,
                        frame_number=frame_no,
                        detected_at=t,
                        is_synced=False,
                        created_at=t,
                    ))
        db.flush()

        # ── Fish Counts (dihitung dari detections, sama seperti saat stream) ─
        recompute_fish_counts(db, session.id)

        # ── Video Path (klip dummy) ──────────────────────────────────────────
        file_name = f"recording_seed_{loc.replace(' ', '_').lower()}_{start.strftime('%Y%m%d_%H%M%S')}.mp4"
        file_path = os.path.join(RECORDINGS_DIR, file_name)
        make_dummy_video(file_path, loc)
        db.add(VideoPath(
            id=generate_cuid(),
            session_id=session.id,
            file_name=file_name,
            file_path=file_path,
            file_size=os.path.getsize(file_path),
            format='mp4',
            duration=10.0,
            created_at=start,
            updated_at=end or now,
        ))
        db.flush()

    db.commit()
    print(f"\nData demo ditambahkan: {len(SESSION_CONFIGS)} misi.")
    print("Password akun baru dicetak di atas; akun yang sudah ada tidak diubah.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main(args: List[str]) -> None:
    # Terminal Windows (cp1252) gagal mencetak '→' dan '—' tanpa ini
    sys.stdout.reconfigure(encoding='utf-8')
    if not ({'--fresh', '--demo'} & set(args)):
        print(__doc__)  # tanpa opsi tidak menyentuh database
        sys.exit(1)
    if not check_db_connection():
        print("Tidak bisa konek ke database! Periksa DATABASE_URL di .env")
        sys.exit(1)
    init_db()
    db = next(get_db())
    if '--fresh' in args:
        fresh(db)
    if '--demo' in args:
        print()
        demo(db)


if __name__ == '__main__':
    main(sys.argv[1:])
