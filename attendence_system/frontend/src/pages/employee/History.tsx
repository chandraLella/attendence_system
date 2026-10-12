import { useState } from "react";
import { employee } from "../../api/endpoints";
import { Empty, Loading } from "../../components/ui";
import { useAsync } from "../../lib/hooks";
import { addDays, todayISO } from "../../lib/time";
import { ClassRow } from "./ClassRow";

export default function History() {
  const [from, setFrom] = useState(addDays(todayISO(), -30));
  const { data } = useAsync(() => employee.schedule(from, todayISO()), [from]);
  const past = (data?.classes ?? []).filter((c) => c.window.state === "closed").reverse();
  return (
    <>
      <div className="page-head"><div><h1>Past classes</h1><p>Frozen attendance can be viewed and downloaded but not changed.</p></div>
        <div className="row"><label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label></div></div>
      {!data ? <Loading /> : past.length ? <div className="classes">{past.map((c) => <ClassRow key={c.id} c={c} />)}</div> : <Empty title="No past classes in this range" />}
    </>
  );
}
