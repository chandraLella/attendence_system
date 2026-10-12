import { useState } from "react";
import { Link } from "react-router-dom";
import { admin, templates } from "../../api/endpoints";
import type { TimetableEntry, TimetableImportResult } from "../../api/types";
import { Modal, useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Dropzone, Empty, Field, Loading, PageHead, ProblemList, StateTag } from "../../components/ui";
import { useAsync, useDebounced } from "../../lib/hooks";
import { addDays, fmtDate, todayISO } from "../../lib/time";
import { useSections } from "./useSections";

export default function Timetable() {
  const { sections } = useSections();
  const { toast, fail } = useToast();
  const confirm = useConfirm();
  const [start, setStart] = useState(todayISO());
  const [sec, setSec] = useState(""); const [emp, setEmp] = useState("");
  const demp = useDebounced(emp.trim());
  const end = addDays(start, 6);
  const { data: list, reload } = useAsync(() => admin.timetable({ start, end, section_id: sec, emp_id: demp }), [start, sec, demp]);
  const [modal, setModal] = useState<"add" | "import" | null>(null);

  const byDay = new Map<string, TimetableEntry[]>();
  list?.forEach((c) => byDay.set(c.class_date, [...(byDay.get(c.class_date) ?? []), c]));
  const remove = async (id: number) => {
    if (await confirm({ title: "Remove this class?", body: "It will disappear from the employee's schedule.", ok: "Remove", danger: true })) {
      try { await admin.deleteClass(id); reload(); } catch (e) { fail(e); }
    }
  };

  return (
    <>
      <PageHead title="Timetable" sub="Each slot opens attendance for its employee at the start time and freezes it after the grace period."
        actions={<><button className="btn" onClick={() => setModal("import")}>Import from Excel</button><button className="btn primary" onClick={() => setModal("add")}>Add class</button></>} />
      <section className="panel">
        <div className="row" style={{ marginBottom: 14 }}>
          <button className="btn sm" onClick={() => setStart(addDays(start, -7))}>Previous week</button>
          <b>{fmtDate(start)} to {fmtDate(end)}</b>
          <button className="btn sm" onClick={() => setStart(addDays(start, 7))}>Next week</button>
          <button className="btn sm ghost" onClick={() => setStart(todayISO())}>This week</button>
          <span className="spacer" />
          <select value={sec} onChange={(e) => setSec(e.target.value)} aria-label="Section"><option value="">All sections</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input placeholder="Employee ID" value={emp} onChange={(e) => setEmp(e.target.value)} style={{ width: 140 }} aria-label="Employee ID" />
        </div>
        {!list ? <Loading /> : !list.length ? <Empty title="No classes this week">Add a class or import a timetable spreadsheet.</Empty> :
          [...byDay.entries()].map(([d, cs]) => (
            <div key={d}><h3 style={{ margin: "14px 0 8px" }}>{fmtDate(d)}</h3>
              <div className="classes">{cs.map((c) => (
                <div key={c.id} className={`cls ${c.window.state}`}>
                  <div className="time">{c.start_time}<small>to {c.end_time}</small></div>
                  <div><b>{c.section}</b> <span className="muted">{c.subject}</span><div className="small muted">{c.emp_name} {c.emp_id}{c.room && `, room ${c.room}`}</div></div>
                  <div className="row hide-m"><StateTag w={c.window} /></div>
                  <div className="row"><Link className="btn sm ghost" to={`/admin/class/${c.id}`}>{c.session_id ? "View attendance" : "Open"}</Link>
                    {!c.session_id && <button className="btn sm ghost danger" onClick={() => remove(c.id)}>Remove</button>}</div>
                </div>))}</div></div>))}
      </section>
      {modal === "add" && <AddClassModal onClose={() => setModal(null)} onSaved={(n, errs) => { setModal(null); toast(`Added ${n} class${n > 1 ? "es" : ""}${errs.length ? `, skipped ${errs.length}: ${errs[0]}` : ""}`, errs.length ? "" : "ok"); reload(); }} />}
      {modal === "import" && <ImportModal onClose={() => { setModal(null); reload(); }} />}
    </>
  );
}

function AddClassModal({ onClose, onSaved }: { onClose: () => void; onSaved: (n: number, errors: string[]) => void }) {
  const { sections } = useSections();
  const { fail } = useToast();
  const [f, setF] = useState({ emp_id: "", section_id: "", subject: "", room: "", class_date: todayISO(), start_time: "09:00", end_time: "09:50", repeat_until: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const sectionId = f.section_id || String(sections[0]?.id ?? "");
  const save = async () => {
    try { const r = await admin.addClass({ ...f, section_id: +sectionId, repeat_until: f.repeat_until || null }); onSaved(r.added, r.errors); } catch (e) { fail(e); }
  };
  return (
    <Modal title="Add class" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={!f.emp_id.trim() || !sectionId}>Add class</button></>}>
      <div className="form-grid">
        <Field label="Employee ID"><input value={f.emp_id} onChange={set("emp_id")} placeholder="EMP101" /></Field>
        <Field label="Section"><select value={sectionId} onChange={set("section_id")}>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Subject"><input value={f.subject} onChange={set("subject")} /></Field>
        <Field label="Room"><input value={f.room} onChange={set("room")} /></Field>
        <Field label="Date"><input type="date" value={f.class_date} onChange={set("class_date")} /></Field>
        <Field label="Starts"><input type="time" value={f.start_time} onChange={set("start_time")} /></Field>
        <Field label="Ends"><input type="time" value={f.end_time} onChange={set("end_time")} /></Field>
        <Field label="Repeat weekly until"><input type="date" value={f.repeat_until} onChange={set("repeat_until")} /></Field>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>Classes that clash with the same employee or section are skipped and listed.</p>
    </Modal>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { fail } = useToast();
  const [cm, setCm] = useState(false);
  const [r, setR] = useState<TimetableImportResult | null>(null);
  return (
    <Modal title="Import timetable" onClose={onClose} footer={<button className="btn" onClick={onClose}>Done</button>}>
      <p className="muted small" style={{ marginBottom: 12 }}>Columns: Employee ID, Section, Date, Start Time, End Time. Optional: Employee Name, Subject, Room. <a href={templates.url("timetable")}>Download template</a></p>
      <Dropzone accept=".xlsx,.xls,.csv" title="Drop an Excel or CSV file" hint="Rows that clash with existing classes are skipped."
        onFiles={async ([f]) => { try { setR(await admin.importTimetable(f, cm)); } catch (e) { fail(e); } }} />
      <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={cm} onChange={(e) => setCm(e.target.checked)} />Create sections that don't exist yet</label>
      {r && <div className="notice" style={{ marginTop: 12 }}><b>{r.added} classes added.</b>{!!r.created_sections.length && ` Created ${r.created_sections.join(", ")}.`}
        {!!r.errors.length && <><br /><span style={{ color: "var(--review)" }}>{r.errors.length} rows skipped:</span><ProblemList items={r.errors} /></>}</div>}
    </Modal>
  );
}
