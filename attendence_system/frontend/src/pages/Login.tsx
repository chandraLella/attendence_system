import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Field, Seg } from "../components/ui";

export default function Login() {
  const { me, ready, login } = useAuth();
  const nav = useNavigate();
  const [role, setRole] = useState<Role>("employee");
  const [username, setU] = useState(""); const [password, setP] = useState(""); const [empId, setE] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  if (ready && me) return <Navigate to={me.role === "admin" ? "/admin" : "/employee"} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { const m = await login({ role, username: username.trim(), password, emp_id: empId.trim() }); nav(m.role === "admin" ? "/admin" : "/employee", { replace: true }); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <section className="login-art">
        <div className="brand"><div className="brand-mark">R</div><div><b>VertexAI</b><span>Face-recognition attendance</span></div></div>
        <div><h1>Attendance from a few class photos.</h1>
          <p>Each class opens at its timetable slot, matches faces only against that section's enrolled students, and freezes shortly after the class ends.</p></div>
        <div className="login-steps">
          <div><b>1</b>Admin enrolls students from a zip of photos and assigns sections.</div>
          <div><b>2</b>Admin publishes the timetable for each employee.</div>
          <div><b>3</b>Employees upload class photos during the slot and correct any misses.</div>
        </div>
      </section>
      <section className="login-form">
        <form onSubmit={submit} autoComplete="on">
          <h2 style={{ fontSize: 22 }}>Sign in</h2>
          <div style={{ alignSelf: "flex-start" }}><Seg<Role> value={role} onChange={setRole} options={[{ value: "employee", label: "Employee" }, { value: "admin", label: "Admin" }]} /></div>
          <Field label="Username"><input value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" required /></Field>
          <Field label="Password"><input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
          {role === "employee" && <Field label="Employee ID"><input value={empId} onChange={(e) => setE(e.target.value)} placeholder="As shown on the timetable, e.g. EMP101" required /></Field>}
          <div className="err-text" role="alert">{err}</div>
          <button className="btn primary" style={{ justifyContent: "center", padding: 10 }} disabled={busy}>{busy ? "Signing in" : "Sign in"}</button>
          <p className="faint small">Demo accounts: admin / admin and employee / employee.</p>
        </form>
      </section>
    </div>
  );
}
