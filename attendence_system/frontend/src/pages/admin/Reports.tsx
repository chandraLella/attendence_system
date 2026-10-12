import { useEffect, useState } from "react";
import { admin } from "../../api/endpoints";
import { Empty, Field, Loading, PageHead } from "../../components/ui";
import { useAsync } from "../../lib/hooks";
import { addDays, todayISO } from "../../lib/time";
import { useSections } from "./useSections";

export default function Reports() {
  const { sections } = useSections();
  const [sec, setSec] = useState<number | null>(null);
  useEffect(() => { if (sec === null && sections.length) setSec(sections[0].id); }, [sections, sec]);
  const [start, setStart] = useState(addDays(todayISO(), -29)); const [end, setEnd] = useState(todayISO()); const [th, setTh] = useState(75);
  const { data: r, loading } = useAsync(async () => (sec ? admin.report(sec, start, end) : null), [sec, start, end]);
  const low = r?.students.filter((s) => s.pct !== null && s.pct < th).length ?? 0;
  return (
    <>
      <PageHead title="Reports" sub="Student-wise attendance for a section. Students below the threshold are highlighted." />
      <section className="panel">
        <div className="row" style={{ marginBottom: 14 }}>
          <Field label="Section"><select value={sec ?? ""} onChange={(e) => setSec(+e.target.value)}>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="From"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="To"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Highlight below"><input type="number" min={0} max={100} value={th} onChange={(e) => setTh(+e.target.value)} style={{ width: 90 }} /></Field>
          <span className="spacer" />{sec && <a className="btn" href={admin.reportXlsxUrl(sec, start, end)}>Download Excel</a>}
        </div>
        {!sections.length ? <Empty title="No sections yet" /> : loading && !r ? <Loading /> : r && <>
          <p className="muted small" style={{ marginBottom: 12 }}>{r.classes.length} classes scheduled, {r.classes_taken} with attendance. {low} students below {th}%.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Roll</th><th>Name</th><th className="num">Present</th><th className="num">Held</th><th className="num">%</th><th>Recent classes</th></tr></thead>
            <tbody>{r.students.map((s) => (
              <tr key={s.id}><td>{s.roll}</td><td>{s.name}</td><td className="num">{s.present}</td><td className="num">{s.held}</td>
                <td className="num" style={{ color: s.pct === null ? "var(--faint)" : s.pct < th ? "var(--absent)" : "var(--present)" }}>{s.pct ?? "-"}</td>
                <td><div className="mini-cells">{s.cells.slice(-20).map((c, i) => <i key={i} title={c} className={c === "Present" ? "p" : c === "Absent" ? "a" : ""} />)}</div></td></tr>))}</tbody>
          </table></div></>}
      </section>
    </>
  );
}
