"""JSON telemetri Raspberry Pi format tim sensor (Arga, 2026-11-11) terbaca lengkap."""
from core.scheduler import _read_water_quality


def test_reads_sensor_team_format():
    data = {"ph": 7.42, "tds_ppm": 320.5, "ec_us_cm": 641.0, "do_mg_l": 6.85,
            "temperature_c": 28.3, "timestamp": "2026-11-11T00:10:00Z"}
    assert _read_water_quality(data) == {
        "ph_level": 7.42, "tds_value": 320.5, "dissolved_oxygen": 6.85, "water_temp": 28.3,
    }


def test_missing_value_saves_nothing():
    assert _read_water_quality({"ph": 7.42, "tds_ppm": 320.5, "do_mg_l": 6.85}) is None
