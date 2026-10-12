import type { ClassWindow } from "../../api/types";
import { StateTag } from "../../components/ui";
import { useTick } from "../../lib/hooks";
import { dur, hm, liveState, serverNow } from "../../lib/time";

/** Start -> end -> freeze bar with a live "now" marker and countdown. */
export function Timeline({ w }: { w: ClassWindow }) {
  useTick(1000);
  const t = serverNow(), s = +new Date(w.start), e = +new Date(w.end), f = +new Date(w.freeze);
  const pad = (f - s) * 0.12, lo = s - pad, hi = f + pad, P = (x: number) => (100 * (x - lo)) / (hi - lo);
  const state = liveState(w, t);
  return (
    <section className="panel">
      <div className="tl-headline">
        {state === "upcoming" && <span className="clock upcoming">Opens in {dur(s - t)}</span>}
        {state === "live" && <><span className="clock live">{dur(f - t)}</span><span className="muted">until attendance freezes</span></>}
        {state === "grace" && <><span className="clock grace">{dur(f - t)}</span><span className="muted">left to finish. Class has ended.</span></>}
        {state === "closed" && <span className="clock closed">Frozen at {hm(w.freeze)}</span>}
        <span className="spacer" /><StateTag w={w} />
      </div>
      <div className="timeline" aria-hidden="true">
        <div className="tl-track">
          <div className="tl-bar tl-before" style={{ left: 0, width: `${P(s)}%` }} />
          <div className="tl-bar tl-class" style={{ left: `${P(s)}%`, width: `${P(e) - P(s)}%` }} />
          <div className="tl-bar tl-grace" style={{ left: `${P(e)}%`, width: `${P(f) - P(e)}%` }} />
          <div className="tl-bar tl-after" style={{ left: `${P(f)}%`, right: 0 }} />
          {t >= lo && t <= hi && <div className="tl-now" style={{ left: `${P(t)}%` }} />}
        </div>
        <div className="tl-labels">
          <span style={{ left: `${P(s)}%` }}>Starts {hm(w.start)}</span>
          <span style={{ left: `${P(e)}%` }}>Ends {hm(w.end)}</span>
          <span style={{ left: `${P(f)}%` }}>Freezes {hm(w.freeze)}</span>
        </div>
      </div>
    </section>
  );
}
