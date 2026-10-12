"""
db_query.py - read data out of data/attendance.db (the web app's database).

Opens the database READ-ONLY, so it is safe to run while the web server is running.

Usage:
    python db_query.py                      # runs the demo at the bottom
    python db_query.py --db /path/to/attendance.db

Or import it:
    from db_query import AttendanceDB
    db = AttendanceDB("data/attendance.db")
    df = db.section_summary("CSE-A", "2026-10-01", "2026-10-31")
"""
from __future__ import annotations

import argparse
import pickle
import sqlite3
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd


def to_emb(blob: bytes | None) -> np.ndarray | None:
    """Embeddings are stored as raw float32 bytes (512 x 4 = 2048 bytes)."""
    return None if blob is None else np.frombuffer(blob, dtype=np.float32).copy()


class AttendanceDB:
    def __init__(self, path: str | Path = "data/attendance.db"):
        self.path = Path(path).resolve()
        if not self.path.exists():
            raise FileNotFoundError(self.path)

    def _con(self) -> sqlite3.Connection:
        # mode=ro: never writes, never takes a write lock on the live database
        con = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, timeout=10)
        con.row_factory = sqlite3.Row
        return con

    def df(self, sql: str, params: tuple | list = ()) -> pd.DataFrame:
        """Run any SELECT and get a DataFrame back."""
        with closing(self._con()) as con:
            return pd.read_sql_query(sql, con, params=params)

    # ------------------------------------------------------------------ master data
    def sections(self) -> pd.DataFrame:
        return self.df("""
            SELECT s.id, s.name, s.description, COUNT(st.id) AS students,
                   SUM(st.status = 'OK') AS ready
            FROM sections s LEFT JOIN students st ON st.section_id = s.id
            GROUP BY s.id ORDER BY s.name""")

    def students(self, section: str | None = None) -> pd.DataFrame:
        sql = """SELECT st.id, st.roll, st.name, se.name AS section, st.status,
                        st.n_views, st.issues, st.photo
                 FROM students st LEFT JOIN sections se ON se.id = st.section_id"""
        if section:
            return self.df(sql + " WHERE se.name = ? ORDER BY st.name", (section,))
        return self.df(sql + " ORDER BY st.name")

    def employees(self) -> pd.DataFrame:
        return self.df("SELECT emp_id, name, department FROM employees ORDER BY emp_id")

    # ------------------------------------------------------------------ embeddings
    def embeddings(self, section: str | None = None, roll: str | None = None) -> dict[str, dict]:
        """{roll: {"name", "section", "views": {view: (512,)}, "mean": (512,)}}"""
        sql = """SELECT st.roll, st.name, se.name AS section, st.mean_emb, v.view, v.embedding
                 FROM students st
                 LEFT JOIN sections se ON se.id = st.section_id
                 LEFT JOIN student_views v ON v.student_id = st.id WHERE 1=1"""
        args: list = []
        if section:
            sql += " AND se.name = ?"; args.append(section)
        if roll:
            sql += " AND st.roll = ?"; args.append(roll)
        out: dict[str, dict] = {}
        with closing(self._con()) as con:
            for r in con.execute(sql + " ORDER BY st.roll, v.view", args):
                s = out.setdefault(r["roll"], {"name": r["name"], "section": r["section"],
                                               "views": {}, "mean": to_emb(r["mean_emb"])})
                if r["view"]:
                    s["views"][r["view"]] = to_emb(r["embedding"])
        return out

    def embedding_matrix(self, section: str | None = None) -> tuple[np.ndarray, list[str]]:
        """Mean embeddings stacked as (N, 512) plus matching roll list. Handy for
        similarity searches: (M @ M.T) gives every pairwise cosine similarity."""
        e = self.embeddings(section)
        rolls = [r for r, s in e.items() if s["mean"] is not None]
        return (np.stack([e[r]["mean"] for r in rolls]) if rolls else np.zeros((0, 512), np.float32)), rolls

    def export_pickle(self, out_path: str, section: str | None = None) -> int:
        """Write an embeddings.pkl in the same format enroll.py produced, so the
        command-line attendance.py can use web-enrolled students."""
        e = self.embeddings(section)
        studs = []
        for roll, s in e.items():
            views = list(s["views"])
            studs.append({"roll": roll, "name": s["name"], "views": views,
                          "embeddings": np.stack([s["views"][v] for v in views]) if views else np.zeros((0, 512), np.float32),
                          "mean_embedding": s["mean"], "crops": {}, "aligned": {}, "front_source": None})
        with open(out_path, "wb") as fh:
            pickle.dump({"model_pack": "buffalo_l", "flip_tta": True, "embedding_dim": 512,
                         "created": date.today().isoformat(), "students": studs}, fh)
        return len(studs)

    # ------------------------------------------------------------------ timetable & attendance
    def timetable(self, start: str, end: str, emp_id: str | None = None, section: str | None = None) -> pd.DataFrame:
        sql = """SELECT t.id AS class_id, t.class_date, t.start_time, t.end_time, se.name AS section,
                        t.subject, t.room, t.emp_id, e.name AS emp_name,
                        ses.id IS NOT NULL AS attendance_taken
                 FROM timetable t JOIN sections se ON se.id = t.section_id
                 LEFT JOIN employees e ON e.emp_id = t.emp_id
                 LEFT JOIN sessions ses ON ses.timetable_id = t.id
                 WHERE t.class_date BETWEEN ? AND ?"""
        args: list = [start, end]
        if emp_id:
            sql += " AND t.emp_id = ?"; args.append(emp_id)
        if section:
            sql += " AND se.name = ?"; args.append(section)
        return self.df(sql + " ORDER BY t.class_date, t.start_time", args)

    def class_attendance(self, class_id: int) -> pd.DataFrame:
        """Roster for one timetable slot. source: auto = face match, manual = employee, admin = admin."""
        return self.df("""
            SELECT st.roll, st.name, a.status, a.source, ROUND(a.score, 3) AS similarity,
                   a.updated_by, a.updated_at
            FROM sessions ses JOIN attendance a ON a.session_id = ses.id
            JOIN students st ON st.id = a.student_id
            WHERE ses.timetable_id = ? ORDER BY st.name""", (class_id,))

    def student_history(self, roll: str) -> pd.DataFrame:
        return self.df("""
            SELECT t.class_date, t.start_time, se.name AS section, t.subject, t.emp_id, a.status, a.source
            FROM students st JOIN attendance a ON a.student_id = st.id
            JOIN sessions ses ON ses.id = a.session_id
            JOIN timetable t ON t.id = ses.timetable_id JOIN sections se ON se.id = t.section_id
            WHERE st.roll = ? ORDER BY t.class_date, t.start_time""", (roll,))

    def attendance_long(self, start: str, end: str, section: str | None = None) -> pd.DataFrame:
        """One row per (student, class) with a recorded mark. Basis for any report."""
        sql = """SELECT t.id AS class_id, t.class_date, t.start_time, t.subject, se.name AS section,
                        st.roll, st.name, a.status
                 FROM attendance a JOIN sessions ses ON ses.id = a.session_id
                 JOIN timetable t ON t.id = ses.timetable_id JOIN sections se ON se.id = t.section_id
                 JOIN students st ON st.id = a.student_id
                 WHERE t.class_date BETWEEN ? AND ?"""
        args: list = [start, end]
        if section:
            sql += " AND se.name = ?"; args.append(section)
        return self.df(sql, args)

    def section_summary(self, section: str, start: str, end: str) -> pd.DataFrame:
        """Per-student present / held / percentage for a section over a date range."""
        d = self.attendance_long(start, end, section)
        if d.empty:
            return pd.DataFrame(columns=["roll", "name", "present", "held", "pct"])
        g = d.assign(p=d.status.eq("Present")).groupby(["roll", "name"]).agg(present=("p", "sum"), held=("p", "size"))
        g["pct"] = (100 * g.present / g.held).round(1)
        return g.reset_index().sort_values("pct")

    def section_matrix(self, section: str, start: str, end: str) -> pd.DataFrame:
        """Students x classes grid of P / A, like a paper register."""
        d = self.attendance_long(start, end, section)
        if d.empty:
            return pd.DataFrame()
        d["class"] = d.class_date + " " + d.start_time + " " + d.subject.fillna("")
        return d.pivot_table(index=["roll", "name"], columns="class", values="status",
                             aggfunc="first").replace({"Present": "P", "Absent": "A"})

    def detections(self, class_id: int) -> pd.DataFrame:
        """Every face found in a class's photos with its score and decision.
        Use this to calibrate match_thresh / review_thresh on real classes."""
        return self.df("""
            SELECT u.batch, u.filename, d.decision, ROUND(d.score, 3) AS score, st.roll AS matched_roll,
                   st2.roll AS top1_roll, ROUND(d.top1_score, 3) AS top1_score, d.reasons, d.crop
            FROM sessions ses JOIN uploads u ON u.session_id = ses.id
            JOIN detections d ON d.upload_id = u.id
            LEFT JOIN students st ON st.id = d.student_id
            LEFT JOIN students st2 ON st2.id = d.top1_student_id
            WHERE ses.timetable_id = ? ORDER BY u.batch, u.id, d.id""", (class_id,))


# ---------------------------------------------------------------------- demo
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/attendance.db")
    args = ap.parse_args()
    db = AttendanceDB(args.db)
    pd.set_option("display.width", 160, "display.max_columns", 20)
    today = date.today().isoformat(); month_ago = (date.today() - timedelta(days=30)).isoformat()

    print("== Sections"); print(db.sections().to_string(index=False))
    print("\n== Students"); print(db.students()[["roll", "name", "section", "status", "n_views"]].to_string(index=False))

    emb = db.embeddings()
    roll = next(iter(emb))
    s = emb[roll]
    print(f"\n== Embeddings: {len(emb)} students. {roll} ({s['name']}) has views {list(s['views'])}")
    for v, e in s["views"].items():
        print(f"   {v:8s} shape={e.shape} norm={np.linalg.norm(e):.3f} first5={np.round(e[:5], 4)}")

    M, rolls = db.embedding_matrix()
    sim = M @ M.T; np.fill_diagonal(sim, -1)
    i, j = np.unravel_index(sim.argmax(), sim.shape)
    print(f"   most similar pair: {rolls[i]} / {rolls[j]} = {sim[i, j]:.3f}")

    tt = db.timetable(month_ago, today)
    print("\n== Classes in the last 30 days"); print(tt.to_string(index=False))
    taken = tt[tt.attendance_taken == 1]
    if len(taken):
        cid = int(taken.class_id.iloc[-1])
        print(f"\n== Attendance for class {cid}"); print(db.class_attendance(cid).to_string(index=False))
        print(f"\n== Faces detected in class {cid}"); print(db.detections(cid).drop(columns="crop").to_string(index=False))
        sec = taken.section.iloc[-1]
        print(f"\n== {sec} summary"); print(db.section_summary(sec, month_ago, today).to_string(index=False))
        print(f"\n== {sec} register"); print(db.section_matrix(sec, month_ago, today).to_string())

    n = db.export_pickle("embeddings_export.pkl")
    print(f"\nExported {n} students to embeddings_export.pkl (same format as enroll.py)")


if __name__ == "__main__":
    main()
