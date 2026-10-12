import { Link } from "react-router-dom";
import type { ScheduleClass } from "../../api/types";
import { StateTag } from "../../components/ui";
import { fmtDate, liveState, todayISO } from "../../lib/time";

export const ClassRow = ({ c }: { c: ScheduleClass }) => (
  <Link className={`cls ${liveState(c.window)}`} to={`/employee/class/${c.id}`}>
    <div className="time">{c.start_time}<small>{c.class_date === todayISO() ? `to ${c.end_time}` : fmtDate(c.class_date)}</small></div>
    <div><b>{c.subject || "Class"}</b> <span className="muted">{c.section}</span><div className="small muted">{c.room && `Room ${c.room}, `}{c.section_size} students</div></div>
    <div className="small muted hide-m">{c.session_id ? `${c.present}/${c.total} present` : liveState(c.window) === "closed" ? "Not taken" : ""}</div>
    <StateTag w={c.window} />
  </Link>
);
