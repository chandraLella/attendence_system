"""SQLite schema and small helpers. One connection per call; WAL lets reads run during writes."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime

import numpy as np

from .config import DATA_DIR, DB_PATH, DEFAULT_SETTINGS

SCHEMA = """
CREATE TABLE IF NOT EXISTS sections(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  description TEXT DEFAULT '', created_at TEXT);

CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY, roll TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL,
  section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  status TEXT, n_views INTEGER DEFAULT 0, issues TEXT DEFAULT '', mean_emb BLOB,
  photo TEXT, created_at TEXT, updated_at TEXT);

CREATE TABLE IF NOT EXISTS student_views(
  id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  view TEXT, embedding BLOB, crop_path TEXT, aligned_path TEXT,
  det_score REAL, blur REAL, face_px INTEGER, yaw REAL);

CREATE TABLE IF NOT EXISTS employees(
  id INTEGER PRIMARY KEY, emp_id TEXT UNIQUE NOT NULL COLLATE NOCASE,
  name TEXT DEFAULT '', department TEXT DEFAULT '', created_at TEXT);

CREATE TABLE IF NOT EXISTS timetable(
  id INTEGER PRIMARY KEY, emp_id TEXT NOT NULL COLLATE NOCASE,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject TEXT DEFAULT '', room TEXT DEFAULT '',
  class_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, created_at TEXT);
CREATE INDEX IF NOT EXISTS ix_tt_date ON timetable(class_date);
CREATE INDEX IF NOT EXISTS ix_tt_emp ON timetable(emp_id, class_date);

CREATE TABLE IF NOT EXISTS sessions(
  id INTEGER PRIMARY KEY, timetable_id INTEGER UNIQUE NOT NULL REFERENCES timetable(id) ON DELETE CASCADE,
  opened_at TEXT, opened_by TEXT);

CREATE TABLE IF NOT EXISTS attendance(
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL,            -- Present | Absent
  source TEXT NOT NULL,            -- auto | manual | admin
  score REAL, evidence TEXT, updated_at TEXT, updated_by TEXT,
  PRIMARY KEY(session_id, student_id));

CREATE TABLE IF NOT EXISTS uploads(
  id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  batch INTEGER, filename TEXT, path TEXT, annotated TEXT,
  n_faces INTEGER, n_ok INTEGER, n_matched INTEGER, created_at TEXT, created_by TEXT);

CREATE TABLE IF NOT EXISTS detections(
  id INTEGER PRIMARY KEY, upload_id INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  crop TEXT, student_id INTEGER, score REAL, top1_student_id INTEGER, top1_score REAL,
  decision TEXT,                   -- MATCH | REVIEW | UNKNOWN | REJECTED
  reasons TEXT DEFAULT '');

CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, ts TEXT, actor TEXT, action TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
"""


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


@contextmanager
def db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.execute("PRAGMA journal_mode = WAL")
        con.executescript(SCHEMA)


def rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


def emb_to_blob(e: np.ndarray) -> bytes:
    return np.asarray(e, np.float32).tobytes()


def blob_to_emb(b: bytes) -> np.ndarray:
    return np.frombuffer(b, np.float32).copy()


def get_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    with db() as con:
        for r in con.execute("SELECT key, value FROM settings"):
            if r["key"] in s:
                s[r["key"]] = type(DEFAULT_SETTINGS[r["key"]])(json.loads(r["value"]))
    return s


def save_settings(new: dict) -> dict:
    with db() as con:
        for k, v in new.items():
            if k in DEFAULT_SETTINGS:
                v = type(DEFAULT_SETTINGS[k])(v)
                con.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, json.dumps(v)))
    return get_settings()


def audit(actor: str, action: str, detail: str = "", con=None) -> None:
    q = "INSERT INTO audit(ts, actor, action, detail) VALUES(?,?,?,?)"
    if con is not None:
        con.execute(q, (now_iso(), actor, action, detail))
    else:
        with db() as c:
            c.execute(q, (now_iso(), actor, action, detail))
