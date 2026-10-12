import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { employee } from "../../api/endpoints";
import { Empty, Loading } from "../../components/ui";
import { useAsync, useTick } from "../../lib/hooks";
import { dur, fmtDate, liveState, serverNow, syncClock, todayISO } from "../../lib/time";
import { ClassRow } from "./ClassRow";

export default function Today() {
  const { data, reload } = useAsync(async () => { const r = await employee.schedule(todayISO(), todayISO()); syncClock(r.server_time); return r; });
  useTick(1000);
  // Refetch when any class changes state so present counts and the hero card stay current.
  const sig = data?.classes.map((c) => liveState(c.window)).join() ?? "";
  const last = useRef(sig);
  useEffect(() => { if (last.current && sig !== last.current) reload(); last.current = sig; }, [sig, reload]);
  if (!data) return <Loading />;

  const t = serverNow();
  const live = data.classes.find((c) => ["live", "grace"].includes(liveState(c.window)));
  const next = data.classes.find((c) => liveState(c.window) === "upcoming");
  const grace = live && liveState(live.window) === "grace";
  return (
    <>
      <div className="page-head"><div><h1>{fmtDate(todayISO())}</h1>
        {!!data.classes.length && <p>{data.classes.length} class{data.classes.length > 1 ? "es" : ""} today. Attendance stays open until {data.grace_minutes} minutes after each class ends.</p>}</div></div>
      {live ? (
        <div className={`live-hero ${grace ? "grace" : ""}`}>
          <div className="row"><span className={`tag t-${grace ? "grace" : "live"}`}>{grace ? "Class ended, still editable" : "In progress"}</span><span className="muted small">{live.start_time} to {live.end_time}</span></div>
          <h2 style={{ margin: "10px 0 4px" }}>{live.subject || "Class"}, {live.section}</h2>
          <p className="muted">Attendance freezes in <b style={{ color: "var(--text)" }}>{dur(+new Date(live.window.freeze) - t)}</b>{live.session_id ? `. ${live.present} of ${live.total} marked present so far.` : "."}</p>
          <div className="row" style={{ marginTop: 14 }}><Link className="btn primary" to={`/employee/class/${live.id}`}>Take attendance</Link></div>
        </div>
      ) : next ? (
        <div className="panel" style={{ marginBottom: 22 }}><p className="muted small">Next class</p>
          <h2 style={{ margin: "4px 0" }}>{next.subject || "Class"}, {next.section} at {next.start_time}</h2>
          <p className="muted">Attendance opens in {dur(+new Date(next.window.start) - t)}.</p></div>
      ) : null}
      {data.classes.length ? <div className="classes">{data.classes.map((c) => <ClassRow key={c.id} c={c} />)}</div>
        : <Empty title="No classes scheduled today">Your past classes are under Past classes.</Empty>}
    </>
  );
}
