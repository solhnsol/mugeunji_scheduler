"""월간 예약 오픈·초기화 스케줄 계산."""
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

from src.automation_config import (
    KST,
    ScheduleConfig,
    format_monthly_open_label,
    get_last_monthly_open,
    get_next_monthly_open,
    monthly_open_cycle_key,
)

OPEN_GRACE_MINUTES = 30


def parse_opens_at(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).astimezone(KST)
    except (ValueError, TypeError):
        return None


def resolve_auto_monthly_schedule(
    now: datetime, config: ScheduleConfig, last_cleared_for: Optional[str]
) -> Tuple[bool, str, Optional[str], bool]:
    """
    Returns: is_open, message, cycle_key_to_mark_cleared, should_clear_now
    """
    last_open = get_last_monthly_open(now, config)
    next_open = get_next_monthly_open(now, config)
    clear_before_next = next_open - timedelta(minutes=config.monthly_clear_minutes_before)
    next_cycle_key = monthly_open_cycle_key(next_open)
    last_cycle_key = monthly_open_cycle_key(last_open)

    if now < last_open:
        return False, f"예약은 {format_monthly_open_label(last_open)}부터 가능합니다.", None, False

    if config.auto_monthly_clear_enabled and clear_before_next <= now < next_open:
        should_clear = last_cleared_for != next_cycle_key
        msg = (
            f"예약자 명단이 초기화되었습니다. 예약은 {format_monthly_open_label(next_open)}부터 가능합니다."
            if should_clear
            else f"예약은 {format_monthly_open_label(next_open)}부터 가능합니다."
        )
        return False, msg, next_cycle_key if should_clear else None, should_clear

    grace_end = last_open + timedelta(minutes=OPEN_GRACE_MINUTES)
    if (
        config.auto_monthly_clear_enabled
        and last_open <= now < grace_end
        and last_cleared_for != last_cycle_key
    ):
        return True, "예약 가능", last_cycle_key, True

    return True, "예약 가능", None, False


def resolve_manual_monthly_schedule(
    now: datetime,
    opens_at: datetime,
    opens_at_raw: str,
    last_cleared_for: Optional[str],
    clear_enabled: bool,
) -> Tuple[bool, str, Optional[str], bool]:
    if now < opens_at:
        return False, f"예약은 {format_monthly_open_label(opens_at)}부터 가능합니다.", None, False

    if clear_enabled and last_cleared_for != opens_at_raw:
        return True, "예약 가능", opens_at_raw, True

    return True, "예약 가능", None, False
