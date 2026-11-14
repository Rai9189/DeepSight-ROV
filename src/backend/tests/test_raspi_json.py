"""JSON telemetri Raspberry Pi format tim sensor (Arga, 2026-11-11) terbaca lengkap."""
from core.scheduler import _read_water_quality, _read_pixhawk_health


def test_reads_sensor_team_format():
    data = {"ph": 7.42, "tds_ppm": 320.5, "ec_us_cm": 641.0, "do_mg_l": 6.85,
            "temperature_c": 28.3, "timestamp": "2026-11-11T00:10:00Z"}
    assert _read_water_quality(data) == {
        "ph_level": 7.42, "tds_value": 320.5, "dissolved_oxygen": 6.85, "water_temp": 28.3,
    }


def test_missing_or_bad_value_is_none_not_zero():
    # TDS belum terpasang (2026-11-14): sensor lain tetap tersimpan, TDS None (bukan 0)
    assert _read_water_quality({"ph": 7.42, "tds_ppm": None, "do_mg_l": 6.85, "temperature_c": "rusak"}) == {
        "ph_level": 7.42, "tds_value": None, "dissolved_oxygen": 6.85, "water_temp": None,
    }


def test_all_water_sensors_dead_saves_nothing():
    assert _read_water_quality({"ph": None, "tds_ppm": None}) is None
    assert _read_water_quality({}) is None


def test_pixhawk_health_ok_only_when_true():
    data = {"pixhawk_sensors": {"gyro_ok": True, "accel_ok": False, "compass_ok": True, "baro_ok": False}}
    assert _read_pixhawk_health(data) == {"gyroscope": "OK", "accelerometer": None, "magnetometer": "OK"}


def test_pixhawk_health_missing_or_bad_is_empty():
    empty = {"gyroscope": None, "accelerometer": None, "magnetometer": None}
    assert _read_pixhawk_health({}) == empty
    assert _read_pixhawk_health({"pixhawk_sensors": "rusak"}) == empty
    assert _read_pixhawk_health({"pixhawk_sensors": {"gyro_ok": "true"}}) == empty


# Format final Arga (2026-11-13): Pixhawk putus / nilai error dikirim null.
# Navigasi tak valid dilewati, tapi kualitas air tetap tersimpan.
from datetime import datetime  # noqa: E402
from core.scheduler import _read_navigation, _save_health_data  # noqa: E402
from database.models import MonitoringSession, SessionStatus, AUVStatus, Telemetry  # noqa: E402

FINAL = {"ph": 7.42, "tds_ppm": 114.5, "do_mg_l": 6.85, "temperature_c": 29.0, "depth": 0.0, "speed": None,
         "attitude": {"roll_deg": 1.2, "pitch_deg": -0.8, "yaw_deg": 132.0}, "compass": {"heading_deg": 132.0},
         "pixhawk_sensors": {"gyro_ok": True, "accel_ok": True, "compass_ok": False, "baro_ok": True},
         "sensor_status": {"tds_ok": True, "ph_ok": True, "do_ok": True, "pixhawk_ok": True},
         "timestamp": "2026-11-13T20:00:00Z"}


def _save(db, admin, data):
    t = datetime.utcnow()
    s = MonitoringSession(user_id=admin.id, location_name="Raspi", status=SessionStatus.RUNNING,
                          start_time=t, created_at=t, updated_at=t)
    db.add(s)
    db.commit()
    _save_health_data(data, _read_navigation(data), _read_water_quality(data))
    db.expire_all()
    rows = (db.query(AUVStatus).filter_by(session_id=s.id).all(),
            db.query(Telemetry).filter_by(session_id=s.id).all())
    s.status = SessionStatus.COMPLETED
    db.commit()
    return rows


def test_final_json_saves_navigation_and_water(db, admin):
    nav, water = _save(db, admin, FINAL)
    assert len(nav) == 1 and len(water) == 1
    assert (nav[0].roll, nav[0].heading, nav[0].speed) == (1.2, "132.0", 0.0)
    assert (nav[0].gyroscope, nav[0].accelerometer, nav[0].magnetometer) == ("OK", "OK", None)
    assert water[0].tds_value == 114.5


def test_pixhawk_null_still_saves_water(db, admin):
    nav, water = _save(db, admin, dict(FINAL, attitude=None, compass=None, pixhawk_sensors=None))
    assert len(nav) == 0 and len(water) == 1


def test_bad_attitude_value_still_saves_water(db, admin):
    for bad in (None, "nan", float("inf"), "rusak"):
        att = {"roll_deg": bad, "pitch_deg": 0.0, "yaw_deg": 0.0}
        nav, water = _save(db, admin, dict(FINAL, attitude=att))
        assert len(nav) == 0 and len(water) == 1, bad


def test_missing_tds_stored_as_null_not_zero(db, admin):
    nav, water = _save(db, admin, dict(FINAL, tds_ppm=None))
    assert len(water) == 1
    assert (water[0].ph_level, water[0].tds_value, water[0].water_temp) == (7.42, None, 29.0)


def test_missing_heading_keeps_attitude_with_null_heading(db, admin):
    for compass in (None, {}, {"heading_deg": None}, {"heading_deg": "nan"}):
        nav, water = _save(db, admin, dict(FINAL, compass=compass))
        assert len(nav) == 1 and len(water) == 1, compass
        assert (nav[0].roll, nav[0].heading) == (1.2, None), compass
