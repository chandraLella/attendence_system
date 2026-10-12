/* Small presentational pieces shared across pages. */
import { ReactNode, useRef, useState } from "react";
import { mediaUrl } from "../api/client";
import type { ClassWindow, EnrollStatus } from "../api/types";
import { liveState } from "../lib/time";

const AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#1c2a2e"/><circle cx="20" cy="16" r="7" fill="#3a4e53"/><path d="M6 38c2-9 8-13 14-13s12 4 14 13" fill="#3a4e53"/></svg>');

export function Face({ path, className = "avatar", alt = "" }: { path?: string | null; className?: string; alt?: string }) {
  return <img className={className} src={path ? mediaUrl(path) : AVATAR} alt={alt} loading="lazy" onError={(e) => ((e.target as HTMLImageElement).src = AVATAR)} />;
}

export const PageHead = ({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) => (
  <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{actions && <div className="row">{actions}</div>}</div>
);

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="empty"><strong>{title}</strong>{children}</div>
);

export const Loading = () => <div className="loading">Loading</div>;
export const ErrorBox = ({ error }: { error: Error }) => <div className="notice" style={{ color: "var(--absent)" }}>{error.message}</div>;

const STATE_LABEL = { upcoming: "Upcoming", live: "In progress", grace: "Closing soon", closed: "Closed" } as const;
/** Re-evaluates against the synced clock so tags flip without a reload. */
export const StateTag = ({ w }: { w: ClassWindow }) => { const s = liveState(w); return <span className={`tag t-${s}`}>{STATE_LABEL[s]}</span>; };

const ENROLL_LABEL: Record<EnrollStatus, string> = { OK: "Ready", PARTIAL: "Partial", FAILED: "Failed" };
export const EnrollTag = ({ s }: { s: EnrollStatus }) => <span className={`tag t-${s}`}>{ENROLL_LABEL[s] ?? s}</span>;

export const ProgressBar = ({ value }: { value: number }) => (
  <div className="progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
    <i style={{ width: `${Math.min(100, value * 100)}%` }} />
  </div>
);

export function Dropzone({ accept, multiple, title, hint, onFiles, disabled }: { accept: string; multiple?: boolean; title: string; hint: string; onFiles: (f: File[]) => void; disabled?: boolean }) {
  const inp = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = () => !disabled && inp.current?.click();
  return (
    <div className={`drop ${over ? "over" : ""}`} tabIndex={0} role="button" aria-disabled={disabled}
      onClick={pick} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick())}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); }}>
      <strong>{title}</strong><span className="small">{hint}</span>
      <input ref={inp} type="file" hidden accept={accept} multiple={multiple} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { const f = e.target.files; if (f?.length) onFiles([...f]); e.target.value = ""; }} />
    </div>
  );
}

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="field">{label}{children}{hint && <span className="faint small">{hint}</span>}</label>
);

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map((o) => <button type="button" key={o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>;
}

export const ProblemList = ({ items }: { items: string[] }) => items.length ? <ul className="list-plain">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : null;
