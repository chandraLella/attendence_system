import { admin } from "../../api/endpoints";
import { Loading, PageHead } from "../../components/ui";
import { useAsync } from "../../lib/hooks";

export default function Activity() {
  const { data } = useAsync(() => admin.audit(300));
  return (
    <>
      <PageHead title="Activity log" sub="Sign-ins, imports and every attendance change, newest first." />
      <section className="panel">{!data ? <Loading /> : <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
        <tbody>{data.map((a) => <tr key={a.id}><td className="small">{a.ts.replace("T", " ")}</td><td>{a.actor}</td><td>{a.action}</td><td className="small muted">{a.detail}</td></tr>)}</tbody>
      </table></div>}</section>
    </>
  );
}
