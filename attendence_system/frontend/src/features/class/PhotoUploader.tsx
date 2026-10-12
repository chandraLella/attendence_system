import { useEffect, useMemo, useState } from "react";
import { pollJob } from "../../api/client";
import { classes } from "../../api/endpoints";
import type { RecognizeResult } from "../../api/types";
import { useToast } from "../../components/Toast";
import { Dropzone, ProgressBar } from "../../components/ui";

const isImage = (f: File) => /image|heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

export function PhotoUploader({ tid, section, maxPhotos = 10, onDone }: { tid: number; section: string; maxPhotos?: number; onDone: () => void }) {
  const { toast, fail } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState("");
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  const run = async () => {
    setBusy(true); setProgress(0); setMsg("Uploading");
    try {
      const { job_id } = await classes.uploadPhotos(tid, files, (p) => setProgress(p * 0.3));
      const r = await pollJob<RecognizeResult>(job_id, (j) => { setMsg(j.message); if (j.total) setProgress(0.3 + (0.7 * j.progress) / j.total); });
      toast(r.newly_present ? `${r.newly_present} student${r.newly_present > 1 ? "s" : ""} marked present from ${r.faces} faces` : `No new students found in ${r.faces} faces`, "ok");
      setFiles([]); onDone();
    } catch (e) { fail(e); } finally { setBusy(false); setMsg(""); }
  };

  return (
    <section className="panel">
      <div className="panel-head"><div><h2>Mark from class photos</h2>
        <p className="muted small">Take 3 to 6 photos from different corners. Only students of {section} are matched. Uploading again only adds students who were missed; it never removes anyone or changes your edits.</p></div></div>
      <Dropzone accept="image/*,.heic,.heif" multiple disabled={busy} title="Drop class photos here or click to choose" hint={`JPG, PNG or HEIC. Up to ${maxPhotos} photos per round.`}
        onFiles={(fs) => { const imgs = fs.filter(isImage); if (imgs.length > maxPhotos) toast(`Only the first ${maxPhotos} photos were kept`); setFiles(imgs.slice(0, maxPhotos)); }} />
      {!!files.length && <div className="files">{previews.map((u, i) => <img key={u} src={u} alt={files[i].name} title={files[i].name} />)}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!files.length || busy} onClick={run}>Mark attendance from photos</button>
        <span className="muted small">{busy ? msg : files.length ? `${files.length} photo${files.length > 1 ? "s" : ""} ready` : ""}</span>
      </div>
      {busy && <ProgressBar value={progress} />}
    </section>
  );
}
