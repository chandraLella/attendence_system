/* Employee app: the class that is open right now, today's schedule, and past classes (read-only). */
const NAV = [
  { id: "today", label: "Today", icon: "clock" },
  { id: "history", label: "Past classes", icon: "history" },
  { id: "upcoming", label: "Upcoming", icon: "calendar" },
];
const V = () => $("#view");

const clsRow = (c) => `<a class="cls ${c.window.state}" href="#class/${c.id}">
  <div class="time">${c.start_time}<small>${c.class_date === todayISO() ? `to ${c.end_time}` : fmtDate(c.class_date)}</small></div>
  <div><b>${esc(c.subject || "Class")}</b> <span class="muted">${esc(c.section)}</span><div class="small muted">${c.room ? `Room ${esc(c.room)}, ` : ""}${c.section_size} students</div></div>
  <div class="small muted hide-m">${c.session_id ? `${c.present}/${c.total} present` : c.window.state === "closed" ? "Not taken" : ""}</div>${stateTag(c.window)}</a>`;

const views = {
  async today() {
    const r = await api(`/api/employee/schedule?start=${todayISO()}&end=${todayISO()}`); syncClock(r.server_time);
    const live = r.classes.find((c) => c.window.open);
    const next = r.classes.find((c) => c.window.state === "upcoming");
    const draw = () => {
      const t = now().getTime();
      let hero;
      if (live) {
        const f = +new Date(live.window.freeze), grace = t > +new Date(live.window.end);
        hero = `<div class="live-hero ${grace ? "grace" : ""}"><div class="row"><span class="tag t-${grace ? "grace" : "live"}">${grace ? "Class ended, still editable" : "In progress"}</span>
          <span class="muted small">${live.start_time} to ${live.end_time}</span></div>
          <h2 style="margin:10px 0 4px">${esc(live.subject || "Class")}, ${esc(live.section)}</h2>
          <p class="muted">Attendance freezes in <b style="color:var(--text)">${dur(f - t)}</b>${live.session_id ? `. ${live.present} of ${live.total} marked present so far.` : "."}</p>
          <div class="row" style="margin-top:14px"><a class="btn primary" href="#class/${live.id}">Take attendance</a></div></div>`;
      } else if (next) {
        hero = `<div class="panel" style="margin-bottom:22px"><p class="muted small">Next class</p><h2 style="margin:4px 0">${esc(next.subject || "Class")}, ${esc(next.section)} at ${next.start_time}</h2>
          <p class="muted">Attendance opens in ${dur(+new Date(next.window.start) - t)}.</p></div>`;
      } else hero = "";
      $("#hero").innerHTML = hero;
    };
    V().innerHTML = `<div class="page-head"><div><h1>${fmtDate(todayISO())}</h1><p>${r.classes.length ? `${r.classes.length} class${r.classes.length > 1 ? "es" : ""} today. Attendance stays open until ${r.grace_minutes} minutes after each class ends.` : ""}</p></div></div>
      <div id="hero"></div>
      ${r.classes.length ? `<div class="classes">${r.classes.map(clsRow).join("")}</div>` : `<div class="empty"><strong>No classes scheduled today</strong>Your past classes are under Past classes.</div>`}`;
    draw();
    let state = JSON.stringify(r.classes.map((c) => c.window.state));
    window.__tick = setInterval(() => {
      const t = now().getTime();
      const st = JSON.stringify(r.classes.map((c) => (t < +new Date(c.window.start) ? "upcoming" : t <= +new Date(c.window.end) ? "live" : t <= +new Date(c.window.freeze) ? "grace" : "closed")));
      if (st !== state) { clearInterval(window.__tick); views.today(); return; }
      draw();
    }, 1000);
  },

  async history() {
    let start = addDays(todayISO(), -30);
    V().innerHTML = `<div class="page-head"><div><h1>Past classes</h1><p>Frozen attendance can be viewed and downloaded but not changed.</p></div>
      <div class="row"><label class="field">From<input type="date" id="f" value="${start}"></label></div></div><div id="list"></div>`;
    const refresh = async () => {
      const r = await api(`/api/employee/schedule?start=${$("#f").value}&end=${todayISO()}`);
      const past = r.classes.filter((c) => c.window.state === "closed").reverse();
      $("#list").innerHTML = past.length ? `<div class="classes">${past.map(clsRow).join("")}</div>` : `<div class="empty"><strong>No past classes in this range</strong></div>`;
    };
    $("#f").onchange = refresh; refresh();
  },

  async upcoming() {
    const r = await api(`/api/employee/schedule?start=${todayISO()}&end=${addDays(todayISO(), 14)}`);
    const up = r.classes.filter((c) => c.window.state === "upcoming");
    V().innerHTML = `<div class="page-head"><div><h1>Upcoming</h1><p>Your classes for the next two weeks.</p></div></div>
      ${up.length ? `<div class="classes">${up.map(clsRow).join("")}</div>` : `<div class="empty"><strong>Nothing scheduled</strong>Ask the admin if your timetable is missing.</div>`}`;
  },
};

(async () => {
  const me = await api("/api/me"); syncClock(me.server_time);
  shell({ brandSub: "Employee", nav: NAV, who: `${me.name} (${me.emp_id})`, onRoute: (id, rest) => {
    if (id === "class") return renderClass(V(), +rest[0], { role: "employee", backHref: "#today" });
    (views[id] || views.today)().catch(fail);
  } });
})();
