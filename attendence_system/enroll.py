"""
enroll.py - Excel of students -> download 3 images each -> detect -> crop -> embed -> store.

Usage:
    python enroll.py --excel students.xlsx --out enroll_output
    python enroll.py --excel students.xlsx --out enroll_output --gpu --workers 16

Outputs (in --out):
    downloads/<roll>/<view>_<fileid>        raw images
    crops/<roll>/<view>_crop.jpg            face crop with margin   (verify detection)
    crops/<roll>/<view>_aligned.jpg         112x112 aligned crop    (what the model sees)
    embeddings.pkl                          enrollment database (used by attendance.py)
    enroll_embeddings.xlsx                  same embeddings as rows of 512 floats
    enroll_report.xlsx                      per-student status with thumbnails
"""
from __future__ import annotations

import argparse
import logging
import os
import pickle
import re
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import cv2
import numpy as np
import pandas as pd
import requests
from openpyxl import Workbook
from tqdm import tqdm

from face_engine import (VIEWS, Face, FaceEngine, crop_with_margin, load_image,
                         make_thumb, save_jpg, write_sheet)

log = logging.getLogger("enroll")

# keyword rules used to find columns, so the long Google-Form headers don't need to match exactly
COLUMN_RULES = {
    "name": [r"full\s*name", r"\bname\b"],
    "roll": [r"registration", r"roll"],
    "front": [r"image\s*1", r"front"],
    "left45": [r"image\s*2", r"left"],
    "right45": [r"image\s*3", r"right"],
}
DRIVE_ID_RE = [r"/file/d/([\w-]{20,})", r"[?&]id=([\w-]{20,})", r"/d/([\w-]{20,})"]


# ------------------------------------------------------------------ excel parsing
def resolve_columns(df: pd.DataFrame) -> dict:
    cols, used = {}, set()
    for key, pats in COLUMN_RULES.items():
        for pat in pats:
            hit = next((c for c in df.columns
                        if c not in used and re.search(pat, str(c), re.I)), None)
            if hit:
                cols[key] = hit; used.add(hit); break
        if key not in cols:
            raise ValueError(f"Could not find a column for '{key}'. Columns: {list(df.columns)}")
    log.info("Column mapping: %s", cols)
    return cols


def safe_name(s: str) -> str:
    return re.sub(r"[^\w.-]+", "_", str(s).strip()) or "unknown"


def parse_source(cell) -> tuple[str, str] | None:
    """Return ('drive', file_id) | ('local', path) | ('url', url) | None.
    Google Forms cells can hold several comma-separated links - the first is used."""
    if cell is None or (isinstance(cell, float) and np.isnan(cell)):
        return None
    text = str(cell).strip()
    if not text:
        return None
    if os.path.exists(text):
        return ("local", text)
    first = re.split(r"[,\s]+", text)[0]
    for pat in DRIVE_ID_RE:
        m = re.search(pat, first)
        if m:
            return ("drive", m.group(1))
    if first.startswith("http"):
        return ("url", first)
    return None


# ------------------------------------------------------------------------ download
def download_one(src: tuple[str, str], dest_base: str, retries: int = 3) -> str:
    kind, ref = src
    if kind == "local":
        dest = dest_base + os.path.splitext(ref)[1]
        if not os.path.exists(dest):
            shutil.copy(ref, dest)
        return dest
    dest = dest_base + (f"_{ref}" if kind == "drive" else "")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:   # resume support
        return dest
    last_err = None
    for attempt in range(retries):
        try:
            if kind == "drive":
                import gdown
                out = gdown.download(id=ref, output=dest, quiet=True)
                if not out:
                    raise RuntimeError("gdown returned None (file not shared publicly?)")
            else:
                r = requests.get(ref, timeout=60); r.raise_for_status()
                with open(dest, "wb") as fh:
                    fh.write(r.content)
            if os.path.getsize(dest) < 1024:
                raise RuntimeError("downloaded file too small - probably an HTML error page")
            return dest
        except Exception as e:  # noqa: BLE001
            last_err = e
            if os.path.exists(dest):
                os.remove(dest)
            time.sleep(2 * (attempt + 1))
    msg = str(last_err).strip().splitlines()
    raise RuntimeError(f"download failed ({msg[0] if msg else last_err}). Is the file shared as 'Anyone with the link'?")


# ----------------------------------------------------------------------- detection
def detect_main_face(engine: FaceEngine, img: np.ndarray) -> Face | None:
    """Enrollment photo = one subject. Take the largest face. Fallbacks:
    larger input, then padding (faces filling the whole frame are sometimes missed)."""
    for size, pad in ((640, 0), (1024, 0), (640, 0.25)):
        work = img
        if pad:
            p = int(max(img.shape[:2]) * pad)
            work = cv2.copyMakeBorder(img, p, p, p, p, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        faces = engine.detect(work, det_size=size)
        if faces:
            f = max(faces, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]))
            if pad:
                f.bbox[[0, 2]] -= p; f.bbox[[1, 3]] -= p; f.kps -= p
            return f
    return None


# ---------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Student face enrollment")
    ap.add_argument("--excel", required=True)
    ap.add_argument("--sheet", default=0)
    ap.add_argument("--out", default="enroll_output")
    ap.add_argument("--model", default="buffalo_l", help="buffalo_l | antelopev2")
    ap.add_argument("--workers", type=int, default=8, help="parallel downloads")
    ap.add_argument("--gpu", action="store_true")
    ap.add_argument("--no-flip-tta", action="store_true")
    ap.add_argument("--warn-blur", type=float, default=40.0)
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out = args.out
    for d in ("downloads", "crops", "thumbs"):
        os.makedirs(os.path.join(out, d), exist_ok=True)

    df = pd.read_excel(args.excel, sheet_name=args.sheet, dtype=str)
    cols = resolve_columns(df)
    df = df.dropna(subset=[cols["roll"]])

    # ---- 1) parallel downloads (I/O bound -> threads) ------------------------------
    students, tasks = [], {}
    for _, row in df.iterrows():
        roll = str(row[cols["roll"]]).strip()
        st = {"roll": roll, "name": str(row[cols["name"]]).strip(), "views": {}, "errors": []}
        students.append(st)
        sdir = os.path.join(out, "downloads", safe_name(roll))
        os.makedirs(sdir, exist_ok=True)
        for v in VIEWS:
            src = parse_source(row[cols[v]])
            if src is None:
                st["errors"].append(f"{v}: no/invalid link")
                continue
            tasks[(roll, v)] = (src, os.path.join(sdir, v))

    paths = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(download_one, s, d): k for k, (s, d) in tasks.items()}
        for fut in tqdm(as_completed(futs), total=len(futs), desc="Downloading"):
            key = futs[fut]
            try:
                paths[key] = fut.result()
            except Exception as e:  # noqa: BLE001
                next(s for s in students if s["roll"] == key[0])["errors"].append(f"{key[1]}: {e}")

    # ---- 2) detect + embed. Decoding is threaded and overlaps with inference --------
    engine = FaceEngine(args.model, det_size=640, use_gpu=args.gpu)
    jobs = [(st, v, paths[(st["roll"], v)]) for st in students for v in VIEWS
            if (st["roll"], v) in paths]

    def _load(job):
        try:
            return job, load_image(job[2], max_side=1600), None
        except Exception as e:  # noqa: BLE001
            return job, None, e

    with ThreadPoolExecutor(max_workers=4) as ex:
        for (st, v, p), img, err in tqdm(ex.map(_load, jobs), total=len(jobs), desc="Enrolling"):
            if err is not None:
                st["errors"].append(f"{v}: cannot read image ({err})"); continue
            face = detect_main_face(engine, img)
            if face is None:
                st["errors"].append(f"{v}: no face detected"); continue
            engine.align(img, [face])
            engine.embed([face], flip_tta=not args.no_flip_tta)
            sdir = os.path.join(out, "crops", safe_name(st["roll"]))
            crop_p = save_jpg(os.path.join(sdir, f"{v}_crop.jpg"), crop_with_margin(img, face.bbox))
            align_p = save_jpg(os.path.join(sdir, f"{v}_aligned.jpg"), face.aligned)
            st["views"][v] = {
                "embedding": face.embedding, "crop": crop_p, "aligned": align_p, "source": p,
                "det_score": face.score, "blur": face.blur, "face_px": face.face_px,
                "yaw": face.yaw, "feat_norm": face.feat_norm,
            }

    # ---- 3) build database -------------------------------------------------------
    db_students = []
    for st in students:
        vs = [v for v in VIEWS if v in st["views"]]
        emb = np.stack([st["views"][v]["embedding"] for v in vs]) if vs else np.zeros((0, 512), np.float32)
        mean = None
        if len(vs):
            m = emb.mean(0); mean = (m / np.linalg.norm(m)).astype(np.float32)
        db_students.append({
            "roll": st["roll"], "name": st["name"], "views": vs, "embeddings": emb,
            "mean_embedding": mean,
            "crops": {v: st["views"][v]["crop"] for v in vs},
            "aligned": {v: st["views"][v]["aligned"] for v in vs},
            "front_source": st["views"].get("front", {}).get("source")
                            or paths.get((st["roll"], "front")),
        })
    db = {"model_pack": args.model, "flip_tta": not args.no_flip_tta, "embedding_dim": 512,
          "created": datetime.now().isoformat(timespec="seconds"), "students": db_students}
    with open(os.path.join(out, "embeddings.pkl"), "wb") as fh:
        pickle.dump(db, fh)

    # embeddings as Excel rows
    rows = [[s["roll"], s["name"], v, *s["embeddings"][i].round(6).tolist()]
            for s in db_students for i, v in enumerate(s["views"])]
    pd.DataFrame(rows, columns=["roll", "name", "view", *[f"e{i}" for i in range(512)]]) \
        .to_excel(os.path.join(out, "enroll_embeddings.xlsx"), index=False)

    # ---- 4) verification report with thumbnails ---------------------------------
    wb = Workbook(); ws = wb.active; ws.title = "Enrollment"
    headers = ["Roll No", "Name", "Status", "Views OK", "Front", "Left 45", "Right 45",
               "Min blur", "Min face px", "Issues"]
    rep = []
    for st in students:
        th = {}
        for v in VIEWS:
            if v in st["views"]:
                th[v] = make_thumb(st["views"][v]["crop"],
                                   os.path.join(out, "thumbs", f"{safe_name(st['roll'])}_{v}.jpg"))
        n = len(st["views"])
        issues = list(st["errors"])
        blurs = [x["blur"] for x in st["views"].values()]
        if blurs and min(blurs) < args.warn_blur:
            issues.append("low sharpness in an enroll image - consider retaking")
        status = "OK" if n == 3 and not issues else ("PARTIAL" if n else "FAILED")
        rep.append([st["roll"], st["name"], status, f"{n}/3", th.get("front"), th.get("left45"),
                    th.get("right45"), round(min(blurs), 1) if blurs else None,
                    min((x["face_px"] for x in st["views"].values()), default=None),
                    "; ".join(issues)])
    write_sheet(ws, headers, rep, image_cols=("Front", "Left 45", "Right 45"))
    ws.column_dimensions["J"].width = 60
    wb.save(os.path.join(out, "enroll_report.xlsx"))

    ok = sum(r[2] == "OK" for r in rep)
    log.info("Done: %d students | OK=%d PARTIAL=%d FAILED=%d -> %s", len(rep), ok,
             sum(r[2] == "PARTIAL" for r in rep), sum(r[2] == "FAILED" for r in rep), out)


if __name__ == "__main__":
    main()
