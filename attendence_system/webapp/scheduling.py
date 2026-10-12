"""When a class's attendance is open. All times are server-local."""
from __future__ import annotations

from datetime import datetime, timedelta


def class_window(class_date: str, start: str, end: str, grace_minutes: int, now: datetime | None = None) -> dict:
    now = now or datetime.now()
    s = datetime.fromisoformat(f"{class_date}T{start}")
    e = datetime.fromisoformat(f"{class_date}T{end}")
    f = e + timedelta(minutes=grace_minutes)
    if now < s:
        state = "upcoming"
    elif now <= e:
        state = "live"
    elif now <= f:
        state = "grace"          # class over, still editable
    else:
        state = "closed"
    return {"start": s.isoformat(timespec="seconds"), "end": e.isoformat(timespec="seconds"),
            "freeze": f.isoformat(timespec="seconds"), "state": state,
            "open": state in ("live", "grace"), "now": now.isoformat(timespec="seconds")}


def overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    return a_start < b_end and b_start < a_end
