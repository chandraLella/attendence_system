/* Low-level HTTP. Cookies carry the session, so every call is same-origin (Vite proxies in dev). */
import type { Job } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function parse(r: Response) {
  const ct = r.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) {
    if (r.status === 401) onUnauthorized();
    const msg = typeof data === "object" && data?.detail ? (Array.isArray(data.detail) ? data.detail.map((d: { msg: string }) => d.msg).join(", ") : data.detail) : `Request failed (${r.status})`;
    throw new ApiError(msg, r.status);
  }
  return data;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)["Content-Type"] = "application/json"; }
  return parse(await fetch(path, init));
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
export const patch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body);
export const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
export const del = <T>(path: string) => request<T>("DELETE", path);

/** multipart POST with upload progress (0..1). fetch() can't report upload progress, XHR can. */
export function upload<T>(path: string, form: FormData, onProgress?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", path);
    x.withCredentials = true;
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let d: { detail?: string } = {};
      try { d = JSON.parse(x.responseText); } catch { /* non-JSON error page */ }
      if (x.status === 401) onUnauthorized();
      x.status < 300 ? resolve(d as T) : reject(new ApiError(d.detail ?? `Upload failed (${x.status})`, x.status));
    };
    x.onerror = () => reject(new ApiError("Network error during upload", 0));
    x.send(form);
  });
}

/** Poll a background job until it finishes. Resolves with job.result, rejects with job.message. */
export async function pollJob<R>(id: string, onTick?: (j: Job<R>) => void, signal?: AbortSignal): Promise<R> {
  for (;;) {
    if (signal?.aborted) throw new ApiError("Cancelled", 0);
    const j = await get<Job<R>>(`/api/jobs/${id}`);
    onTick?.(j);
    if (j.status === "done") return j.result as R;
    if (j.status === "error") throw new ApiError(j.message, 500);
    await new Promise((r) => setTimeout(r, 900));
  }
}

export const qs = (o: Record<string, string | number | null | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();

export const mediaUrl = (p?: string | null) => (p ? `/media/${p.split("/").map(encodeURIComponent).join("/")}` : "");
