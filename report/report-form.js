/* =============================================================
 * ReportForm — renders the 13-section Monthly Principal Academic
 * Report into a container. Supports edit and read-only modes,
 * live auto-calculation, and get/set of the full data object.
 *
 * Data shape: { fields: {key:value}, teachers:[], bestTeachers:[], actions:[] }
 * ============================================================= */
window.ReportForm = (function () {
  "use strict";

  var GRADES_ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var SECONDARY_GRADES = [6, 7, 8];
  var SECONDARY_SUBJECTS = ["English", "Tamil", "Hindi", "Arabic", "History", "Mathematics", "Science", "Geography"];
  var PRIMARY_GRADES = [1, 2, 3, 4, 5];
  var PRIMARY_SUBJECTS = ["English", "Tamil", "Hindi", "Arabic", "English Language", "Mathematics", "Science", "Lead / Other Activities"];
  var NURSERY_CLASSES = ["Nursery", "JKG", "SKG"];
  var SYLLABUS_GRADES = ["Pre-KG", "JKG", "SKG", "Grade-1", "Grade-2", "Grade-3", "Grade-4", "Grade-5", "Grade-6", "Grade-7", "Grade-8", "Grade-9", "Grade-10", "Grade-11", "Grade-12"];
  var SLOW_GRADES = ["Grade-1", "Grade-2", "Grade-3", "Grade-4", "Grade-5", "Grade-6", "Grade-7", "Grade-8", "Grade-9", "Grade-10", "Grade-11", "Grade-12"];
  var SM_GRADES = [9, 10, 11, 12]; // special monitoring grades
  var SM_ROWS = 6;
  var ABACUS_GRADES = ["Grade-1", "Grade-2", "Grade-3", "Grade-4", "Grade-5", "Grade-6", "Grade-7", "Grade-8", "Grade-9", "Grade-10", "Grade-11", "Grade-12"];
  var ACTIVITY_SECTIONS = ["Nursery", "Grade 1 to 5", "Grade 6 to 8"];
  // Seeded from "Major Olympiad Organizations in India"
  var OLYMPIAD_DEFAULTS = [
    { exam: "IMO – Int'l Mathematics Olympiad", org: "SOF", grades: "3 – 11" },
    { exam: "NSO – National Science Olympiad", org: "SOF", grades: "3 – 11" },
    { exam: "IEO – English Olympiad", org: "SOF", grades: "1 – 11" },
    { exam: "IGKO – General Knowledge Olympiad", org: "SOF", grades: "1 – 11" },
    { exam: "NCO – Cyber Olympiad", org: "SOF", grades: "3 – 11" },
    { exam: "Indian Talent Olympiad (Math/Sci/Eng/GK/Comp)", org: "Indian Talent Olympiad", grades: "1 – 11" },
    { exam: "NSTSE", org: "Unified Council", grades: "1 – 11" },
    { exam: "UCO", org: "Unified Council", grades: "1 – 11" },
    { exam: "UIEO", org: "Unified Council", grades: "1 – 11" },
    { exam: "Math / Physics / Chemistry / Biology Olympiad", org: "HBCSE (TIFR)", grades: "8 – 11" },
  ];
  var OLYMPIAD_STATUS = ["Not Started", "School Registered", "Students Enrolled", "Fees Paid", "Completed"];

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? null : n; }
  function r1(n) { return Math.round(n * 10) / 10; }
  function avg(a) { return sum(a) / a.length; }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

  function ti(field, o) {
    o = o || {};
    var i = el("input", { type: "text", "data-field": field });
    if (o.left) i.className = "text-left";
    if (o.numeric) i.setAttribute("inputmode", "decimal");
    if (o.calc) i.setAttribute("data-calc", o.calc);
    if (o.subject) i.setAttribute("data-subject", o.subject);
    if (o.list) i.setAttribute("list", o.list);
    if (o.placeholder) i.setAttribute("placeholder", o.placeholder);
    return i;
  }

  /* Shared pick-lists (type-or-choose) to speed up repetitive text entry */
  var PICKLISTS = {
    rf_dl_actions: [
      "Continue as per plan", "Maintain present pace", "Remedial 2 hrs/week", "Remedial 3 hrs/week",
      "Remedial 4 hrs/week", "Daily 30-min remedial", "Bridge course – basic operations",
      "Bridge course on fractions and integers", "Special coaching 6 hrs/week", "Weekly dictation",
      "Weekly spelling drill", "Comprehension practice", "Peer reading pairs formed", "Extra grammar worksheet",
      "Map marking test every fortnight", "Diagram and map practice", "Answer-writing practice",
      "Practical record completion", "Lab demonstration", "Mental maths drill daily", "Reading log maintained",
      "Parents informed", "Revision worksheets issued", "Oral recitation practice", "Puzzle-based practice",
    ],
    rf_dl_correction: ["Up to date", "1 set pending", "2 sets pending", "3 sets pending", "Behind schedule"],
    rf_dl_subjects: ["English", "Tamil", "Hindi", "Arabic", "History", "Geography", "Mathematics", "Science", "English Language", "Social Science", "Computer", "EVS"],
    rf_dl_sections: ["Grade 1 – 5", "Grade 6 – 8", "Grade 6 – 9", "Grade 6 – 12", "Grade 9 – 12", "Primary Class Teacher", "Nursery / KG", "Grade 1", "Grade 2", "Grade 3"],
    rf_dl_yesno: ["Yes", "No"],
    rf_dl_yesdetail: ["Yes", "No", "Yes – moderated by subject heads", "Yes – completed", "Yes – all sections"],
    rf_dl_g9risk: ["N/A (not yet started)", "N/A", "Safe", "Moderate Risk", "High Risk"],
    rf_dl_parents: ["Parents informed", "Parents called", "Parent meeting held", "PTM discussion done"],
  };
  function buildDatalists() {
    var host = el("div", { style: "display:none" });
    Object.keys(PICKLISTS).forEach(function (id) {
      var dl = el("datalist", { id: id });
      PICKLISTS[id].forEach(function (v) { dl.appendChild(el("option", { value: v })); });
      host.appendChild(dl);
    });
    root.appendChild(host);
  }
  function sel(field, opts, current) {
    var s = el("select", { "data-field": field });
    opts.forEach(function (o) {
      var op = el("option", { value: o.value != null ? o.value : o }, [o.label != null ? o.label : o]);
      s.appendChild(op);
    });
    if (current != null) s.value = current;
    return s;
  }

  var root, onChange, readOnly;

  function build(container, opts) {
    root = container;
    onChange = (opts && opts.onChange) || function () {};
    readOnly = !!(opts && opts.readOnly);
    root.innerHTML = "";
    root.classList.toggle("readonly", readOnly);

    buildHeader();
    buildExec();
    buildGradeSummary();
    buildSubjectSection("3. Subject-Wise Performance Analysis (Grade 6 – 8)", SECONDARY_GRADES, SECONDARY_SUBJECTS, "sub");
    buildSubjectSection("4. Primary Section Summary (Grade 1 – 5)", PRIMARY_GRADES, PRIMARY_SUBJECTS, "pri");
    buildNursery();
    buildPeriodicTest();
    buildSyllabus();
    buildSlowLearner();
    buildSpecialMonitoring();
    buildTeacher();
    buildBestTeacher();
    buildDiscipline();
    buildExternalExams();
    buildAbacus();
    buildActionPlan();
    buildSignatures();
    buildDatalists();

    // events
    root.addEventListener("input", function (e) {
      if (e.target.matches("input, textarea, select, [contenteditable]")) { recalc(); onChange(); }
    });
    root.addEventListener("change", function (e) {
      if (e.target.type === "checkbox" && /^rf_sm\d+_na$/.test(e.target.id)) toggleSM();
      if (e.target.matches("input, textarea, select")) { recalc(); onChange(); }
    });
    root.querySelectorAll("[data-add]").forEach(function (b) {
      b.addEventListener("click", function () {
        var t = b.getAttribute("data-add");
        if (t === "teacher") q("#rf_teacher tbody").appendChild(teacherRow());
        else if (t === "bestTeacher") q("#rf_best tbody").appendChild(bestTeacherRow());
        else if (t === "action") q("#rf_action tbody").appendChild(actionRow());
        else if (t === "extExam") q("#rf_extexam tbody").appendChild(extExamRow());
        reindex(); recalc(); onChange();
      });
    });

    if (readOnly) lockDown();
    recalc();
  }

  function section(title, sub) {
    var s = el("section", { class: "rf-section" });
    var h = el("h2", null, [title]);
    if (sub) h.appendChild(el("span", { class: "sub" }, [" " + sub]));
    s.appendChild(h);
    root.appendChild(s);
    return s;
  }
  function q(s) { return root.querySelector(s); }

  /* ---- Header meta ---- */
  function buildHeader() {
    var s = el("section", { class: "rf-header" });
    s.appendChild(el("div", { class: "rf-meta" }, [
      metaField("Month", "month", "e.g. January 2026"),
      metaField("Academic Year", "academicYear", "e.g. 2025 – 2026"),
      metaField("Submitted by", "submittedBy", "e.g. Mrs. C. Meena, Principal"),
      metaField("Date", "submitDate", "e.g. 03 February 2026"),
    ]));
    root.appendChild(s);
  }
  function metaField(label, field, ph) {
    return el("label", { class: "rf-metafield" }, [label, ti(field, { placeholder: ph })]);
  }

  /* ---- 1. Executive summary ---- */
  function buildExec() {
    var s = section("1. Executive Summary");
    var t = el("table", { class: "kv" });
    var tb = el("tbody");
    function row(th, tdChildren) { tb.appendChild(el("tr", null, [el("th", null, [th]), el("td", null, tdChildren)])); }
    row("Overall School Academic Average", [autoSpan("es_overall")]);
    row("Improvement vs Last Month", [
      sel("es_trend", [{ value: "UP", label: "▲ UP" }, { value: "DOWN", label: "▼ DOWN" }, { value: "SAME", label: "— No change" }]),
      ti("es_trendValue", { numeric: true }), document.createTextNode(" % "),
      ti("es_trendNote", { placeholder: "(e.g. Dec-25: 66.6 %)" }),
    ]);
    row("Best Performing Grade", [autoSpan("es_bestGrade")]);
    row("Weakest Performing Grade", [autoSpan("es_weakGrade")]);
    row("Best Subject Overall", [autoSpan("es_bestSubject")]);
    row("Weakest Subject Overall", [autoSpan("es_weakSubject")]);
    row("Students Below 40% (Total)", [autoSpan("es_below40"), document.createTextNode(" out of "), ti("es_totalStudents", { numeric: true, placeholder: "total" }), document.createTextNode(" students")]);
    row("Grade 9 Risk Category Students", [ti("es_g9risk", { list: "rf_dl_g9risk", placeholder: "N/A if Grade 9 not started" })]);
    row("Syllabus Completion Status", [sel("es_syllabus", ["On Track", "Slight Delay", "Major Delay"]), ti("es_syllabusNote", { placeholder: "details" })]);
    t.appendChild(tb);
    s.appendChild(t);
    s.appendChild(el("label", { class: "rf-block" }, ["Key Academic Observations for the month:"]));
    s.appendChild(el("textarea", { "data-field": "es_observations", rows: "5", placeholder: "1. ...\n2. ...\n3. ..." }));
  }
  function autoSpan(id) { return el("span", { class: "auto", id: "rf_" + id }, ["—"]); }

  /* ---- 2. Grade-wise ---- */
  function buildGradeSummary() {
    var s = section("2. Grade-Wise Academic Performance Summary");
    var t = el("table", { class: "data", id: "rf_grade" });
    t.appendChild(thead(["Grade", "Overall Average %", "Highest %", "Lowest %", "Students <40%", "Attendance %"]));
    var tb = el("tbody");
    GRADES_ALL.forEach(function (g) {
      var p = "gs_" + g + "_";
      tb.appendChild(el("tr", null, [
        el("td", { class: "lbl" }, [String(g)]),
        td(ti(p + "avg", { numeric: true, calc: "grade" })),
        td(ti(p + "high", { numeric: true, calc: "grade" })),
        td(ti(p + "low", { numeric: true, calc: "grade" })),
        td(ti(p + "below", { numeric: true, calc: "grade" })),
        td(ti(p + "att", { numeric: true, calc: "grade" })),
      ]));
    });
    t.appendChild(tb);
    t.appendChild(el("tfoot", null, [el("tr", { class: "total" }, [
      el("th", null, ["School"]),
      totalTd("gs_avg"), totalTd("gs_high"), totalTd("gs_low"), totalTd("gs_below"), totalTd("gs_att"),
    ])]));
    s.appendChild(t);
    s.appendChild(el("p", { class: "hint no-print" }, ["The School row is calculated automatically."]));
  }

  /* ---- 3 & 4 subject tables ---- */
  function buildSubjectSection(title, grades, subjects, prefix) {
    var s = section(title);
    grades.forEach(function (g) {
      s.appendChild(el("h3", { class: "rf-grade-h" }, ["Grade " + g]));
      var t = el("table", { class: "data" });
      t.appendChild(thead(["Subject", "Average %", "Highest", "Lowest", "Students <40%", "Action Plan / Students Requiring Action"]));
      var tb = el("tbody");
      subjects.forEach(function (name, idx) {
        var p = prefix + "_" + g + "_" + idx + "_";
        tb.appendChild(el("tr", null, [
          el("td", { class: "lbl left" }, [name]),
          td(ti(p + "avg", { numeric: true, calc: "subject", subject: name })),
          td(ti(p + "high", { numeric: true })),
          td(ti(p + "low", { numeric: true })),
          td(ti(p + "below", { numeric: true })),
          td(ti(p + "action", { left: true, list: "rf_dl_actions" })),
        ]));
      });
      t.appendChild(tb);
      s.appendChild(t);
    });
  }

  /* ---- 5 nursery ---- */
  function buildNursery() {
    var s = section("5. Nursery Section Summary");
    var t = el("table", { class: "data" });
    t.appendChild(thead(["Class", "No. of Students", "English Writing Well", "English Reading Well", "Activity Smart", "Need to Improve – Students"]));
    var tb = el("tbody");
    NURSERY_CLASSES.forEach(function (c, idx) {
      var p = "nur_" + idx + "_";
      tb.appendChild(el("tr", null, [
        el("td", { class: "lbl" }, [c]),
        td(ti(p + "count", { numeric: true })), td(ti(p + "writing", { numeric: true })),
        td(ti(p + "reading", { numeric: true })), td(ti(p + "activity", { numeric: true })),
        td(ti(p + "improve", { left: true })),
      ]));
    });
    t.appendChild(tb); s.appendChild(t);
  }

  /* ---- 6 periodic test ---- */
  function buildPeriodicTest() {
    var s = section("6. Periodic Test / Assessment Report");
    var t = el("table", { class: "kv" }); var tb = el("tbody");
    function row(th, td) { tb.appendChild(el("tr", null, [el("th", null, [th]), el("td", null, td)])); }
    row("PT conducted this month – Date(s)", [ti("pt_date", { placeholder: "e.g. 16-01-2026 to 21-01-2026" })]);
    row("Blueprint followed (CBSE pattern)?", [sel("pt_blueprint", ["Yes", "No"])]);
    row("Question paper moderation done?", [ti("pt_moderation", { list: "rf_dl_yesdetail", placeholder: "e.g. Yes – moderated by subject heads" })]);
    row("Average school score: Nursery to Grade 1", [ti("pt_avg1", { numeric: true }), document.createTextNode(" %")]);
    row("Average school score: Grade 2 to 5", [ti("pt_avg2", { numeric: true }), document.createTextNode(" %")]);
    row("Average school score: Grade 6 to 9", [ti("pt_avg3", { numeric: true }), document.createTextNode(" %")]);
    row("No. of students below 40%", [autoSpan("pt_below40")]);
    t.appendChild(tb); s.appendChild(t);
    s.appendChild(el("label", { class: "rf-block" }, ["Exam Quality Review Remarks:"]));
    s.appendChild(el("textarea", { "data-field": "pt_remarks", rows: "3" }));
  }

  /* ---- 7 syllabus ---- */
  function buildSyllabus() {
    var s = section("7. Syllabus Completion Status");
    var t = el("table", { class: "data" });
    t.appendChild(thead(["Grade", "No. of Subjects", "% Completed", "On Track (Y/N)", "Delay Reason"]));
    var tb = el("tbody");
    SYLLABUS_GRADES.forEach(function (g, idx) {
      var p = "syl_" + idx + "_";
      tb.appendChild(el("tr", null, [
        el("td", { class: "lbl" }, [g]),
        td(ti(p + "subjects", { numeric: true })), td(ti(p + "pct", { numeric: true })),
        td(sel(p + "ontrack", ["Y", "N"])), td(ti(p + "reason", { left: true })),
      ]));
    });
    t.appendChild(tb); s.appendChild(t);
    s.appendChild(el("label", { class: "rf-block" }, ["Recovery plan:"]));
    s.appendChild(el("textarea", { "data-field": "syl_recovery", rows: "2" }));
  }

  /* ---- 8 slow learner ---- */
  function buildSlowLearner() {
    var s = section("8. Slow Learner Monitoring");
    var t = el("table", { class: "data", id: "rf_slow" });
    t.appendChild(thead(["Grade", "No. of Students <40%", "Remedial Classes (Hours)", "Parent Informed (Y/N)", "Improvement %"]));
    var tb = el("tbody");
    SLOW_GRADES.forEach(function (g, idx) {
      var p = "sl_" + idx + "_";
      tb.appendChild(el("tr", null, [
        el("td", { class: "lbl" }, [g]),
        td(ti(p + "below", { numeric: true, calc: "slow" })), td(ti(p + "hours", { numeric: true, calc: "slow" })),
        td(sel(p + "parent", ["Y", "N"])), td(ti(p + "improve", { numeric: true, calc: "slow" })),
      ]));
    });
    t.appendChild(tb);
    t.appendChild(el("tfoot", null, [el("tr", { class: "total" }, [
      el("th", null, ["Total"]), totalTd("sl_below"), totalTd("sl_hours"), el("td", null, ["—"]),
      el("td", null, [el("span", { class: "auto", "data-total": "sl_improve" }, ["—"]), document.createTextNode(" (avg.)")]),
    ])]));
    s.appendChild(t);
  }

  /* ---- 9 special monitoring: Grade 9, 10, 11 ---- */
  function buildSpecialMonitoring() {
    var s = section("9. Special Monitoring (Grade 9 – 11)", "board / higher-grade focus");
    SM_GRADES.forEach(function (g) {
      var pre = "sm" + g + "_";
      var block = el("div", { class: "sm-block", id: "rf_smblock_" + g });
      block.appendChild(el("div", { class: "sm-head" }, [
        el("h3", { class: "rf-grade-h" }, ["Grade " + g]),
        el("label", { class: "rf-check no-print" }, [
          el("input", { type: "checkbox", "data-field": pre + "na", id: "rf_" + pre + "na" }),
          " Not Applicable (Grade " + g + " not commenced)",
        ]),
      ]));
      var wrap = el("div", { id: "rf_" + pre + "wrap" });
      var t = el("table", { class: "data" });
      t.appendChild(thead(["Subject", "Average %", "Students <50%", "Extra Coaching Hours", "Risk Category Students"]));
      var tb = el("tbody");
      for (var r = 0; r < SM_ROWS; r++) {
        var p = pre + r + "_";
        tb.appendChild(el("tr", null, [
          td(ti(p + "subject", { left: true })), td(ti(p + "avg", { numeric: true })),
          td(ti(p + "below50", { numeric: true })), td(ti(p + "hours", { numeric: true })),
          td(ti(p + "risk", { left: true })),
        ]));
      }
      t.appendChild(tb); wrap.appendChild(t);
      wrap.appendChild(el("label", { class: "rf-block" }, ["Board / Exam Readiness Status: "]));
      wrap.appendChild(sel(pre + "readiness", ["Safe", "Moderate Risk", "High Risk"]));
      block.appendChild(wrap);
      block.appendChild(el("p", { class: "na-note", id: "rf_" + pre + "na_note" }, ["NOT APPLICABLE – Grade " + g + " has not commenced. Fill from the year this batch begins."]));
      s.appendChild(block);
    });
  }
  function toggleSM() {
    SM_GRADES.forEach(function (g) {
      var cb = q("#rf_sm" + g + "_na");
      if (!cb) return;
      var na = cb.checked;
      var w = q("#rf_sm" + g + "_wrap");
      var n = q("#rf_sm" + g + "_na_note");
      if (w) w.style.display = na ? "none" : "";
      if (n) n.style.display = na ? "block" : "none";
    });
  }

  /* ---- 10 teacher ---- */
  function buildTeacher() {
    var s = section("10. Teacher Academic Accountability");
    var t = el("table", { class: "data", id: "rf_teacher" });
    t.appendChild(thead(["#", "Teacher Name", "Subject", "Section", "Avg Result %", "Lesson Plan Submitted", "Correction Status", "Remarks", ""], true));
    t.appendChild(el("tbody"));
    s.appendChild(t);
    s.appendChild(el("button", { type: "button", class: "btn small add no-print", "data-add": "teacher" }, ["+ Add teacher"]));
    t.querySelector("tbody").appendChild(teacherRow());
  }
  function teacherRow(d) {
    d = d || {};
    var lp = sel(null, ["Yes", "No"], d.lessonPlan || "Yes"); lp.dataset.role = "lessonPlan"; lp.removeAttribute("data-field");
    var tr = el("tr", { class: "dyn" }, [
      el("td", { class: "ridx" }, []),
      dcell(d.name, true), dcell(d.subject, true, false, null, "rf_dl_subjects"), dcell(d.section, true, false, null, "rf_dl_sections"), dcell(d.avg, false, true),
      el("td", null, [lp]), dcell(d.correction, true, false, null, "rf_dl_correction"), dcell(d.remarks, true), delCell(),
    ]);
    return tr;
  }

  /* ---- 11 best teacher ---- */
  function buildBestTeacher() {
    var s = section("11. Best Teacher of the Month", "(ranked automatically by total marks)");
    var t = el("table", { class: "data", id: "rf_best" });
    t.appendChild(thead(["Teacher Name", "Teaching Effectiveness (30)", "Engagement & Discipline (20)", "Academic Perf. / Improvement (20)", "Prof. Discipline & Attendance (10)", "Innovation & Contribution (10)", "Parent / Student Feedback (10)", "Total (100)", "Rank", ""], true));
    t.appendChild(el("tbody"));
    s.appendChild(t);
    s.appendChild(el("button", { type: "button", class: "btn small add no-print", "data-add": "bestTeacher" }, ["+ Add teacher"]));
    s.appendChild(el("label", { class: "rf-block" }, ["Selection remarks:"]));
    s.appendChild(el("textarea", { "data-field": "bt_remarks", rows: "2" }));
    t.querySelector("tbody").appendChild(bestTeacherRow());
  }
  function bestTeacherRow(d) {
    d = d || {};
    var tr = el("tr", { class: "dyn bt" });
    tr.appendChild(dcell(d.name, true));
    ["te", "en", "ac", "pd", "in", "pf"].forEach(function (k) { tr.appendChild(dcell(d[k], false, true, "bt-score")); });
    tr.appendChild(el("td", null, [el("span", { class: "auto bt-total" }, ["—"])]));
    tr.appendChild(el("td", null, [el("span", { class: "auto bt-rank" }, ["—"])]));
    tr.appendChild(delCell());
    return tr;
  }

  /* ---- 12 discipline ---- */
  function buildDiscipline() {
    var s = section("12. Academic Discipline & Engagement");
    var t = el("table", { class: "kv" }); var tb = el("tbody");
    function row(th, td) { tb.appendChild(el("tr", null, [el("th", null, [th]), el("td", null, td)])); }
    row("Student Attendance % (Overall)", [ti("de_attendance", { numeric: true }), document.createTextNode(" %")]);
    row("Chronic Absentees", [ti("de_absentees", { placeholder: "e.g. 9 students below 60% attendance" })]);
    row("Lab Practical Completion (Grade 6 – 8)", [ti("de_lab", { list: "rf_dl_yesdetail", placeholder: "e.g. Yes – 14 practicals" })]);
    row("Subject Enrichment Activities Conducted", [ti("de_enrichment", { list: "rf_dl_yesno" })]);
    row("PTM Conducted", [ti("de_ptm", { list: "rf_dl_yesdetail", placeholder: "e.g. Yes – on 24-01-2026" })]);
    row("Parent Attendance %", [ti("de_parentAtt")]);
    row("Field Trips", [ti("de_fieldtrips")]);
    row("Activities: Nursery to Grade 1", [ti("de_act1", { numeric: true })]);
    row("Activities: Grade 2 to 5", [ti("de_act2", { numeric: true })]);
    row("Activities: Grade 6 to 9", [ti("de_act3", { numeric: true })]);
    t.appendChild(tb); s.appendChild(t);
    s.appendChild(el("label", { class: "rf-block" }, ["Major Comments from Parents (PTM):"]));
    s.appendChild(el("textarea", { "data-field": "de_parentComments", rows: "3" }));
    s.appendChild(el("label", { class: "rf-block" }, ["Academic Activities Conducted:"]));
    var at = el("table", { class: "data" });
    at.appendChild(thead(["Section", "Activities"]));
    var atb = el("tbody");
    ACTIVITY_SECTIONS.forEach(function (name, idx) {
      atb.appendChild(el("tr", null, [el("td", { class: "lbl" }, [name]), td(ti("act_" + idx, { left: true }))]));
    });
    at.appendChild(atb); s.appendChild(at);
  }

  /* ---- 13 external / competitive exams (olympiads) ---- */
  function buildExternalExams() {
    var s = section("13. External / Competitive Exams (Olympiads & Assessments)", "as per participating bodies");
    var t = el("table", { class: "kv" }); var tb = el("tbody");
    tb.appendChild(el("tr", null, [el("th", null, ["Olympiad / Exam Coordinator"]), el("td", null, [ti("ext_coordinator", { placeholder: "e.g. Academic Head / Math HOD" })])]));
    tb.appendChild(el("tr", null, [el("th", null, ["Overall Participation Status"]), el("td", null, [sel("ext_overall", ["Planning", "Registration Open", "Registered", "Exams Scheduled", "Completed", "Not Participating"])])]));
    t.appendChild(tb); s.appendChild(t);

    var et = el("table", { class: "data", id: "rf_extexam" });
    et.appendChild(thead(["Exam", "Organization", "Grades", "Registration Status", "Scheduled / Exam Date", "Students Registered", "Remarks", ""], true));
    et.appendChild(el("tbody"));
    s.appendChild(et);
    s.appendChild(el("button", { type: "button", class: "btn small add no-print", "data-add": "extExam" }, ["+ Add exam"]));
    // seed default olympiad list
    var body = et.querySelector("tbody");
    OLYMPIAD_DEFAULTS.forEach(function (d) { body.appendChild(extExamRow(d)); });
  }
  function extExamRow(d) {
    d = d || {};
    var st = sel(null, OLYMPIAD_STATUS, d.status || "Not Started"); st.dataset.role = "examstatus"; st.removeAttribute("data-field");
    return el("tr", { class: "dyn" }, [
      dcell(d.exam, true), dcell(d.org, true), dcell(d.grades), el("td", null, [st]),
      dcell(d.date), dcell(d.registered, false, true), dcell(d.remarks, true), delCell(),
    ]);
  }

  /* ---- 14 abacus programme ---- */
  function buildAbacus() {
    var s = section("14. Abacus Programme", "grade-wise progress");
    var t = el("table", { class: "data", id: "rf_abacus" });
    t.appendChild(thead(["Grade", "Classes Conducted", "Students Enrolled", "Students Performing Well", "Top Performers / Remarks"]));
    var tb = el("tbody");
    ABACUS_GRADES.forEach(function (g, idx) {
      var p = "abc_" + idx + "_";
      tb.appendChild(el("tr", null, [
        el("td", { class: "lbl" }, [g]),
        td(ti(p + "classes", { numeric: true, calc: "abacus" })),
        td(ti(p + "enrolled", { numeric: true, calc: "abacus" })),
        td(ti(p + "well", { numeric: true, calc: "abacus" })),
        td(ti(p + "remarks", { left: true })),
      ]));
    });
    t.appendChild(tb);
    t.appendChild(el("tfoot", null, [el("tr", { class: "total" }, [
      el("th", null, ["Total"]), totalTd("abc_classes"), totalTd("abc_enrolled"), totalTd("abc_well"), el("td", null, ["—"]),
    ])]));
    s.appendChild(t);
  }

  /* ---- 15 action plan ---- */
  function buildActionPlan() {
    var s = section("15. Action Plan for Next Month");
    var t = el("table", { class: "data", id: "rf_action" });
    t.appendChild(thead(["#", "Action Point", "Responsibility", "Target Date", ""], true));
    t.appendChild(el("tbody"));
    s.appendChild(t);
    s.appendChild(el("button", { type: "button", class: "btn small add no-print", "data-add": "action" }, ["+ Add action point"]));
    t.querySelector("tbody").appendChild(actionRow());
  }
  function actionRow(d) {
    d = d || {};
    return el("tr", { class: "dyn" }, [el("td", { class: "ridx" }, []), dcell(d.point, true), dcell(d.responsibility, true), dcell(d.target, true), delCell()]);
  }

  /* ---- signatures ---- */
  function buildSignatures() {
    var wrapper = el("section", { class: "rf-section" });
    var loc = el("div", { class: "rf-locbar" }, [
      el("label", { class: "rf-metafield" }, ["Location / Place", ti("sign_location", { placeholder: "e.g. Cheranmahadevi" })]),
      el("label", { class: "rf-metafield" }, ["Report Date", ti("sign_reportDate", { placeholder: "e.g. 03 February 2026" })]),
    ]);
    wrapper.appendChild(loc);
    var s = el("div", { class: "rf-sign" });
    s.appendChild(signBox("Prepared and Submitted by", "sign_principal", "Principal name", "Principal", "sign_principalDate"));
    s.appendChild(signBox("Received / Reviewed by", "sign_chairman", "Chairman", "Chairman", "sign_chairmanDate"));
    wrapper.appendChild(s);
    root.appendChild(wrapper);
  }
  function signBox(top, nameField, ph, role, dateField) {
    return el("div", { class: "sign-box" }, [
      el("div", { class: "sign-line" }, []), el("div", null, [top]),
      el("div", null, [ti(nameField, { placeholder: ph })]), el("div", null, [role]),
      el("div", null, ["Date: ", ti(dateField)]),
    ]);
  }

  /* ---- shared cell helpers ---- */
  function thead(cols, lastNoPrint) {
    var tr = el("tr");
    cols.forEach(function (c, i) {
      var th = el("th", null, [c]);
      if (lastNoPrint && i === cols.length - 1) th.className = "no-print";
      tr.appendChild(th);
    });
    return el("thead", null, [tr]);
  }
  function td(child) { return el("td", null, [child]); }
  function totalTd(key) { return el("td", null, [el("span", { class: "auto", "data-total": key }, ["—"])]); }
  function dcell(val, left, numeric, cls, list) {
    var i = el("input", { type: "text" });
    var c = [];
    if (left) c.push("text-left");
    if (cls) c.push(cls);
    if (c.length) i.className = c.join(" ");
    if (numeric) i.setAttribute("inputmode", "decimal");
    if (list) i.setAttribute("list", list);
    if (val != null) i.value = val;
    i.dataset.dyn = "1";
    return el("td", null, [i]);
  }
  function delCell() {
    var b = el("button", { type: "button", class: "delrow no-print", title: "Remove" }, ["✕"]);
    b.addEventListener("click", function () { var tr = b.closest("tr"); tr.parentNode.removeChild(tr); reindex(); recalc(); onChange(); });
    return el("td", { class: "no-print" }, [b]);
  }
  function reindex() {
    root.querySelectorAll("#rf_teacher tbody tr").forEach(function (tr, i) { var c = tr.querySelector(".ridx"); if (c) c.textContent = i + 1; });
    root.querySelectorAll("#rf_action tbody tr").forEach(function (tr, i) { var c = tr.querySelector(".ridx"); if (c) c.textContent = i + 1; });
  }

  /* ================= auto-calc ================= */
  function val(field) { var e = root.querySelector('[data-field="' + field + '"]'); return e ? e.value : ""; }
  function setAuto(id, text) { var e = root.querySelector("#rf_" + id); if (e) e.textContent = text; }
  function setTotal(k, v) { var e = root.querySelector('[data-total="' + k + '"]'); if (e) e.textContent = v == null ? "—" : String(v); }

  function recalc() {
    var avgs = [], highs = [], lows = [], belows = [], atts = [];
    GRADES_ALL.forEach(function (g) {
      var a = num(val("gs_" + g + "_avg")); if (a != null) avgs.push(a);
      var h = num(val("gs_" + g + "_high")); if (h != null) highs.push(h);
      var l = num(val("gs_" + g + "_low")); if (l != null) lows.push(l);
      var b = num(val("gs_" + g + "_below")); if (b != null) belows.push(b);
      var t = num(val("gs_" + g + "_att")); if (t != null) atts.push(t);
    });
    var schoolAvg = avgs.length ? r1(avg(avgs)) : null;
    var totalBelow = belows.length ? sum(belows) : null;
    setTotal("gs_avg", schoolAvg);
    setTotal("gs_high", highs.length ? Math.max.apply(null, highs) : null);
    setTotal("gs_low", lows.length ? Math.min.apply(null, lows) : null);
    setTotal("gs_below", totalBelow);
    setTotal("gs_att", atts.length ? r1(avg(atts)) : null);

    setAuto("es_overall", schoolAvg != null ? schoolAvg + " %" : "—");
    var best = null, weak = null;
    GRADES_ALL.forEach(function (g) {
      var a = num(val("gs_" + g + "_avg")); if (a == null) return;
      if (!best || a > best.v) best = { g: g, v: a };
      if (!weak || a < weak.v) weak = { g: g, v: a };
    });
    setAuto("es_bestGrade", best ? "Grade " + best.g + " (" + r1(best.v) + " %)" : "—");
    setAuto("es_weakGrade", weak ? "Grade " + weak.g + " (" + r1(weak.v) + " %)" : "—");
    setAuto("es_below40", totalBelow != null ? String(totalBelow) : "—");
    setAuto("pt_below40", totalBelow != null ? String(totalBelow) : "—");

    var subjAgg = {};
    root.querySelectorAll('input[data-calc="subject"]').forEach(function (i) {
      var name = i.getAttribute("data-subject"); var v = num(i.value);
      if (!name || v == null) return;
      (subjAgg[name] = subjAgg[name] || []).push(v);
    });
    var bestS = null, weakS = null;
    Object.keys(subjAgg).forEach(function (s) {
      var a = avg(subjAgg[s]);
      if (!bestS || a > bestS.v) bestS = { s: s, v: a };
      if (!weakS || a < weakS.v) weakS = { s: s, v: a };
    });
    setAuto("es_bestSubject", bestS ? bestS.s + " (" + r1(bestS.v) + " %)" : "—");
    setAuto("es_weakSubject", weakS ? weakS.s + " (" + r1(weakS.v) + " %)" : "—");

    var slB = [], slH = [], slI = [];
    for (var i = 0; i < SLOW_GRADES.length; i++) {
      var p = "sl_" + i + "_";
      var b = num(val(p + "below")); if (b != null) slB.push(b);
      var h = num(val(p + "hours")); if (h != null) slH.push(h);
      var im = num(val(p + "improve")); if (im != null) slI.push(im);
    }
    setTotal("sl_below", slB.length ? sum(slB) : null);
    setTotal("sl_hours", slH.length ? sum(slH) : null);
    setTotal("sl_improve", slI.length ? r1(avg(slI)) : null);

    var rows = Array.prototype.slice.call(root.querySelectorAll("#rf_best tbody tr"));
    var scored = [];
    rows.forEach(function (tr) {
      var scores = Array.prototype.slice.call(tr.querySelectorAll(".bt-score")).map(function (i) { return num(i.value) || 0; });
      var total = sum(scores);
      var any = tr.querySelector(".bt-score") && (tr.querySelector(".bt-score").value !== "" || scores.some(function (x) { return x > 0; }));
      tr.querySelector(".bt-total").textContent = any ? String(total) : "—";
      scored.push({ tr: tr, total: total, any: any });
    });
    var ranked = scored.filter(function (r) { return r.any; }).slice().sort(function (a, b) { return b.total - a.total; });
    scored.forEach(function (r) { r.tr.querySelector(".bt-rank").textContent = "—"; });
    ranked.forEach(function (r, i) { r.tr.querySelector(".bt-rank").textContent = ordinal(i + 1); });

    // ---- Abacus totals ----
    var abC = [], abE = [], abW = [];
    for (var a = 0; a < ABACUS_GRADES.length; a++) {
      var ap = "abc_" + a + "_";
      var c = num(val(ap + "classes")); if (c != null) abC.push(c);
      var e = num(val(ap + "enrolled")); if (e != null) abE.push(e);
      var w = num(val(ap + "well")); if (w != null) abW.push(w);
    }
    setTotal("abc_classes", abC.length ? sum(abC) : null);
    setTotal("abc_enrolled", abE.length ? sum(abE) : null);
    setTotal("abc_well", abW.length ? sum(abW) : null);
  }

  /* ================= get / set ================= */
  function getData() {
    var state = { fields: {}, teachers: [], bestTeachers: [], actions: [] };
    root.querySelectorAll("[data-field]").forEach(function (e) {
      state.fields[e.getAttribute("data-field")] = e.type === "checkbox" ? e.checked : e.value;
    });
    root.querySelectorAll("#rf_teacher tbody tr").forEach(function (tr) {
      var t = tr.querySelectorAll("input[data-dyn]"); var lp = tr.querySelector('select[data-role="lessonPlan"]');
      state.teachers.push({ name: t[0].value, subject: t[1].value, section: t[2].value, avg: t[3].value, lessonPlan: lp ? lp.value : "Yes", correction: t[4].value, remarks: t[5].value });
    });
    root.querySelectorAll("#rf_best tbody tr").forEach(function (tr) {
      var t = tr.querySelectorAll("input[data-dyn]");
      state.bestTeachers.push({ name: t[0].value, te: t[1].value, en: t[2].value, ac: t[3].value, pd: t[4].value, "in": t[5].value, pf: t[6].value });
    });
    root.querySelectorAll("#rf_action tbody tr").forEach(function (tr) {
      var t = tr.querySelectorAll("input[data-dyn]");
      state.actions.push({ point: t[0].value, responsibility: t[1].value, target: t[2].value });
    });
    state.externalExams = [];
    root.querySelectorAll("#rf_extexam tbody tr").forEach(function (tr) {
      var t = tr.querySelectorAll("input[data-dyn]");
      var st = tr.querySelector('select[data-role="examstatus"]');
      state.externalExams.push({ exam: t[0].value, org: t[1].value, grades: t[2].value, status: st ? st.value : "", date: t[3].value, registered: t[4].value, remarks: t[5].value });
    });
    return state;
  }

  function setData(state) {
    state = state || {};
    Object.keys(state.fields || {}).forEach(function (k) {
      var e = root.querySelector('[data-field="' + k + '"]');
      if (!e) return;
      if (e.type === "checkbox") e.checked = !!state.fields[k];
      else e.value = state.fields[k];
    });
    rebuild("#rf_teacher tbody", state.teachers, teacherRow);
    rebuild("#rf_best tbody", state.bestTeachers, bestTeacherRow);
    rebuild("#rf_action tbody", state.actions, actionRow);
    rebuild("#rf_extexam tbody", (state.externalExams && state.externalExams.length ? state.externalExams : OLYMPIAD_DEFAULTS), extExamRow);
    if (state.teachers) root.querySelectorAll("#rf_teacher tbody tr").forEach(function (tr, i) {
      var s = tr.querySelector('select[data-role="lessonPlan"]'); if (s && state.teachers[i]) s.value = state.teachers[i].lessonPlan || "Yes";
    });
    toggleSM(); reindex(); recalc();
    if (readOnly) lockDown();
  }
  function rebuild(selc, arr, factory) {
    var tb = q(selc); tb.innerHTML = "";
    (arr && arr.length ? arr : [null]).forEach(function (d) { tb.appendChild(factory(d)); });
  }

  function lockDown() {
    root.querySelectorAll("input, select, textarea").forEach(function (e) {
      if (e.type === "checkbox") e.disabled = true;
      else { e.setAttribute("readonly", "readonly"); if (e.tagName === "SELECT") e.disabled = true; }
    });
    root.querySelectorAll(".add, .delrow").forEach(function (b) { b.style.display = "none"; });
  }

  return { build: build, getData: getData, setData: setData, recalc: recalc };
})();
