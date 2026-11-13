"""JSON telemetri Raspberry Pi format tim sensor (Arga, 2026-11-11) terbaca lengkap."""
from core.scheduler import _read_water_quality, _read_pixhawk_health


def test_reads_sensor_team_format():
    data = {"ph": 7.42, "tds_ppm": 320.5, "ec_us_cm": 641.0, "do_mg_l": 6.85,
            "temperature_c": 28.3, "timestamp": "2026-11-11T00:10:00Z"}
    assert _read_water_quality(data) == {
        "ph_level": 7.42, "tds_value": 320.5, "dissolved_oxygen": 6.85, "water_temp": 28.3,
    }


def test_missing_value_saves_nothing():
    assert _read_water_quality({"ph": 7.42, "tds_ppm": 320.5, "do_mg_l": 6.85}) is None


def test_pixhawk_health_ok_only_when_true():
    data = {"pixhawk_sensors": {"gyro_ok": True, "accel_ok": False, "compass_ok": True, "baro_ok": False}}
    assert _read_pixhawk_health(data) == {"gyroscope": "OK", "accelerometer": None, "magnetometer": "OK"}


def test_pixhawk_health_missing_or_bad_is_empty():
    empty = {"gyroscope": None, "accelerometer": None, "magnetometer": None}
    assert _read_pixhawk_health({}) == empty
    assert _read_pixhawk_health({"pixhawk_sensors": "rusak"}) == empty
    assert _read_pixhawk_health({"pixhawk_sensors": {"gyro_ok": "true"}}) == empty
