/* Class attendance page, shared by the employee app and the admin's read/override view. */
async function renderClass(view, tid, { role, backHref }) {
  let d, filter = "all", query = "";
  const load = async () => { d = await api(`/api/class/${tid}`); syncClock(d.server_time); };
  try { await load(); } catch (e) { view.innerHTML = `<div class="empty"><strong>${esc(e.message)}</strong><a href="${backHref}">Go back</a></div>`; return; }

  const sourceText = (r) => {
    if (r.status === "Not taken") return "No attendance recorded";
    if (r.source === "auto" && r.status === "Present") return `Face match ${r.score ?? ""}`;
    if (r.source === "auto") return r.detected ? `Low-confidence match ${r.detected}` : "Not detected";
    if (r.source === "admin") return "Changed by admin";
    return "Marked by hand";
  };

  function timelineHTML() {
    const w = d.window, s = +new Date(w.start), e = +new Date(w.end), f = +new Date(w.freeze);
    const pad = (f - s) * 0.12, lo = s - pad, hi = f + pad, P = (t) => (100 * (t - lo)) / (hi - lo);
    const t = now().getTime(), nowPos = Math.min(100, Math.max(0, P(t)));
    let head;
    if (w.state === "upcoming") head = `<span class="clock upcoming">Opens in ${dur(s - t)}</span>`;
    else if (w.state === "live") head = `<span class="clock live">${dur(f - t)}</span><span class="muted">until attendance freezes</span>`;
    else if (w.state === "grace") head = `<span class="clock grace">${dur(f - t)}</span><span class="muted">left to finish. Class has ended.</span>`;
    else head = `<span class="clock closed">Frozen at ${w.freeze.slice(11, 16)}</span>`;
    const hm = (x) => x.slice(11, 16);
    return `<div class="tl-headline">${head}<span class="spacer"></span>${stateTag(w)}</div>
      <div class="timeline" aria-hidden="true"><div class="tl-track">
        <div class="tl-bar tl-before" style="left:0;width:${P(s)}%"></div>
        <div class="tl-bar tl-class" style="left:${P(s)}%;width:${P(e) - P(s)}%"></div>
        <div class="tl-bar tl-grace" style="left:${P(e)}%;width:${P(f) - P(e)}%"></div>
        <div class="tl-bar tl-after" style="left:${P(f)}%;right:0"></div>
        ${t >= lo && t <= hi ? `<div class="tl-now" style="left:${nowPos}%"></div>` : ""}
      </div><div class="tl-labels"><span style="left:${P(s)}%">Starts ${hm(w.start)}</span>
        <span style="left:${P(e)}%">Ends ${hm(w.end)}</span><span style="left:${P(f)}%">Freezes ${hm(w.freeze)}</span></div></div>`;
  }

  function rosterHTML() {
    const list = d.roster.filter((r) => (filter === "all" || r.status === filter) &&
      (!query || (r.name + " " + r.roll).toLowerCase().includes(query)));
    if (!list.length) return `<div class="empty"><strong>No students match</strong>Change the filter or search.</div>`;
    const dis = d.editable && d.session_id ? "" : "disabled";
    return `<div class="roster">${list.map((r) => {
      const st = r.status === "Present" ? "present" : r.status === "Absent" ? "absent" : "";
      const flag = r.status === "Absent" && r.source !== "auto" && r.detected >= d.thresholds.match
        ? `<div class="flag">Detected in a photo (${r.detected})</div>` : "";
      return `<div class="stu ${st}">
        ${img(r.photo, "avatar", r.name)}${r.evidence ? `<img class="ev" src="${media(r.evidence)}" alt="" title="Face found in class photo">` : ""}
        <div style="min-width:0"><div class="nm" title="${esc(r.name)}">${esc(r.name)}</div>
          <div class="meta">${esc(r.roll)} &middot; ${esc(sourceText(r))}</div>${flag}</div>
        ${r.status === "Not taken" ? `<span class="tag t-none">Not taken</span>` :
          `<div class="toggle" role="group" aria-label="Attendance for ${esc(r.name)}">
            <button class="p ${r.status === "Present" ? "on" : ""}" data-mark="Present" data-id="${r.student_id}" ${dis} title="Present">P</button>
            <button class="a ${r.status === "Absent" ? "on" : ""}" data-mark="Absent" data-id="${r.student_id}" ${dis} title="Absent">A</button></div>`}
      </div>`;
    }).join("")}</div>`;
  }

  const studentById = (id) => d.roster.find((r) => r.student_id === id);

  function render() {
    const t = d.class, w = d.window, c = d.counts;
    const canUpload = d.editable && (role === "admin" ? w.state !== "upcoming" : w.open);
    const absent = d.roster.filter((r) => r.status === "Absent");
    view.innerHTML = `
      <a href="${backHref}" class="small">Back to classes</a>
      <div class="page-head" style="margin-top:10px"><div>
        <h1>${esc(t.subject || "Class")} &nbsp;<span class="muted" style="font-weight:400">${esc(t.section)}</span></h1>
        <p>${fmtDate(t.class_date)}, ${t.start_time} to ${t.end_time}${t.room ? `, room ${esc(t.room)}` : ""}. Taught by ${esc(t.emp_name || t.emp_id)} (${esc(t.emp_id)}).</p></div>
        <div class="row">${d.session_id ? `<a class="btn" href="/api/class/${tid}/export">Download CSV</a>` : ""}</div></div>

      <section class="panel" id="tl">${timelineHTML()}</section>

      <div class="stats" style="margin-top:16px">
        <div class="stat"><div class="v" style="color:var(--present)">${c.Present}</div><div class="k">Present</div></div>
        <div class="stat"><div class="v" style="color:var(--absent)">${c.Absent}</div><div class="k">Absent</div></div>
        <div class="stat"><div class="v">${c.total}</div><div class="k">In section</div></div>
        <div class="stat"><div class="v">${pct(c.Present, c.total)}%</div><div class="k">Attendance</div></div>
        <div class="stat"><div class="v">${d.uploads.length}</div><div class="k">Photos processed</div></div>
      </div>

      ${role === "admin" && !w.open && d.session_id ? `<div class="notice" style="margin-bottom:16px">You are viewing as admin. Changes made here after the class froze are recorded in the activity log.</div>` : ""}
      ${role === "employee" && w.state === "closed" ? `<div class="notice frozen" style="margin-bottom:16px">This class is frozen. Attendance can be viewed but not changed. Contact the admin for corrections.</div>` : ""}
      ${role === "employee" && w.state === "upcoming" ? `<div class="notice" style="margin-bottom:16px">Attendance opens when the class starts at ${t.start_time}.</div>` : ""}

      ${canUpload ? `<section class="panel">
        <div class="panel-head"><div><h2>Mark from class photos</h2>
          <p class="muted small">Take 3 to 6 photos from different corners. Only students of ${esc(t.section)} are matched. Uploading again only adds students who were missed; it never removes anyone or changes your edits.</p></div></div>
        <div id="dz"></div><div class="files" id="picked"></div>
        <div class="row" style="margin-top:12px"><button class="btn primary" id="run" disabled>Mark attendance from photos</button>
          <span class="muted small" id="runmsg"></span></div>
        <div class="progress" id="prog" hidden><i></i></div>
      </section>` : ""}

      ${d.suggestions.length && d.editable ? `<section class="panel">
        <div class="panel-head"><div><h2>Check these possible matches</h2>
          <p class="muted small">Faces that resemble students who are currently absent. Low-confidence matches aren't marked automatically, and students you marked absent by hand are never overridden.</p></div></div>
        <div class="faces">${d.suggestions.map((s) => { const r = studentById(s.student_id) || {}; return `
          <div class="facecard"><div class="pair">${img(s.crop, "", "class photo")}${img(r.photo, "", "enrolled")}</div>
            <div class="cap"><b>${esc(r.name)}</b><br><span class="muted">${s.decision === "MATCH" ? "strong match, marked absent by hand" : "possible match"} (${s.score})</span></div>
            <button class="btn sm" style="margin-top:6px;width:100%" data-confirm="${s.student_id}" data-ev="${esc(s.crop)}">Mark present</button></div>`; }).join("")}</div>
      </section>` : ""}

      <section class="panel">
        <div class="panel-head"><h2>Students</h2>
          <div class="row"><input type="search" id="q" placeholder="Search name or roll" value="${esc(query)}" style="width:200px">
            <div class="seg" id="flt">${["all", "Present", "Absent"].map((f) => `<button data-f="${f}" class="${filter === f ? "on" : ""}">${f === "all" ? "All" : f}</button>`).join("")}</div>
            ${d.editable && d.session_id ? `<button class="btn sm" id="allP">Mark all present</button><button class="btn sm" id="allA">Mark all absent</button>` : ""}</div></div>
        <div id="roster">${rosterHTML()}</div>
      </section>

      ${d.unknown.length ? `<section class="panel">
        <div class="panel-head"><div><h2>Faces not matched to anyone</h2>
          <p class="muted small">Clear faces that did not match a student of this section. ${d.editable ? "Pick a name to mark that student present." : ""}</p></div></div>
        <div class="faces">${d.unknown.slice(0, 60).map((u) => `<div class="facecard">${img(u.crop, "", "face")}
          <div class="cap muted">closest: ${esc((studentById(u.top1_student_id) || {}).name || "none")} (${u.top1_score})</div>
          ${d.editable && absent.length ? `<select data-assign="${esc(u.crop)}"><option value="">Assign to</option>
            ${absent.map((a) => `<option value="${a.student_id}">${esc(a.name)}</option>`).join("")}</select>` : ""}</div>`).join("")}</div>
      </section>` : ""}

      ${d.uploads.length ? `<section class="panel">
        <div class="panel-head"><div><h2>Processed photos</h2><p class="muted small">Green boxes are matches, blue need checking, red are unknown faces and grey were too small, blurry or side-on to use${d.rejected ? ` (${d.rejected} faces)` : ""}.</p></div></div>
        <div class="thumbs">${d.uploads.map((u) => `<a href="#" data-lb="${media(u.annotated)}" data-cap="${esc(u.filename)}: ${u.n_faces} faces, ${u.n_matched} matched">
          <img src="${media(u.annotated)}" alt="${esc(u.filename)}" loading="lazy"><span class="small muted">Round ${u.batch}, ${u.n_matched}/${u.n_faces} matched</span></a>`).join("")}</div>
      </section>` : ""}`;
    wire();
  }

  async function mark(ids, status, evidence) {
    try {
      await api(`/api/class/${tid}/attendance`, { method: "PATCH", json: { student_ids: ids, status, evidence } });
      await load(); render();
    } catch (e) { fail(e); await load(); render(); }
  }

  function wire() {
    let picked = [];
    const dz = $("#dz");
    if (dz) dropzone(dz, {
      accept: "image/*,.heic,.heif", multiple: true, title: "Drop class photos here or click to choose",
      hint: "JPG, PNG or HEIC. Up to 10 photos per round.",
      onFiles: (fs) => {
        picked = fs.filter((f) => /image|heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name));
        $("#picked").innerHTML = picked.map((f) => `<img src="${URL.createObjectURL(f)}" alt="${esc(f.name)}" title="${esc(f.name)}">`).join("");
        $("#run").disabled = !picked.length;
        $("#runmsg").textContent = picked.length ? `${picked.length} photo${picked.length > 1 ? "s" : ""} ready` : "";
      },
    });
    const run = $("#run");
    if (run) run.onclick = async () => {
      run.disabled = true;
      const bar = $("#prog"), msg = $("#runmsg"); bar.hidden = false;
      const fd = new FormData(); picked.forEach((f) => fd.append("files", f));
      try {
        msg.textContent = "Uploading";
        const { job_id } = await upload(`/api/class/${tid}/photos`, fd, (p) => ($("i", bar).style.width = `${p * 30}%`));
        const res = await pollJob(job_id, (j) => {
          msg.textContent = j.message;
          if (j.total) $("i", bar).style.width = `${30 + (70 * j.progress) / j.total}%`;
        });
        toast(res.newly_present ? `${res.newly_present} student${res.newly_present > 1 ? "s" : ""} marked present from ${res.faces} faces` :
          `No new students found in ${res.faces} faces`, "ok");
        await load(); render();
      } catch (e) { fail(e); run.disabled = false; msg.textContent = ""; bar.hidden = true; }
    };
    $("#q") && ($("#q").oninput = (e) => { query = e.target.value.toLowerCase(); $("#roster").innerHTML = rosterHTML(); });
    $$("#flt button").forEach((b) => (b.onclick = () => { filter = b.dataset.f; $$("#flt button").forEach((x) => x.classList.toggle("on", x === b)); $("#roster").innerHTML = rosterHTML(); }));
    view.onclick = (e) => {
      const m = e.target.closest("[data-mark]");
      if (m && !m.disabled) return mark([+m.dataset.id], m.dataset.mark);
      const c = e.target.closest("[data-confirm]");
      if (c) return mark([+c.dataset.confirm], "Present", c.dataset.ev);
      const lb = e.target.closest("[data-lb]");
      if (lb) { e.preventDefault(); lightbox(lb.dataset.lb, lb.dataset.cap); }
    };
    $$("[data-assign]").forEach((s) => (s.onchange = () => s.value && mark([+s.value], "Present", s.dataset.assign)));
    const bulk = async (status) => {
      if (await confirmBox(`Mark everyone ${status.toLowerCase()}?`, `All ${d.roster.length} students will be set to ${status}. You can still change individual students afterwards.`, `Mark all ${status.toLowerCase()}`))
        mark(d.roster.map((r) => r.student_id), status);
    };
    $("#allP") && ($("#allP").onclick = () => bulk("Present"));
    $("#allA") && ($("#allA").onclick = () => bulk("Absent"));
  }

  render();
  let lastState = d.window.state;
  window.__tick = setInterval(async () => {
    const tl = $("#tl"); if (!tl) return clearInterval(window.__tick);
    const t = now().getTime(), w = d.window;
    const st = t < +new Date(w.start) ? "upcoming" : t <= +new Date(w.end) ? "live" : t <= +new Date(w.freeze) ? "grace" : "closed";
    if (st !== lastState) { lastState = st; await load(); render(); if (st === "closed" && role === "employee") toast("Attendance is now frozen for this class"); return; }
    d.window.state = st; tl.innerHTML = timelineHTML();
  }, 1000);
}
