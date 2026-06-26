"""예약·자동화 스케줄 설정 (system_settings 기반)."""
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Tuple

KST = timezone(timedelta(hours=9))

WEEKDAY_TO_DAY = {
    0: "Monday",
    1: "Tuesday",
    2: "Wednesday",
    3: "Thursday",
    4: "Friday",
    5: "Saturday",
    6: "Sunday",
}

DAY_TO_WEEKDAY = {v: k for k, v in WEEKDAY_TO_DAY.items()}

WEEKDAY_LABELS_KO = ["월", "화", "수", "목", "금", "토", "일"]

RESERVATION_MONTHLY = "monthly"
RESERVATION_FREE = "free"

AUTOMATION_SETTING_DEFAULTS: Dict[str, str] = {
    "monthly_clear_minutes_before": "20",
    "auto_monthly_clear_enabled": "true",
    "auto_free_reset_enabled": "true",
    "free_reset_weekday": "6",
    "free_reset_hour": "20",
    "free_reset_minute": "59",
    "free_booking_start_hour": "21",
    "free_booking_start_minute": "0",
    "free_booking_window_hours": "24",
}


def now_kst() -> datetime:
    return datetime.now(KST)


def _int_setting(settings: Dict, key: str, default: int) -> int:
    raw = settings.get(key)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _bool_setting(settings: Dict, key: str, default: bool) -> bool:
    raw = settings.get(key)
    if raw is None:
        return default
    return str(raw).lower() == "true"


@dataclass
class ScheduleConfig:
    monthly_clear_minutes_before: int = 20
    auto_monthly_clear_enabled: bool = True
    auto_free_reset_enabled: bool = True
    free_reset_weekday: int = 6
    free_reset_hour: int = 20
    free_reset_minute: int = 59
    free_booking_start_hour: int = 21
    free_booking_start_minute: int = 0
    free_booking_window_hours: int = 24

    @classmethod
    def from_settings(cls, settings: Dict) -> "ScheduleConfig":
        weekday = _int_setting(settings, "free_reset_weekday", 6)
        weekday = max(0, min(6, weekday))
        hours = _int_setting(settings, "free_booking_window_hours", 24)
        hours = max(1, min(48, hours))
        clear_before = _int_setting(settings, "monthly_clear_minutes_before", 20)
        clear_before = max(0, min(24 * 60, clear_before))
        return cls(
            monthly_clear_minutes_before=clear_before,
            auto_monthly_clear_enabled=_bool_setting(settings, "auto_monthly_clear_enabled", True),
            auto_free_reset_enabled=_bool_setting(settings, "auto_free_reset_enabled", True),
            free_reset_weekday=weekday,
            free_reset_hour=max(0, min(23, _int_setting(settings, "free_reset_hour", 20))),
            free_reset_minute=max(0, min(59, _int_setting(settings, "free_reset_minute", 59))),
            free_booking_start_hour=max(0, min(23, _int_setting(settings, "free_booking_start_hour", 21))),
            free_booking_start_minute=max(0, min(59, _int_setting(settings, "free_booking_start_minute", 0))),
            free_booking_window_hours=hours,
        )

    def to_settings_dict(self) -> Dict[str, str]:
        return {
            "monthly_clear_minutes_before": str(self.monthly_clear_minutes_before),
            "auto_monthly_clear_enabled": str(self.auto_monthly_clear_enabled).lower(),
            "auto_free_reset_enabled": str(self.auto_free_reset_enabled).lower(),
            "free_reset_weekday": str(self.free_reset_weekday),
            "free_reset_hour": str(self.free_reset_hour),
            "free_reset_minute": str(self.free_reset_minute),
            "free_booking_start_hour": str(self.free_booking_start_hour),
            "free_booking_start_minute": str(self.free_booking_start_minute),
            "free_booking_window_hours": str(self.free_booking_window_hours),
        }


def get_last_free_reset_time(dt: datetime, config: ScheduleConfig) -> datetime:
    local = dt.astimezone(KST)
    tw = config.free_reset_weekday
    days_since = (local.weekday() - tw) % 7
    reset_date = (local - timedelta(days=days_since)).date()
    reset_time = datetime.combine(
        reset_date,
        time(config.free_reset_hour, config.free_reset_minute),
        tzinfo=KST,
    )
    if local < reset_time:
        reset_time -= timedelta(days=7)
    return reset_time


def get_next_free_reset_time(dt: datetime, config: ScheduleConfig) -> datetime:
    last = get_last_free_reset_time(dt, config)
    return last + timedelta(days=7)


def get_free_week_start(dt: datetime, config: ScheduleConfig) -> datetime:
    return get_last_free_reset_time(dt, config) + timedelta(minutes=1)


def get_free_week_end(dt: datetime, config: ScheduleConfig) -> datetime:
    return get_free_week_start(dt, config) + timedelta(days=7) - timedelta(minutes=1)


def get_free_booking_window(dt: datetime, config: ScheduleConfig) -> Tuple[datetime, datetime]:
    local = dt.astimezone(KST)
    today_start = local.replace(
        hour=config.free_booking_start_hour,
        minute=config.free_booking_start_minute,
        second=0,
        microsecond=0,
    )
    if local >= today_start:
        start = today_start
    else:
        start = today_start - timedelta(days=1)
    end = start + timedelta(hours=config.free_booking_window_hours - 1)
    return start, end


def iter_slots_between(start: datetime, end: datetime) -> List[Dict[str, object]]:
    slots: List[Dict[str, object]] = []
    current = start.astimezone(KST).replace(minute=0, second=0, microsecond=0)
    end_local = end.astimezone(KST)
    while current <= end_local:
        slots.append({
            "day": WEEKDAY_TO_DAY[current.weekday()],
            "time_index": current.hour,
        })
        current += timedelta(hours=1)
    return slots


def slot_key(day: str, time_index: int) -> str:
    return f"{day}-{time_index}"


def slots_in_booking_window(dt: datetime, config: ScheduleConfig) -> List[Dict[str, object]]:
    start, end = get_free_booking_window(dt, config)
    return iter_slots_between(start, end)
