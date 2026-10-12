import { useState } from "react";
import { admin } from "../../api/endpoints";
import type { Employee } from "../../api/types";
import { Modal, useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { Empty, Field, Loading, PageHead } from "../../components/ui";
import { useAsync } from "../../lib/hooks";

export default function Employees() {
  const { data: list, reload } = useAsync(admin.employees);
  const { fail } = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<Partial<Employee> | null>(null);
  const remove = async (id: string) => {
    if (await confirm({ title: "Remove employee?", body: "Only possible when they have no timetable slots.", ok: "Remove", danger: true })) {
      try { await admin.deleteEmployee(id); reload(); } catch (e) { fail(e); }
    }
  };
  return (
    <>
      <PageHead title="Employees" sub="Employees are added automatically from the timetable. Add names here so they show up on schedules." actions={<button className="btn primary" onClick={() => setEdit({})}>Add employee</button>} />
      <section className="panel">{!list ? <Loading /> : <div className="table-wrap"><table>
        <thead><tr><th>Employee ID</th><th>Name</th><th>Department</th><th className="num">Upcoming classes</th><th /></tr></thead>
        <tbody>{list.length ? list.map((e) => (
          <tr key={e.emp_id}><td><b>{e.emp_id}</b></td><td>{e.name}</td><td>{e.department}</td><td className="num">{e.upcoming}</td>
            <td className="num"><button className="btn sm ghost" onClick={() => setEdit(e)}>Edit</button><button className="btn sm ghost danger" onClick={() => remove(e.emp_id)}>Remove</button></td></tr>))
          : <tr><td colSpan={5}><Empty title="No employees yet">Import a timetable or add one here.</Empty></td></tr>}</tbody>
      </table></div>}</section>
      {edit && <EmployeeModal e={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function EmployeeModal({ e, onClose, onSaved }: { e: Partial<Employee>; onClose: () => void; onSaved: () => void }) {
  const { toast, fail } = useToast();
  const [f, setF] = useState({ emp_id: e.emp_id ?? "", name: e.name ?? "", department: e.department ?? "" });
  const save = async () => { try { await admin.saveEmployee(f); toast("Employee saved", "ok"); onSaved(); } catch (er) { fail(er); } };
  return (
    <Modal title={e.emp_id ? "Edit employee" : "Add employee"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save employee</button></>}>
      <div className="form-grid">
        <Field label="Employee ID"><input value={f.emp_id} readOnly={!!e.emp_id} onChange={(x) => setF({ ...f, emp_id: x.target.value })} /></Field>
        <Field label="Name"><input value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} /></Field>
        <Field label="Department"><input value={f.department} onChange={(x) => setF({ ...f, department: x.target.value })} /></Field>
      </div>
    </Modal>
  );
}
