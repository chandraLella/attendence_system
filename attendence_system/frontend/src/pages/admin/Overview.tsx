import { Link } from "react-router-dom";
import { admin } from "../../api/endpoints";
import { Empty, ErrorBox, Loading, PageHead, StateTag } from "../../components/ui";
import { useAsync } from "../../lib/hooks";
import { fmtDate, pct, todayISO } from "../../lib/time";

export default function Overview() {
  const { data: o, error } = useAsync(admin.overview);
  if (error) return <ErrorBox error={error} />;
  if (!o) return <Loading />;
  const e = o.enrolled;
  return (
    <>
      <PageHead title="Overview" sub={`Today is ${fmtDate(todayISO())}.`} />
      <div className="stats">
        <div className="stat"><div className="v">{o.students}</div><div className="k">Students enrolled</div></div>
        <div className="stat"><div className="v" style={{ color: "var(--present)" }}>{e.OK ?? 0}</div><div className="k">Ready for matching</div></div>
        <div className="stat"><div className="v" style={{ color: "var(--review)" }}>{e.PARTIAL ?? 0}</div><div className="k">Partial enrollment</div></div>
        <div className="stat"><div className="v" style={{ color: "var(--absent)" }}>{e.FAILED ?? 0}</div><div className="k">No face found</div></div>
        <div className="stat"><div className="v">{o.sections}</div><div className="k">Sections</div></div>
        <div className="stat"><div className="v">{o.unassigned}</div><div className="k">Without a section</div></div>
      </div>
      {o.flagged > 0 && <div className="notice" style={{ marginBottom: 16 }}>{o.flagged} students look very similar to another enrolled student. <Link to="/admin/students">Review them</Link> before taking attendance.</div>}
      <div className="grid g2">
        <section className="panel">
          <div className="panel-head"><h2>Today's classes</h2><Link to="/admin/timetable" className="small">Open timetable</Link></div>
          {o.today.length ? <div className="classes">{o.today.map((c) => (
            <Link key={c.id} className={`cls ${c.window.state}`} to={`/admin/class/${c.id}`}>
              <div className="time">{c.start_time}<small>to {c.end_time}</small></div>
              <div><b>{c.section}</b> <span className="muted">{c.subject}</span><div className="small muted">{c.emp_name || c.emp_id}</div></div>
              <div className="small muted hide-m">{c.session_id ? `${c.present}/${c.total} present` : "Not taken"}</div>
              <StateTag w={c.window} />
            </Link>))}</div>
            : <Empty title="No classes today"><Link to="/admin/timetable">Add classes to the timetable</Link></Empty>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Attendance, last 7 days</h2></div>
          {o.trend.length ? <div className="bars">{o.trend.map((t) => (
            <div key={t.d}><span>{pct(t.p, t.n)}%</span><i style={{ height: `${pct(t.p, t.n)}%` }} title={`${t.p} of ${t.n} marks`} /><span>{fmtDate(t.d).split(",")[0]}</span></div>))}</div>
            : <Empty title="No attendance yet">Figures appear once employees take attendance.</Empty>}
        </section>
      </div>
    </>
  );
}
