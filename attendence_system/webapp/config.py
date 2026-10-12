"""Central configuration. Override anything with environment variables."""
from __future__ import annotations

import os
import secrets
from pathlib import Path

WEBAPP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = WEBAPP_DIR.parent                       # folder that holds face_engine.py / enroll.py / attendance.py
DATA_DIR = Path(os.environ.get("ATT_DATA_DIR", PROJECT_DIR / "data")).resolve()
DB_PATH = DATA_DIR / "attendance.db"
ENROLL_DIR = DATA_DIR / "enroll"                      # per-student crops
SESSION_DIR = DATA_DIR / "sessions"                   # class photos, face crops, annotated photos
UPLOAD_TMP = DATA_DIR / "tmp"

# Demo credentials (requested). Change via env before real use.
ADMIN_USER = os.environ.get("ATT_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ATT_ADMIN_PASS", "admin")
EMPLOYEE_USER = os.environ.get("ATT_EMPLOYEE_USER", "employee")
EMPLOYEE_PASS = os.environ.get("ATT_EMPLOYEE_PASS", "employee")

MODEL_PACK = os.environ.get("ATT_MODEL_PACK", "buffalo_l")
USE_GPU = os.environ.get("ATT_GPU", "0") == "1"

# Defaults copied from attendance.py / enroll.py CLI defaults; editable in Admin > Settings
DEFAULT_SETTINGS = {
    "match_thresh": 0.40,      # cosine >= this  -> Present
    "review_thresh": 0.30,     # cosine >= this  -> suggested for review
    "grace_minutes": 15,       # attendance stays editable this long after class end
    "det_size": 1280,
    "tiles": 2,
    "det_thresh": 0.45,
    "min_face": 24,
    "min_blur": 25.0,
    "max_yaw": 0.9,
    "warn_blur": 40.0,         # enrollment sharpness warning
    "duplicate_thresh": 0.60,  # two enrolled students this similar get flagged
    "max_photos_per_upload": 10,
}


def secret_key() -> str:
    """Stable cookie-signing key, generated once and kept in the data folder."""
    env = os.environ.get("ATT_SECRET_KEY")
    if env:
        return env
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    p = DATA_DIR / ".secret_key"
    if not p.exists():
        p.write_text(secrets.token_hex(32))
    return p.read_text().strip()
