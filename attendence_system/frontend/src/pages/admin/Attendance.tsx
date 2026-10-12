import { useState } from "react";
import { Link } from "react-router-dom";
import { admin } from "../../api/endpoints";
import { Empty, Loading, PageHead, StateTag } from "../../components/ui";
import { useAsync } from "../../lib/hooks";
import { addDays, fmtDate, todayISO } from "../../lib/time";
import { useSections } from "./useSections";

export default function Attendance() {
  const { sections } = useSections();
  const [start, setStart] = useState(addDays(todayISO(), -6)); const [end, setEnd] = useState(todayISO()); const [sec, setSec] = useState("");
  const { data } = useAsync(() => admin.timetable({ start, end, section_id: sec }), [start, end, sec]);
  const rows = (data ?? []).filter((c) => c.window.state !== "upcoming").reverse();
  return (
    <>
      <PageHead title="Attendance" sub="Every class that has started in a date range. Open one to view or correct it." />
      <section className="panel">
        <div className="row" style={{ marginBottom: 14 }}>
          <label className="field">From<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field">To<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          <label className="field">Section<select value={sec} onChange={(e) => setSec(e.target.value)}><option value="">All</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        </div>
        {!data ? <Loading /> : <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Time</th><th>Section</th><th>Subject</th><th>Employee</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.length ? rows.map((c) => (
            <tr key={c.id}><td>{fmtDate(c.class_date)}</td><td>{c.start_time}-{c.end_time}</td><td>{c.section}</td><td>{c.subject}</td><td>{c.emp_id}</td>
              <td>{c.session_id ? <StateTag w={c.window} /> : <span className="tag t-absent">Not taken</span>}</td>
              <td className="num"><Link className="btn sm ghost" to={`/admin/class/${c.id}`}>Open</Link></td></tr>))
            : <tr><td colSpan={7}><Empty title="No classes in this range" /></td></tr>}</tbody>
        </table></div>}
      </section>
    </>
  );
}
