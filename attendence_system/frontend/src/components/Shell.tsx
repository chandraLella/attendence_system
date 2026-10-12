import { ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Icon, IconName } from "./Icon";

export interface NavItem { to: string; label: string; icon: IconName; end?: boolean }

export function Shell({ sub, nav, children }: { sub: string; nav: NavItem[]; children: ReactNode }) {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="shell">
      <aside className={`side ${open ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark">R</div><div><b>VertexAI</b><span>{sub}</span></div></div>
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={n.icon} />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">{me?.role === "employee" ? `${me.name} (${me.emp_id})` : me?.name}</div>
          <button className="btn ghost sm" style={{ paddingLeft: 0, marginTop: 6 }} onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <button className="btn sm burger" aria-label="Open menu" onClick={() => setOpen((o) => !o)}>Menu</button>
        {children}
      </main>
    </div>
  );
}
