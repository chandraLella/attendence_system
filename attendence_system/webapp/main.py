"""
Run:  uvicorn webapp.main:app --host 0.0.0.0 --port 8000
      (from the folder that contains face_engine.py, enroll.py, attendance.py and webapp/)
"""
from __future__ import annotations

import csv
import io
import logging
import os
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import importers, jobs
from .config import (ADMIN_PASS, ADMIN_USER, DATA_DIR, EMPLOYEE_PASS, EMPLOYEE_USER, SESSION_DIR,
                     UPLOAD_TMP, WEBAPP_DIR, secret_key)
from .database import audit, db, get_settings, init_db, now_iso, rows, save_settings
from .scheduling import class_window

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = FastAPI(title="Attendance")
app.add_middleware(SessionMiddleware, secret_key=secret_key(), session_cookie="att_session",
                   max_age=12 * 3600, same_site="lax")
STATIC = WEBAPP_DIR / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.on_event("startup")
def _startup():
    init_db()
    for d in (UPLOAD_TMP, SESSION_DIR):
        d.mkdir(parents=True, exist_ok=True)


# =============================================================================== auth
def user(request: Request) -> dict:
    u = request.session.get("user")
    if not u:
        raise HTTPException(401, "Sign in to continue")
    return u


def admin(u: dict = Depends(user)) -> dict:
    if u["role"] != "admin":
        raise HTTPException(403, "Admin access required")
    return u


def employee(u: dict = Depends(user)) -> dict:
    if u["role"] != "employee":
        raise HTTPException(403, "Employee access required")
    return u


def actor(u: dict) -> str:
    return "admin" if u["role"] == "admin" else f"emp:{u['emp_id']}"


@app.post("/api/login")
def login(request: Request, body: dict = Body(...)):
    role, un, pw = body.get("role"), body.get("username", ""), body.get("password", "")
    if role == "admin" and un == ADMIN_USER and pw == ADMIN_PASS:
        request.session["user"] = {"role": "admin", "name": "Administrator"}
    elif role == "employee" and un == EMPLOYEE_USER and pw == EMPLOYEE_PASS:
        emp_id = (body.get("emp_id") or "").strip()
        with db() as con:
            e = con.execute("SELECT emp_id, name FROM employees WHERE emp_id=?", (emp_id,)).fetchone()
        if not e:
            raise HTTPException(400, f"Employee ID '{emp_id}' is not on the timetable. Ask the admin to add it.")
        request.session["user"] = {"role": "employee", "emp_id": e["emp_id"], "name": e["name"] or e["emp_id"]}
    else:
        raise HTTPException(401, "Username or password is incorrect")
    audit(actor(request.session["user"]), "login")
    return request.session["user"]


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def me(u: dict = Depends(user)):
    return {**u, "server_time": now_iso()}


# ============================================================================== pages
@app.get("/")
def root(request: Request):
    u = request.session.get("user")
    return RedirectResponse("/admin" if u and u["role"] == "admin" else "/employee" if u else "/login")


# React build (frontend/dist) wins when present; otherwise the original static pages are used.
REACT_DIST = Path(os.environ.get("ATT_FRONTEND_DIST", WEBAPP_DIR.parent / "frontend" / "dist")).resolve()
REACT_INDEX = REACT_DIST / "index.html"
if REACT_INDEX.exists():
    app.mount("/assets", StaticFiles(directory=REACT_DIST / "assets"), name="react-assets")


@app.get("/login")
def login_page():
    return FileResponse(REACT_INDEX if REACT_INDEX.exists() else STATIC / "login.html")


@app.get("/admin")
@app.get("/admin/{rest:path}")
def admin_page(request: Request, rest: str = ""):
    if REACT_INDEX.exists():          # client-side routes; the React app and the API enforce roles
        return FileResponse(REACT_INDEX, headers={"Cache-Control": "no-cache"})
    u = request.session.get("user")
    return FileResponse(STATIC / "admin.html") if u and u["role"] == "admin" else RedirectResponse("/login")


@app.get("/employee")
@app.get("/employee/{rest:path}")
def employee_page(request: Request, rest: str = ""):
    if REACT_INDEX.exists():
        return FileResponse(REACT_INDEX, headers={"Cache-Control": "no-cache"})
    u = request.session.get("user")
    return FileResponse(STATIC / "employee.html") if u and u["role"] == "employee" else RedirectResponse("/login")


@app.get("/media/{path:path}")
def media(path: str, u: dict = Depends(user)):
    """Face images are biometric data, so they are only served to signed-in users."""
    p = (DATA_DIR / path).resolve()
    if not str(p).startswith(str(DATA_DIR)) or not p.is_file() or p.name.startswith("."):
        raise HTTPException(404)
    return FileResponse(p, headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/jobs/{jid}")
def job_status(jid: str, u: dict = Depends(user)):
    j = jobs.get(jid)
    if not j or (j["owner"] != actor(u) and u["role"] != "admin"):
        raise HTTPException(404, "Job not found")
    return j


@app.get("/api/templates/{kind}")
def download_template(kind: str, u: dict = Depends(user)):
    try:
        data = importers.template(kind)
    except ValueError:
        raise HTTPException(404)
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{kind}_template.xlsx"'})


async def _save_upload(f: UploadFile, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe = "".join(c for c in (f.filename or "file") if c.isalnum() or c in "._-") or "file"
    p = dest_dir / f"{uuid.uuid4().hex[:8]}__{safe}"
    with open(p, "wb") as fh:
        while chunk := await f.read(1 << 20):
            fh.write(chunk)
    return p


# ===================================================================== admin: overview
@app.get("/api/admin/overview")
def overview(u: dict = Depends(admin)):
    s = get_settings()
    today = date.today().isoformat()
    with db() as con:
        c = lambda q, *a: con.execute(q, a).fetchone()[0]
        enrolled = {r["status"]: r["n"] for r in con.execute("SELECT status, COUNT(*) n FROM students GROUP BY status")}
        classes = rows(con.execute(
            "SELECT t.*, s.name section, e.name emp_name, ses.id session_id, "
            "(SELECT COUNT(*) FROM attendance a WHERE a.session_id=ses.id AND a.status='Present') present, "
            "(SELECT COUNT(*) FROM attendance a WHERE a.session_id=ses.id) total "
            "FROM timetable t JOIN sections s ON s.id=t.section_id LEFT JOIN employees e ON e.emp_id=t.emp_id "
            "LEFT JOIN sessions ses ON ses.timetable_id=t.id WHERE class_date=? ORDER BY start_time", (today,)))
        week_ago = (date.today() - timedelta(days=6)).isoformat()
        trend = rows(con.execute(
            "SELECT t.class_date d, SUM(a.status='Present') p, COUNT(a.student_id) n FROM timetable t "
            "JOIN sessions ses ON ses.timetable_id=t.id JOIN attendance a ON a.session_id=ses.id "
            "WHERE t.class_date BETWEEN ? AND ? GROUP BY t.class_date ORDER BY t.class_date", (week_ago, today)))
        out = {
            "students": c("SELECT COUNT(*) FROM students"),
            "unassigned": c("SELECT COUNT(*) FROM students WHERE section_id IS NULL"),
            "sections": c("SELECT COUNT(*) FROM sections"),
            "employees": c("SELECT COUNT(*) FROM employees"),
            "enrolled": enrolled,
            "flagged": c("SELECT COUNT(*) FROM students WHERE issues LIKE '%looks like%'"),
        }
    for cl in classes:
        cl["window"] = class_window(cl["class_date"], cl["start_time"], cl["end_time"], s["grace_minutes"])
    out.update(today=classes, trend=trend)
    return out


# =================================================================== admin: enrollment
@app.post("/api/admin/enroll")
async def enroll_upload(file: UploadFile = File(...), u: dict = Depends(admin)):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(400, "Upload a .zip file")
    from .vision import enroll_zip
    p = await _save_upload(file, UPLOAD_TMP)
    return {"job_id": jobs.submit("enroll", actor(u), enroll_zip, str(p), actor(u))}


@app.get("/api/admin/students")
def list_students(q: str = "", section_id: str = "", status: str = "", u: dict = Depends(admin)):
    sql = ("SELECT st.id, st.roll, st.name, st.status, st.n_views, st.issues, st.photo, st.section_id, "
           "se.name section, st.updated_at FROM students st LEFT JOIN sections se ON se.id=st.section_id WHERE 1=1")
    a = []
    if q:
        sql += " AND (st.name LIKE ? OR st.roll LIKE ?)"; a += [f"%{q}%", f"%{q}%"]
    if section_id == "none":
        sql += " AND st.section_id IS NULL"
    elif section_id:
        sql += " AND st.section_id=?"; a.append(int(section_id))
    if status:
        sql += " AND st.status=?"; a.append(status)
    with db() as con:
        return rows(con.execute(sql + " ORDER BY st.name COLLATE NOCASE", a))


@app.get("/api/admin/students/{sid}")
def student_detail(sid: int, u: dict = Depends(admin)):
    with db() as con:
        st = con.execute("SELECT id, roll, name, status, issues, photo, section_id FROM students WHERE id=?", (sid,)).fetchone()
        if not st:
            raise HTTPException(404)
        views = rows(con.execute("SELECT view, crop_path, aligned_path, round(blur,1) blur, face_px, round(det_score,2) det, round(yaw,2) yaw "
                                 "FROM student_views WHERE student_id=?", (sid,)))
        hist = rows(con.execute(
            "SELECT t.class_date, t.start_time, t.subject, a.status FROM attendance a JOIN sessions s ON s.id=a.session_id "
            "JOIN timetable t ON t.id=s.timetable_id WHERE a.student_id=? ORDER BY t.class_date DESC, t.start_time DESC LIMIT 60", (sid,)))
    return {**dict(st), "views": views, "history": hist}


@app.patch("/api/admin/students/{sid}")
def update_student(sid: int, body: dict = Body(...), u: dict = Depends(admin)):
    allowed = {k: body[k] for k in ("name", "roll", "section_id") if k in body}
    if not allowed:
        return {"ok": True}
    with db() as con:
        sets = ", ".join(f"{k}=?" for k in allowed)
        try:
            con.execute(f"UPDATE students SET {sets}, updated_at=? WHERE id=?", (*allowed.values(), now_iso(), sid))
        except Exception as e:
            raise HTTPException(400, f"Could not save: {e}")
        audit(actor(u), "student_update", f"{sid}: {allowed}", con)
    return {"ok": True}


@app.delete("/api/admin/students/{sid}")
def delete_student(sid: int, u: dict = Depends(admin)):
    with db() as con:
        r = con.execute("SELECT roll FROM students WHERE id=?", (sid,)).fetchone()
        con.execute("DELETE FROM students WHERE id=?", (sid,))
        audit(actor(u), "student_delete", r["roll"] if r else str(sid), con)
    return {"ok": True}


@app.post("/api/admin/students/bulk-section")
def bulk_section(body: dict = Body(...), u: dict = Depends(admin)):
    ids = [int(i) for i in body.get("student_ids", [])]
    sec = body.get("section_id")
    with db() as con:
        con.executemany("UPDATE students SET section_id=?, updated_at=? WHERE id=?", [(sec, now_iso(), i) for i in ids])
        audit(actor(u), "bulk_section", f"{len(ids)} -> {sec}", con)
    return {"updated": len(ids)}


# ===================================================================== admin: sections
@app.get("/api/sections")
def list_sections(u: dict = Depends(user)):
    with db() as con:
        return rows(con.execute(
            "SELECT s.id, s.name, s.description, COUNT(st.id) students, "
            "SUM(st.status='OK') ok FROM sections s LEFT JOIN students st ON st.section_id=s.id "
            "GROUP BY s.id ORDER BY s.name COLLATE NOCASE"))


@app.post("/api/admin/sections")
def create_section(body: dict = Body(...), u: dict = Depends(admin)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Section name is required")
    with db() as con:
        if con.execute("SELECT 1 FROM sections WHERE name=?", (name,)).fetchone():
            raise HTTPException(400, f"Section '{name}' already exists")
        sid = con.execute("INSERT INTO sections(name, description, created_at) VALUES(?,?,?)",
                          (name, body.get("description", ""), now_iso())).lastrowid
        audit(actor(u), "section_create", name, con)
    return {"id": sid}


@app.patch("/api/admin/sections/{sid}")
def update_section(sid: int, body: dict = Body(...), u: dict = Depends(admin)):
    with db() as con:
        try:
            con.execute("UPDATE sections SET name=COALESCE(?,name), description=COALESCE(?,description) WHERE id=?",
                        (body.get("name"), body.get("description"), sid))
        except Exception:
            raise HTTPException(400, "A section with that name already exists")
    return {"ok": True}


@app.delete("/api/admin/sections/{sid}")
def delete_section(sid: int, u: dict = Depends(admin)):
    with db() as con:
        n = con.execute("SELECT COUNT(*) FROM timetable WHERE section_id=?", (sid,)).fetchone()[0]
        con.execute("DELETE FROM sections WHERE id=?", (sid,))
        audit(actor(u), "section_delete", f"{sid} (removed {n} timetable slots)", con)
    return {"ok": True}


@app.post("/api/admin/sections/auto-assign")
def auto_assign(body: dict = Body(...), u: dict = Depends(admin)):
    """Alphabetical split. 'equal' spreads students evenly across the chosen sections in order
    (first block of names -> first section); 'capacity' fills each section up to N."""
    sec_ids = [int(x) for x in body.get("section_ids", [])]
    if not sec_ids:
        raise HTTPException(400, "Choose at least one section")
    key = "roll" if body.get("by") == "roll" else "name"
    scope = body.get("scope", "unassigned")
    with db() as con:
        names = {r["id"]: r["name"] for r in con.execute(
            f"SELECT id, name FROM sections WHERE id IN ({','.join('?' * len(sec_ids))})", sec_ids)}
        sec_ids = [s for s in sec_ids if s in names]
        sql = "SELECT id FROM students" + (" WHERE section_id IS NULL" if scope == "unassigned" else "")
        st = [r["id"] for r in con.execute(sql + f" ORDER BY {key} COLLATE NOCASE")]
        if not st:
            return {"assigned": 0, "split": []}
        if body.get("mode") == "capacity":
            cap = max(1, int(body.get("capacity") or 1))
            plan = [sec_ids[i // cap] if i // cap < len(sec_ids) else None for i in range(len(st))]
        else:
            k, r = divmod(len(st), len(sec_ids))
            plan = []
            for j, s in enumerate(sec_ids):
                plan += [s] * (k + (j < r))
        split = {}
        for sid, sec in zip(st, plan):
            if sec is None:
                continue
            con.execute("UPDATE students SET section_id=?, updated_at=? WHERE id=?", (sec, now_iso(), sid))
            split[names[sec]] = split.get(names[sec], 0) + 1
        audit(actor(u), "auto_assign", f"by {key}, {scope}: {split}", con)
    left = sum(p is None for p in plan)
    return {"assigned": len(st) - left, "left_unassigned": left, "split": [{"section": k, "count": v} for k, v in split.items()]}


@app.post("/api/admin/sections/import")
async def section_import(file: UploadFile = File(...), create_missing: bool = Form(False), u: dict = Depends(admin)):
    try:
        return importers.import_section_map(await file.read(), file.filename or "", create_missing, actor(u))
    except ValueError as e:
        raise HTTPException(400, str(e))


# ==================================================================== admin: employees
@app.get("/api/admin/employees")
def list_employees(u: dict = Depends(admin)):
    with db() as con:
        return rows(con.execute(
            "SELECT e.*, (SELECT COUNT(*) FROM timetable t WHERE t.emp_id=e.emp_id AND t.class_date>=date('now','localtime')) upcoming "
            "FROM employees e ORDER BY e.emp_id COLLATE NOCASE"))


@app.post("/api/admin/employees")
def upsert_employee(body: dict = Body(...), u: dict = Depends(admin)):
    emp = (body.get("emp_id") or "").strip()
    if not emp:
        raise HTTPException(400, "Employee ID is required")
    with db() as con:
        importers.ensure_employee(con, emp)
        con.execute("UPDATE employees SET name=?, department=? WHERE emp_id=?", (body.get("name", ""), body.get("department", ""), emp))
    return {"ok": True}


@app.delete("/api/admin/employees/{emp_id}")
def delete_employee(emp_id: str, u: dict = Depends(admin)):
    with db() as con:
        if con.execute("SELECT 1 FROM timetable WHERE emp_id=?", (emp_id,)).fetchone():
            raise HTTPException(400, "This employee still has timetable slots. Remove them first.")
        con.execute("DELETE FROM employees WHERE emp_id=?", (emp_id,))
    return {"ok": True}


# ==================================================================== admin: timetable
@app.get("/api/admin/timetable")
def list_timetable(start: str = "", end: str = "", section_id: str = "", emp_id: str = "", u: dict = Depends(admin)):
    s = get_settings()
    start = start or date.today().isoformat()
    end = end or (date.fromisoformat(start) + timedelta(days=6)).isoformat()
    sql = ("SELECT t.*, s.name section, e.name emp_name, ses.id session_id FROM timetable t "
           "JOIN sections s ON s.id=t.section_id LEFT JOIN employees e ON e.emp_id=t.emp_id "
           "LEFT JOIN sessions ses ON ses.timetable_id=t.id WHERE class_date BETWEEN ? AND ?")
    a: list = [start, end]
    if section_id:
        sql += " AND t.section_id=?"; a.append(int(section_id))
    if emp_id:
        sql += " AND t.emp_id=?"; a.append(emp_id)
    with db() as con:
        out = rows(con.execute(sql + " ORDER BY class_date, start_time", a))
    for r in out:
        r["window"] = class_window(r["class_date"], r["start_time"], r["end_time"], s["grace_minutes"])
    return out


@app.post("/api/admin/timetable")
def add_timetable(body: dict = Body(...), u: dict = Depends(admin)):
    try:
        d0 = importers.parse_date(body["class_date"])
        st, en = importers.parse_time(body["start_time"]), importers.parse_time(body["end_time"])
        emp, sec = body["emp_id"].strip(), int(body["section_id"])
    except (KeyError, ValueError) as e:
        raise HTTPException(400, f"Check the form: {e}")
    dates = [d0]
    until = body.get("repeat_until")
    if until:
        d, stop = date.fromisoformat(d0), date.fromisoformat(importers.parse_date(until))
        if (stop - d).days > 200:
            raise HTTPException(400, "Weekly repeat is limited to 200 days")
        while (d := d + timedelta(days=7)) <= stop:
            dates.append(d.isoformat())
    entries = [{"label": d, "emp_id": emp, "emp_name": body.get("emp_name", ""), "section_id": sec,
                "class_date": d, "start_time": st, "end_time": en,
                "subject": body.get("subject", ""), "room": body.get("room", "")} for d in dates]
    with db() as con:
        added, errors = importers.add_timetable_rows(con, entries)
        audit(actor(u), "timetable_add", f"{emp} {sec} {d0} x{added}", con)
    if not added and errors:
        raise HTTPException(400, "; ".join(errors))
    return {"added": added, "errors": errors}


@app.delete("/api/admin/timetable/{tid}")
def delete_timetable(tid: int, u: dict = Depends(admin)):
    with db() as con:
        if con.execute("SELECT 1 FROM sessions WHERE timetable_id=?", (tid,)).fetchone():
            raise HTTPException(400, "Attendance was already taken for this class, so it can't be deleted.")
        con.execute("DELETE FROM timetable WHERE id=?", (tid,))
        audit(actor(u), "timetable_delete", str(tid), con)
    return {"ok": True}


@app.post("/api/admin/timetable/import")
async def timetable_import(file: UploadFile = File(...), create_missing: bool = Form(False), u: dict = Depends(admin)):
    try:
        return importers.import_timetable(await file.read(), file.filename or "", create_missing, actor(u))
    except ValueError as e:
        raise HTTPException(400, str(e))


# ===================================================================== admin: reports
@app.get("/api/admin/reports/section/{sec_id}")
def section_report(sec_id: int, start: str = "", end: str = "", fmt: str = "json", u: dict = Depends(admin)):
    end = end or date.today().isoformat()
    start = start or (date.fromisoformat(end) - timedelta(days=29)).isoformat()
    with db() as con:
        sec = con.execute("SELECT name FROM sections WHERE id=?", (sec_id,)).fetchone()
        if not sec:
            raise HTTPException(404)
        classes = rows(con.execute(
            "SELECT t.id, t.class_date, t.start_time, t.subject, t.emp_id, ses.id session_id FROM timetable t "
            "LEFT JOIN sessions ses ON ses.timetable_id=t.id WHERE t.section_id=? AND t.class_date BETWEEN ? AND ? "
            "AND t.class_date || 'T' || t.start_time <= ? ORDER BY t.class_date, t.start_time",
            (sec_id, start, end, datetime.now().isoformat(timespec="minutes"))))
        marks = {}
        sids = [c["session_id"] for c in classes if c["session_id"]]
        if sids:
            for r in con.execute(f"SELECT session_id, student_id, status FROM attendance WHERE session_id IN ({','.join('?' * len(sids))})", sids):
                marks[(r["session_id"], r["student_id"])] = r["status"]
        studs = rows(con.execute("SELECT id, roll, name FROM students WHERE section_id=? ORDER BY name COLLATE NOCASE", (sec_id,)))
    taken = [c for c in classes if c["session_id"]]
    table = []
    for s in studs:
        cells = [marks.get((c["session_id"], s["id"]), "-") if c["session_id"] else "Not taken" for c in classes]
        p = sum(x == "Present" for x in cells); n = sum(x in ("Present", "Absent") for x in cells)
        table.append({**s, "cells": cells, "present": p, "held": n, "pct": round(100 * p / n, 1) if n else None})
    if fmt == "xlsx":
        import pandas as pd
        cols = [f"{c['class_date']} {c['start_time']} {c['subject']}".strip() for c in classes]
        df = pd.DataFrame([[t["roll"], t["name"], *t["cells"], t["present"], t["held"], t["pct"]] for t in table],
                          columns=["Roll No", "Name", *cols, "Present", "Held", "%"])
        buf = io.BytesIO(); df.to_excel(buf, index=False)
        return Response(buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{sec["name"]}_{start}_{end}.xlsx"'})
    return {"section": sec["name"], "start": start, "end": end, "classes": classes,
            "classes_taken": len(taken), "students": table}


@app.get("/api/admin/settings")
def read_settings(u: dict = Depends(admin)):
    return get_settings()


@app.put("/api/admin/settings")
def write_settings(body: dict = Body(...), u: dict = Depends(admin)):
    try:
        s = save_settings(body)
    except (TypeError, ValueError) as e:
        raise HTTPException(400, f"Invalid value: {e}")
    if s["review_thresh"] > s["match_thresh"]:
        raise HTTPException(400, "Review threshold must be at or below the match threshold")
    audit(actor(u), "settings", str(body))
    return s


@app.get("/api/admin/audit")
def audit_log(limit: int = 200, u: dict = Depends(admin)):
    with db() as con:
        return rows(con.execute("SELECT * FROM audit ORDER BY id DESC LIMIT ?", (min(limit, 1000),)))


# ================================================================= employee: schedule
@app.get("/api/employee/schedule")
def my_schedule(start: str = "", end: str = "", u: dict = Depends(employee)):
    s = get_settings()
    start = start or (date.today() - timedelta(days=30)).isoformat()
    end = end or (date.today() + timedelta(days=7)).isoformat()
    with db() as con:
        out = rows(con.execute(
            "SELECT t.*, sec.name section, ses.id session_id, "
            "(SELECT COUNT(*) FROM students st WHERE st.section_id=t.section_id) section_size, "
            "(SELECT COUNT(*) FROM attendance a WHERE a.session_id=ses.id AND a.status='Present') present, "
            "(SELECT COUNT(*) FROM attendance a WHERE a.session_id=ses.id) total "
            "FROM timetable t JOIN sections sec ON sec.id=t.section_id LEFT JOIN sessions ses ON ses.timetable_id=t.id "
            "WHERE t.emp_id=? AND t.class_date BETWEEN ? AND ? ORDER BY class_date, start_time",
            (u["emp_id"], start, end)))
    for r in out:
        r["window"] = class_window(r["class_date"], r["start_time"], r["end_time"], s["grace_minutes"])
    return {"classes": out, "server_time": now_iso(), "grace_minutes": s["grace_minutes"]}


# ===================================================================== class sessions
def _class(con, tid: int, u: dict) -> dict:
    t = con.execute("SELECT t.*, s.name section, e.name emp_name FROM timetable t JOIN sections s ON s.id=t.section_id "
                    "LEFT JOIN employees e ON e.emp_id=t.emp_id WHERE t.id=?", (tid,)).fetchone()
    if not t:
        raise HTTPException(404, "Class not found")
    if u["role"] == "employee" and t["emp_id"].lower() != u["emp_id"].lower():
        raise HTTPException(403, "This class is assigned to another employee")
    return dict(t)


def _ensure_session(con, t: dict, who: str) -> int:
    """Create the sheet (everyone Absent/auto) the first time the class is opened, and
    add any student who joined the section later while the class is still open."""
    r = con.execute("SELECT id FROM sessions WHERE timetable_id=?", (t["id"],)).fetchone()
    sid = r["id"] if r else con.execute("INSERT INTO sessions(timetable_id, opened_at, opened_by) VALUES(?,?,?)",
                                        (t["id"], now_iso(), who)).lastrowid
    con.execute("INSERT OR IGNORE INTO attendance(session_id, student_id, status, source, updated_at, updated_by) "
                "SELECT ?, id, 'Absent', 'auto', ?, 'system' FROM students WHERE section_id=?", (sid, now_iso(), t["section_id"]))
    return sid


def _can_edit(u: dict, win: dict) -> bool:
    """Employees: only inside the window. Admin: any time after the class has started."""
    return win["open"] or (u["role"] == "admin" and win["state"] != "upcoming")


@app.get("/api/class/{tid}")
def class_detail(tid: int, u: dict = Depends(user)):
    s = get_settings()
    with db() as con:
        t = _class(con, tid, u)
        win = class_window(t["class_date"], t["start_time"], t["end_time"], s["grace_minutes"])
        ses = con.execute("SELECT id FROM sessions WHERE timetable_id=?", (tid,)).fetchone()
        if win["open"] and u["role"] == "employee":
            sid = _ensure_session(con, t, actor(u))
        else:
            sid = ses["id"] if ses else None
        if sid:
            roster = rows(con.execute(
                "SELECT a.student_id, st.roll, st.name, st.photo, a.status, a.source, round(a.score,3) score, a.evidence, "
                "a.updated_by, a.updated_at, "
                "(SELECT round(MAX(d.score),3) FROM detections d JOIN uploads up ON up.id=d.upload_id "
                " WHERE up.session_id=a.session_id AND d.student_id=a.student_id AND d.decision IN ('MATCH','REVIEW')) detected "
                "FROM attendance a JOIN students st ON st.id=a.student_id WHERE a.session_id=? ORDER BY st.name COLLATE NOCASE", (sid,)))
            uploads = rows(con.execute("SELECT id, batch, filename, annotated, n_faces, n_ok, n_matched, created_at, created_by "
                                       "FROM uploads WHERE session_id=? ORDER BY id", (sid,)))
            dets = rows(con.execute("SELECT d.id, d.crop, d.student_id, round(d.score,3) score, d.decision, d.reasons, "
                                    "d.top1_student_id, round(d.top1_score,3) top1_score FROM detections d "
                                    "JOIN uploads up ON up.id=d.upload_id WHERE up.session_id=?", (sid,)))
        else:
            roster = rows(con.execute("SELECT id student_id, roll, name, photo, 'Not taken' status FROM students "
                                      "WHERE section_id=? ORDER BY name COLLATE NOCASE", (t["section_id"],)))
            uploads, dets = [], []
    absent = {r["student_id"] for r in roster if r["status"] == "Absent"}
    sugg: dict[int, dict] = {}
    for d in dets:
        if d["decision"] in ("REVIEW", "MATCH") and d["student_id"] in absent:
            if d["student_id"] not in sugg or d["score"] > sugg[d["student_id"]]["score"]:
                sugg[d["student_id"]] = {"student_id": d["student_id"], "score": d["score"], "crop": d["crop"], "decision": d["decision"]}
    unknown = [d for d in dets if d["decision"] == "UNKNOWN"]
    counts = {k: sum(r["status"] == k for r in roster) for k in ("Present", "Absent")}
    return {"class": t, "window": win, "session_id": sid, "editable": _can_edit(u, win),
            "roster": roster, "uploads": uploads, "suggestions": sorted(sugg.values(), key=lambda x: -x["score"]),
            "unknown": unknown, "rejected": sum(d["decision"] == "REJECTED" for d in dets),
            "counts": {**counts, "total": len(roster)}, "thresholds": {"match": s["match_thresh"], "review": s["review_thresh"]},
            "server_time": now_iso()}


@app.post("/api/class/{tid}/photos")
async def class_photos(tid: int, files: list[UploadFile] = File(...), u: dict = Depends(user)):
    s = get_settings()
    if not files:
        raise HTTPException(400, "Add at least one class photo")
    if len(files) > s["max_photos_per_upload"]:
        raise HTTPException(400, f"Upload at most {s['max_photos_per_upload']} photos at a time")
    with db() as con:
        t = _class(con, tid, u)
        win = class_window(t["class_date"], t["start_time"], t["end_time"], s["grace_minutes"])
        if not _can_edit(u, win):
            raise HTTPException(403, "Attendance for this class is closed" if win["state"] == "closed"
                                else f"Attendance opens at {t['start_time']}")
        sid = _ensure_session(con, t, actor(u))
    from .vision import recognize_session
    paths = [str(await _save_upload(f, SESSION_DIR / str(sid) / "photos")) for f in files]
    return {"job_id": jobs.submit("recognize", actor(u), recognize_session, sid, paths, actor(u))}


@app.patch("/api/class/{tid}/attendance")
def mark(tid: int, body: dict = Body(...), u: dict = Depends(user)):
    """Manual edits. Employees: only while open. Admin: any time (logged as 'admin' source)."""
    s = get_settings()
    status = body.get("status")
    if status not in ("Present", "Absent"):
        raise HTTPException(400, "Status must be Present or Absent")
    ids = [int(i) for i in body.get("student_ids", [])]
    if not ids:
        return {"updated": 0}
    with db() as con:
        t = _class(con, tid, u)
        win = class_window(t["class_date"], t["start_time"], t["end_time"], s["grace_minutes"])
        if not _can_edit(u, win):
            raise HTTPException(403, "Attendance for this class is frozen" if win["state"] == "closed"
                                else f"Attendance opens at {t['start_time']}")
        sid = _ensure_session(con, t, actor(u))
        src = "admin" if u["role"] == "admin" else "manual"
        ev = body.get("evidence")
        for i in ids:
            con.execute("UPDATE attendance SET status=?, source=?, updated_at=?, updated_by=?, "
                        "evidence=COALESCE(?, evidence) WHERE session_id=? AND student_id=?",
                        (status, src, now_iso(), actor(u), ev, sid, i))
        audit(actor(u), "mark", f"class {tid}: {len(ids)} -> {status}" + (" (frozen override)" if not win["open"] else ""), con)
    return {"updated": len(ids)}


@app.get("/api/class/{tid}/export")
def class_export(tid: int, u: dict = Depends(user)):
    d = class_detail(tid, u)
    t = d["class"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Section", t["section"], "Date", t["class_date"], "Time", f"{t['start_time']}-{t['end_time']}",
                "Subject", t["subject"], "Employee", t["emp_id"]])
    w.writerow(["Roll No", "Name", "Status", "Marked by", "Similarity"])
    for r in d["roster"]:
        w.writerow([r["roll"], r["name"], r["status"], r.get("updated_by") or "", r.get("score") or ""])
    name = f"{t['section']}_{t['class_date']}_{t['start_time'].replace(':', '')}.csv"
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})
