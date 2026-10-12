/* Admin app: enrollment, students, sections, timetable, attendance records, reports, settings. */
const NAV = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "enroll", label: "Enrollment", icon: "enroll" },
  { id: "students", label: "Students", icon: "students" },
  { id: "sections", label: "Sections", icon: "sections" },
  { id: "timetable", label: "Timetable", icon: "calendar" },
  { id: "classes", label: "Attendance", icon: "history" },
  { id: "reports", label: "Reports", icon: "report" },
  { id: "employees", label: "Employees", icon: "people" },
  { id: "settings", label: "Recognition settings", icon: "settings" },
  { id: "activity", label: "Activity log", icon: "log" },
];
let SECTIONS = [];
const loadSections = async () => (SECTIONS = await api("/api/sections"));
const secOptions = (sel = "", extra = "") => extra + SECTIONS.map((s) => `<option value="${s.id}" ${String(sel) === String(s.id) ? "selected" : ""}>${esc(s.name)}</option>`).join("");
const V = () => $("#view");
const head = (title, sub, actions = "") => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;

const views = {
  /* ------------------------------------------------------------ overview */
  async overview() {
    const o = await api("/api/admin/overview");
    const e = o.enrolled || {};
    V().innerHTML = head("Overview", `Today is ${fmtDate(todayISO())}.`) + `
      <div class="stats">
        <div class="stat"><div class="v">${o.students}</div><div class="k">Students enrolled</div></div>
        <div class="stat"><div class="v" style="color:var(--present)">${e.OK || 0}</div><div class="k">Ready for matching</div></div>
        <div class="stat"><div class="v" style="color:var(--review)">${e.PARTIAL || 0}</div><div class="k">Partial enrollment</div></div>
        <div class="stat"><div class="v" style="color:var(--absent)">${e.FAILED || 0}</div><div class="k">No face found</div></div>
        <div class="stat"><div class="v">${o.sections}</div><div class="k">Sections</div></div>
        <div class="stat"><div class="v">${o.unassigned}</div><div class="k">Without a section</div></div>
      </div>
      ${o.flagged ? `<div class="notice" style="margin-bottom:16px">${o.flagged} students look very similar to another enrolled student. <a href="#students">Review them</a> before taking attendance.</div>` : ""}
      <div class="grid g2">
        <section class="panel"><div class="panel-head"><h2>Today's classes</h2><a href="#timetable" class="small">Open timetable</a></div>
          ${o.today.length ? `<div class="classes">${o.today.map((c) => `<a class="cls ${c.window.state}" href="#class/${c.id}">
            <div class="time">${c.start_time}<small>to ${c.end_time}</small></div>
            <div><b>${esc(c.section)}</b> <span class="muted">${esc(c.subject || "")}</span><div class="small muted">${esc(c.emp_name || c.emp_id)}</div></div>
            <div class="small muted hide-m">${c.session_id ? `${c.present}/${c.total} present` : "Not taken"}</div>${stateTag(c.window)}</a>`).join("")}</div>`
          : `<div class="empty"><strong>No classes today</strong><a href="#timetable">Add classes to the timetable</a></div>`}</section>
        <section class="panel"><div class="panel-head"><h2>Attendance, last 7 days</h2></div>
          ${o.trend.length ? `<div class="bars">${o.trend.map((t) => `<div><span>${pct(t.p, t.n)}%</span><i style="height:${pct(t.p, t.n)}%" title="${t.p} of ${t.n} marks"></i><span>${fmtDate(t.d).split(",")[0]}</span></div>`).join("")}</div>`
          : `<div class="empty"><strong>No attendance yet</strong>Figures appear once employees take attendance.</div>`}</section>
      </div>`;
  },

  /* ------------------------------------------------------------ enrollment */
  async enroll() {
    V().innerHTML = head("Enrollment", "Upload one zip with a folder per student. Each folder holds that student's three photos: front, left 45° and right 45°.") + `
      <div class="grid g2">
        <section class="panel"><h2 style="margin-bottom:12px">Upload enrollment zip</h2>
          <div id="dz"></div>
          <div id="job" style="margin-top:14px"></div></section>
        <section class="panel"><h2 style="margin-bottom:10px">How to name folders</h2>
          <p class="muted small">Start the folder name with the roll number, then the name. The roll number keeps students unique, so re-uploading a folder replaces that student's photos.</p>
          <pre class="notice small" style="margin:12px 0;white-space:pre-wrap">students.zip
  21CS001_Ravi Kumar/
    front.jpg   left.jpg   right.jpg
  21CS002 - Priya Sharma/
    1.jpg   2.jpg   3.jpg</pre>
          <p class="muted small">Files named front, left or right are used for that view; otherwise the first three images in name order are used. A folder without a roll number uses the folder name as both roll and name, which you can edit later under Students.</p></section>
      </div>`;
    dropzone($("#dz"), {
      accept: ".zip", title: "Drop the .zip here or click to choose", hint: "Faces are cropped and converted to embeddings on this server.",
      onFiles: async ([f]) => {
        const box = $("#job");
        box.innerHTML = `<div class="small" id="jm">Uploading ${esc(f.name)}</div><div class="progress"><i></i></div>`;
        const bar = $("i", box), fd = new FormData(); fd.append("file", f);
        try {
          const { job_id } = await upload("/api/admin/enroll", fd, (p) => (bar.style.width = `${p * 20}%`));
          const r = await pollJob(job_id, (j) => { $("#jm").textContent = j.message; if (j.total) bar.style.width = `${20 + (80 * j.progress) / j.total}%`; });
          box.innerHTML = `<div class="notice"><b>Enrollment finished.</b> ${r.students} students: ${r.created} new, ${r.updated} updated.<br>
            <span style="color:var(--present)">${r.OK} ready</span>, <span style="color:var(--review)">${r.PARTIAL} partial</span>, <span style="color:var(--absent)">${r.FAILED} failed</span>.
            ${r.duplicates.length ? `<br><span style="color:var(--review)">${r.duplicates.length} pairs of students look alike:</span><ul class="list-plain">${r.duplicates.map((x) => `<li>${esc(x.a)} and ${esc(x.b)} (${x.similarity})</li>`).join("")}</ul>` : ""}
            <div class="row" style="margin-top:10px"><a class="btn sm" href="#students">Review students</a><a class="btn sm" href="#sections">Assign sections</a></div></div>`;
        } catch (e) { box.innerHTML = `<div class="notice" style="color:var(--absent)">${esc(e.message)}</div>`; }
      },
    });
  },

  /* ------------------------------------------------------------ students */
  async students() {
    await loadSections();
    V().innerHTML = head("Students", "Enrollment quality and section for every student.") + `
      <section class="panel"><div class="row" style="margin-bottom:14px">
        <input type="search" id="q" placeholder="Search name or roll" style="width:220px">
        <select id="fs"><option value="">All sections</option><option value="none">No section</option>${secOptions()}</select>
        <select id="fst"><option value="">Any enrollment</option><option value="OK">Ready</option><option value="PARTIAL">Partial</option><option value="FAILED">Failed</option></select>
        <span class="spacer"></span><span class="small muted" id="selc"></span>
        <select id="mv" disabled><option value="">Move selected to</option><option value="null">No section</option>${secOptions()}</select></div>
        <div class="table-wrap"><table><thead><tr><th style="width:30px"><input type="checkbox" id="all" aria-label="Select all"></th><th></th><th>Name</th><th>Roll</th><th>Section</th><th>Enrollment</th><th>Notes</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></section>`;
    const sel = new Set();
    const refresh = async () => {
      const list = await api(`/api/admin/students?q=${encodeURIComponent($("#q").value)}&section_id=${$("#fs").value}&status=${$("#fst").value}`);
      $("#tb").innerHTML = list.length ? list.map((s) => `<tr>
        <td><input type="checkbox" data-sel="${s.id}" ${sel.has(s.id) ? "checked" : ""} aria-label="Select ${esc(s.name)}"></td>
        <td>${img(s.photo, "avatar", s.name)}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.roll)}</td>
        <td>${s.section ? esc(s.section) : '<span class="faint">None</span>'}</td>
        <td><span class="tag t-${s.status}">${{ OK: "Ready", PARTIAL: "Partial", FAILED: "Failed" }[s.status] || s.status}</span> <span class="small muted">${s.n_views} photos</span></td>
        <td class="small muted" style="max-width:280px">${esc(s.issues)}</td>
        <td><button class="btn sm ghost" data-open="${s.id}">Details</button></td></tr>`).join("")
        : `<tr><td colspan="8"><div class="empty"><strong>No students found</strong><a href="#enroll">Upload an enrollment zip</a></div></td></tr>`;
      $("#selc").textContent = sel.size ? `${sel.size} selected` : "";
      $("#mv").disabled = !sel.size;
    };
    ["q", "fs", "fst"].forEach((id) => ($("#" + id).oninput = refresh));
    $("#tb").onchange = (e) => { const c = e.target.closest("[data-sel]"); if (c) { c.checked ? sel.add(+c.dataset.sel) : sel.delete(+c.dataset.sel); $("#selc").textContent = sel.size ? `${sel.size} selected` : ""; $("#mv").disabled = !sel.size; } };
    $("#all").onchange = (e) => { $$("[data-sel]").forEach((c) => { c.checked = e.target.checked; c.checked ? sel.add(+c.dataset.sel) : sel.delete(+c.dataset.sel); }); $("#selc").textContent = sel.size ? `${sel.size} selected` : ""; $("#mv").disabled = !sel.size; };
    $("#mv").onchange = async (e) => {
      if (!e.target.value) return;
      const sid = e.target.value === "null" ? null : +e.target.value;
      try { const r = await api("/api/admin/students/bulk-section", { method: "POST", json: { student_ids: [...sel], section_id: sid } }); toast(`Moved ${r.updated} students`, "ok"); sel.clear(); $("#all").checked = false; refresh(); } catch (er) { fail(er); }
      e.target.value = "";
    };
    $("#tb").onclick = (e) => { const b = e.target.closest("[data-open]"); b && studentModal(+b.dataset.open, refresh); };
    refresh();
  },

  /* ------------------------------------------------------------ sections */
  async sections() {
    await loadSections();
    V().innerHTML = head("Sections", "Create sections, then fill them alphabetically or from a spreadsheet.", `<button class="btn primary" id="new">New section</button>`) + `
      <div class="grid g2">
        <section class="panel"><h2 style="margin-bottom:12px">Sections</h2>
          ${SECTIONS.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th class="num">Students</th><th class="num">Ready</th><th></th></tr></thead><tbody>
          ${SECTIONS.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.description || "")}</div></td><td class="num">${s.students}</td><td class="num">${s.ok || 0}</td>
            <td class="num"><button class="btn sm ghost" data-ren="${s.id}">Rename</button><button class="btn sm ghost danger" data-del="${s.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>`
          : `<div class="empty"><strong>No sections yet</strong>Create one to start assigning students.</div>`}</section>
        <div>
          <section class="panel"><h2>Fill sections alphabetically</h2><p class="muted small" style="margin:4px 0 14px">Students are sorted, then split across the sections you tick, in the order shown.</p>
            <div class="row" style="margin-bottom:12px">${SECTIONS.map((s) => `<label class="check"><input type="checkbox" value="${s.id}" class="aa-sec" checked>${esc(s.name)}</label>`).join("") || '<span class="muted small">Create sections first.</span>'}</div>
            <div class="form-grid">
              <label class="field">Sort by<select id="aa-by"><option value="name">Name</option><option value="roll">Roll number</option></select></label>
              <label class="field">Split<select id="aa-mode"><option value="equal">Evenly</option><option value="capacity">Fill up to a size</option></select></label>
              <label class="field">Section size<input type="number" id="aa-cap" value="60" min="1" disabled></label>
              <label class="field">Students<select id="aa-scope"><option value="unassigned">Only those without a section</option><option value="all">Everyone (reassign)</option></select></label></div>
            <div class="row" style="margin-top:14px"><button class="btn primary" id="aa-go" ${SECTIONS.length ? "" : "disabled"}>Assign students</button><span class="small muted" id="aa-res"></span></div></section>
          <section class="panel"><h2>Assign from a spreadsheet</h2><p class="muted small" style="margin:4px 0 14px">Columns: Student Name and Section. Add a Roll No column if two students share a name. <a href="/api/templates/sections">Download template</a></p>
            <div id="dz"></div><label class="check" style="margin-top:10px"><input type="checkbox" id="cm" checked>Create sections that don't exist yet</label>
            <div id="imp" style="margin-top:12px"></div></section>
        </div></div>`;
    $("#new").onclick = () => sectionModal();
    $("#aa-mode").onchange = (e) => ($("#aa-cap").disabled = e.target.value !== "capacity");
    $("#aa-go").onclick = async () => {
      const ids = $$(".aa-sec:checked").map((c) => +c.value);
      if ($("#aa-scope").value === "all" && !(await confirmBox("Reassign every student?", "Current section assignments will be replaced. Past attendance records are not affected.", "Reassign"))) return;
      try {
        const r = await api("/api/admin/sections/auto-assign", { method: "POST", json: { section_ids: ids, by: $("#aa-by").value, mode: $("#aa-mode").value, capacity: +$("#aa-cap").value, scope: $("#aa-scope").value } });
        toast(`Assigned ${r.assigned} students`, "ok");
        views.sections().then(() => ($("#aa-res").textContent = r.split.map((s) => `${s.section}: ${s.count}`).join(", ") + (r.left_unassigned ? `. ${r.left_unassigned} did not fit.` : "")));
      } catch (e) { fail(e); }
    };
    dropzone($("#dz"), {
      accept: ".xlsx,.xls,.csv", title: "Drop an Excel or CSV file", hint: "Unmatched names are listed so you can fix them.",
      onFiles: async ([f]) => {
        const fd = new FormData(); fd.append("file", f); fd.append("create_missing", $("#cm").checked);
        try {
          const r = await upload("/api/admin/sections/import", fd);
          const probs = [...r.not_found, ...r.ambiguous];
          $("#imp").innerHTML = `<div class="notice"><b>${r.assigned} students assigned.</b>${r.created_sections.length ? ` Created ${r.created_sections.map(esc).join(", ")}.` : ""}
            ${probs.length ? `<br><span style="color:var(--review)">${probs.length} rows need attention:</span><ul class="list-plain">${probs.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}</div>`;
          await loadSections();
        } catch (e) { fail(e); }
      },
    });
    V().onclick = async (e) => {
      const del = e.target.closest("[data-del]"), ren = e.target.closest("[data-ren]");
      if (del) {
        const s = SECTIONS.find((x) => x.id === +del.dataset.del);
        if (await confirmBox(`Delete ${s.name}?`, "Students stay enrolled but lose this section. Its timetable slots and their attendance records are deleted.", "Delete section", true)) {
          try { await api(`/api/admin/sections/${s.id}`, { method: "DELETE" }); toast("Section deleted"); views.sections(); } catch (er) { fail(er); }
        }
      }
      if (ren) sectionModal(SECTIONS.find((x) => x.id === +ren.dataset.ren));
    };
  },

  /* ------------------------------------------------------------ timetable */
  async timetable() {
    await loadSections();
    let start = todayISO();
    V().innerHTML = head("Timetable", "Each slot opens attendance for its employee at the start time and freezes it after the grace period.",
      `<button class="btn" id="imp">Import from Excel</button><button class="btn primary" id="add">Add class</button>`) + `
      <section class="panel"><div class="row" style="margin-bottom:14px">
        <button class="btn sm" id="prev">Previous week</button><b id="range"></b><button class="btn sm" id="next">Next week</button><button class="btn sm ghost" id="today">This week</button>
        <span class="spacer"></span><select id="fs"><option value="">All sections</option>${secOptions()}</select>
        <input id="fe" placeholder="Employee ID" style="width:140px"></div><div id="tt"></div></section>`;
    const refresh = async () => {
      const end = addDays(start, 6);
      $("#range").textContent = `${fmtDate(start)} to ${fmtDate(end)}`;
      const list = await api(`/api/admin/timetable?start=${start}&end=${end}&section_id=${$("#fs").value}&emp_id=${encodeURIComponent($("#fe").value.trim())}`);
      if (!list.length) { $("#tt").innerHTML = `<div class="empty"><strong>No classes this week</strong>Add a class or import a timetable spreadsheet.</div>`; return; }
      const byDay = {}; list.forEach((c) => (byDay[c.class_date] ||= []).push(c));
      $("#tt").innerHTML = Object.entries(byDay).map(([d, cs]) => `<h3 style="margin:14px 0 8px">${fmtDate(d)}</h3><div class="classes">${cs.map((c) => `
        <div class="cls ${c.window.state}"><div class="time">${c.start_time}<small>to ${c.end_time}</small></div>
          <div><b>${esc(c.section)}</b> <span class="muted">${esc(c.subject)}</span><div class="small muted">${esc(c.emp_name || "")} ${esc(c.emp_id)}${c.room ? `, room ${esc(c.room)}` : ""}</div></div>
          <div class="row hide-m">${stateTag(c.window)}</div>
          <div class="row"><a class="btn sm ghost" href="#class/${c.id}">${c.session_id ? "View attendance" : "Open"}</a>${c.session_id ? "" : `<button class="btn sm ghost danger" data-del="${c.id}">Remove</button>`}</div></div>`).join("")}</div>`).join("");
    };
    $("#prev").onclick = () => { start = addDays(start, -7); refresh(); };
    $("#next").onclick = () => { start = addDays(start, 7); refresh(); };
    $("#today").onclick = () => { start = todayISO(); refresh(); };
    $("#fs").onchange = refresh; $("#fe").oninput = refresh;
    $("#add").onclick = () => classModal(refresh);
    $("#imp").onclick = () => timetableImportModal(refresh);
    $("#tt").onclick = async (e) => {
      const b = e.target.closest("[data-del]");
      if (b && (await confirmBox("Remove this class?", "It will disappear from the employee's schedule.", "Remove", true))) {
        try { await api(`/api/admin/timetable/${b.dataset.del}`, { method: "DELETE" }); refresh(); } catch (er) { fail(er); }
      }
    };
    refresh();
  },

  /* ------------------------------------------------------------ attendance records */
  async classes() {
    await loadSections();
    let start = addDays(todayISO(), -6), end = todayISO();
    V().innerHTML = head("Attendance", "Every class in a date range, with how many students were marked present.") + `
      <section class="panel"><div class="row" style="margin-bottom:14px">
        <label class="field">From<input type="date" id="f" value="${start}"></label><label class="field">To<input type="date" id="t" value="${end}"></label>
        <label class="field">Section<select id="fs"><option value="">All</option>${secOptions()}</select></label></div>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Time</th><th>Section</th><th>Subject</th><th>Employee</th><th>Status</th><th class="num">Present</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></section>`;
    const refresh = async () => {
      const list = await api(`/api/admin/timetable?start=${$("#f").value}&end=${$("#t").value}&section_id=${$("#fs").value}`);
      const ses = list.filter((c) => c.window.state !== "upcoming");
      $("#tb").innerHTML = ses.length ? ses.reverse().map((c) => `<tr><td>${fmtDate(c.class_date)}</td><td>${c.start_time}-${c.end_time}</td><td>${esc(c.section)}</td>
        <td>${esc(c.subject)}</td><td>${esc(c.emp_id)}</td><td>${c.session_id ? stateTag(c.window) : '<span class="tag t-absent">Not taken</span>'}</td>
        <td class="num" data-cnt="${c.id}">${c.session_id ? "" : "-"}</td><td class="num"><a class="btn sm ghost" href="#class/${c.id}">Open</a></td></tr>`).join("")
        : `<tr><td colspan="8"><div class="empty"><strong>No classes in this range</strong></div></td></tr>`;
      for (const c of ses.filter((x) => x.session_id).slice(0, 40)) {
        api(`/api/class/${c.id}`).then((d) => { const td = $(`[data-cnt="${c.id}"]`); td && (td.textContent = `${d.counts.Present}/${d.counts.total}`); }).catch(() => {});
      }
    };
    ["f", "t", "fs"].forEach((id) => ($("#" + id).onchange = refresh));
    refresh();
  },

  /* ------------------------------------------------------------ reports */
  async reports() {
    await loadSections();
    V().innerHTML = head("Reports", "Student-wise attendance for a section. Students below the threshold are highlighted.") + `
      <section class="panel"><div class="row" style="margin-bottom:14px">
        <label class="field">Section<select id="s">${secOptions()}</select></label>
        <label class="field">From<input type="date" id="f" value="${addDays(todayISO(), -29)}"></label>
        <label class="field">To<input type="date" id="t" value="${todayISO()}"></label>
        <label class="field">Highlight below<input type="number" id="th" value="75" min="0" max="100" style="width:90px"></label>
        <span class="spacer"></span><a class="btn" id="xl">Download Excel</a></div><div id="rep"></div></section>`;
    const refresh = async () => {
      if (!$("#s").value) { $("#rep").innerHTML = `<div class="empty"><strong>No sections yet</strong></div>`; return; }
      const q = `start=${$("#f").value}&end=${$("#t").value}`;
      $("#xl").href = `/api/admin/reports/section/${$("#s").value}?${q}&fmt=xlsx`;
      const r = await api(`/api/admin/reports/section/${$("#s").value}?${q}`);
      const th = +$("#th").value;
      const low = r.students.filter((s) => s.pct !== null && s.pct < th).length;
      $("#rep").innerHTML = `<p class="muted small" style="margin-bottom:12px">${r.classes.length} classes scheduled, ${r.classes_taken} with attendance. ${low} students below ${th}%.</p>
        <div class="table-wrap"><table><thead><tr><th>Roll</th><th>Name</th><th class="num">Present</th><th class="num">Held</th><th class="num">%</th><th>Recent classes</th></tr></thead><tbody>
        ${r.students.map((s) => `<tr><td>${esc(s.roll)}</td><td>${esc(s.name)}</td><td class="num">${s.present}</td><td class="num">${s.held}</td>
          <td class="num" style="color:${s.pct === null ? "var(--faint)" : s.pct < th ? "var(--absent)" : "var(--present)"}">${s.pct ?? "-"}</td>
          <td><div class="row" style="gap:3px">${s.cells.slice(-20).map((c) => `<i title="${esc(c)}" style="width:9px;height:16px;border-radius:2px;background:${c === "Present" ? "var(--present)" : c === "Absent" ? "var(--absent)" : "var(--raised)"}"></i>`).join("")}</div></td></tr>`).join("")}
        </tbody></table></div>`;
    };
    ["s", "f", "t", "th"].forEach((id) => ($("#" + id).onchange = refresh));
    refresh();
  },

  /* ------------------------------------------------------------ employees */
  async employees() {
    const list = await api("/api/admin/employees");
    V().innerHTML = head("Employees", "Employees are added automatically from the timetable. Add names here so they show up on schedules.", `<button class="btn primary" id="add">Add employee</button>`) + `
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>Employee ID</th><th>Name</th><th>Department</th><th class="num">Upcoming classes</th><th></th></tr></thead><tbody>
      ${list.map((e) => `<tr><td><b>${esc(e.emp_id)}</b></td><td>${esc(e.name)}</td><td>${esc(e.department)}</td><td class="num">${e.upcoming}</td>
        <td class="num"><button class="btn sm ghost" data-edit="${esc(e.emp_id)}">Edit</button><button class="btn sm ghost danger" data-del="${esc(e.emp_id)}">Remove</button></td></tr>`).join("") ||
        `<tr><td colspan="5"><div class="empty"><strong>No employees yet</strong>Import a timetable or add one here.</div></td></tr>`}</tbody></table></div></section>`;
    const edit = (e = {}) => {
      const m = modal(`<h2>${e.emp_id ? "Edit employee" : "Add employee"}</h2><div class="form-grid">
        <label class="field">Employee ID<input id="ei" value="${esc(e.emp_id || "")}" ${e.emp_id ? "readonly" : ""}></label>
        <label class="field">Name<input id="en" value="${esc(e.name || "")}"></label>
        <label class="field">Department<input id="ed" value="${esc(e.department || "")}"></label></div>
        <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sv">Save employee</button></div>`);
      $("#sv", m.el).onclick = async () => {
        try { await api("/api/admin/employees", { method: "POST", json: { emp_id: $("#ei", m.el).value, name: $("#en", m.el).value, department: $("#ed", m.el).value } }); m.close(); toast("Employee saved", "ok"); views.employees(); } catch (er) { fail(er); }
      };
    };
    $("#add").onclick = () => edit();
    V().onclick = async (ev) => {
      const ed = ev.target.closest("[data-edit]"), del = ev.target.closest("[data-del]");
      if (ed) edit(list.find((x) => x.emp_id === ed.dataset.edit));
      if (del && (await confirmBox("Remove employee?", "Only possible when they have no timetable slots.", "Remove", true))) {
        try { await api(`/api/admin/employees/${encodeURIComponent(del.dataset.del)}`, { method: "DELETE" }); views.employees(); } catch (er) { fail(er); }
      }
    };
  },

  /* ------------------------------------------------------------ settings */
  async settings() {
    const s = await api("/api/admin/settings");
    const F = [
      ["match_thresh", "Mark present at similarity", "0.01", "Faces scoring at least this are marked present automatically."],
      ["review_thresh", "Suggest for review at", "0.01", "Between this and the value above, the employee is asked to confirm."],
      ["grace_minutes", "Minutes editable after class ends", "1", "Attendance freezes for employees after this."],
      ["tiles", "Detection tiles per side", "1", "2 finds small back-row faces. 3 for very wide rooms. 1 is fastest."],
      ["det_size", "Detector input size", "32", "1280 by default. Larger finds smaller faces but is slower."],
      ["min_face", "Smallest usable face (px)", "1", "Faces smaller than this are ignored."],
      ["min_blur", "Minimum sharpness", "1", "Blurrier faces are ignored."],
      ["max_yaw", "Maximum head turn", "0.05", "Higher allows more side-on faces."],
      ["duplicate_thresh", "Flag look-alike enrollments at", "0.01", "Two students more similar than this are flagged."],
      ["max_photos_per_upload", "Photos per upload round", "1", ""],
    ];
    V().innerHTML = head("Recognition settings", "Defaults come from the command-line scripts. Calibrate the two similarity thresholds on one real class before relying on them.") + `
      <section class="panel"><div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
      ${F.map(([k, l, st, h]) => `<label class="field">${l}<input type="number" step="${st}" id="s-${k}" value="${s[k]}"><span class="faint small">${h}</span></label>`).join("")}</div>
      <div class="row" style="margin-top:18px"><button class="btn primary" id="sv">Save settings</button><span class="small muted">Detector size and threshold changes apply after the server restarts.</span></div></section>`;
    $("#sv").onclick = async () => {
      const body = Object.fromEntries(F.map(([k]) => [k, +$("#s-" + k).value]));
      try { await api("/api/admin/settings", { method: "PUT", json: body }); toast("Settings saved", "ok"); } catch (e) { fail(e); }
    };
  },

  /* ------------------------------------------------------------ activity */
  async activity() {
    const list = await api("/api/admin/audit");
    V().innerHTML = head("Activity log", "Sign-ins, imports and every attendance change, newest first.") + `
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>
      ${list.map((a) => `<tr><td class="small">${esc(a.ts.replace("T", " "))}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="small muted">${esc(a.detail)}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  },
};

/* ------------------------------------------------------------ modals */
async function studentModal(id, after) {
  const s = await api(`/api/admin/students/${id}`);
  await loadSections();
  const p = s.history.filter((h) => h.status === "Present").length;
  const m = modal(`<h2>${esc(s.name)}</h2>
    <div class="faces" style="margin-bottom:14px">${s.views.map((v) => `<div class="facecard">${img(v.crop_path, "", v.view)}<div class="cap"><b>${esc(v.view)}</b><br><span class="muted">sharpness ${v.blur}, ${v.face_px}px</span></div></div>`).join("") || '<span class="muted">No faces were found in this student\'s photos. Re-upload a folder for this roll number.</span>'}</div>
    ${s.issues ? `<div class="notice small" style="margin-bottom:14px">${esc(s.issues)}</div>` : ""}
    <div class="form-grid"><label class="field">Name<input id="n" value="${esc(s.name)}"></label>
      <label class="field">Roll number<input id="r" value="${esc(s.roll)}"></label>
      <label class="field">Section<select id="sec"><option value="">None</option>${secOptions(s.section_id)}</select></label></div>
    <p class="small muted" style="margin-top:14px">${s.history.length ? `Present in ${p} of the last ${s.history.length} classes (${pct(p, s.history.length)}%).` : "No attendance recorded yet."}</p>
    <div class="modal-foot"><button class="btn danger" id="del" style="margin-right:auto">Delete student</button><button class="btn" data-close>Cancel</button><button class="btn primary" id="sv">Save changes</button></div>`, { wide: true });
  $("#sv", m.el).onclick = async () => {
    try {
      await api(`/api/admin/students/${id}`, { method: "PATCH", json: { name: $("#n", m.el).value, roll: $("#r", m.el).value, section_id: $("#sec", m.el).value ? +$("#sec", m.el).value : null } });
      m.close(); toast("Student saved", "ok"); after();
    } catch (e) { fail(e); }
  };
  $("#del", m.el).onclick = async () => {
    if (await confirmBox(`Delete ${s.name}?`, "Their face data and all attendance records are removed. This can't be undone.", "Delete student", true)) {
      try { await api(`/api/admin/students/${id}`, { method: "DELETE" }); m.close(); toast("Student deleted"); after(); } catch (e) { fail(e); }
    }
  };
}

function sectionModal(s) {
  const m = modal(`<h2>${s ? "Rename section" : "New section"}</h2><div class="form-grid" style="grid-template-columns:1fr">
    <label class="field">Name<input id="n" value="${esc(s?.name || "")}" placeholder="e.g. CSE-A"></label>
    <label class="field">Description<input id="d" value="${esc(s?.description || "")}" placeholder="Optional"></label></div>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sv">${s ? "Save section" : "Create section"}</button></div>`);
  $("#sv", m.el).onclick = async () => {
    try {
      const body = { name: $("#n", m.el).value, description: $("#d", m.el).value };
      s ? await api(`/api/admin/sections/${s.id}`, { method: "PATCH", json: body }) : await api("/api/admin/sections", { method: "POST", json: body });
      m.close(); toast(s ? "Section saved" : "Section created", "ok"); views.sections();
    } catch (e) { fail(e); }
  };
}

function classModal(after) {
  const m = modal(`<h2>Add class</h2><div class="form-grid">
    <label class="field">Employee ID<input id="e" placeholder="EMP101"></label>
    <label class="field">Section<select id="s">${secOptions()}</select></label>
    <label class="field">Subject<input id="sub"></label><label class="field">Room<input id="rm"></label>
    <label class="field">Date<input type="date" id="d" value="${todayISO()}"></label>
    <label class="field">Starts<input type="time" id="st" value="09:00"></label><label class="field">Ends<input type="time" id="en" value="09:50"></label>
    <label class="field">Repeat weekly until<input type="date" id="rep"></label></div>
    <p class="small muted" style="margin-top:10px">Classes that clash with the same employee or section are skipped and listed.</p>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="sv">Add class</button></div>`);
  $("#sv", m.el).onclick = async () => {
    try {
      const r = await api("/api/admin/timetable", { method: "POST", json: { emp_id: $("#e", m.el).value, section_id: $("#s", m.el).value, subject: $("#sub", m.el).value, room: $("#rm", m.el).value, class_date: $("#d", m.el).value, start_time: $("#st", m.el).value, end_time: $("#en", m.el).value, repeat_until: $("#rep", m.el).value || null } });
      m.close(); toast(`Added ${r.added} class${r.added > 1 ? "es" : ""}${r.errors.length ? `, skipped ${r.errors.length}: ${r.errors[0]}` : ""}`, r.errors.length ? "" : "ok"); after();
    } catch (e) { fail(e); }
  };
}

function timetableImportModal(after) {
  const m = modal(`<h2>Import timetable</h2><p class="muted small" style="margin-bottom:12px">Columns: Employee ID, Section, Date, Start Time, End Time. Optional: Employee Name, Subject, Room. <a href="/api/templates/timetable">Download template</a></p>
    <div id="dz"></div><label class="check" style="margin-top:10px"><input type="checkbox" id="cm">Create sections that don't exist yet</label><div id="res" style="margin-top:12px"></div>
    <div class="modal-foot"><button class="btn" data-close>Done</button></div>`);
  dropzone($("#dz", m.el), {
    accept: ".xlsx,.xls,.csv", title: "Drop an Excel or CSV file", hint: "Rows that clash with existing classes are skipped.",
    onFiles: async ([f]) => {
      const fd = new FormData(); fd.append("file", f); fd.append("create_missing", $("#cm", m.el).checked);
      try {
        const r = await upload("/api/admin/timetable/import", fd);
        $("#res", m.el).innerHTML = `<div class="notice"><b>${r.added} classes added.</b>${r.created_sections.length ? ` Created ${r.created_sections.map(esc).join(", ")}.` : ""}
          ${r.errors.length ? `<br><span style="color:var(--review)">${r.errors.length} rows skipped:</span><ul class="list-plain">${r.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
        after();
      } catch (e) { fail(e); }
    },
  });
}

(async () => {
  const meInfo = await api("/api/me"); syncClock(meInfo.server_time);
  shell({ brandSub: "Admin", nav: NAV, who: meInfo.name, onRoute: (id, rest) => {
    if (id === "class") return renderClass(V(), +rest[0], { role: "admin", backHref: "#classes" });
    (views[id] || views.overview)().catch(fail);
  } });
})();
