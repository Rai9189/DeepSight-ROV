"""
Backend for Playwright: rebuilds carter_island_e2e, then serves the app on it.

Started by playwright.config.ts with the backend venv, from src/backend. Playwright
refuses to start it while port 8000 is taken, so the DB is only reset when no other
backend is running. seed.py is not used.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import pymysql
import uvicorn
from dotenv import load_dotenv

E2E_DB = os.environ.get("E2E_DB", "carter_island_e2e")
PASSWORD = "rahasia88"

# Same guard as the plan: never drop anything that isn't a dedicated e2e database
if not E2E_DB.endswith("_e2e"):
    sys.exit(f"Refusing to reset '{E2E_DB}': name must end with _e2e")

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src", "backend"))
load_dotenv(os.path.join(BACKEND_DIR, "..", "..", ".env"))
base = os.environ["DATABASE_URL"].rsplit("/", 1)[0]
m = re.match(r"mysql(?:\+pymysql)?://([^:@]+):?([^@]*)@([^:/]+):?(\d*)", base)
conn = pymysql.connect(user=m[1], password=m[2], host=m[3], port=int(m[4] or 3306))
with conn.cursor() as c:
    c.execute(f"DROP DATABASE IF EXISTS {E2E_DB}")
    c.execute(f"CREATE DATABASE {E2E_DB}")
conn.close()

# load_dotenv never overrides these, so config.py sees the test values, not .env
os.environ.update({
    "DATABASE_URL": f"{base}/{E2E_DB}",
    "RECORDINGS_DIR": os.path.join(tempfile.gettempdir(), "carter_e2e_recordings"),
    "RTSP_URL": "rtsp://localhost:8554/cam",
    "RTSP_TRANSPORT": "tcp",
    "BASE_STATION_URL": "",  # test rows must never reach a real Base Station
    "CORS_ORIGINS": "http://localhost:3000",
    "COOKIE_SECURE": "false",
})
sys.path.insert(0, BACKEND_DIR)

from auth.password import hash_password  # noqa: E402
from database.connection import SessionLocal, init_db  # noqa: E402
from core.cuid import generate_cuid  # noqa: E402
from config import RECORDINGS_DIR  # noqa: E402
from database.models import (  # noqa: E402
    Detection, FishCount, MonitoringSession, Role, SessionStatus, Telemetry, User, VideoPath,
)

init_db()
db = SessionLocal()
hashed = hash_password(PASSWORD)
admin = User(username="Admin Tes", email="admin@tes.com", password=hashed, phone_number="0812", role=Role.ADMIN)
user = User(username="User Tes", email="user@tes.com", password=hashed, phone_number="0813", role=Role.USER)
db.add_all([admin, user])
db.flush()
now = datetime.now(timezone.utc)

# One real clip, copied per recording, so the players have something to play
shutil.rmtree(RECORDINGS_DIR, ignore_errors=True)
os.makedirs(RECORDINGS_DIR)
clip = os.path.join(RECORDINGS_DIR, "clip.mp4")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=2",
                "-pix_fmt", "yuv420p", clip], check=True)


def mission(name, owner, hours_ago, minutes=10, recording=True, keep_file=True):
    end = now - timedelta(hours=hours_ago)
    s = MonitoringSession(id=generate_cuid(), user_id=owner.id, location_name=name,
                          start_time=end - timedelta(minutes=minutes), end_time=end, status=SessionStatus.COMPLETED)
    db.add(s)
    db.flush()
    if recording:
        file_name = f"seed_{s.id}.mp4"
        path = os.path.join(RECORDINGS_DIR, file_name)
        if keep_file:
            shutil.copy(clip, path)
        db.add(VideoPath(session_id=s.id, file_name=file_name, file_path=path,
                         file_size=os.path.getsize(clip), format="mp4", duration=2.0))
    return s


mission("Misi Contoh", admin, 1)
mission("Misi User", user, 2)
mission("Misi Rename", user, 3)
mission("Misi Hapus", admin, 4)
mission("Misi File Hilang", admin, 5, keep_file=False)
mission("<img src=x onerror=window.__xss=1>", admin, 6)
mission("W" * 255, admin, 7)
mission("Misi Tanpa Rekaman", admin, 8, recording=False)
big = mission("Misi Besar", admin, 30, minutes=480)

# Bulk data: an 8-hour mission with 20,000 rows of each kind, plus 600 older missions
start = big.start_time
db.bulk_insert_mappings(Telemetry, [
    {"id": generate_cuid(), "session_id": big.id, "timestamp": start + timedelta(seconds=i * 1.44),
     "depth": i % 30, "ph_level": 7.5, "tds_value": 300, "dissolved_oxygen": 6.5, "water_temp": 28}
    for i in range(20_000)
])
db.bulk_insert_mappings(Detection, [
    {"id": generate_cuid(), "session_id": big.id, "species_name": "ikan", "confidence": 0.8,
     "detected_at": start + timedelta(seconds=i * 1.44), "frame_number": i}
    for i in range(20_000)
])
ids = [generate_cuid() for _ in range(600)]
db.bulk_insert_mappings(MonitoringSession, [
    {"id": sid, "user_id": admin.id, "location_name": f"Massal {i}", "status": SessionStatus.COMPLETED,
     "start_time": now - timedelta(days=2, hours=i), "end_time": now - timedelta(days=2, hours=i, minutes=-5)}
    for i, sid in enumerate(ids)
])
db.bulk_insert_mappings(FishCount, [
    {"id": generate_cuid(), "session_id": sid, "species_name": "ikan", "total_ikan": 3} for sid in ids
])
db.commit()
db.close()

if __name__ == "__main__":
    # Same options as main.py; loopback only, because the test password is public
    uvicorn.run("main:app", host="127.0.0.1", port=8000, loop="asyncio",
                access_log=False, timeout_graceful_shutdown=5)
