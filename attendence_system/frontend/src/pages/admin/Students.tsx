import { useState } from "react";
import { Link } from "react-router-dom";
import { admin } from "../../api/endpoints";
import { useConfirm, Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Empty, EnrollTag, Face, Field, Loading, PageHead } from "../../components/ui";
import { useAsync, useDebounced } from "../../lib/hooks";
import { pct } from "../../lib/time";
import { useSections } from "./useSections";

export default function Students() {
  const { sections } = useSections();
  const { toast, fail } = useToast();
  const [q, setQ] = useState(""); const [sec, setSec] = useState(""); const [status, setStatus] = useState("");
  const dq = useDebounced(q);
  const { data: list, reload } = useAsync(() => admin.students({ q: dq, section_id: sec, status }), [dq, sec, status]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const toggle = (id: number, on: boolean) => setSel((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });

  const move = async (v: string) => {
    if (!v) return;
    try { const r = await admin.moveStudents([...sel], v === "null" ? null : +v); toast(`Moved ${r.updated} students`, "ok"); setSel(new Set()); reload(); } catch (e) { fail(e); }
  };

  return (
    <>
      <PageHead title="Students" sub="Enrollment quality and section for every student." />
      <section className="panel">
        <div className="row" style={{ marginBottom: 14 }}>
          <input type="search" placeholder="Search name or roll" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} aria-label="Search" />
          <select value={sec} onChange={(e) => setSec(e.target.value)} aria-label="Section"><option value="">All sections</option><option value="none">No section</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Enrollment"><option value="">Any enrollment</option><option value="OK">Ready</option><option value="PARTIAL">Partial</option><option value="FAILED">Failed</option></select>
          <span className="spacer" />{sel.size > 0 && <span className="small muted">{sel.size} selected</span>}
          <select value="" disabled={!sel.size} onChange={(e) => move(e.target.value)} aria-label="Move selected"><option value="">Move selected to</option><option value="null">No section</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
        {!list ? <Loading /> : (
          <div className="table-wrap"><table>
            <thead><tr><th style={{ width: 30 }}><input type="checkbox" aria-label="Select all" checked={!!list.length && list.every((s) => sel.has(s.id))} onChange={(e) => setSel(e.target.checked ? new Set(list.map((s) => s.id)) : new Set())} /></th><th /><th>Name</th><th>Roll</th><th>Section</th><th>Enrollment</th><th>Notes</th><th /></tr></thead>
            <tbody>
              {list.length ? list.map((s) => (
                <tr key={s.id}>
                  <td><input type="checkbox" checked={sel.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} aria-label={`Select ${s.name}`} /></td>
                  <td><Face path={s.photo} alt={s.name} /></td><td><b>{s.name}</b></td><td>{s.roll}</td>
                  <td>{s.section ?? <span className="faint">None</span>}</td>
                  <td><EnrollTag s={s.status} /> <span className="small muted">{s.n_views} photos</span></td>
                  <td className="small muted" style={{ maxWidth: 280 }}>{s.issues}</td>
                  <td><button className="btn sm ghost" onClick={() => setOpen(s.id)}>Details</button></td>
                </tr>
              )) : <tr><td colSpan={8}><Empty title="No students found"><Link to="/admin/enroll">Upload an enrollment zip</Link></Empty></td></tr>}
            </tbody>
          </table></div>
        )}
      </section>
      {open !== null && <StudentModal id={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function StudentModal({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const { data: s } = useAsync(() => admin.student(id), [id]);
  const { sections } = useSections();
  const { toast, fail } = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<{ name: string; roll: string; section: string } | null>(null);
  const f = form ?? (s ? { name: s.name, roll: s.roll, section: s.section_id ? String(s.section_id) : "" } : null);
  if (!s || !f) return <Modal onClose={onClose}><Loading /></Modal>;
  const p = s.history.filter((h) => h.status === "Present").length;

  const save = async () => {
    try { await admin.updateStudent(id, { name: f.name, roll: f.roll, section_id: f.section ? +f.section : null }); toast("Student saved", "ok"); onSaved(); } catch (e) { fail(e); }
  };
  const remove = async () => {
    if (await confirm({ title: `Delete ${s.name}?`, body: "Their face data and all attendance records are removed. This can't be undone.", ok: "Delete student", danger: true })) {
      try { await admin.deleteStudent(id); toast("Student deleted"); onSaved(); } catch (e) { fail(e); }
    }
  };
  return (
    <Modal wide title={s.name} onClose={onClose} footer={<>
      <button className="btn danger" style={{ marginRight: "auto" }} onClick={remove}>Delete student</button>
      <button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save changes</button></>}>
      <div className="faces" style={{ marginBottom: 14 }}>
        {s.views.length ? s.views.map((v) => <div className="facecard" key={v.view}><Face path={v.crop_path} className="" alt={v.view} /><div className="cap"><b>{v.view}</b><br /><span className="muted">sharpness {v.blur}, {v.face_px}px</span></div></div>)
          : <span className="muted">No faces were found in this student's photos. Re-upload a folder for this roll number.</span>}
      </div>
      {s.issues && <div className="notice small" style={{ marginBottom: 14 }}>{s.issues}</div>}
      <div className="form-grid">
        <Field label="Name"><input value={f.name} onChange={(e) => setForm({ ...f, name: e.target.value })} /></Field>
        <Field label="Roll number"><input value={f.roll} onChange={(e) => setForm({ ...f, roll: e.target.value })} /></Field>
        <Field label="Section"><select value={f.section} onChange={(e) => setForm({ ...f, section: e.target.value })}><option value="">None</option>{sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>{s.history.length ? `Present in ${p} of the last ${s.history.length} classes (${pct(p, s.history.length)}%).` : "No attendance recorded yet."}</p>
    </Modal>
  );
}
