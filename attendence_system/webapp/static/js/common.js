/* Shared helpers: API calls, escaping, toasts, modals, uploads, job polling, small formatters. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const media = (p) => (p ? `/media/${p.split("/").map(encodeURIComponent).join("/")}` : "");
const AVATAR = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#1c2a2e"/><circle cx="20" cy="16" r="7" fill="#3a4e53"/><path d="M6 38c2-9 8-13 14-13s12 4 14 13" fill="#3a4e53"/></svg>');
const img = (p, cls = "avatar", alt = "") => `<img class="${cls}" src="${p ? media(p) : AVATAR}" alt="${esc(alt)}" loading="lazy" onerror="this.src='${AVATAR}'">`;

let serverOffset = 0; // server clock minus browser clock, ms
const now = () => new Date(Date.now() + serverOffset);
const syncClock = (iso) => { if (iso) serverOffset = new Date(iso).getTime() - Date.now(); };

async function api(path, opts = {}) {
  const o = { headers: {}, ...opts };
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers["Content-Type"] = "application/json"; delete o.json; }
  const r = await fetch(path, o);
  if (r.status === 401) { location.href = "/login"; throw new Error("Signed out"); }
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.detail) || `Request failed (${r.status})`);
  return data;
}

function toast(msg, kind = "") {
  let box = $(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; box.setAttribute("role", "status"); document.body.append(box); }
  const t = document.createElement("div");
  t.className = `toast ${kind}`; t.textContent = msg; box.append(t);
  setTimeout(() => t.remove(), kind === "err" ? 7000 : 4000);
}
const fail = (e) => toast(e.message || String(e), "err");

function modal(html, { wide = false } = {}) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { bg.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => e.key === "Escape" && close();
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(bg);
  const first = bg.querySelector("input, select, button:not([data-close])"); first && first.focus();
  return { el: bg, close };
}

function confirmBox(title, body, okLabel = "Confirm", danger = false) {
  return new Promise((res) => {
    const m = modal(`<h2>${esc(title)}</h2><p class="muted">${body}</p>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button>
      <button class="btn ${danger ? "danger" : "primary"}" id="cf-ok">${esc(okLabel)}</button></div>`);
    $("#cf-ok", m.el).onclick = () => { m.close(); res(true); };
    m.el.addEventListener("click", (e) => e.target.closest("[data-close]") && res(false));
  });
}

function lightbox(src, caption = "") {
  modal(`<div class="lightbox"><img src="${src}" alt=""><p class="muted small" style="margin-top:8px">${esc(caption)}</p></div>
    <div class="modal-foot"><button class="btn" data-close>Close</button></div>`, { wide: true });
}

/* Drag-and-drop file picker. onFiles receives a File[] */
function dropzone(el, { accept, multiple = false, title, hint, onFiles }) {
  el.classList.add("drop");
  el.tabIndex = 0;
  el.innerHTML = `<strong>${esc(title)}</strong><span class="small">${esc(hint)}</span>
    <input type="file" ${multiple ? "multiple" : ""} accept="${accept}">`;
  const inp = $("input", el);
  el.onclick = () => inp.click();
  el.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), inp.click());
  inp.onclick = (e) => e.stopPropagation();
  inp.onchange = () => { inp.files.length && onFiles([...inp.files]); inp.value = ""; };
  el.ondragover = (e) => { e.preventDefault(); el.classList.add("over"); };
  el.ondragleave = () => el.classList.remove("over");
  el.ondrop = (e) => { e.preventDefault(); el.classList.remove("over"); e.dataTransfer.files.length && onFiles([...e.dataTransfer.files]); };
}

/* Upload with byte progress (fetch has no upload progress). */
function upload(url, form, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => {
      let d; try { d = JSON.parse(x.responseText); } catch { d = {}; }
      x.status < 300 ? res(d) : rej(new Error(d.detail || `Upload failed (${x.status})`));
    };
    x.onerror = () => rej(new Error("Network error during upload"));
    x.send(form);
  });
}

async function pollJob(id, onTick) {
  for (;;) {
    const j = await api(`/api/jobs/${id}`);
    onTick && onTick(j);
    if (j.status === "done") return j.result;
    if (j.status === "error") throw new Error(j.message);
    await new Promise((r) => setTimeout(r, 900));
  }
}

const fmtDate = (d) => new Date(d + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const todayISO = () => { const d = now(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + "T00:00"); d.setDate(d.getDate() + n); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const STATE_LABEL = { upcoming: "Upcoming", live: "In progress", grace: "Closing soon", closed: "Closed" };
const stateTag = (w) => `<span class="tag t-${w.state}">${STATE_LABEL[w.state]}</span>`;
const dur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};

const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  enroll: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0"/><path d="M19 3v6M16 6h6"/>',
  students: '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM1 21a8 8 0 0 1 16 0M17 4a4 4 0 0 1 0 7M23 21a8 8 0 0 0-5-7.4"/>',
  sections: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M19 8v6M22 11h-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 19.4 9H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 2z"/>',
  log: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

function shell({ brandSub, nav, who, onRoute }) {
  document.body.innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><div class="brand-mark">R</div><div><b>VertexAI</b><span>${esc(brandSub)}</span></div></div>
      <nav class="nav">${nav.map((n) => `<a href="#${n.id}" data-id="${n.id}">${icon(n.icon)}${esc(n.label)}</a>`).join("")}</nav>
      <div class="side-foot"><div class="who">${esc(who)}</div>
        <button class="btn ghost sm" id="logout" style="padding-left:0;margin-top:6px">Sign out</button></div>
    </aside>
    <main class="main"><button class="btn sm burger" id="burger" aria-label="Open menu">Menu</button><div id="view"></div></main>
  </div>`;
  $("#logout").onclick = async () => { await api("/api/logout", { method: "POST" }); location.href = "/login"; };
  $("#burger").onclick = () => $("#side").classList.toggle("open");
  const go = () => {
    const [id, ...rest] = (location.hash.slice(1) || nav[0].id).split("/");
    $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === id));
    $("#side").classList.remove("open");
    clearInterval(window.__tick);
    $("#view").onclick = null; $("#view").innerHTML = '<p class="muted">Loading</p>';
    onRoute(id, rest);
  };
  window.addEventListener("hashchange", go);
  go();
}
