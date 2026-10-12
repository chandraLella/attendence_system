/* All class windows are computed by the server's clock. We keep an offset so countdowns
   are right even when the laptop clock is a few minutes off. */
let offset = 0;
export const syncClock = (serverIso?: string) => { if (serverIso) offset = new Date(serverIso).getTime() - Date.now(); };
export const serverNow = () => Date.now() + offset;

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const todayISO = () => iso(new Date(serverNow()));
export const addDays = (d: string, n: number) => { const x = new Date(d + "T00:00"); x.setDate(x.getDate() + n); return iso(x); };
export const fmtDate = (d: string) => new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
export const hm = (isoTs: string) => isoTs.slice(11, 16);
export const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

import type { ClassWindow, WindowState } from "../api/types";
/** Same rule as scheduling.class_window, evaluated against the synced clock. */
export function liveState(w: ClassWindow, t = serverNow()): WindowState {
  if (t < +new Date(w.start)) return "upcoming";
  if (t <= +new Date(w.end)) return "live";
  if (t <= +new Date(w.freeze)) return "grace";
  return "closed";
}
