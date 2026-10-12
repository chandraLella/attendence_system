"""
vision.py - glue between the web app and your existing scripts.

Nothing here re-implements detection or matching. It calls:
  face_engine.FaceEngine / QualityConfig / assess / load_image / crop_with_margin   (detect, align, embed, quality)
  enroll.detect_main_face                                                            (largest face + fallbacks)
  attendance.build_gallery / student_scores / assign                                (templates + Hungarian)
What it adds: zip parsing, SQLite storage, restricting the gallery to one section, and
merging results into an existing attendance sheet without overwriting it.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import sys
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np

from .config import ENROLL_DIR, MODEL_PACK, PROJECT_DIR, SESSION_DIR, UPLOAD_TMP, USE_GPU
from .database import audit, blob_to_emb, db, emb_to_blob, get_settings, now_iso, rows

sys.path.insert(0, str(PROJECT_DIR))
from face_engine import (VIEWS, FaceEngine, QualityConfig, assess,  # noqa: E402
                         crop_with_margin, load_image, save_jpg)
from enroll import detect_main_face, safe_name  # noqa: E402
from attendance import assign, build_gallery, student_scores  # noqa: E402

log = logging.getLogger("vision")
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif")

_engine: FaceEngine | None = None
_engine_lock = threading.Lock()   # one model, one inference at a time (ORT already uses all cores)


def engine() -> FaceEngine:
    global _engine
    with _engine_lock:
        if _engine is None:
            s = get_settings()
            _engine = FaceEngine(MODEL_PACK, det_size=s["det_size"], det_thresh=s["det_thresh"], use_gpu=USE_GPU)
        return _engine


def _small(img: np.ndarray, max_px: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = max_px / max(h, w)
    return cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else img


def rel(p: Path | str) -> str:
    """Path relative to the data dir; this is what the UI requests from /media/."""
    from .config import DATA_DIR
    return str(Path(p).resolve().relative_to(DATA_DIR)).replace(os.sep, "/")


# ================================================================== enrollment (zip)
FOLDER_RE = re.compile(r"^\s*([A-Za-z0-9/.]*\d[A-Za-z0-9/.]*)\s*[-_ ]+\s*(.+?)\s*$")   # roll: no _ or - inside


def parse_folder(name: str) -> tuple[str, str]:
    """'21CS001_Ravi Kumar' / '21CS001 - Ravi_Kumar' -> (roll, name).
    A folder without a leading roll number uses the folder name for both."""
    m = FOLDER_RE.match(name)
    if m:
        return m.group(1).strip(), re.sub(r"[_]+", " ", m.group(2)).strip()
    clean = re.sub(r"[_]+", " ", name).strip()
    return clean, clean


def assign_views(files: list[Path]) -> dict[str, Path]:
    """Filename keywords win (front/left/right); remaining images fill views in sorted order.
    Images beyond three become extra templates, which only helps matching."""
    out, rest = {}, []
    for f in sorted(files, key=lambda p: p.name.lower()):
        n = f.stem.lower()
        v = ("front" if re.search(r"front|straight|centre|center|0deg|image ?1|^1$", n) else
             "left45" if re.search(r"left|image ?2|^2$", n) else
             "right45" if re.search(r"right|image ?3|^3$", n) else None)
        if v and v not in out:
            out[v] = f
        else:
            rest.append(f)
    for v in VIEWS:
        if v not in out and rest:
            out[v] = rest.pop(0)
    for i, f in enumerate(rest, 1):
        out[f"extra{i}"] = f
    return out


def _safe_extract(zip_path: Path, dest: Path) -> None:
    with zipfile.ZipFile(zip_path) as z:
        for m in z.infolist():
            target = (dest / m.filename).resolve()
            if not str(target).startswith(str(dest.resolve())):   # zip-slip guard
                raise ValueError(f"Unsafe path in zip: {m.filename}")
        z.extractall(dest)


def find_student_dirs(root: Path) -> list[tuple[Path, list[Path]]]:
    found = []
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if not x.startswith((".", "__MACOSX"))]
        imgs = [Path(d) / f for f in files if f.lower().endswith(IMG_EXT) and not f.startswith(".")]
        if imgs and Path(d) != root:
            found.append((Path(d), imgs))
    return sorted(found, key=lambda t: t[0].name.lower())


def enroll_zip(job, zip_path: str, actor: str) -> dict:
    s = get_settings()
    work = UPLOAD_TMP / f"enroll_{job.id}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        job.update(message="Unpacking zip")
        _safe_extract(Path(zip_path), work)
        sdirs = find_student_dirs(work)
        if not sdirs:
            raise ValueError("No student folders with images found. Expected: zip > one folder per student > 3 images.")
        total = sum(len(f) for _, f in sdirs)
        job.update(total=total, message=f"Found {len(sdirs)} student folders, {total} images")

        eng = engine()
        jobs = []
        for d, files in sdirs:
            roll, name = parse_folder(d.name)
            for view, f in assign_views(files).items():
                jobs.append((roll, name, view, f))

        def _load(j):
            try:
                return j, load_image(str(j[3]), max_side=1600), None
            except Exception as e:  # noqa: BLE001
                return j, None, e

        results: dict[str, dict] = {}
        done = 0
        with ThreadPoolExecutor(max_workers=4) as ex:          # decode overlaps with inference
            for (roll, name, view, f), img, err in ex.map(_load, jobs):
                st = results.setdefault(roll, {"roll": roll, "name": name, "views": {}, "errors": []})
                done += 1
                job.update(progress=done, message=f"Enrolling {name} ({view})")
                if err is not None:
                    st["errors"].append(f"{view}: cannot read image"); continue
                with _engine_lock:
                    face = detect_main_face(eng, img)
                    if face is not None:
                        eng.align(img, [face])
                        eng.embed([face], flip_tta=True)
                if face is None:
                    st["errors"].append(f"{view}: no face detected"); continue
                sdir = ENROLL_DIR / safe_name(roll)
                crop = save_jpg(str(sdir / f"{view}_crop.jpg"), _small(crop_with_margin(img, face.bbox), 360))
                aligned = save_jpg(str(sdir / f"{view}_aligned.jpg"), face.aligned)
                st["views"][view] = {"emb": face.embedding, "crop": crop, "aligned": aligned,
                                     "det": face.score, "blur": face.blur, "px": face.face_px, "yaw": face.yaw}

        job.update(message="Saving to database")
        summary = {"OK": 0, "PARTIAL": 0, "FAILED": 0, "students": len(results), "created": 0, "updated": 0}
        with db() as con:
            for roll, st in results.items():
                vs = st["views"]
                core = [v for v in VIEWS if v in vs]
                issues = list(st["errors"])
                blurs = [x["blur"] for x in vs.values()]
                if blurs and min(blurs) < s["warn_blur"]:
                    issues.append("low sharpness in an enroll image")
                status = "OK" if len(core) == 3 and not issues else ("PARTIAL" if vs else "FAILED")
                summary[status] += 1
                mean = None
                if vs:
                    m = np.mean([x["emb"] for x in vs.values()], axis=0)
                    mean = emb_to_blob(m / np.linalg.norm(m))
                photo = rel(vs[core[0]]["crop"]) if core else (rel(next(iter(vs.values()))["crop"]) if vs else None)
                ex_row = con.execute("SELECT id FROM students WHERE roll=?", (roll,)).fetchone()
                if ex_row:   # re-enrollment replaces the face data, keeps the section
                    sid = ex_row["id"]
                    con.execute("UPDATE students SET name=?, status=?, n_views=?, issues=?, mean_emb=?, photo=?, updated_at=? WHERE id=?",
                                (st["name"], status, len(vs), "; ".join(issues), mean, photo, now_iso(), sid))
                    con.execute("DELETE FROM student_views WHERE student_id=?", (sid,))
                    summary["updated"] += 1
                else:
                    sid = con.execute("INSERT INTO students(roll,name,status,n_views,issues,mean_emb,photo,created_at,updated_at) "
                                      "VALUES(?,?,?,?,?,?,?,?,?)",
                                      (roll, st["name"], status, len(vs), "; ".join(issues), mean, photo, now_iso(), now_iso())).lastrowid
                    summary["created"] += 1
                for v, x in vs.items():
                    con.execute("INSERT INTO student_views(student_id,view,embedding,crop_path,aligned_path,det_score,blur,face_px,yaw) "
                                "VALUES(?,?,?,?,?,?,?,?,?)",
                                (sid, v, emb_to_blob(x["emb"]), rel(x["crop"]), rel(x["aligned"]),
                                 x["det"], x["blur"], x["px"], x["yaw"]))
            audit(actor, "enroll_zip", f"{Path(zip_path).name}: {summary}", con)
        summary["duplicates"] = flag_duplicates(s["duplicate_thresh"])
        return summary
    finally:
        shutil.rmtree(work, ignore_errors=True)
        try:
            os.remove(zip_path)
        except OSError:
            pass


def flag_duplicates(thresh: float) -> list[dict]:
    """Two different rolls with near-identical faces usually means the same person was
    enrolled twice or folders were mixed up. Flag both; matching would be ambiguous."""
    with db() as con:
        st = rows(con.execute("SELECT id, roll, name, mean_emb, issues FROM students WHERE mean_emb IS NOT NULL"))
        if len(st) < 2:
            return []
        M = np.stack([blob_to_emb(x["mean_emb"]) for x in st])
        sim = M @ M.T
        np.fill_diagonal(sim, -1)
        pairs = []
        for i, j in zip(*np.where(np.triu(sim) >= thresh)):
            pairs.append({"a": st[i]["roll"], "b": st[j]["roll"], "similarity": round(float(sim[i, j]), 3)})
        flagged: dict[int, list[str]] = {}
        for p in pairs:
            ia = next(k for k, x in enumerate(st) if x["roll"] == p["a"])
            ib = next(k for k, x in enumerate(st) if x["roll"] == p["b"])
            flagged.setdefault(ia, []).append(p["b"]); flagged.setdefault(ib, []).append(p["a"])
        for k, x in enumerate(st):
            base = re.sub(r";?\s*looks like [^;]+", "", x["issues"] or "").strip("; ")
            if k in flagged:
                base = "; ".join(filter(None, [base, "looks like " + ", ".join(flagged[k])]))
            if base != (x["issues"] or ""):
                con.execute("UPDATE students SET issues=? WHERE id=?", (base, x["id"]))
    return pairs


# ============================================================ classroom recognition
def _section_gallery(student_ids: list[int]) -> dict:
    """Same dict shape as embeddings.pkl, but only for this class's students."""
    if not student_ids:
        return {"students": []}
    q = ",".join("?" * len(student_ids))
    with db() as con:
        st = rows(con.execute(f"SELECT id, roll, name, mean_emb, photo FROM students WHERE id IN ({q})", student_ids))
        vw = rows(con.execute(f"SELECT student_id, view, embedding, crop_path FROM student_views WHERE student_id IN ({q})", student_ids))
    by = {}
    for v in vw:
        by.setdefault(v["student_id"], []).append(v)
    out = []
    for s in st:
        views = by.get(s["id"], [])
        if not views:
            continue
        out.append({"id": s["id"], "roll": s["roll"], "name": s["name"],
                    "views": [v["view"] for v in views],
                    "embeddings": np.stack([blob_to_emb(v["embedding"]) for v in views]),
                    "mean_embedding": blob_to_emb(s["mean_emb"]) if s["mean_emb"] else None,
                    "crops": {v["view"]: v["crop_path"] for v in views}})
    return {"students": out}


def recognize_session(job, session_id: int, photo_paths: list[str], actor: str) -> dict:
    s = get_settings()
    with db() as con:
        roster = rows(con.execute("SELECT student_id, status, source, score FROM attendance WHERE session_id=?", (session_id,)))
        batch = (con.execute("SELECT COALESCE(MAX(batch),0) FROM uploads WHERE session_id=?", (session_id,)).fetchone()[0]) + 1
    gal = _section_gallery([r["student_id"] for r in roster])
    students = gal["students"]
    if not students:
        raise ValueError("None of this section's students have enrolled faces.")
    G, owner, _ = build_gallery(gal)
    q = QualityConfig(min_face_px=s["min_face"], min_blur=s["min_blur"], max_yaw=s["max_yaw"],
                      min_det_score=s["det_thresh"])
    eng = engine()
    sdir = SESSION_DIR / str(session_id)
    job.update(total=len(photo_paths), message="Detecting faces")

    best: dict[int, dict] = {}         # student db id -> best evidence across photos
    totals = {"faces": 0, "ok": 0, "matched": 0, "review": 0, "unknown": 0, "rejected": 0}
    for n, p in enumerate(photo_paths, 1):
        job.update(progress=n - 1, message=f"Photo {n} of {len(photo_paths)}")
        img = load_image(p, max_side=4000)
        with _engine_lock:
            faces = eng.detect(img, det_size=s["det_size"], tiles=s["tiles"])
            eng.align(img, faces)
            eng.embed(faces, flip_tta=True)
        for f in faces:
            assess(f, q)
        good = [f for f in faces if f.ok]
        gidx = {id(f): i for i, f in enumerate(good)}
        S = T = None
        pred = {}
        if good:
            E = np.stack([f.embedding for f in good])
            S, T = student_scores(E, G, owner, len(students))
            pred = assign(S, s["review_thresh"])

        stem = f"b{batch}_{n}"
        vis = img.copy()
        det_rows = []
        n_match = 0
        for fi, f in enumerate(faces):
            crop = save_jpg(str(sdir / "faces" / f"{stem}_f{fi:03d}.jpg"), _small(crop_with_margin(img, f.bbox, 0.25), 220), 88)
            x1, y1, x2, y2 = f.bbox.astype(int)
            if not f.ok:
                det_rows.append((rel(crop), None, None, None, None, "REJECTED", ", ".join(f.reject_reasons)))
                cv2.rectangle(vis, (x1, y1), (x2, y2), (128, 128, 128), 2)
                totals["rejected"] += 1
                continue
            gi = gidx[id(f)]
            top = int(np.argmax(S[gi])); top_sc = float(S[gi, top])
            si = pred.get(gi)
            if si is None:
                decision, sc, stu = "UNKNOWN", top_sc, None
                totals["unknown"] += 1
            else:
                sc = float(S[gi, si]); stu = students[si]
                decision = "MATCH" if sc >= s["match_thresh"] else "REVIEW"
                totals["matched" if decision == "MATCH" else "review"] += 1
                n_match += decision == "MATCH"
                b = best.get(stu["id"])
                if b is None or sc > b["score"]:
                    best[stu["id"]] = {"score": sc, "crop": rel(crop)}
            det_rows.append((rel(crop), stu["id"] if stu else None, round(sc, 4),
                             students[top]["id"], round(top_sc, 4), decision, ""))
            color = {"MATCH": (80, 200, 120), "REVIEW": (60, 180, 240), "UNKNOWN": (70, 70, 230)}[decision]
            cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)
            cv2.putText(vis, f"{stu['roll'] if stu else '?'} {sc:.2f}", (x1, max(12, y1 - 5)),
                        cv2.FONT_HERSHEY_SIMPLEX, max(0.4, (x2 - x1) / 120), color, 2)
        totals["faces"] += len(faces); totals["ok"] += len(good)
        ann = save_jpg(str(sdir / "annotated" / f"{stem}.jpg"), _small(vis, 1800), 85)
        with db() as con:
            uid = con.execute("INSERT INTO uploads(session_id,batch,filename,path,annotated,n_faces,n_ok,n_matched,created_at,created_by) "
                              "VALUES(?,?,?,?,?,?,?,?,?,?)",
                              (session_id, batch, Path(p).name.split("__", 1)[-1], rel(p), rel(ann),
                               len(faces), len(good), n_match, now_iso(), actor)).lastrowid
            con.executemany("INSERT INTO detections(upload_id,crop,student_id,score,top1_student_id,top1_score,decision,reasons) "
                            "VALUES(?,?,?,?,?,?,?,?)", [(uid, *r) for r in det_rows])
        job.update(progress=n)

    newly = merge_detections(session_id, best, s["match_thresh"], actor)
    totals.update(newly_present=len(newly), newly_present_names=newly, batch=batch)
    return totals


def merge_detections(session_id: int, best: dict, match_thresh: float, actor: str) -> list[str]:
    """Additive merge. A detection can only turn an automatic 'Absent' into 'Present'.
    It never marks anyone absent and never overrides a manual edit, so re-uploading
    photos can only fill gaps in the sheet."""
    newly = []
    with db() as con:
        cur = {r["student_id"]: r for r in rows(con.execute(
            "SELECT a.student_id, a.status, a.source, a.score, s.name FROM attendance a "
            "JOIN students s ON s.id=a.student_id WHERE a.session_id=?", (session_id,)))}
        for sid, b in best.items():
            r = cur.get(sid)
            if r is None or b["score"] < match_thresh:
                continue
            if r["status"] == "Absent" and r["source"] == "auto":
                con.execute("UPDATE attendance SET status='Present', source='auto', score=?, evidence=?, updated_at=?, updated_by=? "
                            "WHERE session_id=? AND student_id=?", (b["score"], b["crop"], now_iso(), "face-match", session_id, sid))
                newly.append(r["name"])
            elif r["status"] == "Present" and r["source"] == "auto" and b["score"] > (r["score"] or 0):
                con.execute("UPDATE attendance SET score=?, evidence=? WHERE session_id=? AND student_id=?",
                            (b["score"], b["crop"], session_id, sid))
        audit(actor, "recognize", f"session {session_id}: +{len(newly)} present", con)
    return newly
