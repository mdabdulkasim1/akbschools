"use strict";
/**
 * Convert reports and dashboard data into worksheet definitions for lib/xlsx.
 */
const num = (v) => {
  if (v === null || v === undefined || v === "") return "";
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? String(v) : n;
};

function reportToSheets(report, schoolName) {
  const f = (report.data && report.data.fields) || {};
  const k = report.kpis || {};
  const grades = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // ---- Summary sheet ----
  const summary = [
    ["Monthly Principal Academic Report"],
    ["School", schoolName || ""],
    ["Month", report.month || ""],
    ["Academic Year", report.academicYear || ""],
    ["Status", report.status || ""],
    ["Submitted", report.submittedAt || ""],
    ["Reviewed", report.reviewedAt || ""],
    [],
    ["Key Indicator", "Value"],
    ["Overall School Average (%)", k.overallAvg == null ? "" : k.overallAvg],
    ["Overall Attendance (%)", k.attendance == null ? "" : k.attendance],
    ["Students below 40%", k.below40 == null ? "" : k.below40],
    ["Syllabus completion (%)", k.syllabusAvg == null ? "" : k.syllabusAvg],
    ["Best grade", k.bestGrade ? `Grade ${k.bestGrade.grade} (${k.bestGrade.value}%)` : ""],
    ["Weakest grade", k.weakGrade ? `Grade ${k.weakGrade.grade} (${k.weakGrade.value}%)` : ""],
    ["Best subject", k.bestSubject ? `${k.bestSubject.name} (${k.bestSubject.value}%)` : ""],
    ["Weakest subject", k.weakSubject ? `${k.weakSubject.name} (${k.weakSubject.value}%)` : ""],
    ["Best teacher", k.bestTeacher ? `${k.bestTeacher.name} (${k.bestTeacher.total}/100)` : ""],
    ["Abacus classes conducted", k.abacusClasses == null ? "" : k.abacusClasses],
    ["Abacus students performing well", k.abacusWell == null ? "" : k.abacusWell],
    ["Olympiad exams registered", k.olympiadsRegistered == null ? "" : k.olympiadsRegistered],
    ["Olympiad exams scheduled", k.olympiadsScheduled == null ? "" : k.olympiadsScheduled],
    ["Board readiness (Gr 9-12)", k.boardReadiness || ""],
    ["Chairman remarks", report.chairmanRemarks || ""],
  ];

  // ---- Grade-wise ----
  const gradeRows = [["Grade", "Average %", "Highest %", "Lowest %", "Students <40%", "Attendance %"]];
  grades.forEach((g) => {
    gradeRows.push([
      "Grade " + g,
      num(f[`gs_${g}_avg`]), num(f[`gs_${g}_high`]), num(f[`gs_${g}_low`]),
      num(f[`gs_${g}_below`]), num(f[`gs_${g}_att`]),
    ]);
  });

  // ---- Teachers ----
  const teacherRows = [["#", "Teacher", "Subject", "Section", "Avg %", "Lesson Plan", "Correction", "Remarks"]];
  (report.data.teachers || []).forEach((t, i) => {
    teacherRows.push([i + 1, t.name || "", t.subject || "", t.section || "", num(t.avg), t.lessonPlan || "", t.correction || "", t.remarks || ""]);
  });

  // ---- Best teacher ----
  const btRows = [["Teacher", "Teaching(30)", "Engagement(20)", "Academic(20)", "Discipline(10)", "Innovation(10)", "Feedback(10)", "Total(100)"]];
  (report.data.bestTeachers || []).forEach((t) => {
    const total = ["te", "en", "ac", "pd", "in", "pf"].reduce((s, key) => s + (Number(num(t[key])) || 0), 0);
    btRows.push([t.name || "", num(t.te), num(t.en), num(t.ac), num(t.pd), num(t["in"]), num(t.pf), total]);
  });

  // ---- Abacus ----
  const abRows = [["Grade", "Classes Conducted", "Students Enrolled", "Performing Well", "Remarks"]];
  grades.forEach((g, i) => {
    abRows.push(["Grade " + g, num(f[`abc_${i}_classes`]), num(f[`abc_${i}_enrolled`]), num(f[`abc_${i}_well`]), f[`abc_${i}_remarks`] || ""]);
  });

  // ---- External exams ----
  const exRows = [["Exam", "Organization", "Grades", "Registration Status", "Scheduled / Exam Date", "Registered", "Remarks"]];
  (report.data.externalExams || []).forEach((x) => {
    exRows.push([x.exam || "", x.org || "", x.grades || "", x.status || "", x.date || "", num(x.registered), x.remarks || ""]);
  });

  return [
    { name: "Summary", rows: summary },
    { name: "Grade-Wise", rows: gradeRows },
    { name: "Teachers", rows: teacherRows },
    { name: "Best Teacher", rows: btRows },
    { name: "Abacus", rows: abRows },
    { name: "External Exams", rows: exRows },
  ];
}

function dashboardToSheets(dash, selectedMonth) {
  const cards = dash.schoolCards || [];

  const summary = [["Chairman Dashboard — " + (selectedMonth || "Latest")], []];
  summary.push(["School", "Place", "Month", "Average %", "Attendance %", "Students <40%", "Syllabus %", "Abacus classes", "Abacus well", "Olympiads scheduled", "Board readiness"]);
  cards.forEach((c) => {
    summary.push([
      c.name, c.place || "", c.latestMonth || "",
      c.overallAvg == null ? "" : c.overallAvg,
      c.attendance == null ? "" : c.attendance,
      c.below40 == null ? "" : c.below40,
      c.syllabusAvg == null ? "" : c.syllabusAvg,
      c.abacusClasses == null ? "" : c.abacusClasses,
      c.abacusWell == null ? "" : c.abacusWell,
      c.olympiadsScheduled == null ? "" : c.olympiadsScheduled,
      c.boardReadiness || "",
    ]);
  });

  // Comparison sheet
  const cmp = [["Month-on-Month Comparison"], ["Current month", dash.selectedMonth || ""], ["Previous month", dash.prevMonth || ""], []];
  cmp.push(["School", "Metric", "Current", "Previous", "Change"]);
  (dash.comparison || []).forEach((row) => {
    const metrics = [
      ["Overall average %", row.current.overallAvg, row.previous.overallAvg],
      ["Attendance %", row.current.attendance, row.previous.attendance],
      ["Students <40%", row.current.below40, row.previous.below40],
      ["Syllabus %", row.current.syllabusAvg, row.previous.syllabusAvg],
      ["Abacus classes", row.current.abacusClasses, row.previous.abacusClasses],
    ];
    metrics.forEach(([label, cur, prev]) => {
      const delta = cur != null && prev != null ? Math.round((cur - prev) * 10) / 10 : "";
      cmp.push([row.name, label, cur == null ? "" : cur, prev == null ? "" : prev, delta]);
    });
  });

  return [
    { name: "Summary", rows: summary },
    { name: "Comparison", rows: cmp },
  ];
}

function usersToSheets(users) {
  const rows = [["Name", "Username", "Role", "School", "Status"]];
  users.forEach((u) => {
    rows.push([u.name || "", u.username || "", u.role === "admin" ? "Chairman" : "Principal", u.schoolName || "", u.active === false ? "Disabled" : "Active"]);
  });
  return [{ name: "Users", rows }];
}

module.exports = { reportToSheets, dashboardToSheets, usersToSheets };
