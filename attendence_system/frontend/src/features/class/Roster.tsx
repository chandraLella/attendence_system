import { useMemo, useState } from "react";
import type { ClassDetail, MarkStatus, RosterRow } from "../../api/types";
import { mediaUrl } from "../../api/client";
import { useConfirm } from "../../components/Modal";
import { Empty, Face, Seg } from "../../components/ui";

type Filter = "all" | MarkStatus;

function sourceText(r: RosterRow) {
  if (r.status === "Not taken") return "No attendance recorded";
  if (r.source === "auto" && r.status === "Present") return `Face match ${r.score ?? ""}`;
  if (r.source === "auto") return r.detected ? `Low-confidence match ${r.detected}` : "Not detected";
  if (r.source === "admin") return "Changed by admin";
  return "Marked by hand";
}

export function Roster({ d, canEdit, onMark }: { d: ClassDetail; canEdit: boolean; onMark: (ids: number[], s: MarkStatus) => void }) {
  const confirm = useConfirm();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const list = useMemo(() => d.roster.filter((r) => (filter === "all" || r.status === filter) &&
    (!q || `${r.name} ${r.roll}`.toLowerCase().includes(q.toLowerCase()))), [d.roster, filter, q]);

  const bulk = async (s: MarkStatus) => {
    if (await confirm({ title: `Mark everyone ${s.toLowerCase()}?`, body: `All ${d.roster.length} students will be set to ${s}. You can still change individual students afterwards.`, ok: `Mark all ${s.toLowerCase()}` }))
      onMark(d.roster.map((r) => r.student_id), s);
  };

  return (
    <section className="panel">
      <div className="panel-head"><h2>Students</h2>
        <div className="row">
          <input type="search" placeholder="Search name or roll" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} aria-label="Search students" />
          <Seg<Filter> value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "Present", label: "Present" }, { value: "Absent", label: "Absent" }]} />
          {canEdit && <><button className="btn sm" onClick={() => bulk("Present")}>Mark all present</button><button className="btn sm" onClick={() => bulk("Absent")}>Mark all absent</button></>}
        </div>
      </div>
      {!list.length ? <Empty title="No students match">Change the filter or search.</Empty> : (
        <div className="roster">
          {list.map((r) => {
            const discrepancy = r.status === "Absent" && r.source !== "auto" && (r.detected ?? 0) >= d.thresholds.match;
            return (
              <div key={r.student_id} className={`stu ${r.status === "Present" ? "present" : r.status === "Absent" ? "absent" : ""}`}>
                <Face path={r.photo} alt={r.name} />
                {r.evidence && <img className="ev" src={mediaUrl(r.evidence)} alt="" title="Face found in class photo" />}
                <div style={{ minWidth: 0 }}>
                  <div className="nm" title={r.name}>{r.name}</div>
                  <div className="meta">{r.roll} &middot; {sourceText(r)}</div>
                  {discrepancy && <div className="flag">Detected in a photo ({r.detected})</div>}
                </div>
                {r.status === "Not taken" ? <span className="tag t-none">Not taken</span> : (
                  <div className="toggle" role="group" aria-label={`Attendance for ${r.name}`}>
                    <button className={`p ${r.status === "Present" ? "on" : ""}`} disabled={!canEdit} title="Present" aria-pressed={r.status === "Present"} onClick={() => r.status !== "Present" && onMark([r.student_id], "Present")}>P</button>
                    <button className={`a ${r.status === "Absent" ? "on" : ""}`} disabled={!canEdit} title="Absent" aria-pressed={r.status === "Absent"} onClick={() => r.status !== "Absent" && onMark([r.student_id], "Absent")}>A</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
