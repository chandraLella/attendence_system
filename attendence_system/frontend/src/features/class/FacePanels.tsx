import { useState } from "react";
import { mediaUrl } from "../../api/client";
import type { ClassDetail } from "../../api/types";
import { Modal } from "../../components/Modal";
import { Face } from "../../components/ui";

type Mark = (ids: number[], evidence: string) => void;

export function Suggestions({ d, onConfirm }: { d: ClassDetail; onConfirm: Mark }) {
  if (!d.suggestions.length) return null;
  const byId = new Map(d.roster.map((r) => [r.student_id, r]));
  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Check these possible matches</h2>
        <p className="muted small">Faces that resemble students who are currently absent. Low-confidence matches aren't marked automatically, and students you marked absent by hand are never overridden.</p></div></div>
      <div className="faces">
        {d.suggestions.map((s) => { const r = byId.get(s.student_id); return (
          <div className="facecard" key={s.student_id}>
            <div className="pair"><Face path={s.crop} className="" alt="class photo" /><Face path={r?.photo} className="" alt="enrolled" /></div>
            <div className="cap"><b>{r?.name}</b><br /><span className="muted">{s.decision === "MATCH" ? "strong match, marked absent by hand" : "possible match"} ({s.score})</span></div>
            <button className="btn sm" style={{ marginTop: 6, width: "100%" }} onClick={() => onConfirm([s.student_id], s.crop)}>Mark present</button>
          </div>); })}
      </div>
    </section>
  );
}

export function UnknownFaces({ d, canEdit, onAssign }: { d: ClassDetail; canEdit: boolean; onAssign: Mark }) {
  if (!d.unknown.length) return null;
  const byId = new Map(d.roster.map((r) => [r.student_id, r]));
  const absent = d.roster.filter((r) => r.status === "Absent");
  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Faces not matched to anyone</h2>
        <p className="muted small">Clear faces that did not match a student of this section.{canEdit && " Pick a name to mark that student present."}</p></div></div>
      <div className="faces">
        {d.unknown.slice(0, 60).map((u) => (
          <div className="facecard" key={u.id}>
            <Face path={u.crop} className="" alt="face" />
            <div className="cap muted">closest: {byId.get(u.top1_student_id ?? -1)?.name ?? "none"} ({u.top1_score})</div>
            {canEdit && !!absent.length && (
              <select defaultValue="" aria-label="Assign face to student" onChange={(e) => e.target.value && onAssign([+e.target.value], u.crop)}>
                <option value="">Assign to</option>
                {absent.map((a) => <option key={a.student_id} value={a.student_id}>{a.name}</option>)}
              </select>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProcessedPhotos({ d }: { d: ClassDetail }) {
  const [open, setOpen] = useState<{ src: string; cap: string } | null>(null);
  if (!d.uploads.length) return null;
  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Processed photos</h2>
        <p className="muted small">Green boxes are matches, blue need checking, red are unknown faces and grey were too small, blurry or side-on to use{d.rejected ? ` (${d.rejected} faces)` : ""}.</p></div></div>
      <div className="thumbs">
        {d.uploads.map((u) => (
          <button key={u.id} onClick={() => setOpen({ src: mediaUrl(u.annotated), cap: `${u.filename}: ${u.n_faces} faces, ${u.n_matched} matched` })}>
            <img src={mediaUrl(u.annotated)} alt={u.filename} loading="lazy" />
            <span className="small muted">Round {u.batch}, {u.n_matched}/{u.n_faces} matched</span>
          </button>
        ))}
      </div>
      {open && <Modal wide onClose={() => setOpen(null)} footer={<button className="btn" onClick={() => setOpen(null)}>Close</button>}>
        <div className="lightbox"><img src={open.src} alt="" /><p className="muted small" style={{ marginTop: 8 }}>{open.cap}</p></div></Modal>}
    </section>
  );
}
