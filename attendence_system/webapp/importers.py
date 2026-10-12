"""Excel/CSV parsing for section mapping and timetable uploads, plus downloadable templates."""
from __future__ import annotations

import io
import re
from datetime import date, datetime, time, timedelta

import pandas as pd

from .database import audit, db, now_iso, rows
from .scheduling import overlaps


def read_table(raw: bytes, filename: str) -> pd.DataFrame:
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(io.BytesIO(raw), dtype=object)
    else:
        df = pd.read_excel(io.BytesIO(raw), dtype=object)
    df.columns = [str(c).strip() for c in df.columns]
    return df.dropna(how="all")


def find_col(df: pd.DataFrame, *patterns: str, required=True) -> str | None:
    for pat in patterns:
        for c in df.columns:
            if re.search(pat, c, re.I):
                return c
    if required:
        raise ValueError(f"Missing a column matching {patterns[0]!r}. Found: {list(df.columns)}")
    return None


def norm_name(s) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def cell(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()


# ------------------------------------------------------------------- section map
def import_section_map(raw: bytes, filename: str, create_missing: bool, actor: str) -> dict:
    """Columns: Student Name, Section (optional Roll No). Roll wins when present because
    names are not unique; name-only rows that match two students are reported, not guessed."""
    df = read_table(raw, filename)
    c_sec = find_col(df, r"section|class|batch")
    c_roll = find_col(df, r"roll|reg", required=False)
    c_name = find_col(df, r"name", required=not c_roll)
    out = {"assigned": 0, "created_sections": [], "not_found": [], "ambiguous": [], "skipped": 0}
    with db() as con:
        students = rows(con.execute("SELECT id, roll, name FROM students"))
        by_roll = {s["roll"].lower(): s for s in students}
        by_name: dict[str, list] = {}
        for s in students:
            by_name.setdefault(norm_name(s["name"]), []).append(s)
        sections = {r["name"].lower(): r["id"] for r in con.execute("SELECT id, name FROM sections")}
        for i, r in df.iterrows():
            sec = cell(r[c_sec]); roll = cell(r[c_roll]) if c_roll else ""; name = cell(r[c_name]) if c_name else ""
            if not sec or not (roll or name):
                out["skipped"] += 1; continue
            if sec.lower() not in sections:
                if not create_missing:
                    out["not_found"].append(f"row {i + 2}: section '{sec}' does not exist"); continue
                sections[sec.lower()] = con.execute("INSERT INTO sections(name,created_at) VALUES(?,?)", (sec, now_iso())).lastrowid
                out["created_sections"].append(sec)
            if roll and roll.lower() in by_roll:
                st = by_roll[roll.lower()]
            else:
                hits = by_name.get(norm_name(name), [])
                if len(hits) > 1:
                    out["ambiguous"].append(f"row {i + 2}: '{name}' matches {', '.join(h['roll'] for h in hits)}"); continue
                if not hits:
                    out["not_found"].append(f"row {i + 2}: no enrolled student '{name or roll}'"); continue
                st = hits[0]
            con.execute("UPDATE students SET section_id=?, updated_at=? WHERE id=?", (sections[sec.lower()], now_iso(), st["id"]))
            out["assigned"] += 1
        audit(actor, "section_import", f"{filename}: {out['assigned']} assigned", con)
    return out


# --------------------------------------------------------------------- timetable
def parse_date(v) -> str:
    if isinstance(v, (datetime, pd.Timestamp)):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, (int, float)) and not pd.isna(v):          # Excel serial
        return (datetime(1899, 12, 30) + timedelta(days=float(v))).date().isoformat()
    s = cell(v)
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%Y/%m/%d", "%d %b %Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f"unreadable date '{s}' (use YYYY-MM-DD)")


def parse_time(v) -> str:
    if isinstance(v, (datetime, pd.Timestamp)):
        return v.strftime("%H:%M")
    if isinstance(v, time):
        return v.strftime("%H:%M")
    if isinstance(v, (int, float)) and not pd.isna(v) and 0 <= float(v) < 1:   # Excel fraction of day
        m = round(float(v) * 1440)
        return f"{m // 60:02d}:{m % 60:02d}"
    s = cell(v).upper().replace(".", ":")
    for fmt in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M%p", "%I %p", "%I%p"):
        try:
            return datetime.strptime(s, fmt).strftime("%H:%M")
        except ValueError:
            pass
    raise ValueError(f"unreadable time '{cell(v)}' (use HH:MM, 24-hour)")


def conflicts(con, emp_id: str, section_id: int, d: str, st: str, en: str, ignore_id: int | None = None) -> list[str]:
    msgs = []
    for r in con.execute("SELECT t.id, t.emp_id, t.section_id, t.start_time, t.end_time, s.name sec FROM timetable t "
                         "JOIN sections s ON s.id=t.section_id WHERE class_date=? AND (emp_id=? OR section_id=?)",
                         (d, emp_id, section_id)):
        if r["id"] == ignore_id or not overlaps(st, en, r["start_time"], r["end_time"]):
            continue
        if r["emp_id"].lower() == emp_id.lower():
            msgs.append(f"{emp_id} already teaches {r['sec']} {r['start_time']}-{r['end_time']}")
        if r["section_id"] == section_id:
            msgs.append(f"{r['sec']} already has a class {r['start_time']}-{r['end_time']}")
    return msgs


def ensure_employee(con, emp_id: str, name: str = "") -> None:
    ex = con.execute("SELECT id, name FROM employees WHERE emp_id=?", (emp_id,)).fetchone()
    if not ex:
        con.execute("INSERT INTO employees(emp_id,name,created_at) VALUES(?,?,?)", (emp_id, name, now_iso()))
    elif name and not ex["name"]:
        con.execute("UPDATE employees SET name=? WHERE id=?", (name, ex["id"]))


def add_timetable_rows(con, entries: list[dict]) -> tuple[int, list[str]]:
    added, errors = 0, []
    for e in entries:
        if e["end_time"] <= e["start_time"]:
            errors.append(f"{e['label']}: end time must be after start time"); continue
        clash = conflicts(con, e["emp_id"], e["section_id"], e["class_date"], e["start_time"], e["end_time"])
        if clash:
            errors.append(f"{e['label']}: " + "; ".join(clash)); continue
        ensure_employee(con, e["emp_id"], e.get("emp_name", ""))
        con.execute("INSERT INTO timetable(emp_id,section_id,subject,room,class_date,start_time,end_time,created_at) "
                    "VALUES(?,?,?,?,?,?,?,?)", (e["emp_id"], e["section_id"], e.get("subject", ""), e.get("room", ""),
                                                e["class_date"], e["start_time"], e["end_time"], now_iso()))
        added += 1
    return added, errors


def import_timetable(raw: bytes, filename: str, create_missing: bool, actor: str) -> dict:
    df = read_table(raw, filename)
    c_emp = find_col(df, r"emp.*id|employee|staff.*id|faculty.*id")
    c_ename = find_col(df, r"emp.*name|faculty.*name|staff.*name|teacher", required=False)
    c_sec = find_col(df, r"section|class|batch")
    c_date = find_col(df, r"date|day")
    c_start = find_col(df, r"start|from")
    c_end = find_col(df, r"end|to\b|till")
    c_sub = find_col(df, r"subject|course", required=False)
    c_room = find_col(df, r"room|venue|hall", required=False)
    entries, errors, created = [], [], []
    with db() as con:
        sections = {r["name"].lower(): r["id"] for r in con.execute("SELECT id, name FROM sections")}
        for i, r in df.iterrows():
            label = f"row {i + 2}"
            try:
                emp = cell(r[c_emp]); sec = cell(r[c_sec])
                if not emp or not sec:
                    raise ValueError("employee id and section are required")
                if sec.lower() not in sections:
                    if not create_missing:
                        raise ValueError(f"section '{sec}' does not exist")
                    sections[sec.lower()] = con.execute("INSERT INTO sections(name,created_at) VALUES(?,?)", (sec, now_iso())).lastrowid
                    created.append(sec)
                entries.append({"label": label, "emp_id": emp, "emp_name": cell(r[c_ename]) if c_ename else "",
                                "section_id": sections[sec.lower()], "class_date": parse_date(r[c_date]),
                                "start_time": parse_time(r[c_start]), "end_time": parse_time(r[c_end]),
                                "subject": cell(r[c_sub]) if c_sub else "", "room": cell(r[c_room]) if c_room else ""})
            except ValueError as e:
                errors.append(f"{label}: {e}")
        added, errs = add_timetable_rows(con, entries)
        audit(actor, "timetable_import", f"{filename}: {added} added, {len(errors) + len(errs)} errors", con)
    return {"added": added, "errors": errors + errs, "created_sections": created}


# --------------------------------------------------------------------- templates
def template(kind: str) -> bytes:
    if kind == "sections":
        df = pd.DataFrame({"Student Name": ["Ravi Kumar", "Priya Sharma"], "Section": ["CSE-A", "CSE-B"],
                           "Roll No (optional)": ["21CS001", "21CS002"]})
    elif kind == "timetable":
        d = date.today().isoformat()
        df = pd.DataFrame({"Employee ID": ["EMP101", "EMP102"], "Employee Name": ["Dr. Rao", "Ms. Iyer"],
                           "Section": ["CSE-A", "CSE-B"], "Date": [d, d], "Start Time": ["09:00", "10:00"],
                           "End Time": ["09:50", "10:50"], "Subject": ["Data Structures", "Networks"],
                           "Room": ["B-201", "B-204"]})
    else:
        raise ValueError(kind)
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    return buf.getvalue()
