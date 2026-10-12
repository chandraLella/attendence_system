import { useState } from "react";
import { admin } from "../../api/endpoints";
import type { Settings as S } from "../../api/types";
import { useToast } from "../../components/Toast";
import { Field, Loading, PageHead } from "../../components/ui";
import { useAsync } from "../../lib/hooks";

const FIELDS: [keyof S, string, number, string][] = [
  ["match_thresh", "Mark present at similarity", 0.01, "Faces scoring at least this are marked present automatically."],
  ["review_thresh", "Suggest for review at", 0.01, "Between this and the value above, the employee is asked to confirm."],
  ["grace_minutes", "Minutes editable after class ends", 1, "Attendance freezes for employees after this."],
  ["tiles", "Detection tiles per side", 1, "2 finds small back-row faces. 3 for very wide rooms. 1 is fastest."],
  ["det_size", "Detector input size", 32, "1280 by default. Larger finds smaller faces but is slower."],
  ["min_face", "Smallest usable face (px)", 1, "Faces smaller than this are ignored."],
  ["min_blur", "Minimum sharpness", 1, "Blurrier faces are ignored."],
  ["max_yaw", "Maximum head turn", 0.05, "Higher allows more side-on faces."],
  ["duplicate_thresh", "Flag look-alike enrollments at", 0.01, "Two students more similar than this are flagged."],
  ["max_photos_per_upload", "Photos per upload round", 1, ""],
];

export default function Settings() {
  const { data } = useAsync(admin.settings);
  const { toast, fail } = useToast();
  const [draft, setDraft] = useState<Partial<S>>({});
  if (!data) return <Loading />;
  const v = { ...data, ...draft };
  const save = async () => { try { await admin.saveSettings(v); setDraft({}); toast("Settings saved", "ok"); } catch (e) { fail(e); } };
  return (
    <>
      <PageHead title="Recognition settings" sub="Defaults come from the command-line scripts. Calibrate the two similarity thresholds on one real class before relying on them." />
      <section className="panel">
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
          {FIELDS.map(([k, label, step, hint]) => <Field key={k} label={label} hint={hint}><input type="number" step={step} value={v[k]} onChange={(e) => setDraft({ ...draft, [k]: +e.target.value })} /></Field>)}
        </div>
        <div className="row" style={{ marginTop: 18 }}><button className="btn primary" onClick={save} disabled={!Object.keys(draft).length}>Save settings</button>
          <span className="small muted">Detector size and threshold changes apply after the server restarts.</span></div>
      </section>
    </>
  );
}
