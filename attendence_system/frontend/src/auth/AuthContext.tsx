import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { setUnauthorizedHandler } from "../api/client";
import { auth } from "../api/endpoints";
import type { Me, Role } from "../api/types";
import { syncClock } from "../lib/time";

interface Ctx { me: Me | null; ready: boolean; login: (a: Parameters<typeof auth.login>[0]) => Promise<Me>; logout: () => Promise<void> }
const AuthCtx = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    setUnauthorizedHandler(() => { setMe(null); nav("/login", { replace: true }); });
    auth.me().then((m) => { syncClock(m.server_time); setMe(m); }).catch(() => setMe(null)).finally(() => setReady(true));
  }, [nav]);

  const login = useCallback(async (a: Parameters<typeof auth.login>[0]) => {
    await auth.login(a);
    const m = await auth.me(); syncClock(m.server_time); setMe(m);
    return m;
  }, []);
  const logout = useCallback(async () => { await auth.logout().catch(() => {}); setMe(null); nav("/login", { replace: true }); }, [nav]);

  return <AuthCtx.Provider value={{ me, ready, login, logout }}>{children}</AuthCtx.Provider>;
}

/** Route guard: only renders children for the given role. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { me, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="loading" style={{ padding: 40 }}>Loading</div>;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.role !== role) return <Navigate to={me.role === "admin" ? "/admin" : "/employee"} replace />;
  return <>{children}</>;
}
