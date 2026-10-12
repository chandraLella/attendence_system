import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { classes } from "../../api/endpoints";
import type { ClassDetail, MarkStatus, Role } from "../../api/types";
import { useToast } from "../../components/Toast";
import { Empty, Loading } from "../../components/ui";
import { useAsync, useTick } from "../../lib/hooks";
import { fmtDate, liveState, pct, syncClock } from "../../lib/time";
import { ProcessedPhotos, Suggestions, UnknownFaces } from "./FacePanels";
import { PhotoUploader } from "./PhotoUploader";
import { Roster } from "./Roster";
import { Timeline } from "./Timeline";

/** One class: countdown, photo upload, review, roster. The server enforces every rule shown here. */
export function ClassPage({ role, back }: { role: Role; back: string }) {
  const tid = Number(useParams().id);
  const { toast, fail } = useToast();
  const { data: d, error, loading, reload, setData } = useAsync(async () => {
    const x = await classes.detail(tid); syncClock(x.server_time); return x;
  }, [tid]);

  // When the window crosses start/end/freeze, re-fetch so the server decides what's editable now.
  useTick(1000);
  const state = d ? liveState(d.window) : null;
  const last = useRef(state);
  useEffect(() => {
    if (!d || state === last.current) return;
    const prev = last.current; last.current = state;
    if (prev !== null) { reload(); if (state === "closed" && role === "employee") toast("Attendance is now frozen for this class"); }
  }, [state, d, reload, role, toast]);

  if (loading && !d) return <Loading />;
  if (error && !d) return <Empty title={error.message}><Link to={back}>Go back</Link></Empty>;
  if (!d) return null;

  const t = d.class, c = d.counts;
  const canEdit = d.editable && !!d.session_id;
  const canUpload = d.editable && (role === "admin" ? state !== "upcoming" : state === "live" || state === "grace");

  const mark = async (ids: number[], status: MarkStatus, evidence?: string) => {
    // optimistic: flip locally, then reconcile with the server's view
    const prev = d;
    setData({ ...d, roster: d.roster.map((r) => ids.includes(r.student_id) ? { ...r, status, source: role === "admin" ? "admin" : "manual" } : r) } as ClassDetail);
    try { await classes.mark(tid, ids, status, evidence); } catch (e) { setData(prev); fail(e); }
    reload();
  };

  return (
    <>
      <Link to={back} className="small">Back to classes</Link>
      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h1>{t.subject || "Class"} &nbsp;<span className="muted" style={{ fontWeight: 400 }}>{t.section}</span></h1>
          <p>{fmtDate(t.class_date)}, {t.start_time} to {t.end_time}{t.room && `, room ${t.room}`}. Taught by {t.emp_name || t.emp_id} ({t.emp_id}).</p>
        </div>
        {d.session_id && <div className="row"><a className="btn" href={classes.exportUrl(tid)}>Download CSV</a></div>}
      </div>

      <Timeline w={d.window} />

      <div className="stats" style={{ marginTop: 16 }}>
        <div className="stat"><div className="v" style={{ color: "var(--present)" }}>{c.Present}</div><div className="k">Present</div></div>
        <div className="stat"><div className="v" style={{ color: "var(--absent)" }}>{c.Absent}</div><div className="k">Absent</div></div>
        <div className="stat"><div className="v">{c.total}</div><div className="k">In section</div></div>
        <div className="stat"><div className="v">{pct(c.Present, c.total)}%</div><div className="k">Attendance</div></div>
        <div className="stat"><div className="v">{d.uploads.length}</div><div className="k">Photos processed</div></div>
      </div>

      {role === "admin" && !d.window.open && d.session_id && <div className="notice" style={{ marginBottom: 16 }}>You are viewing as admin. Changes made here after the class froze are recorded in the activity log.</div>}
      {role === "employee" && state === "closed" && <div className="notice frozen" style={{ marginBottom: 16 }}>This class is frozen. Attendance can be viewed but not changed. Contact the admin for corrections.</div>}
      {role === "employee" && state === "upcoming" && <div className="notice" style={{ marginBottom: 16 }}>Attendance opens when the class starts at {t.start_time}.</div>}

      {canUpload && <PhotoUploader tid={tid} section={t.section} onDone={reload} />}
      {canEdit && <Suggestions d={d} onConfirm={(ids, ev) => mark(ids, "Present", ev)} />}
      <Roster d={d} canEdit={canEdit} onMark={(ids, s) => mark(ids, s)} />
      <UnknownFaces d={d} canEdit={canEdit} onAssign={(ids, ev) => mark(ids, "Present", ev)} />
      <ProcessedPhotos d={d} />
    </>
  );
}
