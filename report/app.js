/* =============================================================
 * SPA controller: auth, routing, and views.
 * ============================================================= */
(function () {
  "use strict";

  var app = document.getElementById("app");
  var state = { user: null, schools: [] };

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    return fetch("api/" + path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || "Request failed (" + r.status + ")");
        return j;
      });
    });
  }

  /* ---------- DOM helpers ---------- */
  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function toast(msg, kind) {
    var t = h("div", { class: "toast " + (kind || "") }, [msg]);
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 10);
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 3000);
  }
  function fmtMonth(m) { return window.Charts.fmtMonth(m); }
  function statusBadge(s) {
    var map = { draft: "Draft", submitted: "Submitted", reviewed: "Reviewed", returned: "Returned", missing: "Not submitted" };
    return h("span", { class: "badge b-" + s }, [map[s] || s]);
  }
  function schoolNameById(id) { var s = state.schools.find(function (x) { return x.id === id; }); return s ? s.name : ""; }

  /* ---------- Boot ---------- */
  function boot() {
    api("me").then(function (r) {
      state.user = r.user;
      return api("schools");
    }).then(function (r) {
      state.schools = r.schools;
      route();
    }).catch(function () {
      renderLogin();
    });
  }
  window.addEventListener("hashchange", function () { if (state.user) route(); });

  /* ---------- Login ---------- */
  function renderLogin() {
    document.body.classList.add("login-mode");
    clear(app);
    var u = h("input", { type: "text", placeholder: "Username", autofocus: "true" });
    var p = h("input", { type: "password", placeholder: "Password" });
    var err = h("div", { class: "login-err" });
    function submit() {
      err.textContent = "";
      api("login", { method: "POST", body: { username: u.value.trim(), password: p.value } })
        .then(function (r) { state.user = r.user; location.reload(); })
        .catch(function (e) { err.textContent = e.message; });
    }
    [u, p].forEach(function (el) { el.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); }); });
    app.appendChild(h("div", { class: "login-wrap" }, [
      h("div", { class: "login-card" }, [
        h("div", { class: "login-logo" }, ["📘"]),
        h("h1", null, ["Principal Academic Report"]),
        h("p", { class: "login-sub" }, ["Monthly academic reporting portal"]),
        u, p, err,
        h("button", { class: "btn btn-primary btn-block", onclick: submit }, ["Sign in"]),
      ]),
    ]));
  }

  /* ---------- Shell ---------- */
  function shell(activeView, content) {
    document.body.classList.remove("login-mode");
    clear(app);
    var isAdmin = state.user.role === "admin";
    var nav = [navLink("#/dashboard", "Dashboard", activeView === "dashboard", "📊")];
    nav.push(navLink("#/reports", "Reports", activeView === "reports", "📄"));
    if (isAdmin) {
      nav.push(navLink("#/schools", "Schools", activeView === "schools", "🏫"));
      nav.push(navLink("#/users", "Users", activeView === "users", "👥"));
    }
    var header = h("header", { class: "topbar" }, [
      h("div", { class: "brand" }, [h("span", { class: "brand-mark" }, ["📘"]), "Academic Report Portal"]),
      h("nav", { class: "topnav" }, nav),
      h("div", { class: "userbox" }, [
        h("div", { class: "user-meta" }, [
          h("span", { class: "user-name" }, [state.user.name || state.user.username]),
          h("span", { class: "user-role" }, [isAdmin ? "Chairman (Admin)" : "Principal — " + schoolNameById(state.user.schoolId)]),
        ]),
        h("a", { class: "link-plain", href: "#/account" }, ["Account"]),
        h("button", { class: "btn btn-ghost small", onclick: logout }, ["Sign out"]),
      ]),
    ]);
    app.appendChild(header);
    var main = h("main", { class: "main" });
    main.appendChild(content);
    app.appendChild(main);
  }
  function navLink(href, label, active, icon) { return h("a", { href: href, class: "navlink" + (active ? " active" : "") }, [icon ? h("span", { class: "nav-ico" }, [icon]) : null, label]); }
  function logout() { api("logout", { method: "POST" }).then(function () { location.reload(); }); }

  /* ---------- Router ---------- */
  function route() {
    var hash = location.hash || "#/dashboard";
    var parts = hash.replace(/^#\//, "").split("/");
    var view = parts[0] || "dashboard";
    if (view === "dashboard") return renderDashboard();
    if (view === "reports") {
      if (parts[1] === "new") return renderReportEditor(null);
      if (parts[1]) return renderReportPage(parts[1]);
      return renderReportsList();
    }
    if (view === "schools" && state.user.role === "admin") return renderSchools();
    if (view === "users" && state.user.role === "admin") return renderUsers();
    if (view === "account") return renderAccount();
    return renderDashboard();
  }

  /* ================= Dashboard ================= */
  function renderDashboard(month) {
    api("dashboard" + (month ? "?month=" + encodeURIComponent(month) : "")).then(function (d) {
      var isAdmin = state.user.role === "admin";
      var wrap = h("div", { class: "view" });

      // Month navigation toolbar
      var months = d.months || [];
      var sel = d.selectedMonth;
      var idx = months.indexOf(sel);
      var monthSelect = h("select", { class: "month-select",
        onchange: function () { renderDashboard(this.value); } },
        months.slice().reverse().map(function (m) { return h("option", { value: m, selected: m === sel ? "selected" : null }, [fmtMonth(m)]); }));
      var prevBtn = h("button", { class: "btn small", disabled: idx <= 0 ? "disabled" : null, title: "Previous month",
        onclick: function () { if (idx > 0) renderDashboard(months[idx - 1]); } }, ["◀"]);
      var nextBtn = h("button", { class: "btn small", disabled: idx < 0 || idx >= months.length - 1 ? "disabled" : null, title: "Next month",
        onclick: function () { if (idx < months.length - 1) renderDashboard(months[idx + 1]); } }, ["▶"]);
      var monthBar = months.length
        ? h("div", { class: "month-bar" }, [prevBtn, h("span", { class: "month-label" }, ["🗓 "]), monthSelect, nextBtn])
        : null;
      var excelBtn = months.length
        ? h("button", { class: "btn", onclick: function () { downloadFile("api/export/dashboard?month=" + encodeURIComponent(sel || "")); } }, ["⬇ Excel"])
        : null;

      wrap.appendChild(h("div", { class: "page-head" }, [
        h("h1", null, [isAdmin ? "Chairman Dashboard" : "School Dashboard"]),
        h("div", { class: "page-head-actions" }, [
          monthBar, excelBtn,
          !isAdmin ? h("a", { class: "btn btn-primary", href: "#/reports/new" }, ["+ New Report"]) : null,
        ]),
      ]));
      if (d.prevMonth) wrap.appendChild(h("div", { class: "compare-note" }, ["Showing ", h("b", null, [fmtMonth(sel)]), " — changes compared with ", h("b", null, [fmtMonth(d.prevMonth)]), "."]));

      // Top KPI strip
      var strip = h("div", { class: "kpi-strip" });
      if (isAdmin) {
        strip.appendChild(kpiTile("Schools", d.totals.schools, "🏫"));
        strip.appendChild(kpiTile("Avg across schools", d.totals.avgAcrossSchools != null ? d.totals.avgAcrossSchools + "%" : "—", "📊"));
        strip.appendChild(kpiTile("Students < 40%", d.totals.studentsBelow40, "⚠️", d.totals.studentsBelow40 > 0 ? "warn" : "good"));
        strip.appendChild(kpiTile("Awaiting review", d.pendingReview, "📥", d.pendingReview > 0 ? "warn" : "good"));
      } else {
        var c = d.schoolCards[0] || {};
        strip.appendChild(kpiTile("Overall average", c.overallAvg != null ? c.overallAvg + "%" : "—", "📊"));
        strip.appendChild(kpiTile("Attendance", c.attendance != null ? c.attendance + "%" : "—", "🎯"));
        strip.appendChild(kpiTile("Students < 40%", c.below40 != null ? c.below40 : "—", "⚠️", c.below40 > 0 ? "warn" : "good"));
        strip.appendChild(kpiTile("Syllabus done", c.syllabusAvg != null ? c.syllabusAvg + "%" : "—", "📚"));
      }
      wrap.appendChild(strip);

      // Second KPI row — Abacus, Olympiads, Board readiness
      var strip2 = h("div", { class: "kpi-strip" });
      if (isAdmin) {
        strip2.appendChild(kpiTile("Abacus classes", d.totals.abacusClasses || 0, "🧮"));
        strip2.appendChild(kpiTile("Abacus doing well", d.totals.abacusWell || 0, "🌟", "good"));
        strip2.appendChild(kpiTile("Olympiad exams scheduled", d.totals.olympiadsScheduled || 0, "🏅"));
        strip2.appendChild(kpiTile("Schools at board risk", d.totals.boardRisk || 0, "🎓", d.totals.boardRisk > 0 ? "warn" : "good"));
      } else {
        var c2 = d.schoolCards[0] || {};
        strip2.appendChild(kpiTile("Abacus classes", c2.abacusClasses != null ? c2.abacusClasses : "—", "🧮"));
        strip2.appendChild(kpiTile("Abacus doing well", c2.abacusWell != null ? c2.abacusWell : "—", "🌟", "good"));
        strip2.appendChild(kpiTile("Olympiads scheduled", c2.olympiadsScheduled != null ? c2.olympiadsScheduled : "—", "🏅"));
        strip2.appendChild(kpiTile("Board readiness", c2.boardReadiness || "—", "🎓", c2.boardReadiness === "High Risk" ? "warn" : "good"));
      }
      wrap.appendChild(strip2);

      // School cards
      if (isAdmin) {
        var cards = h("div", { class: "school-cards" });
        d.schoolCards.forEach(function (c) { cards.appendChild(schoolCard(c)); });
        wrap.appendChild(cards);
      }

      // Charts row
      var charts = h("div", { class: "charts-row" });
      var lineBox = h("div", { class: "card chart-card" }, [h("h3", null, ["Overall average trend"]), h("div", { class: "chart-host", id: "lineHost" })]);
      charts.appendChild(lineBox);
      var barBox = h("div", { class: "card chart-card" }, [h("h3", null, ["Students below 40% (latest month)"]), h("div", { class: "chart-host", id: "barHost" })]);
      charts.appendChild(barBox);
      wrap.appendChild(charts);

      // Month-on-month comparison
      if (d.prevMonth && d.comparison && d.comparison.length) {
        wrap.appendChild(comparisonTable(d));
      }

      // Submission matrix (admin)
      if (isAdmin && d.submissionMatrix.length) {
        wrap.appendChild(submissionTable(d));
      }

      // Recent reports
      wrap.appendChild(recentTable(d, isAdmin));

      shell("dashboard", wrap);

      // draw charts after mount
      window.Charts.line(document.getElementById("lineHost"), d.series, d.months);
      var latest = d.latestMonth;
      var barItems = d.schoolCards.map(function (c) { return { label: shortName(c.name), value: c.below40 == null ? 0 : c.below40 }; });
      window.Charts.bar(document.getElementById("barHost"), barItems);
    }).catch(function (e) { toast(e.message, "err"); });
  }
  function shortName(n) { return n.length > 16 ? n.slice(0, 15) + "…" : n; }
  function downloadFile(url) {
    var a = h("a", { href: url, download: "" });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  function deltaCell(cur, prev, lowerIsBetter) {
    if (cur == null || prev == null) return h("td", { class: "center muted" }, ["—"]);
    var diff = Math.round((cur - prev) * 10) / 10;
    if (diff === 0) return h("td", { class: "center" }, ["±0"]);
    var good = lowerIsBetter ? diff < 0 : diff > 0;
    return h("td", { class: "center delta " + (good ? "up" : "down") }, [(diff > 0 ? "▲ +" : "▼ ") + diff]);
  }
  function comparisonTable(d) {
    var card = h("div", { class: "card" }, [h("h3", null, ["Month-on-month comparison  (", fmtMonth(d.selectedMonth), " vs ", fmtMonth(d.prevMonth), ")"])]);
    var metrics = [
      { key: "overallAvg", label: "Overall average %", lower: false },
      { key: "attendance", label: "Attendance %", lower: false },
      { key: "below40", label: "Students < 40%", lower: true },
      { key: "syllabusAvg", label: "Syllabus %", lower: false },
      { key: "abacusClasses", label: "Abacus classes", lower: false },
    ];
    var table = h("table", { class: "grid-table" });
    table.appendChild(h("thead", null, [h("tr", null,
      ["School", "Metric", fmtMonth(d.selectedMonth), fmtMonth(d.prevMonth), "Change"].map(function (c) { return h("th", null, [c]); }))]));
    var tb = h("tbody");
    d.comparison.forEach(function (row) {
      metrics.forEach(function (m, i) {
        var cur = row.current ? row.current[m.key] : null;
        var prev = row.previous ? row.previous[m.key] : null;
        tb.appendChild(h("tr", null, [
          i === 0 ? h("td", { rowspan: String(metrics.length), class: "cmp-school" }, [row.name]) : null,
          h("td", null, [m.label]),
          h("td", { class: "center" }, [cur == null ? "—" : String(cur)]),
          h("td", { class: "center muted" }, [prev == null ? "—" : String(prev)]),
          deltaCell(cur, prev, m.lower),
        ]));
      });
    });
    table.appendChild(tb);
    card.appendChild(h("div", { class: "table-scroll" }, [table]));
    return card;
  }
  function kpiTile(label, value, icon, tone) {
    return h("div", { class: "kpi-tile " + (tone || "") }, [
      h("div", { class: "kpi-icon" }, [icon]),
      h("div", null, [h("div", { class: "kpi-value" }, [String(value)]), h("div", { class: "kpi-label" }, [label])]),
    ]);
  }
  function schoolCard(c) {
    var trendEl = null;
    if (c.trend != null) {
      var up = c.trend > 0, flat = c.trend === 0;
      trendEl = h("span", { class: "trend " + (flat ? "flat" : up ? "up" : "down") }, [(flat ? "—" : up ? "▲ " : "▼ ") + Math.abs(c.trend) + "% vs last month"]);
    }
    return h("div", { class: "card school-card" }, [
      h("div", { class: "sc-head" }, [
        h("div", null, [h("h3", null, [c.name]), h("div", { class: "sc-place" }, [c.place || ""])]),
        c.latestMonth ? h("span", { class: "sc-month" }, [fmtMonth(c.latestMonth)]) : statusBadge("missing"),
      ]),
      h("div", { class: "sc-metrics" }, [
        scMetric("Average", c.overallAvg != null ? c.overallAvg + "%" : "—"),
        scMetric("Attendance", c.attendance != null ? c.attendance + "%" : "—"),
        scMetric("< 40%", c.below40 != null ? c.below40 : "—"),
        scMetric("Syllabus", c.syllabusAvg != null ? c.syllabusAvg + "%" : "—"),
      ]),
      h("div", { class: "sc-chips" }, [
        chip("🧮 Abacus", c.abacusClasses != null ? c.abacusClasses + " classes" : "—"),
        chip("🏅 Olympiads", c.olympiadsScheduled != null ? c.olympiadsScheduled + " scheduled" : "—"),
        c.boardReadiness ? chip("🎓 Board", c.boardReadiness, c.boardReadiness === "High Risk" ? "risk" : "") : null,
      ]),
      h("div", { class: "sc-foot" }, [
        trendEl,
        c.bestTeacher ? h("span", { class: "sc-note" }, ["★ Best teacher: " + c.bestTeacher.name]) : null,
        c.latestReportId ? h("a", { class: "link", href: "#/reports/" + c.latestReportId }, ["Open latest report →"]) : null,
      ]),
    ]);
  }
  function chip(label, value, tone) {
    return h("span", { class: "sc-chip " + (tone || "") }, [h("b", null, [label + ": "]), value]);
  }
  function scMetric(label, value) {
    return h("div", { class: "sc-metric" }, [h("div", { class: "scm-value" }, [String(value)]), h("div", { class: "scm-label" }, [label])]);
  }
  function submissionTable(d) {
    var card = h("div", { class: "card" }, [h("h3", null, ["Submission tracker"])]);
    var table = h("table", { class: "grid-table" });
    var head = h("tr", null, [h("th", null, ["Month"])].concat(
      (d.submissionMatrix[0] ? d.submissionMatrix[0].schools : []).map(function (s) { return h("th", null, [schoolNameById(s.schoolId)]); })
    ));
    table.appendChild(h("thead", null, [head]));
    var tb = h("tbody");
    d.submissionMatrix.slice().reverse().forEach(function (row) {
      tb.appendChild(h("tr", null, [h("td", null, [fmtMonth(row.month)])].concat(
        row.schools.map(function (s) { return h("td", { class: "center" }, [statusBadge(s.status)]); })
      )));
    });
    table.appendChild(tb);
    card.appendChild(h("div", { class: "table-scroll" }, [table]));
    return card;
  }
  function recentTable(d, isAdmin) {
    var card = h("div", { class: "card" }, [h("h3", null, ["Recent reports"])]);
    if (!d.recent.length) { card.appendChild(h("p", { class: "muted" }, ["No submitted reports yet."])); return card; }
    var table = h("table", { class: "grid-table" });
    table.appendChild(h("thead", null, [h("tr", null,
      (isAdmin ? ["School", "Month", "Average", "Attendance", "< 40%", "Status", ""] : ["Month", "Average", "Attendance", "< 40%", "Status", ""])
        .map(function (c) { return h("th", null, [c]); }))]));
    var tb = h("tbody");
    d.recent.forEach(function (r) {
      var cells = [];
      if (isAdmin) cells.push(h("td", null, [r.schoolName]));
      cells.push(h("td", null, [fmtMonth(r.month)]));
      cells.push(h("td", { class: "center" }, [r.kpis.overallAvg != null ? r.kpis.overallAvg + "%" : "—"]));
      cells.push(h("td", { class: "center" }, [r.kpis.attendance != null ? r.kpis.attendance + "%" : "—"]));
      cells.push(h("td", { class: "center" }, [r.kpis.below40 != null ? String(r.kpis.below40) : "—"]));
      cells.push(h("td", { class: "center" }, [statusBadge(r.status)]));
      cells.push(h("td", { class: "center" }, [h("a", { class: "link", href: "#/reports/" + r.id }, ["Open"])]));
      tb.appendChild(h("tr", null, cells));
    });
    table.appendChild(tb);
    card.appendChild(h("div", { class: "table-scroll" }, [table]));
    return card;
  }

  /* ================= Reports list ================= */
  function renderReportsList() {
    Promise.all([api("reports"), Promise.resolve(state.schools)]).then(function (res) {
      var reports = res[0].reports;
      var isAdmin = state.user.role === "admin";
      var wrap = h("div", { class: "view" });
      wrap.appendChild(h("div", { class: "page-head" }, [
        h("h1", null, ["Reports"]),
        h("div", { class: "page-head-actions" }, [h("a", { class: "btn btn-primary", href: "#/reports/new" }, ["+ New Report"])]),
      ]));

      // filters
      var filterSchool = null;
      if (isAdmin) {
        filterSchool = h("select", null, [h("option", { value: "" }, ["All schools"])].concat(
          state.schools.map(function (s) { return h("option", { value: s.id }, [s.name]); })));
        filterSchool.addEventListener("change", applyFilter);
      }
      var filterStatus = h("select", null, ["", "draft", "submitted", "reviewed", "returned"].map(function (v) {
        return h("option", { value: v }, [v === "" ? "All statuses" : v.charAt(0).toUpperCase() + v.slice(1)]);
      }));
      filterStatus.addEventListener("change", applyFilter);
      var filterBar = h("div", { class: "filter-bar" }, [isAdmin ? filterSchool : null, filterStatus]);
      wrap.appendChild(filterBar);

      var listHost = h("div");
      wrap.appendChild(listHost);
      shell("reports", wrap);
      draw(reports);

      function applyFilter() {
        var f = reports.filter(function (r) {
          if (filterSchool && filterSchool.value && r.schoolId !== filterSchool.value) return false;
          if (filterStatus.value && r.status !== filterStatus.value) return false;
          return true;
        });
        draw(f);
      }
      function draw(list) {
        clear(listHost);
        if (!list.length) { listHost.appendChild(h("div", { class: "card" }, [h("p", { class: "muted" }, ["No reports yet. Click “New Report” to create one."])])); return; }
        var table = h("table", { class: "grid-table" });
        table.appendChild(h("thead", null, [h("tr", null,
          (isAdmin ? ["School", "Month", "Year", "Average", "< 40%", "Attendance", "Status", ""] : ["Month", "Year", "Average", "< 40%", "Attendance", "Status", ""])
            .map(function (c) { return h("th", null, [c]); }))]));
        var tb = h("tbody");
        list.forEach(function (r) {
          var cells = [];
          if (isAdmin) cells.push(h("td", null, [r.schoolName]));
          cells.push(h("td", null, [fmtMonth(r.month)]));
          cells.push(h("td", null, [r.academicYear || "—"]));
          cells.push(h("td", { class: "center" }, [r.kpis.overallAvg != null ? r.kpis.overallAvg + "%" : "—"]));
          cells.push(h("td", { class: "center" }, [r.kpis.below40 != null ? String(r.kpis.below40) : "—"]));
          cells.push(h("td", { class: "center" }, [r.kpis.attendance != null ? r.kpis.attendance + "%" : "—"]));
          cells.push(h("td", { class: "center" }, [statusBadge(r.status)]));
          cells.push(h("td", { class: "center" }, [h("a", { class: "link", href: "#/reports/" + r.id }, ["Open"])]));
          tb.appendChild(h("tr", null, cells));
        });
        table.appendChild(tb);
        listHost.appendChild(h("div", { class: "card" }, [h("div", { class: "table-scroll" }, [table])]));
      }
    }).catch(function (e) { toast(e.message, "err"); });
  }

  /* ================= Report page (view / review) ================= */
  function renderReportPage(id) {
    api("reports/" + id).then(function (r) {
      var report = r.report;
      var isAdmin = state.user.role === "admin";
      var canEdit = !isAdmin && report.status !== "reviewed";
      var wrap = h("div", { class: "view" });

      var actions = [h("a", { class: "btn btn-ghost", href: "#/reports" }, ["← Back"])];
      actions.push(h("button", { class: "btn", onclick: function () { window.print(); } }, ["🖨 Print / PDF"]));
      actions.push(h("button", { class: "btn", onclick: function () { downloadFile("api/export/report/" + id); } }, ["⬇ Excel"]));
      if (canEdit) actions.push(h("a", { class: "btn btn-primary", href: "#/reports/" + id + "/edit-marker", onclick: function (e) { e.preventDefault(); openEditor(report); } }, ["✎ Edit"]));

      wrap.appendChild(h("div", { class: "page-head no-print" }, [
        h("div", null, [h("h1", null, [report.schoolName]),
          h("div", { class: "sub-head" }, [fmtMonth(report.month) + "  ·  " + (report.academicYear || "") + "  ", statusBadge(report.status)])]),
        h("div", { class: "page-head-actions" }, actions),
      ]));

      // review panel (admin)
      if (isAdmin) {
        var remarks = h("textarea", { rows: "3", placeholder: "Chairman's remarks (optional)" }, []);
        remarks.value = report.chairmanRemarks || "";
        wrap.appendChild(h("div", { class: "card review-panel no-print" }, [
          h("h3", null, ["Chairman Review"]),
          remarks,
          h("div", { class: "row-actions" }, [
            h("button", { class: "btn btn-primary", onclick: function () { review(id, "reviewed", remarks.value); } }, ["✓ Mark as Reviewed"]),
            h("button", { class: "btn btn-warn", onclick: function () { review(id, "returned", remarks.value); } }, ["↩ Return for changes"]),
          ]),
        ]));
      } else if (report.chairmanRemarks) {
        wrap.appendChild(h("div", { class: "card remark-note" }, [h("strong", null, ["Chairman's remarks: "]), report.chairmanRemarks]));
      }

      // Printable report header + form (read-only)
      wrap.appendChild(printHeader(report));
      var formHost = h("div", { class: "report-print" });
      wrap.appendChild(formHost);
      shell("reports", wrap);
      window.ReportForm.build(formHost, { readOnly: true });
      window.ReportForm.setData(report.data);
    }).catch(function (e) { toast(e.message, "err"); location.hash = "#/reports"; });
  }
  function printHeader(report) {
    return h("div", { class: "print-title" }, [
      h("h2", null, [report.schoolName]),
      h("div", { class: "pt-sub" }, ["Monthly Principal Academic Report — Submitted to Chairman"]),
      h("div", { class: "pt-meta" }, ["Month: " + fmtMonth(report.month) + "    |    Academic Year: " + (report.academicYear || "—")]),
    ]);
  }
  function review(id, status, remarks) {
    api("reports/" + id + "/review", { method: "POST", body: { status: status, remarks: remarks } })
      .then(function () { toast(status === "reviewed" ? "Marked as reviewed" : "Returned for changes", "ok"); renderReportPage(id); })
      .catch(function (e) { toast(e.message, "err"); });
  }
  function openEditor(report) { location.hash = "#/reports/new"; setTimeout(function () { renderReportEditor(report); }, 0); }

  /* ================= Report editor (create / edit) ================= */
  function renderReportEditor(existing) {
    var isAdmin = state.user.role === "admin";
    var wrap = h("div", { class: "view" });
    var editingId = existing ? existing.id : null;

    // meta bar: school, month, year
    var schoolSel = null;
    if (isAdmin) {
      schoolSel = h("select", null, state.schools.map(function (s) { return h("option", { value: s.id }, [s.name]); }));
      if (existing) schoolSel.value = existing.schoolId;
    }
    var monthInput = h("input", { type: "month" });
    if (existing) monthInput.value = existing.month;
    var yearInput = h("input", { type: "text", placeholder: "e.g. 2025 – 2026" });
    if (existing) yearInput.value = existing.academicYear || "";

    var savedNote = h("span", { class: "saved-note" });

    var metaBar = h("div", { class: "editor-meta no-print" }, [
      isAdmin ? field("School", schoolSel) : field("School", h("div", { class: "static-field" }, [schoolNameById(state.user.schoolId)])),
      field("Month", monthInput),
      field("Academic Year", yearInput),
      savedNote,
    ]);

    var actions = h("div", { class: "editor-actions no-print" }, [
      h("button", { class: "btn", onclick: saveDraft }, ["💾 Save draft"]),
      h("button", { class: "btn btn-primary", onclick: submitReport }, ["📤 Submit to Chairman"]),
      !existing ? h("button", { class: "btn", title: "Copy last month's report so you only update the numbers", onclick: prefillLastMonth }, ["↩ Prefill from last month"]) : null,
      h("a", { class: "btn btn-ghost", href: "#/reports" }, ["Cancel"]),
    ]);

    wrap.appendChild(h("div", { class: "page-head no-print" }, [
      h("h1", null, [existing ? "Edit Report" : "New Monthly Report"]),
      !existing ? h("div", { class: "compare-note" }, ["Tip: use ", h("b", null, ["Prefill from last month"]), " to carry over teacher names, subjects and action plans — then just update the figures. Repeating text fields also offer ", h("b", null, ["pick-lists"]), " (click the field for suggestions)."]) : null,
    ]));
    wrap.appendChild(metaBar);
    wrap.appendChild(actions);
    var formHost = h("div", { class: "report-edit" });
    wrap.appendChild(formHost);
    shell("reports", wrap);

    var dirty = false;
    window.ReportForm.build(formHost, { readOnly: false, onChange: function () { dirty = true; savedNote.textContent = "Unsaved changes"; savedNote.className = "saved-note warn"; } });
    if (existing) window.ReportForm.setData(existing.data);

    function collectMeta() {
      return {
        schoolId: isAdmin ? schoolSel.value : state.user.schoolId,
        month: monthInput.value,
        academicYear: yearInput.value,
        data: window.ReportForm.getData(),
      };
    }
    function prefillLastMonth() {
      var schoolId = isAdmin ? (schoolSel && schoolSel.value) : state.user.schoolId;
      if (!schoolId) { toast("Choose a school first", "err"); return; }
      api("reports?school=" + encodeURIComponent(schoolId)).then(function (r) {
        var list = (r.reports || []).slice().sort(function (a, b) { return (b.month || "").localeCompare(a.month || ""); });
        if (!list.length) { toast("No previous report found for this school", "err"); return; }
        var prev = list[0];
        return api("reports/" + prev.id).then(function (rr) {
          var data = rr.report.data || {};
          // carry the academic year over; keep the month blank so it must be set fresh
          if (rr.report.academicYear) yearInput.value = rr.report.academicYear;
          if (data.fields) { data.fields.month = ""; data.fields.submitDate = ""; }
          window.ReportForm.setData(data);
          dirty = true; savedNote.textContent = "Prefilled from " + fmtMonth(prev.month) + " — update the figures"; savedNote.className = "saved-note warn";
          toast("Loaded " + fmtMonth(prev.month) + " — update the numbers and month", "ok");
        });
      }).catch(function (e) { toast(e.message, "err"); });
    }
    function saveDraft() {
      var m = collectMeta();
      if (!m.month) { toast("Please choose a month", "err"); return; }
      if (editingId) {
        api("reports/" + editingId, { method: "PUT", body: { data: m.data, academicYear: m.academicYear } })
          .then(function () { dirty = false; savedNote.textContent = "Saved ✓"; savedNote.className = "saved-note ok"; toast("Draft saved", "ok"); })
          .catch(function (e) { toast(e.message, "err"); });
      } else {
        api("reports", { method: "POST", body: m })
          .then(function (r) { editingId = r.report.id; dirty = false; savedNote.textContent = "Saved ✓"; savedNote.className = "saved-note ok"; toast("Draft created", "ok"); location.hash = "#/reports/" + editingId + "?edit"; setTimeout(function(){ renderReportEditor(r.report); }, 0); })
          .catch(function (e) { toast(e.message, "err"); });
      }
    }
    function submitReport() {
      var m = collectMeta();
      if (!m.month) { toast("Please choose a month", "err"); return; }
      var chain = editingId
        ? api("reports/" + editingId, { method: "PUT", body: { data: m.data, academicYear: m.academicYear } }).then(function () { return { report: { id: editingId } }; })
        : api("reports", { method: "POST", body: m });
      chain.then(function (r) {
        var rid = editingId || r.report.id;
        return api("reports/" + rid + "/submit", { method: "POST" }).then(function () { return rid; });
      }).then(function (rid) {
        toast("Report submitted to Chairman", "ok");
        location.hash = "#/reports/" + rid;
      }).catch(function (e) { toast(e.message, "err"); });
    }
  }
  function field(label, control) { return h("label", { class: "efield" }, [h("span", null, [label]), control]); }

  /* ================= Schools (admin) ================= */
  function renderSchools() {
    api("schools").then(function (r) {
      state.schools = r.schools;
      var wrap = h("div", { class: "view" });
      wrap.appendChild(h("div", { class: "page-head" }, [h("h1", null, ["Schools"])]));
      var card = h("div", { class: "card" });
      state.schools.forEach(function (s) {
        var name = h("input", { type: "text", value: s.name });
        var place = h("input", { type: "text", value: s.place || "" });
        card.appendChild(h("div", { class: "row-edit" }, [
          name, place,
          h("button", { class: "btn small", onclick: function () {
            api("schools/" + s.id, { method: "PUT", body: { name: name.value, place: place.value } })
              .then(function () { toast("School updated", "ok"); loadSchools(); }).catch(function (e) { toast(e.message, "err"); });
          } }, ["Save"]),
        ]));
      });
      // add new
      var nn = h("input", { type: "text", placeholder: "New school name" });
      var np = h("input", { type: "text", placeholder: "Place" });
      card.appendChild(h("div", { class: "row-edit add-row" }, [
        nn, np,
        h("button", { class: "btn btn-primary small", onclick: function () {
          if (!nn.value.trim()) { toast("Enter a name", "err"); return; }
          api("schools", { method: "POST", body: { name: nn.value.trim(), place: np.value.trim() } })
            .then(function () { toast("School added", "ok"); loadSchools(); }).catch(function (e) { toast(e.message, "err"); });
        } }, ["+ Add school"]),
      ]));
      wrap.appendChild(card);
      shell("schools", wrap);
    });
  }
  function loadSchools() { return api("schools").then(function (r) { state.schools = r.schools; if ((location.hash || "").indexOf("schools") > -1) renderSchools(); }); }

  /* ================= Users (admin) ================= */
  function makeUsername(name, role) {
    var base = (name || "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
    if (!base) base = role === "admin" ? "chairman" : "principal";
    return base.slice(0, 20);
  }
  function makePassword() {
    var upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnpqrstuvwxyz", dig = "23456789", sym = "@#$%&*";
    function pick(s, n) { var o = ""; for (var i = 0; i < n; i++) o += s[Math.floor(Math.random() * s.length)]; return o; }
    var raw = pick(upper, 2) + pick(lower, 4) + pick(dig, 2) + pick(sym, 1);
    return raw.split("").sort(function () { return Math.random() - 0.5; }).join("");
  }
  function renderUsers() {
    Promise.all([api("users"), api("schools")]).then(function (res) {
      var users = res[0].users; state.schools = res[1].schools;
      var wrap = h("div", { class: "view" });
      wrap.appendChild(h("div", { class: "page-head" }, [
        h("h1", null, [h("span", { class: "h-ico" }, ["👥"]), "Users & Credentials"]),
        h("div", { class: "page-head-actions" }, [
          h("button", { class: "btn", onclick: function () { downloadFile("api/export/users"); } }, ["⬇ Excel"]),
        ]),
      ]));

      var table = h("table", { class: "grid-table" });
      table.appendChild(h("thead", null, [h("tr", null, ["", "Name", "Username", "Role", "School", "Status", "Actions"].map(function (c) { return h("th", null, [c]); }))]));
      var tb = h("tbody");
      users.forEach(function (u) {
        tb.appendChild(h("tr", null, [
          h("td", { class: "center" }, [h("span", { class: "role-ico" }, [u.role === "admin" ? "👑" : "🧑‍🏫"])]),
          h("td", null, [u.name]),
          h("td", null, [h("code", null, [u.username])]),
          h("td", null, [u.role === "admin" ? "Chairman" : "Principal"]),
          h("td", null, [u.schoolName || "—"]),
          h("td", null, [u.active ? h("span", { class: "badge b-reviewed" }, ["Active"]) : h("span", { class: "badge b-returned" }, ["Disabled"])]),
          h("td", null, [
            h("button", { class: "btn small", title: "Rename", onclick: function () { editName(u); } }, ["✎ Name"]),
            h("button", { class: "btn small", onclick: function () { resetPw(u); } }, ["🔑 Password"]),
            u.role !== "admin" ? h("button", { class: "btn small btn-warn", onclick: function () { delUser(u); } }, ["🗑"]) : null,
          ]),
        ]));
      });
      table.appendChild(tb);
      wrap.appendChild(h("div", { class: "card" }, [h("div", { class: "table-scroll" }, [table])]));

      // Add principal with generate-credentials
      var name = h("input", { type: "text", placeholder: "Full name (e.g. Mrs. C. Meena)", oninput: function () { if (!unameEdited) uname.value = makeUsername(name.value, "principal"); } });
      var uname = h("input", { type: "text", placeholder: "auto from name" });
      var unameEdited = false; uname.addEventListener("input", function () { unameEdited = true; });
      var pass = h("input", { type: "text", placeholder: "click Generate →" });
      var school = h("select", null, state.schools.map(function (s) { return h("option", { value: s.id }, [s.name]); }));
      var genBtn = h("button", { class: "btn", type: "button", onclick: function () { pass.value = makePassword(); } }, ["🎲 Generate password"]);
      var credHost = h("div", { class: "cred-host" });

      wrap.appendChild(h("div", { class: "card" }, [
        h("h3", null, ["Add a principal & generate login"]),
        h("div", { class: "add-user-grid" }, [
          field("Name", name), field("Username", uname), field("Password", pass), field("School", school),
        ]),
        h("div", { class: "row-actions" }, [
          genBtn,
          h("button", { class: "btn btn-primary", onclick: function () {
            var nm = name.value.trim(), un = (uname.value.trim() || makeUsername(nm, "principal"));
            if (!nm) { toast("Enter a name", "err"); return; }
            if (!pass.value) pass.value = makePassword();
            api("users", { method: "POST", body: { name: nm, username: un, password: pass.value, role: "principal", schoolId: school.value } })
              .then(function () {
                var schoolNm = (state.schools.find(function (s) { return s.id === school.value; }) || {}).name || "";
                credHost.appendChild(credCard("Principal", nm, un, pass.value, schoolNm));
                toast("Principal added — credentials shown below", "ok");
                name.value = ""; uname.value = ""; pass.value = ""; unameEdited = false;
                // refresh table without wiping the credential cards
                api("users").then(function (r) { rebuildUserTable(tb, r.users); });
              }).catch(function (e) { toast(e.message, "err"); });
          } }, ["+ Add principal"]),
        ]),
        credHost,
      ]));

      shell("users", wrap);
    }).catch(function (e) { toast(e.message, "err"); });

    function rebuildUserTable(tb, users) {
      clear(tb);
      users.forEach(function (u) {
        tb.appendChild(h("tr", null, [
          h("td", { class: "center" }, [h("span", { class: "role-ico" }, [u.role === "admin" ? "👑" : "🧑‍🏫"])]),
          h("td", null, [u.name]), h("td", null, [h("code", null, [u.username])]),
          h("td", null, [u.role === "admin" ? "Chairman" : "Principal"]), h("td", null, [u.schoolName || "—"]),
          h("td", null, [u.active ? h("span", { class: "badge b-reviewed" }, ["Active"]) : h("span", { class: "badge b-returned" }, ["Disabled"])]),
          h("td", null, [
            h("button", { class: "btn small", onclick: function () { editName(u); } }, ["✎ Name"]),
            h("button", { class: "btn small", onclick: function () { resetPw(u); } }, ["🔑 Password"]),
            u.role !== "admin" ? h("button", { class: "btn small btn-warn", onclick: function () { delUser(u); } }, ["🗑"]) : null,
          ]),
        ]));
      });
    }
    function credCard(role, name, username, password, school) {
      var text = "Login for " + name + " (" + role + (school ? " — " + school : "") + ")\nUsername: " + username + "\nPassword: " + password;
      return h("div", { class: "cred-card" }, [
        h("div", { class: "cred-title" }, ["✅ " + role + " login created"]),
        h("div", { class: "cred-row" }, [h("span", null, ["Name"]), h("b", null, [name])]),
        school ? h("div", { class: "cred-row" }, [h("span", null, ["School"]), h("b", null, [school])]) : null,
        h("div", { class: "cred-row" }, [h("span", null, ["Username"]), h("code", null, [username])]),
        h("div", { class: "cred-row" }, [h("span", null, ["Password"]), h("code", null, [password])]),
        h("div", { class: "cred-actions" }, [
          h("button", { class: "btn small", onclick: function () { copyText(text); } }, ["📋 Copy"]),
          h("span", { class: "cred-hint" }, ["Share this with the principal. They can change it anytime under Account."]),
        ]),
      ]);
    }
    function editName(u) {
      var n = prompt("New name for " + u.name + ":", u.name);
      if (n == null || !n.trim()) return;
      api("users/" + u.id, { method: "PUT", body: { name: n.trim() } }).then(function () { toast("Name updated", "ok"); renderUsers(); }).catch(function (e) { toast(e.message, "err"); });
    }
    function resetPw(u) {
      var p = makePassword();
      if (!confirm("Reset password for " + u.name + "?\n\nNew password will be:\n" + p + "\n\n(You can copy it from the confirmation.)")) return;
      api("users/" + u.id + "/reset-password", { method: "POST", body: { password: p } })
        .then(function () { copyText("Login for " + u.name + "\nUsername: " + u.username + "\nPassword: " + p); toast("Password reset & copied to clipboard", "ok"); }).catch(function (e) { toast(e.message, "err"); });
    }
    function delUser(u) {
      if (!confirm("Delete user " + u.name + "? This cannot be undone.")) return;
      api("users/" + u.id, { method: "DELETE" }).then(function () { toast("User deleted", "ok"); renderUsers(); }).catch(function (e) { toast(e.message, "err"); });
    }
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast("Copied", "ok"); }, function () { fallbackCopy(t); });
    else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    var ta = h("textarea", null, [t]); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Copied", "ok"); } catch (e) { toast("Copy failed", "err"); }
    document.body.removeChild(ta);
  }

  /* ================= Account (change password) ================= */
  function renderAccount() {
    var wrap = h("div", { class: "view" });
    wrap.appendChild(h("div", { class: "page-head" }, [h("h1", null, ["My Account"])]));
    var cur = h("input", { type: "password", placeholder: "Current password" });
    var nw = h("input", { type: "password", placeholder: "New password (min 6 chars)" });
    var cf = h("input", { type: "password", placeholder: "Confirm new password" });
    wrap.appendChild(h("div", { class: "card narrow" }, [
      h("h3", null, ["Change password"]),
      h("div", { class: "user-meta-block" }, [
        h("div", null, [h("strong", null, [state.user.name || state.user.username])]),
        h("div", { class: "muted" }, [state.user.role === "admin" ? "Chairman (Admin)" : "Principal"]),
      ]),
      field("Current password", cur), field("New password", nw), field("Confirm", cf),
      h("button", { class: "btn btn-primary", onclick: function () {
        if (nw.value !== cf.value) { toast("Passwords do not match", "err"); return; }
        if (nw.value.length < 6) { toast("Password too short", "err"); return; }
        api("change-password", { method: "POST", body: { current: cur.value, next: nw.value } })
          .then(function () { state.user.mustChangePassword = false; toast("Password changed", "ok"); location.hash = "#/dashboard"; })
          .catch(function (e) { toast(e.message, "err"); });
      } }, ["Update password"]),
    ]));
    shell("account", wrap);
  }

  boot();
})();
