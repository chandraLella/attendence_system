import { useEffect, useState } from "react";
import { admin, templates } from "../../api/endpoints";
import type { Section, SectionImportResult } from "../../api/types";
import { Modal, useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Dropzone, Empty, Field, PageHead, ProblemList } from "../../components/ui";
import { useSections } from "./useSections";

export default function Sections() {
  const { sections, reloadSections } = useSections();
  const { toast, fail } = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<Section | "new" | null>(null);

  // alphabetical split
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  useEffect(() => setTicked(new Set(sections.map((s) => s.id))), [sections]);
  const [by, setBy] = useState<"name" | "roll">("name");
  const [mode, setMode] = useState<"equal" | "capacity">("equal");
  const [cap, setCap] = useState(60);
  const [scope, setScope] = useState<"unassigned" | "all">("unassigned");
  const [split, setSplit] = useState("");

  // excel import
  const [createMissing, setCreateMissing] = useState(true);
  const [imp, setImp] = useState<SectionImportResult | null>(null);

  const autoAssign = async () => {
    if (scope === "all" && !(await confirm({ title: "Reassign every student?", body: "Current section assignments will be replaced. Past attendance records are not affected.", ok: "Reassign" }))) return;
    try {
      const order = sections.filter((s) => ticked.has(s.id)).map((s) => s.id);
      const r = await admin.autoAssign({ section_ids: order, by, mode, capacity: cap, scope });
      toast(`Assigned ${r.assigned} students`, "ok");
      setSplit(r.split.map((s) => `${s.section}: ${s.count}`).join(", ") + (r.left_unassigned ? `. ${r.left_unassigned} did not fit.` : ""));
      reloadSections();
    } catch (e) { fail(e); }
  };
  const importFile = async ([f]: File[]) => {
    try { setImp(await admin.importSections(f, createMissing)); reloadSections(); } catch (e) { fail(e); }
  };
  const remove = async (s: Section) => {
    if (await confirm({ title: `Delete ${s.name}?`, body: "Students stay enrolled but lose this section. Its timetable slots and their attendance records are deleted.", ok: "Delete section", danger: true })) {
      try { await admin.deleteSection(s.id); toast("Section deleted"); reloadSections(); } catch (e) { fail(e); }
    }
  };

  return (
    <>
      <PageHead title="Sections" sub="Create sections, then fill them alphabetically or from a spreadsheet." actions={<button className="btn primary" onClick={() => setEdit("new")}>New section</button>} />
      <div className="grid g2">
        <section className="panel">
          <h2 style={{ marginBottom: 12 }}>Sections</h2>
          {sections.length ? <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th className="num">Students</th><th className="num">Ready</th><th /></tr></thead>
            <tbody>{sections.map((s) => (
              <tr key={s.id}><td><b>{s.name}</b><div className="small muted">{s.description}</div></td><td className="num">{s.students}</td><td className="num">{s.ok ?? 0}</td>
                <td className="num"><button className="btn sm ghost" onClick={() => setEdit(s)}>Rename</button><button className="btn sm ghost danger" onClick={() => remove(s)}>Delete</button></td></tr>))}</tbody>
          </table></div> : <Empty title="No sections yet">Create one to start assigning students.</Empty>}
        </section>
        <div>
          <section className="panel">
            <h2>Fill sections alphabetically</h2>
            <p className="muted small" style={{ margin: "4px 0 14px" }}>Students are sorted, then split across the sections you tick, in the order shown.</p>
            <div className="row" style={{ marginBottom: 12 }}>
              {sections.map((s) => <label className="check" key={s.id}><input type="checkbox" checked={ticked.has(s.id)} onChange={(e) => setTicked((t) => { const n = new Set(t); e.target.checked ? n.add(s.id) : n.delete(s.id); return n; })} />{s.name}</label>)}
              {!sections.length && <span className="muted small">Create sections first.</span>}
            </div>
            <div className="form-grid">
              <Field label="Sort by"><select value={by} onChange={(e) => setBy(e.target.value as "name")}><option value="name">Name</option><option value="roll">Roll number</option></select></Field>
              <Field label="Split"><select value={mode} onChange={(e) => setMode(e.target.value as "equal")}><option value="equal">Evenly</option><option value="capacity">Fill up to a size</option></select></Field>
              <Field label="Section size"><input type="number" min={1} value={cap} disabled={mode !== "capacity"} onChange={(e) => setCap(+e.target.value)} /></Field>
              <Field label="Students"><select value={scope} onChange={(e) => setScope(e.target.value as "all")}><option value="unassigned">Only those without a section</option><option value="all">Everyone (reassign)</option></select></Field>
            </div>
            <div className="row" style={{ marginTop: 14 }}><button className="btn primary" disabled={!ticked.size} onClick={autoAssign}>Assign students</button><span className="small muted">{split}</span></div>
          </section>
          <section className="panel">
            <h2>Assign from a spreadsheet</h2>
            <p className="muted small" style={{ margin: "4px 0 14px" }}>Columns: Student Name and Section. Add a Roll No column if two students share a name. <a href={templates.url("sections")}>Download template</a></p>
            <Dropzone accept=".xlsx,.xls,.csv" title="Drop an Excel or CSV file" hint="Unmatched names are listed so you can fix them." onFiles={importFile} />
            <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />Create sections that don't exist yet</label>
            {imp && <div className="notice" style={{ marginTop: 12 }}><b>{imp.assigned} students assigned.</b>{!!imp.created_sections.length && ` Created ${imp.created_sections.join(", ")}.`}
              {!!(imp.not_found.length + imp.ambiguous.length) && <><br /><span style={{ color: "var(--review)" }}>{imp.not_found.length + imp.ambiguous.length} rows need attention:</span><ProblemList items={[...imp.not_found, ...imp.ambiguous]} /></>}</div>}
          </section>
        </div>
      </div>
      {edit && <SectionModal s={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reloadSections(); }} />}
    </>
  );
}

function SectionModal({ s, onClose, onSaved }: { s: Section | null; onClose: () => void; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [name, setName] = useState(s?.name ?? ""); const [desc, setDesc] = useState(s?.description ?? "");
  const save = async () => {
    try { s ? await admin.updateSection(s.id, { name, description: desc }) : await admin.createSection(name, desc); toast(s ? "Section saved" : "Section created", "ok"); onSaved(); } catch (e) { fail(e); }
  };
  return (
    <Modal title={s ? "Rename section" : "New section"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>{s ? "Save section" : "Create section"}</button></>}>
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <Field label="Name"><input value={name} placeholder="e.g. CSE-A" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} /></Field>
        <Field label="Description"><input value={desc} placeholder="Optional" onChange={(e) => setDesc(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
