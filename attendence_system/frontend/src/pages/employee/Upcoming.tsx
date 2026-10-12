import { employee } from "../../api/endpoints";
import { Empty, Loading } from "../../components/ui";
import { useAsync } from "../../lib/hooks";
import { addDays, todayISO } from "../../lib/time";
import { ClassRow } from "./ClassRow";

export default function Upcoming() {
  const { data } = useAsync(() => employee.schedule(todayISO(), addDays(todayISO(), 14)));
  const up = (data?.classes ?? []).filter((c) => c.window.state === "upcoming");
  return (
    <>
      <div className="page-head"><div><h1>Upcoming</h1><p>Your classes for the next two weeks.</p></div></div>
      {!data ? <Loading /> : up.length ? <div className="classes">{up.map((c) => <ClassRow key={c.id} c={c} />)}</div> : <Empty title="Nothing scheduled">Ask the admin if your timetable is missing.</Empty>}
    </>
  );
}
