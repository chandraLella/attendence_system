import { useState } from "react";
import { Link } from "react-router-dom";
import { pollJob } from "../../api/client";
import { admin } from "../../api/endpoints";
import type { EnrollResult } from "../../api/types";
import { Dropzone, PageHead, ProblemList, ProgressBar } from "../../components/ui";

type S = { phase: "idle" } | { phase: "running"; msg: string; p: number } | { phase: "done"; r: EnrollResult } | { phase: "error"; msg: string };

export default function Enrollment() {
  const [s, setS] = useState<S>({ phase: "idle" });
  const start = async ([f]: File[]) => {
    if (!f.name.toLowerCase().endsWith(".zip")) return setS({ phase: "error", msg: "Choose a .zip file" });
    setS({ phase: "running", msg: `Uploading ${f.name}`, p: 0 });
    try {
      const { job_id } = await admin.enrollZip(f, (p) => setS({ phase: "running", msg: `Uploading ${f.name}`, p: p * 0.2 }));
      const r = await pollJob<EnrollResult>(job_id, (j) => setS({ phase: "running", msg: j.message, p: j.total ? 0.2 + (0.8 * j.progress) / j.total : 0.2 }));
      setS({ phase: "done", r });
    } catch (e) { setS({ phase: "error", msg: (e as Error).message }); }
  };
  return (
    <>
      <PageHead title="Enrollment" sub="Upload one zip with a folder per student. Each folder holds that student's three photos: front, left 45° and right 45°." />
      <div className="grid g2">
        <section className="panel">
          <h2 style={{ marginBottom: 12 }}>Upload enrollment zip</h2>
          <Dropzone accept=".zip" disabled={s.phase === "running"} title="Drop the .zip here or click to choose" hint="Faces are cropped and converted to embeddings on this server." onFiles={start} />
          <div style={{ marginTop: 14 }}>
            {s.phase === "running" && <><div className="small">{s.msg}</div><ProgressBar value={s.p} /></>}
            {s.phase === "error" && <div className="notice" style={{ color: "var(--absent)" }}>{s.msg}</div>}
            {s.phase === "done" && <div className="notice">
              <b>Enrollment finished.</b> {s.r.students} students: {s.r.created} new, {s.r.updated} updated.<br />
              <span style={{ color: "var(--present)" }}>{s.r.OK} ready</span>, <span style={{ color: "var(--review)" }}>{s.r.PARTIAL} partial</span>, <span style={{ color: "var(--absent)" }}>{s.r.FAILED} failed</span>.
              {!!s.r.duplicates.length && <><br /><span style={{ color: "var(--review)" }}>{s.r.duplicates.length} pairs of students look alike:</span>
                <ProblemList items={s.r.duplicates.map((x) => `${x.a} and ${x.b} (${x.similarity})`)} /></>}
              <div className="row" style={{ marginTop: 10 }}><Link className="btn sm" to="/admin/students">Review students</Link><Link className="btn sm" to="/admin/sections">Assign sections</Link></div>
            </div>}
          </div>
        </section>
        <section className="panel">
          <h2 style={{ marginBottom: 10 }}>How to name folders</h2>
          <p className="muted small">Start the folder name with the roll number, then the name. The roll number keeps students unique, so re-uploading a folder replaces that student's photos and keeps their section.</p>
          <pre className="notice small" style={{ margin: "12px 0", whiteSpace: "pre-wrap" }}>{`students.zip
  21CS001_Ravi Kumar/
    front.jpg   left.jpg   right.jpg
  21CS002 - Priya Sharma/
    1.jpg   2.jpg   3.jpg`}</pre>
          <p className="muted small">Files named front, left or right are used for that view; otherwise the first three images in name order are used. A folder without a roll number uses the folder name as both roll and name, which you can edit under Students.</p>
        </section>
      </div>
    </>
  );
}
