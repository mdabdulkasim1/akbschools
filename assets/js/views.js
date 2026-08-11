/* ===== AKB Fee Collection — views ===== */
(function (w) {
  'use strict';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const view = () => document.getElementById('view');

  function statusBadge(bal, total) {
    if (total === 0) return '<span class="badge gray">No fee</span>';
    if (bal <= 0) return '<span class="badge green">Paid</span>';
    if (bal >= total) return '<span class="badge red">Pending</span>';
    return '<span class="badge amber">Partial</span>';
  }

  // Fee-balance reminder message + WhatsApp/SMS click-to-send buttons
  function reminderText(s) {
    const t = Store.studentTotals(s);
    const school = (Store.meta && Store.meta.school) || 'AKB School of Excellence';
    const parts = Store.HEAD_ORDER.filter(k => (s.fees[k] || {}).balance > 0)
      .map(k => Store.HEAD_LABELS[k] + ' ' + U.inr((s.fees[k] || {}).balance)).join(', ');
    return 'Dear Parent, Fee reminder from ' + school + ' for ' + s.name + (s.grade ? ' (' + s.grade + ')' : '') +
      '. Outstanding balance: ' + U.inr(t.balance) + (parts ? ' — ' + parts : '') +
      '. Kindly clear the pending fees at the earliest. Thank you.';
  }
  function remindButtons(s) {
    if (!s.contact || Store.studentTotals(s).balance <= 0) return '';
    const txt = reminderText(s);
    return `<a class="btn wa" target="_blank" rel="noopener" href="${U.waLink(s.contact, txt)}" title="Open WhatsApp with the reminder">💬 WhatsApp</a>` +
      `<a class="btn" href="${U.smsLink(s.contact, txt)}" title="Send SMS reminder">✉️ SMS</a>`;
  }
  function remindIcon(s) {
    if (!s.contact || Store.studentTotals(s).balance <= 0) return '';
    return `<a class="btn sm wa" target="_blank" rel="noopener" href="${U.waLink(s.contact, reminderText(s))}" title="WhatsApp reminder to ${U.esc(s.contact)}">💬</a> `;
  }
  // server-side WhatsApp API status (optional; used only if an API provider is configured), cached
  let _waStatus;
  function getWaStatus() {
    if (_waStatus) return _waStatus;
    _waStatus = fetch('api/wa-status').then(r => r.ok ? r.json() : { configured: false }).catch(() => ({ configured: false }));
    return _waStatus;
  }

  /* -------------------------------------------------- Dashboard */
  function dashboard() {
    const students = Store.students;
    const cats = Store.HEAD_ORDER.map(k => {
      let total = 0, paid = 0;
      students.forEach(s => { const h = s.fees[k]; if (h) { total += h.total; paid += h.paid; } });
      return { key: k, label: Store.HEAD_LABELS[k], total, paid, bal: total - paid };
    });
    const gt = cats.reduce((a, c) => a + c.total, 0);
    const gp = cats.reduce((a, c) => a + c.paid, 0);
    const gb = gt - gp;
    const defaulters = students.filter(s => Store.studentTotals(s).balance > 0).length;
    const today = U.todayISO();
    const todayPays = Store.payments.filter(p => p.date === today);
    const todaySum = todayPays.reduce((a, p) => a + p.amount, 0);
    const appCollected = Store.payments.reduce((a, p) => a + p.amount, 0);

    // business-wise summary (fees mapped to their business)
    const bizSum = Store.BUSINESS_ORDER.map(bk => {
      let total = 0, paid = 0;
      Store.HEAD_ORDER.forEach(k => { if (Store.businessOfHead(k) === bk) students.forEach(s => { const h = s.fees[k]; if (h) { total += h.total; paid += h.paid; } }); });
      return { bk, B: Store.BUSINESSES[bk], total, paid, bal: total - paid };
    });
    const bizCards = bizSum.map(b => `
      <div class="card link" data-nav="#/business/${b.bk}" style="border-left:4px solid ${b.B.color}">
        <div class="biz-head"><img class="biz-logo" src="${b.B.logo}" alt=""/><div class="k" style="margin:0">${U.esc(b.B.name)}</div></div>
        <div class="v" style="font-size:20px">${U.inr(b.paid)}</div>
        <div class="sub">of ${U.inr(b.total)} · <span style="color:${b.bal > 0 ? 'var(--red)' : 'var(--green)'}">${U.inr(b.bal)} due</span></div>
      </div>`).join('');

    const byGrade = {};
    students.forEach(s => {
      const g = s.grade || '—'; const t = Store.studentTotals(s);
      byGrade[g] = byGrade[g] || { total: 0, paid: 0, bal: 0, n: 0 };
      byGrade[g].total += t.total; byGrade[g].paid += t.paid; byGrade[g].bal += t.balance; byGrade[g].n++;
    });
    const gradeRows = Object.keys(byGrade).sort().map(g => {
      const x = byGrade[g];
      return `<tr class="clickable" data-grade="${U.esc(g)}"><td>${U.esc(g)}</td><td class="num">${x.n}</td>
        <td class="num">${U.inr(x.total)}</td><td class="num">${U.inr(x.paid)}</td>
        <td class="num" style="color:${x.bal > 0 ? 'var(--red)' : 'var(--green)'}">${U.inr(x.bal)}</td></tr>`;
    }).join('');

    const catRows = cats.map(c => `
      <tr><td><b>${U.esc(c.label)}</b></td>
        <td class="num">${U.inr(c.total)}</td>
        <td class="num" style="color:var(--green)">${U.inr(c.paid)}</td>
        <td class="num" style="color:${c.bal > 0 ? 'var(--red)' : 'var(--muted)'};font-weight:600">${U.inr(c.bal)}</td>
        <td class="num">${c.total ? Math.round(c.paid / c.total * 100) : 0}%</td>
        <td style="width:120px"><div class="progress"><span style="width:${c.total ? Math.min(100, c.paid / c.total * 100) : 0}%"></span></div></td></tr>`).join('');

    const recent = Store.payments.slice().sort((a, b) => a.createdAt < b.createdAt ? 1 : -1).slice(0, 8)
      .map(p => `<tr class="clickable" data-rcpt="${p.id}"><td>${U.fmtDate(p.date)}</td>
        <td>${U.esc(p.studentName)}<div class="muted" style="font-size:11px">${U.esc(p.grade || '')}</div></td>
        <td><span class="pill-mode">${U.esc(p.mode)}</span></td>
        <td class="num" style="color:var(--green);font-weight:600">${U.inr(p.amount)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="empty">No payments recorded in the app yet. Use “Receive Payment”.</td></tr>';

    view().innerHTML = `
      <div class="page-head">
        <div><h1>Dashboard</h1><p>${U.esc(Store.meta.school || 'AKB School')} · Academic Year ${U.esc(Store.meta.year || '')}</p></div>
        <a href="#/collect" class="btn primary">🧾 Receive Payment</a>
      </div>
      <div class="cards">
        <div class="card accent-blue link" data-nav="#/students"><div class="k">Total Fees</div><div class="v">${U.inr(gt)}</div><div class="sub">${students.length} students</div></div>
        <div class="card accent-green link" data-nav="#/collections"><div class="k">Collected</div><div class="v">${U.inr(gp)}</div><div class="sub">${gt ? Math.round(gp / gt * 100) : 0}% of total</div></div>
        <div class="card accent-red link" data-nav="#/reports"><div class="k">Outstanding</div><div class="v">${U.inr(gb)}</div><div class="sub">${defaulters} students with dues</div></div>
        <div class="card accent-amber link" data-nav="#/collections"><div class="k">Collected Today</div><div class="v">${U.inr(todaySum)}</div><div class="sub">${todayPays.length} receipt(s) · in-app total ${U.inr(appCollected)}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Fee Category Summary — Total, Paid &amp; Pending</h2><span class="muted">all fee categories</span></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Fee Category</th><th class="t-right">Total Fees</th><th class="t-right">Paid</th><th class="t-right">Pending</th><th class="t-right">% Paid</th><th>Progress</th></tr></thead>
          <tbody>${catRows}</tbody>
          <tfoot><tr style="font-weight:700;background:#f8fafc"><td>TOTAL</td><td class="num">${U.inr(gt)}</td>
            <td class="num" style="color:var(--green)">${U.inr(gp)}</td><td class="num" style="color:var(--red)">${U.inr(gb)}</td>
            <td class="num">${gt ? Math.round(gp / gt * 100) : 0}%</td><td></td></tr></tfoot>
        </table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Business-wise Collection</h2><span class="muted">click a card for its pending students</span></div>
        <div class="panel-body pad"><div class="cards" style="margin:0">${bizCards}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Recent Payments</h2><a href="#/collections" class="btn sm">View all →</a></div>
        <div class="table-scroll"><table><thead><tr><th>Date</th><th>Student</th><th>Mode</th><th class="t-right">Amount</th></tr></thead>
          <tbody>${recent}</tbody></table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Collection by Grade</h2></div>
        <div class="table-scroll"><table><thead><tr><th>Grade</th><th class="t-right">Students</th><th class="t-right">Total</th><th class="t-right">Paid</th><th class="t-right">Outstanding</th></tr></thead>
          <tbody>${gradeRows}</tbody></table></div>
      </div>`;
    bindNav();
    $$('[data-grade]').forEach(tr => tr.onclick = () => { location.hash = '#/students?grade=' + encodeURIComponent(tr.dataset.grade); });
    $$('[data-rcpt]').forEach(tr => tr.onclick = () => { const p = Store.payments.find(x => x.id === tr.dataset.rcpt); if (p) Receipt.open(p); });
  }

  // clickable KPI cards / links
  function bindNav(root) {
    $$('[data-nav]', root).forEach(el => el.onclick = () => { location.hash = el.dataset.nav; });
  }
  // shared KPI card builder
  function kpi(label, value, opts) {
    opts = opts || {};
    const nav = opts.nav ? ` link" data-nav="${opts.nav}` : '';
    const accent = opts.accent ? ' accent-' + opts.accent : '';
    return `<div class="card${accent}${nav}"><div class="k">${U.esc(label)}</div><div class="v">${value}</div>${opts.sub ? `<div class="sub">${opts.sub}</div>` : ''}</div>`;
  }

  /* -------------------------------------------------- Students list */
  let studentsState = { q: '', grade: '', status: '', sort: 'name' };
  function students(params) {
    if (params && params.grade != null) studentsState.grade = params.grade;
    if (params && params.status != null) studentsState.status = params.status;
    const grades = Array.from(new Set(Store.students.map(s => s.grade).filter(Boolean))).sort();
    const gradeOpts = ['<option value="">All grades</option>']
      .concat(grades.map(g => `<option value="${U.esc(g)}"${studentsState.grade === g ? ' selected' : ''}>${U.esc(g)}</option>`)).join('');

    let gt = 0, gp = 0, defaulters = 0;
    Store.students.forEach(s => { const t = Store.studentTotals(s); gt += t.total; gp += t.paid; if (t.balance > 0) defaulters++; });
    view().innerHTML = `
      <div class="page-head">
        <div><h1>Students</h1><p>${Store.students.length} enrolled · click a row to view fees & the dashboard</p></div>
        <div class="flex gap">
          <button class="btn" id="expStudents">⬇ Export CSV</button>
          <button class="btn" id="importBtn">⬆ Import CSV</button>
          <button class="btn primary" id="addStudentBtn">＋ Add Student</button>
        </div>
      </div>
      <div class="cards">
        ${kpi('Students', Store.students.length, { accent: 'blue' })}
        ${kpi('Total Billed', U.inr(gt), { accent: 'blue' })}
        ${kpi('Collected', U.inr(gp), { accent: 'green', sub: (gt ? Math.round(gp / gt * 100) : 0) + '% collected', nav: '#/collections' })}
        ${kpi('Outstanding', U.inr(gt - gp), { accent: 'red', sub: defaulters + ' with dues', nav: '#/reports' })}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div class="toolbar">
            <input id="stuSearch" type="search" placeholder="Search name / ID / parent…" value="${U.esc(studentsState.q)}" style="min-width:220px" />
            <select id="stuGrade">${gradeOpts}</select>
            <select id="stuStatus">
              <option value="">All statuses</option>
              <option value="due"${studentsState.status === 'due' ? ' selected' : ''}>Has dues</option>
              <option value="pending"${studentsState.status === 'pending' ? ' selected' : ''}>Not paid</option>
              <option value="partial"${studentsState.status === 'partial' ? ' selected' : ''}>Partial</option>
              <option value="paid"${studentsState.status === 'paid' ? ' selected' : ''}>Fully paid</option>
            </select>
            <select id="stuSort">
              <option value="name"${studentsState.sort === 'name' ? ' selected' : ''}>Sort: Name</option>
              <option value="balance"${studentsState.sort === 'balance' ? ' selected' : ''}>Sort: Balance ↓</option>
              <option value="grade"${studentsState.sort === 'grade' ? ' selected' : ''}>Sort: Grade</option>
            </select>
          </div>
          <span class="muted" id="stuCount"></span>
        </div>
        <div class="table-scroll"><table>
          <thead><tr><th>Student</th><th>ID</th><th>Grade</th><th class="t-right">Total</th><th class="t-right">Paid</th><th class="t-right">Balance</th><th>Status</th></tr></thead>
          <tbody id="stuBody"></tbody>
        </table></div>
      </div>`;

    function apply() {
      const q = studentsState.q.trim().toLowerCase();
      let rows = Store.students.filter(s => {
        if (studentsState.grade && s.grade !== studentsState.grade) return false;
        const t = Store.studentTotals(s);
        if (studentsState.status === 'due' && !(t.balance > 0)) return false;
        if (studentsState.status === 'paid' && !(t.total > 0 && t.balance <= 0)) return false;
        if (studentsState.status === 'pending' && !(t.balance >= t.total && t.total > 0)) return false;
        if (studentsState.status === 'partial' && !(t.balance > 0 && t.balance < t.total)) return false;
        if (q) { const hay = (s.name + ' ' + s.id + ' ' + (s.father || '') + ' ' + (s.contact || '')).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
        return true;
      });
      rows.sort((a, b) => {
        if (studentsState.sort === 'balance') return Store.studentTotals(b).balance - Store.studentTotals(a).balance;
        if (studentsState.sort === 'grade') return (a.grade || '').localeCompare(b.grade || '') || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });
      $('#stuCount').textContent = rows.length + ' shown';
      $('#stuBody').innerHTML = rows.slice(0, 1000).map(s => {
        const t = Store.studentTotals(s);
        return `<tr class="clickable" data-id="${U.esc(s.id)}">
          <td><b>${U.esc(s.name)}</b><div class="muted" style="font-size:11px">${U.esc(s.father || '')}</div></td>
          <td class="mono">${U.esc(s.id)}</td><td>${U.esc(s.grade || '')}</td>
          <td class="num">${U.inr(t.total)}</td><td class="num" style="color:var(--green)">${U.inr(t.paid)}</td>
          <td class="num" style="color:${t.balance > 0 ? 'var(--red)' : 'var(--muted)'};font-weight:600">${U.inr(t.balance)}</td>
          <td>${statusBadge(t.balance, t.total)}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">No students match your filters.</td></tr>';
      $$('#stuBody [data-id]').forEach(tr => tr.onclick = () => location.hash = '#/student/' + encodeURIComponent(tr.dataset.id));
    }
    $('#stuSearch').oninput = U.debounce(e => { studentsState.q = e.target.value; apply(); }, 150);
    $('#stuGrade').onchange = e => { studentsState.grade = e.target.value; apply(); };
    $('#stuStatus').onchange = e => { studentsState.status = e.target.value; apply(); };
    $('#stuSort').onchange = e => { studentsState.sort = e.target.value; apply(); };
    $('#expStudents').onclick = exportStudentsCSV;
    $('#addStudentBtn').onclick = openAddStudentModal;
    $('#importBtn').onclick = openImportModal;
    bindNav();
    apply();
  }

  /* -------------------------------------------------- Bulk import (CSV) */
  // Import column headers (also used for the downloadable template)
  // base columns + the current (dynamic) fee-category labels
  function importCols() {
    return ['Student ID', 'Name', 'Grade', 'Class Teacher', 'Gender', 'Date of Birth',
      'Father Name', 'Mother Name', 'Contact Number', 'Location', 'Transport', 'Bus/Driver',
      'Religion', 'Discount %', 'Admission', 'Sports Activity', 'Previous School']
      .concat(Store.HEAD_ORDER.map(k => Store.HEAD_LABELS[k]));
  }
  function headerToKey(h) {
    const n = String(h).trim().toLowerCase().replace(/\s+/g, ' ');
    const map = {
      'student id': 'id', 'id': 'id', 'name': 'name', 'student name': 'name', 'grade': 'grade',
      'class teacher': 'classTeacher', 'gender': 'gender', 'date of birth': 'dob', 'dob': 'dob',
      'father name': 'father', 'father': 'father', 'mother name': 'mother', 'mother': 'mother',
      'contact number': 'contact', 'contact': 'contact', 'phone': 'contact', 'location': 'location',
      'location (from)': 'location', 'transport': 'transportType', 'transport (own/school)': 'transportType',
      'bus/driver': 'vehicle', 'bus / driver': 'vehicle', 'vehicle': 'vehicle', 'religion': 'religion',
      'discount %': 'discountpct', 'discount(%)': 'discountpct', 'discount': 'discountpct',
      'admission': 'admission', 'sports activity': 'sportsActivity', 'previous school': 'prevSchool'
    };
    if (map[n]) return map[n];
    // fee heads by label
    for (const k of Store.HEAD_ORDER) if (Store.HEAD_LABELS[k].toLowerCase() === n) return 'fee:' + k;
    return null;
  }

  function openImportModal() {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop" id="imBackdrop"><div class="modal wide">
        <div class="modal-head"><h3>Import Students from CSV</h3><button class="x-close" id="imClose">&times;</button></div>
        <div class="modal-body">
          <ol class="muted" style="font-size:13px;line-height:1.8;margin:0 0 12px;padding-left:18px">
            <li>In Excel/Google Sheets, save your list as <b>CSV</b> (File → Save As / Download → CSV).</li>
            <li>Use these column headers (order doesn't matter; extra columns are ignored):</li>
          </ol>
          <div class="table-scroll" style="max-height:90px;border:1px solid var(--border);border-radius:8px;padding:8px;font-size:12px;margin-bottom:6px">${importCols().map(c => '<span class="badge gray" style="margin:2px">' + U.esc(c) + '</span>').join('')}</div>
          <p class="muted" style="font-size:12px;margin:0 0 14px">Student ID is optional — blank IDs get auto‑numbered. Duplicate IDs are skipped. Fee columns are the total amount for each category (blank/0 = not applied).</p>
          <div class="flex gap wrap">
            <button class="btn sm" id="imTemplate">⬇ Download CSV template</button>
            <label class="btn sm primary" style="cursor:pointer">Choose CSV file…<input type="file" id="imFile" accept=".csv,text/csv" class="hidden"/></label>
          </div>
          <div id="imResult" style="margin-top:14px"></div>
        </div>
        <div class="modal-foot"><button class="btn" id="imCancel">Close</button></div>
      </div></div>`;
    const close = () => { root.innerHTML = ''; };
    $('#imClose', root).onclick = close; $('#imCancel', root).onclick = close;
    $('#imBackdrop', root).onclick = e => { if (e.target.id === 'imBackdrop') close(); };
    $('#imTemplate', root).onclick = () => {
      const cols = importCols();
      const example = ['26270480', 'RIYAN AHMED', 'VI', 'RAGAVI', 'BOY', '2015-06-01', 'ABDUL AHMED',
        'FATHIMA', '9000000000', 'PATHAMADAI', 'SCHOOL', 'TN72 BUS 1', 'MUSLIM', '0', 'NEW', 'CRICKET', 'AKB SCHOOL']
        .concat(Store.HEAD_ORDER.map(() => '0'));
      U.download('akb_student_import_template.csv', U.toCSV([cols, example]), 'text/csv');
    };
    $('#imFile', root).onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = async () => {
        try {
          const rows = U.fromCSV(rd.result);
          if (rows.length < 2) { $('#imResult', root).innerHTML = '<div class="badge red">No data rows found.</div>'; return; }
          const keys = rows[0].map(headerToKey);
          if (keys.indexOf('name') < 0) { $('#imResult', root).innerHTML = '<div class="badge red">A “Name” column is required.</div>'; return; }
          $('#imResult', root).innerHTML = '<div class="muted">Importing ' + (rows.length - 1) + ' rows…</div>';
          let added = 0, skipped = 0; const errs = [];
          for (let r = 1; r < rows.length; r++) {
            const row = rows[r]; if (!row.some(c => (c || '').trim())) continue;
            const data = { fees: {} };
            keys.forEach((key, ci) => {
              if (!key) return; const val = (row[ci] || '').trim();
              if (key.startsWith('fee:')) data.fees[key.slice(4)] = Number(val) || 0;
              else data[key] = val;
            });
            if (data.discountpct != null) { const p = parseFloat(data.discountpct); data.discount = isNaN(p) ? 0 : (p > 1 ? p / 100 : p); delete data.discountpct; }
            if (!data.name) { errs.push('Row ' + (r + 1) + ': missing name'); continue; }
            if (!data.id) data.id = Store.suggestId();
            try { await Store.addStudent(data); added++; }
            catch (ex) { if (/already exists/.test(ex.message)) skipped++; else errs.push('Row ' + (r + 1) + ': ' + ex.message); }
          }
          $('#imResult', root).innerHTML =
            `<div class="panel" style="margin:0"><div class="panel-body pad">
              <div><span class="badge green">${added} added</span> ${skipped ? '<span class="badge amber">' + skipped + ' skipped (duplicate ID)</span>' : ''} ${errs.length ? '<span class="badge red">' + errs.length + ' errors</span>' : ''}</div>
              ${errs.length ? '<div class="muted" style="font-size:12px;margin-top:8px;max-height:120px;overflow:auto">' + errs.slice(0, 50).map(U.esc).join('<br>') + '</div>' : ''}
              <button class="btn sm primary mt" id="imDone">Done</button>
            </div></div>`;
          U.toast(added + ' students imported', 'success');
          $('#imDone', root).onclick = () => { close(); students(); };
        } catch (err) { $('#imResult', root).innerHTML = '<div class="badge red">Could not read file: ' + U.esc(err.message) + '</div>'; }
      };
      rd.readAsText(f);
    };
  }

  /* -------------------------------------------------- Add student modal */
  function openAddStudentModal() {
    const root = document.getElementById('modalRoot');
    const feeInputs = Store.HEAD_ORDER.map(k => {
      const B = Store.BUSINESSES[Store.businessOfHead(k)];
      return `<div class="fee-row" style="grid-template-columns:1.4fr 1fr">
        <div><div class="fh-label">${U.esc(Store.HEAD_LABELS[k])}</div><div class="muted" style="font-size:11px">${U.esc(B.name)}</div></div>
        <input type="number" min="0" step="1" data-fee="${k}" value="0" title="Total fee"/>
      </div>`;
    }).join('');
    root.innerHTML = `
      <div class="modal-backdrop" id="asBackdrop"><div class="modal wide">
        <div class="modal-head"><h3>Add Student</h3><button class="x-close" id="asClose">&times;</button></div>
        <div class="modal-body">
          <h4 class="sec">Photo</h4>
          <div class="photo-edit">
            <div class="photo-box" id="asPhoto"><span class="muted" style="font-size:11px">No photo</span></div>
            <div>
              <label class="btn sm primary" style="cursor:pointer">📎 Attach photo<input type="file" id="asPhotoFile" accept="image/*" class="hidden"/></label>
              <button class="btn sm" id="asPhotoRemove">Remove</button>
              <div class="muted" style="font-size:11px;margin-top:6px">Optional · JPG/PNG from your device.</div>
            </div>
          </div>
          <h4 class="sec">Details</h4>
          <div class="grid2">
            ${textField('Student Name *', 'name', '')}
            ${textField('Student ID *', 'id', Store.suggestId())}
            ${textField('Grade', 'grade', '')}
            ${textField('Class Teacher', 'classTeacher', '')}
            ${textField('Gender', 'gender', '')}
            ${textField('Date of Birth', 'dob', '')}
            ${textField('Father Name', 'father', '')}
            ${textField('Mother Name', 'mother', '')}
            ${textField('Parent Mobile', 'contact', '')}
            ${textField('Location (From)', 'location', '')}
            ${textField('Transport (Own/School)', 'transportType', '')}
            ${textField('Bus / Driver', 'vehicle', '')}
            ${textField('Religion', 'religion', '')}
            ${textField('Discount (%)', 'discountpct', '')}
            ${textField('Sports Activity', 'sportsActivity', '')}
            ${textField('Admission (OLD/NEW)', 'admission', 'NEW')}
          </div>
          <h4 class="sec">Fee Amounts (total for each category)</h4>
          <div class="muted" style="font-size:12px;margin-bottom:6px">Leave 0 for any category that doesn't apply — you can still collect it later.</div>
          ${feeInputs}
        </div>
        <div class="modal-foot"><button class="btn" id="asCancel">Cancel</button><button class="btn primary" id="asSave">Add Student</button></div>
      </div></div>`;
    const close = () => { root.innerHTML = ''; };
    let photo = '';
    $('#asPhotoFile', root).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { photo = await U.imageToDataURL(f, 320); $('#asPhoto', root).innerHTML = `<img src="${photo}" alt=""/>`; }
      catch (err) { U.toast(err.message, 'error'); }
    };
    $('#asPhotoRemove', root).onclick = () => { photo = ''; $('#asPhoto', root).innerHTML = '<span class="muted" style="font-size:11px">No photo</span>'; };
    $('#asClose', root).onclick = close; $('#asCancel', root).onclick = close;
    $('#asBackdrop', root).onclick = e => { if (e.target.id === 'asBackdrop') close(); };
    $('#asSave', root).onclick = async () => {
      const get = f => { const el = $(`[data-f="${f}"]`, root); return el ? el.value.trim() : ''; };
      const data = { photo };
      ['name', 'id', 'grade', 'classTeacher', 'gender', 'dob', 'father', 'mother', 'contact',
        'location', 'transportType', 'vehicle', 'religion', 'sportsActivity', 'admission'].forEach(f => data[f] = get(f));
      const pct = parseFloat(get('discountpct')); data.discount = isNaN(pct) ? 0 : pct / 100;
      data.fees = {};
      $$('[data-fee]', root).forEach(inp => data.fees[inp.dataset.fee] = Number(inp.value) || 0);
      try {
        const s = await Store.addStudent(data);
        close(); U.toast('Student added · ' + s.name, 'success');
        location.hash = '#/student/' + encodeURIComponent(s.id);
      } catch (e) { U.toast(e.message, 'error'); }
    };
  }

  function exportStudentsCSV() {
    const heads = Store.HEAD_ORDER;
    const header = ['Student ID', 'Name', 'Grade', 'Father', 'Contact', 'Discount']
      .concat(heads.flatMap(h => [Store.HEAD_LABELS[h] + ' Total', Store.HEAD_LABELS[h] + ' Paid', Store.HEAD_LABELS[h] + ' Bal']))
      .concat(['Grand Total', 'Grand Paid', 'Grand Balance']);
    const rows = [header];
    Store.students.forEach(s => {
      const t = Store.studentTotals(s);
      const r = [s.id, s.name, s.grade, s.father, s.contact, s.discount];
      heads.forEach(h => { const f = s.fees[h] || {}; r.push(f.total || 0, f.paid || 0, f.balance || 0); });
      r.push(t.total, t.paid, t.balance); rows.push(r);
    });
    U.download('akb_students_fees.csv', U.toCSV(rows), 'text/csv');
    U.toast('Exported students CSV', 'success');
  }

  /* -------------------------------------------------- Student detail (role-based) */
  function studentDetail(id) {
    const s = Store.getStudent(id);
    if (!s) { view().innerHTML = `<div class="empty">Student not found. <a href="#/students">Back to list</a></div>`; return; }
    chairmanDashboard(s);
  }

  function feeCategoryRows(s, withBusiness) {
    return Store.HEAD_ORDER.map(k => {
      const h = s.fees[k]; if (!h) return '';
      return `<tr>
        ${withBusiness ? `<td class="muted" style="font-size:12px">${U.esc(Store.BUSINESS[k] || '')}</td>` : ''}
        <td><b>${U.esc(h.label)}</b></td>
        <td class="num">${U.inr(h.total)}</td>
        <td class="num" style="color:var(--green)">${U.inr(h.paid)}</td>
        <td class="num" style="color:${h.balance > 0 ? 'var(--red)' : 'var(--muted)'};font-weight:600">${U.inr(h.balance)}</td></tr>`;
    }).join('');
  }

  // Monthly transport panel (Apr→Mar). Hidden when the student has no transport.
  function transportMonthlyPanel(s) {
    const tb = Store.transportBreakdown(s);
    if (!tb.some(m => m.total > 0 || m.paid > 0)) return '';
    const tot = tb.reduce((a, m) => a + m.total, 0), paid = tb.reduce((a, m) => a + m.paid, 0), bal = tot - paid;
    const monthStatus = m => m.total <= 0 ? '<span class="badge gray">—</span>'
      : (m.balance <= 0 ? '<span class="badge green">Paid</span>' : (m.paid > 0 ? '<span class="badge amber">Partial</span>' : '<span class="badge red">Due</span>'));
    const rows = tb.map(m => `<tr>
      <td><b>${U.esc(m.label)}</b></td>
      <td class="num">${U.inr(m.total)}</td>
      <td class="num" style="color:var(--green)">${U.inr(m.paid)}</td>
      <td class="num" style="color:${m.balance > 0 ? 'var(--red)' : 'var(--muted)'};font-weight:600">${U.inr(m.balance)}</td>
      <td class="t-center">${monthStatus(m)}</td></tr>`).join('');
    return `<div class="panel">
      <div class="panel-head"><h2>🚌 Transport Fees — Monthly (Apr → Mar)</h2>
        <div class="flex gap"><button class="btn sm" id="trPrint">🖨️ Print card</button><button class="btn green sm" id="trCollect">Collect monthly</button></div></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Month</th><th class="t-right">Total</th><th class="t-right">Paid</th><th class="t-right">Balance</th><th class="t-center">Status</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="font-weight:700;background:#f8fafc"><td>TOTAL</td><td class="num">${U.inr(tot)}</td>
          <td class="num" style="color:var(--green)">${U.inr(paid)}</td>
          <td class="num" style="color:${bal > 0 ? 'var(--red)' : 'var(--muted)'}">${U.inr(bal)}</td><td></td></tr></tfoot>
      </table></div></div>`;
  }
  // Printable per-student monthly transport card (Falcon-branded)
  function printTransportCard(s) {
    const B = Store.BUSINESSES.falcon;
    const tb = Store.transportBreakdown(s);
    const tot = tb.reduce((a, m) => a + m.total, 0), paid = tb.reduce((a, m) => a + m.paid, 0), bal = tot - paid;
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const school = (Store.meta && Store.meta.school) || 'AKB School of Excellence';
    const rows = tb.map(m => `<tr>
      <td>${U.esc(m.label)}</td>
      <td class="num">${U.inr(m.total)}</td>
      <td class="num">${U.inr(m.paid)}</td>
      <td class="num due">${U.inr(m.balance)}</td>
      <td class="c">${m.total <= 0 ? '—' : (m.balance <= 0 ? 'PAID' : (m.paid > 0 ? 'PARTIAL' : 'DUE'))}</td></tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Transport Card — ${U.esc(s.name)}</title>
      <style>
        *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:22px}
        .hd{display:flex;align-items:center;gap:14px;border-bottom:3px solid ${B.color};padding-bottom:10px}
        .hd img{height:52px}.hd h1{margin:0;font-size:18px;color:${B.color}}.hd p{margin:2px 0;font-size:12px;color:#475569}
        .meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:12px 0;font-size:12px}.meta b{color:#0f172a}
        table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 9px;text-align:left}
        th{background:#fff7ed}th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}td.c,th.c{text-align:center}
        td.due{color:#c2410c;font-weight:700}tfoot td{font-weight:700;background:#fff7ed}
        .foot{margin-top:16px;display:flex;justify-content:space-between;font-size:11px;color:#64748b}
        @media print{.noprint{display:none}}
      </style></head><body>
      <div class="hd"><img src="${base}${B.logo}" alt=""/><div><h1>${U.esc(B.name)}</h1><p>Monthly Transport Fee Card — Academic Year ${U.esc(Store.meta.year || '')}</p></div></div>
      <div class="meta"><span><b>${U.esc(s.name)}</b> · Class ${U.esc(s.grade || '')} · ID ${U.esc(s.id)}${s.contact ? ' · ' + U.esc(s.contact) : ''}</span><span>${U.esc(school)} · Date: <b>${U.fmtDate(U.todayISO())}</b></span></div>
      <table><thead><tr><th>Month</th><th class="num">Fee</th><th class="num">Paid</th><th class="num">Balance</th><th class="c">Status</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>TOTAL (Apr–Mar)</td><td class="num">${U.inr(tot)}</td><td class="num">${U.inr(paid)}</td><td class="num due">${U.inr(bal)}</td><td></td></tr></tfoot></table>
      <div class="foot"><span>Generated by AKB School Management</span><span>Collected by: ____________________</span></div>
      <div class="noprint" style="margin-top:20px"><button onclick="window.print()">🖨️ Print</button></div>
      </body></html>`;
    const wdw = window.open('', '_blank');
    if (!wdw) { U.toast('Please allow pop-ups to print', 'error'); return; }
    wdw.document.write(html); wdw.document.close();
  }

  // Grouped bar chart (Total vs Received) — pure inline SVG, no libraries
  function barChart(s) {
    const items = Store.HEAD_ORDER.map(k => ({ label: Store.HEAD_LABELS[k], total: s.fees[k].total, recv: s.fees[k].paid }));
    const max = Math.max(1, ...items.map(i => Math.max(i.total, i.recv)));
    const W = 720, H = 260, padL = 54, padB = 46, padT = 10, padR = 8;
    const cw = (W - padL - padR) / items.length;
    const bw = Math.min(26, cw / 3);
    const y = v => padT + (H - padT - padB) * (1 - v / max);
    const ticks = 4;
    let g = '';
    for (let i = 0; i <= ticks; i++) {
      const val = max * i / ticks, yy = y(val);
      g += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#e2e8f0"/>`;
      g += `<text x="${padL - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="#94a3b8">${U.inr(val)}</text>`;
    }
    items.forEach((it, i) => {
      const cx = padL + cw * i + cw / 2;
      const x1 = cx - bw - 2, x2 = cx + 2;
      g += `<rect x="${x1}" y="${y(it.total)}" width="${bw}" height="${H - padB - y(it.total)}" fill="#dc2626"><title>${U.esc(it.label)} total ${U.inr(it.total)}</title></rect>`;
      g += `<rect x="${x2}" y="${y(it.recv)}" width="${bw}" height="${H - padB - y(it.recv)}" fill="#16a34a"><title>${U.esc(it.label)} received ${U.inr(it.recv)}</title></rect>`;
      const short = it.label.split(' ')[0];
      g += `<text x="${cx}" y="${H - padB + 14}" text-anchor="middle" font-size="9" fill="#475569">${U.esc(short)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Amount and received chart">
      ${g}
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#cbd5e1"/>
    </svg>
    <div class="chart-legend"><span><i style="background:#dc2626"></i>Total</span><span><i style="background:#16a34a"></i>Received</span></div>`;
  }

  function chairmanDashboard(s) {
    const t = Store.studentTotals(s);
    const overall = (() => {
      const m = [s.marks && s.marks.english, s.marks && s.marks.maths, s.marks && s.marks.science]
        .map(x => parseFloat(x)).filter(x => !isNaN(x));
      return m.length ? (m.reduce((a, b) => a + b, 0) / m.length) : null;
    })();

    view().innerHTML = `
      <div class="page-head">
        <div class="flex gap" style="align-items:center">
          <a href="#/students" class="btn ghost sm">← Back</a>
          <div class="flex gap" style="align-items:center">
            <div class="avatar">${s.photo ? `<img src="${s.photo}" alt="${U.esc(s.name)}"/>` : U.esc(U.initials(s.name))}</div>
            <div><h1 style="margin:0">${U.esc(s.name)}</h1><p>Chairman Dashboard · ${U.esc(s.grade || '')} · ID ${U.esc(s.id)}</p></div>
          </div>
        </div>
        <div class="flex gap wrap">
          ${remindButtons(s)}
          <button class="btn" id="editBtn">✏️ Edit</button>
          <button class="btn danger" id="delStudentBtn">🗑 Delete</button>
          <button class="btn green" id="payBtn">🧾 Receive Payment</button>
        </div>
      </div>

      <div class="cards">
        <div class="card accent-blue"><div class="k">Total</div><div class="v">${U.inr(t.total)}</div></div>
        <div class="card accent-green"><div class="k">Received</div><div class="v">${U.inr(t.paid)}</div></div>
        <div class="card ${t.balance > 0 ? 'accent-red' : 'accent-green'}"><div class="k">Balance (Outstanding)</div><div class="v">${U.inr(t.balance)}</div></div>
      </div>

      <div class="detail-grid chair">
        <div>
          <div class="panel">
            <div class="panel-head"><h2>Fees by Category</h2>${statusBadge(t.balance, t.total)}</div>
            <div class="table-scroll"><table>
              <thead><tr><th>Business</th><th>Fees Category</th><th class="t-right">Total</th><th class="t-right">Received</th><th class="t-right">Balance</th></tr></thead>
              <tbody>${feeCategoryRows(s, true)}</tbody>
              <tfoot><tr style="font-weight:700;background:#f8fafc"><td></td><td>TOTAL</td><td class="num">${U.inr(t.total)}</td>
                <td class="num" style="color:var(--green)">${U.inr(t.paid)}</td>
                <td class="num" style="color:${t.balance > 0 ? 'var(--red)' : 'var(--muted)'}">${U.inr(t.balance)}</td></tr></tfoot>
            </table></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>Amount &amp; Received</h2></div>
            <div class="panel-body pad">${barChart(s)}</div>
          </div>
        </div>

        <div>
          <div class="panel">
            <div class="panel-head"><h2>Student Personal Information</h2></div>
            <div class="panel-body pad">
              <div class="student-photo-box">${s.photo ? `<img src="${s.photo}" alt="${U.esc(s.name)}"/>` : '<span class="muted" style="font-size:12px">No photo</span>'}</div>
              <div class="info-list">${infoRows([
              ['Student Name', s.name], ['Student ID', s.id], ['Gender', s.gender],
              ['Date Of Birth', s.dob ? U.fmtDate(s.dob) : ''], ['Age', s.age],
              ['Father Name', s.father], ['Mother Name', s.mother], ['Location (From)', s.location],
              ['Drop/Pick Location', s.dropLocation], ['Transport', s.transportType],
              ['Parent Mobile', s.contact], ['Religion', s.religion],
              ['Discount', s.discount ? (s.discount * 100).toFixed(0) + '%' : ''],
              ['Bus / Driver', s.vehicle]
            ])}
              <div class="row"><span class="lbl">Outstanding</span><span class="val" style="color:var(--red)">${U.inr(t.balance)}</span></div>
            </div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>Academic Information</h2></div>
            <div class="panel-body pad"><div class="info-list">${infoRows([
              ['Grade', s.grade], ['Class Teacher', s.classTeacher], ['Sports Activity', s.sportsActivity],
              ['Previous School', s.prevSchool], ['Admission', s.admission]
            ])}</div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>Last Monthly Exam Marks</h2></div>
            <div class="panel-body pad"><div class="info-list">${infoRows([
              ['English', s.marks && s.marks.english], ['Maths', s.marks && s.marks.maths],
              ['Science', s.marks && s.marks.science]
            ])}
              <div class="row"><span class="lbl">Over All</span><span class="val">${overall == null ? '—' : overall.toFixed(2)}</span></div>
            </div></div>
          </div>
        </div>
      </div>

      ${transportMonthlyPanel(s)}

      <div class="panel">
        <div class="panel-head"><h2>Payment History</h2></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Date</th><th>Receipt</th><th>For</th><th>Mode</th><th>Business</th><th class="t-right">Amount</th><th></th></tr></thead>
          <tbody>${paymentHistoryRows(s.id, true)}</tbody></table></div>
      </div>`;

    bindStudentActions(s);
  }

  function studentFeeView(s) {
    const t = Store.studentTotals(s);
    view().innerHTML = `
      <div class="page-head">
        <div class="flex gap" style="align-items:center">
          <a href="#/students" class="btn ghost sm">← Back</a>
          <div class="flex gap" style="align-items:center">
            <div class="avatar">${U.esc(U.initials(s.name))}</div>
            <div><h1 style="margin:0">${U.esc(s.name)}</h1><p>${U.esc(s.grade || '')} · ID ${U.esc(s.id)}</p></div>
          </div>
        </div>
        <div class="flex gap">
          <button class="btn" id="editBtn">✏️ Edit</button>
          <button class="btn green" id="payBtn">🧾 Receive Payment</button>
        </div>
      </div>
      <div class="cards">
        <div class="card accent-blue"><div class="k">Total Fees</div><div class="v">${U.inr(t.total)}</div></div>
        <div class="card accent-green"><div class="k">Paid</div><div class="v">${U.inr(t.paid)}</div></div>
        <div class="card ${t.balance > 0 ? 'accent-red' : 'accent-green'}"><div class="k">Pending</div><div class="v">${U.inr(t.balance)}</div></div>
      </div>
      <div class="detail-grid">
        <div class="panel">
          <div class="panel-head"><h2>Student Info</h2></div>
          <div class="panel-body pad"><div class="info-list">${infoRows([
            ['Student ID', s.id], ['Grade', s.grade], ['Father', s.father], ['Mother', s.mother],
            ['Contact', s.contact], ['Transport', s.transportType], ['Location', s.location]
          ])}</div></div>
        </div>
        <div>
          <div class="panel">
            <div class="panel-head"><h2>Pending Fees by Category</h2>${statusBadge(t.balance, t.total)}</div>
            <div class="table-scroll"><table>
              <thead><tr><th>Fees Category</th><th class="t-right">Total</th><th class="t-right">Paid</th><th class="t-right">Pending</th></tr></thead>
              <tbody>${feeCategoryRows(s, false)}</tbody>
              <tfoot><tr style="font-weight:700;background:#f8fafc"><td>TOTAL</td><td class="num">${U.inr(t.total)}</td>
                <td class="num" style="color:var(--green)">${U.inr(t.paid)}</td>
                <td class="num" style="color:${t.balance > 0 ? 'var(--red)' : 'var(--muted)'}">${U.inr(t.balance)}</td></tr></tfoot>
            </table></div>
          </div>
          ${transportMonthlyPanel(s)}
          <div class="panel">
            <div class="panel-head"><h2>Payment History</h2></div>
            <div class="table-scroll"><table>
              <thead><tr><th>Date</th><th>Receipt</th><th>For</th><th>Mode</th><th class="t-right">Amount</th><th></th></tr></thead>
              <tbody>${paymentHistoryRows(s.id, false)}</tbody></table></div>
          </div>
        </div>
      </div>`;
    bindStudentActions(s);
  }

  function infoRows(pairs) {
    return pairs.filter(r => r[1] !== '' && r[1] != null)
      .map(r => `<div class="row"><span class="lbl">${U.esc(r[0])}</span><span class="val">${U.esc(r[1])}</span></div>`).join('');
  }
  function paymentHistoryRows(id, withAccount) {
    const pays = Store.studentPayments(id);
    return pays.map(p => `<tr>
      <td>${U.fmtDate(p.date)}</td><td class="mono">${U.esc(p.receiptNo)}</td>
      <td>${p.items.map(i => U.esc(i.label)).join(', ')}</td>
      <td><span class="pill-mode">${U.esc(p.mode)}</span></td>
      ${withAccount ? `<td class="muted" style="font-size:12px">${U.esc(p.businessName || p.entity || '')}</td>` : ''}
      <td class="num" style="color:var(--green);font-weight:600">${U.inr(p.amount)}</td>
      <td class="t-right"><button class="btn sm" data-print="${p.id}">🖨️</button> <button class="btn sm danger" data-del="${p.id}">✕</button></td></tr>`).join('')
      || `<tr><td colspan="${withAccount ? 7 : 6}" class="empty">No payments recorded in the app for this student.</td></tr>`;
  }
  function bizPayRows(key) {
    const list = Store.payments.filter(p => (p.business || 'school') === key).sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
    return list.slice(0, 200).map(p => `<tr class="clickable" data-rcpt="${p.id}">
      <td>${U.fmtDate(p.date)}</td><td class="mono">${U.esc(p.receiptNo)}</td>
      <td>${U.esc(p.studentName)}<div class="muted" style="font-size:11px">${U.esc(p.grade || '')}</div></td>
      <td>${p.items.map(i => U.esc(i.label)).join(', ')}</td><td><span class="pill-mode">${U.esc(p.mode)}</span></td>
      <td class="num" style="color:var(--green);font-weight:600">${U.inr(p.amount)}</td>
      <td class="t-right"><button class="btn sm" data-print="${p.id}">🖨️</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="empty">No collections recorded for this business yet.</td></tr>';
  }
  function bindStudentActions(s) {
    $('#payBtn').onclick = () => openPaymentModal(s.id);
    $('#editBtn').onclick = () => openEditModal(s.id);
    const del = document.getElementById('delStudentBtn');
    if (del) del.onclick = () => {
      if (!confirm('Delete student "' + s.name + '" (ID ' + s.id + ')?\n\nThis removes the student record. Their past receipts stay in Collections.')) return;
      Store.deleteStudent(s.id).then(() => { U.toast('Student deleted', 'success'); location.hash = '#/students'; });
    };
    $$('[data-print]').forEach(b => b.onclick = () => { const p = Store.payments.find(x => x.id === b.dataset.print); if (p) Receipt.open(p); });
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this payment? The amount will be added back to the balance.')) return;
      await Store.deletePayment(b.dataset.del);
      U.toast('Payment deleted', 'success'); studentDetail(s.id);
    });
    const trP = document.getElementById('trPrint'); if (trP) trP.onclick = () => printTransportCard(s);
    const trC = document.getElementById('trCollect'); if (trC) trC.onclick = () => openPaymentModal(s.id);
  }

  /* -------------------------------------------------- Edit student modal */
  function openEditModal(id) {
    const s = Store.getStudent(id); if (!s) return;
    const root = document.getElementById('modalRoot');
    const feeInputs = Store.HEAD_ORDER.filter(k => k !== 'transport').map(k => {
      const h = s.fees[k];
      return `<div class="fee-row" style="grid-template-columns:1.4fr 1fr 1fr">
        <div class="fh-label">${U.esc(h.label)}</div>
        <input type="number" min="0" step="1" data-fee-total="${k}" value="${h.total}" title="Total"/>
        <input type="number" min="0" step="1" data-fee-paid="${k}" value="${h.paid}" title="Paid"/>
      </div>`;
    }).join('');
    // Transport is monthly — a 12-month grid (Apr → Mar)
    const tb = Store.transportBreakdown(s);
    const transportGrid = `<h4 class="sec">🚌 Transport Fees — Monthly (Apr → Mar) · billed per month</h4>
      <div class="fee-head-hdr" style="grid-template-columns:1.4fr 1fr 1fr"><span>Month</span><span>Total</span><span>Paid</span></div>
      ${tb.map(m => `<div class="fee-row" style="grid-template-columns:1.4fr 1fr 1fr">
        <div class="fh-label">${U.esc(m.label)}</div>
        <input type="number" min="0" step="1" data-tr-total="${m.key}" value="${m.total}" title="Total"/>
        <input type="number" min="0" step="1" data-tr-paid="${m.key}" value="${m.paid}" title="Paid"/>
      </div>`).join('')}
      <p class="muted" style="font-size:12px;margin-top:6px">Tip: set the same monthly fee across Apr–Mar. The Transport Fees total on dashboards is the sum of these months.</p>`;
    root.innerHTML = `
      <div class="modal-backdrop" id="edBackdrop"><div class="modal wide">
        <div class="modal-head"><h3>Edit — ${U.esc(s.name)}</h3><button class="x-close" id="edClose">&times;</button></div>
        <div class="modal-body">
          <h4 class="sec">Photo</h4>
          <div class="photo-edit">
            <div class="photo-box" id="edPhoto">${s.photo ? `<img src="${s.photo}" alt=""/>` : '<span class="muted" style="font-size:11px">No photo</span>'}</div>
            <div>
              <label class="btn sm primary" style="cursor:pointer">📎 Attach photo<input type="file" id="edPhotoFile" accept="image/*" class="hidden"/></label>
              <button class="btn sm" id="edPhotoRemove">Remove</button>
              <div class="muted" style="font-size:11px;margin-top:6px">JPG/PNG from your device · auto‑resized &amp; saved with the student.</div>
            </div>
          </div>
          <h4 class="sec">Personal</h4>
          <div class="grid2">
            ${textField('Student Name', 'name', s.name)}
            ${textField('Grade', 'grade', s.grade)}
            ${textField('Class Teacher', 'classTeacher', s.classTeacher)}
            ${textField('Father Name', 'father', s.father)}
            ${textField('Mother Name', 'mother', s.mother)}
            ${textField('Parent Mobile', 'contact', s.contact)}
            ${textField('Location (From)', 'location', s.location)}
            ${textField('Drop/Pick Location', 'dropLocation', s.dropLocation)}
            ${textField('Transport (Own/School)', 'transportType', s.transportType)}
            ${textField('Bus / Driver', 'vehicle', s.vehicle)}
            ${textField('Religion', 'religion', s.religion)}
            ${textField('Sports Activity', 'sportsActivity', s.sportsActivity)}
            ${textField('Previous School', 'prevSchool', s.prevSchool)}
            ${textField('Admission (OLD/NEW)', 'admission', s.admission)}
          </div>
          <h4 class="sec">Exam Marks</h4>
          <div class="grid3">
            ${textField('English', 'mk_english', s.marks && s.marks.english)}
            ${textField('Maths', 'mk_maths', s.marks && s.marks.maths)}
            ${textField('Science', 'mk_science', s.marks && s.marks.science)}
          </div>
          <h4 class="sec">Fee Heads (Total &amp; Paid)</h4>
          <div class="fee-head-hdr"><span></span><span>Total</span><span>Paid</span></div>
          ${feeInputs}
          ${transportGrid}
          <p class="muted" style="font-size:12px;margin-top:8px">Editing “Paid” here adjusts the opening amount directly (no receipt is generated). Use <b>Receive Payment</b> for normal collections.</p>
        </div>
        <div class="modal-foot"><button class="btn" id="edCancel">Cancel</button><button class="btn primary" id="edSave">Save changes</button></div>
      </div></div>`;
    const close = () => { root.innerHTML = ''; };
    let photo = s.photo || '';
    $('#edPhotoFile', root).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { photo = await U.imageToDataURL(f, 320); $('#edPhoto', root).innerHTML = `<img src="${photo}" alt=""/>`; }
      catch (err) { U.toast(err.message, 'error'); }
    };
    $('#edPhotoRemove', root).onclick = () => { photo = ''; $('#edPhoto', root).innerHTML = '<span class="muted" style="font-size:11px">No photo</span>'; };
    $('#edClose', root).onclick = close; $('#edCancel', root).onclick = close;
    $('#edBackdrop', root).onclick = e => { if (e.target.id === 'edBackdrop') close(); };
    $('#edSave', root).onclick = async () => {
      s.photo = photo;
      ['name', 'grade', 'classTeacher', 'father', 'mother', 'contact', 'location', 'dropLocation',
        'transportType', 'vehicle', 'religion', 'sportsActivity', 'prevSchool', 'admission'].forEach(f => {
        const el = $(`[data-f="${f}"]`, root); if (el) s[f] = el.value.trim();
      });
      s.marks = s.marks || {};
      ['english', 'maths', 'science'].forEach(m => { const el = $(`[data-f="mk_${m}"]`, root); if (el) s.marks[m] = el.value.trim(); });
      Store.HEAD_ORDER.forEach(k => {
        if (k === 'transport') return; // handled via the monthly grid below
        const tt = $(`[data-fee-total="${k}"]`, root), pp = $(`[data-fee-paid="${k}"]`, root);
        if (tt) s.fees[k].total = Number(tt.value) || 0;
        if (pp) s.fees[k].paid = Number(pp.value) || 0;
      });
      // transport monthly grid
      Store.ensureTransport(s);
      Store.transportMonths().forEach(m => {
        const tt = $(`[data-tr-total="${m.key}"]`, root), pp = $(`[data-tr-paid="${m.key}"]`, root);
        s.transport[m.key] = { total: tt ? Number(tt.value) || 0 : 0, paid: pp ? Number(pp.value) || 0 : 0 };
      });
      await Store.saveStudent(s);
      close(); U.toast('Saved', 'success'); studentDetail(id);
    };
  }
  function textField(label, key, val) {
    return `<div class="field"><label>${U.esc(label)}</label><input data-f="${key}" value="${U.esc(val == null ? '' : val)}"/></div>`;
  }

  /* -------------------------------------------------- Payment modal */
  function openPaymentModal(studentId) {
    const s = Store.getStudent(studentId); if (!s) return;
    const root = document.getElementById('modalRoot');
    // show ALL fee categories so staff can collect an ad-hoc fee (e.g. a
    // student newly joining Evening Sports or an event), even if it was never
    // applied to this student.
    const feeRowHtml = o => `<div class="fee-row ${o.due ? '' : 'paidoff'}">
        <input type="checkbox" class="fh-chk" data-key="${o.key}" ${o.due ? 'checked' : ''}/>
        <div><div class="fh-label">${U.esc(o.label)}</div><div class="muted" style="font-size:11px">${o.sub}</div></div>
        <div class="fh-bal">Bal ${U.inr(o.balance)}</div>
        <input type="number" class="fh-amt" data-key="${o.key}" data-head="${o.head}"${o.month ? ` data-month="${o.month}"` : ''} min="0" step="1" value="${o.due ? Math.max(0, o.balance) : 0}" ${o.due ? '' : 'disabled'}/>
      </div>`;
    const rows = Store.HEAD_ORDER.map(k => {
      const B = Store.BUSINESSES[Store.businessOfHead(k)];
      if (k === 'transport') {
        // monthly transport — one selectable row per month (Apr → Mar)
        const tb = Store.transportBreakdown(s);
        const monthRows = tb.map(m => {
          const due = m.balance > 0;
          const status = m.total > 0 ? `paid ${U.inr(m.paid)}/${U.inr(m.total)}` : 'not set — tick to add';
          return feeRowHtml({ key: 'transport::' + m.key, head: 'transport', month: m.key, label: 'Transport — ' + m.label, sub: B.name + ' · ' + status, balance: m.balance, due });
        }).join('');
        return `<div class="fee-group"><div class="fee-group-hd">🚌 Transport Fees — Monthly <span class="muted">(tick the month(s) to collect)</span></div>${monthRows}</div>`;
      }
      const h = s.fees[k]; const due = h.balance > 0;
      const status = h.total > 0 ? `Paid ${U.inr(h.paid)} of ${U.inr(h.total)}` : 'Not applied — tick to add & collect';
      return feeRowHtml({ key: k, head: k, month: '', label: h.label, sub: U.esc(B.name) + ' · ' + status, balance: h.balance, due });
    }).join('');
    root.innerHTML = `
      <div class="modal-backdrop" id="payBackdrop"><div class="modal">
        <div class="modal-head"><h3>Receive Payment — ${U.esc(s.name)}</h3><button class="x-close" id="payClose">&times;</button></div>
        <div class="modal-body">
          <div class="muted" style="margin-bottom:10px">${U.esc(s.grade || '')} · ID ${U.esc(s.id)} · Outstanding <b style="color:var(--red)">${U.inr(Store.studentTotals(s).balance)}</b></div>
          <div id="feeRows">${rows}</div>
          <div class="grid2" style="margin-top:16px">
            <div class="field"><label>Date</label><input type="date" id="payDate" value="${U.todayISO()}"/></div>
            <div class="field"><label>Mode</label><select id="payMode">${Store.MODES.map(m => `<option>${U.esc(m)}</option>`).join('')}</select></div>
          </div>
          <div class="field"><label>Remarks (optional)</label><input id="payRemarks" placeholder="e.g. cheque no., note"/></div>
          <div class="muted" style="font-size:11px;margin-bottom:6px">Each fee is receipted under its own business — a separate receipt prints per business.</div>
          <div style="text-align:right;font-size:16px;font-weight:700;margin-top:6px">Total: <span id="payTotal" style="color:var(--green)">₹0</span></div>
        </div>
        <div class="modal-foot"><button class="btn" id="payCancel">Cancel</button><button class="btn green" id="paySave">Save &amp; Print Receipt</button></div>
      </div></div>`;
    const close = () => { root.innerHTML = ''; };
    function recalc() {
      let tot = 0;
      $$('.fh-amt', root).forEach(inp => { const chk = $(`.fh-chk[data-key="${inp.dataset.key}"]`, root); if (chk && chk.checked && !inp.disabled) tot += Number(inp.value) || 0; });
      $('#payTotal', root).textContent = U.inr(tot); return tot;
    }
    $$('.fh-amt', root).forEach(i => i.oninput = recalc);
    $$('.fh-chk', root).forEach(c => c.onchange = () => { const inp = $(`.fh-amt[data-key="${c.dataset.key}"]`, root); inp.disabled = !c.checked; recalc(); });
    recalc();
    $('#payClose', root).onclick = close; $('#payCancel', root).onclick = close;
    $('#payBackdrop', root).onclick = e => { if (e.target.id === 'payBackdrop') close(); };
    $('#paySave', root).onclick = async () => {
      const items = [];
      $$('.fh-amt', root).forEach(inp => {
        const chk = $(`.fh-chk[data-key="${inp.dataset.key}"]`, root); const amt = Number(inp.value) || 0;
        if (chk && chk.checked && amt > 0) { const it = { head: inp.dataset.head, amount: amt }; if (inp.dataset.month) it.month = inp.dataset.month; items.push(it); }
      });
      if (!items.length) { U.toast('Enter at least one amount', 'error'); return; }
      const recs = await Store.addPayment({ studentId, date: $('#payDate', root).value, mode: $('#payMode', root).value, remarks: $('#payRemarks', root).value, items });
      close();
      U.toast('Payment saved · ' + recs.length + ' receipt' + (recs.length > 1 ? 's' : ''), 'success');
      Receipt.open(recs);
      if (location.hash.indexOf('#/student/') === 0) studentDetail(studentId); else Router.render();
    };
  }

  /* -------------------------------------------------- Collect (quick) */
  function collect() {
    const today = U.todayISO();
    const todayPays = Store.payments.filter(p => p.date === today);
    const todaySum = todayPays.reduce((a, p) => a + p.amount, 0);
    const defaulters = Store.students.filter(s => Store.studentTotals(s).balance > 0).length;
    view().innerHTML = `
      <div class="page-head"><div><h1>Receive Payment</h1><p>Search a student to record a fee payment</p></div></div>
      <div class="cards">
        ${kpi('Collected Today', U.inr(todaySum), { accent: 'green', sub: todayPays.length + ' receipt(s)', nav: '#/collections' })}
        ${kpi('Students with Dues', defaulters, { accent: 'red', nav: '#/reports' })}
        ${kpi('Receipts Issued', Store.meta.receiptSeq || 0, { accent: 'amber' })}
      </div>
      <div class="panel">
        <div class="panel-head"><div class="toolbar" style="width:100%"><input id="colSearch" type="search" placeholder="Type student name, ID, or parent name…" style="flex:1;min-width:240px" autofocus/></div></div>
        <div class="table-scroll"><table><thead><tr><th>Student</th><th>Grade</th><th class="t-right">Balance</th><th></th></tr></thead><tbody id="colBody"></tbody></table></div>
      </div>`;
    function apply(q) {
      q = (q || '').trim().toLowerCase();
      let rows = Store.students;
      if (q) rows = rows.filter(s => (s.name + ' ' + s.id + ' ' + (s.father || '') + ' ' + (s.contact || '')).toLowerCase().indexOf(q) >= 0);
      else rows = rows.filter(s => Store.studentTotals(s).balance > 0).sort((a, b) => Store.studentTotals(b).balance - Store.studentTotals(a).balance);
      $('#colBody').innerHTML = rows.slice(0, 60).map(s => {
        const t = Store.studentTotals(s);
        return `<tr><td class="clickable" data-open="${U.esc(s.id)}"><b>${U.esc(s.name)}</b><div class="muted" style="font-size:11px">ID ${U.esc(s.id)} · ${U.esc(s.father || '')}</div></td>
          <td>${U.esc(s.grade || '')}</td>
          <td class="num" style="color:${t.balance > 0 ? 'var(--red)' : 'var(--green)'};font-weight:600">${U.inr(t.balance)}</td>
          <td class="t-right"><button class="btn green sm" data-pay="${U.esc(s.id)}">Collect</button></td></tr>`;
      }).join('') || '<tr><td colspan="4" class="empty">No match.</td></tr>';
      $$('[data-pay]').forEach(b => b.onclick = () => openPaymentModal(b.dataset.pay));
      $$('[data-open]').forEach(td => td.onclick = () => location.hash = '#/student/' + encodeURIComponent(td.dataset.open));
    }
    $('#colSearch').oninput = U.debounce(e => apply(e.target.value), 150);
    bindNav();
    apply('');
  }

  /* -------------------------------------------------- Collections */
  let colState = { from: '', to: '', business: '', mode: '' };
  function collections(params) {
    if (params && params.business != null) colState.business = params.business;
    const pays = Store.payments;
    if (!colState.from && pays.length) { const d = pays.map(p => p.date).sort(); colState.from = d[0]; colState.to = d[d.length - 1]; }
    if (!colState.from) { colState.from = U.todayISO(); colState.to = U.todayISO(); }
    view().innerHTML = `
      <div class="page-head"><div><h1>Collections</h1><p>Payments recorded in the app · daily & business summary</p></div><button class="btn" id="expCol">⬇ Export CSV</button></div>
      <div class="panel"><div class="panel-head"><div class="toolbar">
        <label class="muted">From <input type="date" id="cFrom" value="${colState.from}"/></label>
        <label class="muted">To <input type="date" id="cTo" value="${colState.to}"/></label>
        <select id="cBiz"><option value="">All businesses</option>${Store.BUSINESS_ORDER.map(b => `<option value="${b}"${colState.business === b ? ' selected' : ''}>${U.esc(Store.BUSINESSES[b].name)}</option>`).join('')}</select>
        <select id="cMode"><option value="">All modes</option>${Store.MODES.map(m => `<option${colState.mode === m ? ' selected' : ''}>${U.esc(m)}</option>`).join('')}</select>
        <button class="btn sm" id="cClear">Clear</button>
      </div></div></div>
      <div id="colContent"></div>`;
    function isCash(m) { return m === 'Cash'; }
    function render() {
      const list = Store.payments.filter(p => {
        if (colState.from && p.date < colState.from) return false;
        if (colState.to && p.date > colState.to) return false;
        if (colState.business && (p.business || 'school') !== colState.business) return false;
        if (colState.mode && p.mode !== colState.mode) return false;
        return true;
      }).sort((a, b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1)));
      const total = list.reduce((a, p) => a + p.amount, 0);
      const cash = list.filter(p => isCash(p.mode)).reduce((a, p) => a + p.amount, 0);
      const online = total - cash;
      // business KPI cards
      const bizCards = Store.BUSINESS_ORDER.map(bk => {
        const B = Store.BUSINESSES[bk];
        const sum = list.filter(p => (p.business || 'school') === bk).reduce((a, p) => a + p.amount, 0);
        return `<div class="card link" data-nav="#/business/${bk}" style="border-left:4px solid ${B.color}">
          <div class="biz-head"><img class="biz-logo" src="${B.logo}" alt=""/><div class="k" style="margin:0">${U.esc(B.name)}</div></div>
          <div class="v" style="font-size:20px">${U.inr(sum)}</div></div>`;
      }).join('');
      const days = {};
      list.forEach(p => { days[p.date] = days[p.date] || { cash: 0, online: 0, total: 0, n: 0 }; days[p.date].total += p.amount; days[p.date].n++; if (isCash(p.mode)) days[p.date].cash += p.amount; else days[p.date].online += p.amount; });
      const dayRows = Object.keys(days).sort().reverse().map(d => { const x = days[d]; return `<tr><td>${U.fmtDate(d)}</td><td class="num">${U.inr(x.cash)}</td><td class="num">${U.inr(x.online)}</td><td class="num" style="font-weight:700">${U.inr(x.total)}</td><td class="num">${x.n}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No collections in this range.</td></tr>';
      const biz = {};
      list.forEach(p => { const b = p.businessName || 'AKB School of Excellence'; biz[b] = biz[b] || { cash: 0, online: 0, total: 0 }; biz[b].total += p.amount; if (isCash(p.mode)) biz[b].cash += p.amount; else biz[b].online += p.amount; });
      const bizRows = Object.keys(biz).sort().map(e => { const x = biz[e]; return `<tr><td>${U.esc(e)}</td><td class="num">${U.inr(x.cash)}</td><td class="num">${U.inr(x.online)}</td><td class="num" style="font-weight:700">${U.inr(x.total)}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">—</td></tr>';
      const txnRows = list.slice(0, 400).map(p => `<tr class="clickable" data-rcpt="${p.id}"><td>${U.fmtDate(p.date)}</td><td class="mono">${U.esc(p.receiptNo)}</td>
          <td>${U.esc(p.studentName)}<div class="muted" style="font-size:11px">${U.esc(p.grade || '')}</div></td>
          <td>${p.items.map(i => U.esc(i.label)).join(', ')}</td><td><span class="pill-mode">${U.esc(p.mode)}</span></td>
          <td class="muted" style="font-size:12px">${U.esc(p.businessName || '')}</td><td class="num" style="color:var(--green);font-weight:600">${U.inr(p.amount)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No transactions.</td></tr>';
      $('#colContent').innerHTML = `
        <div class="cards">
          ${kpi('Total Collected', U.inr(total), { accent: 'green', sub: list.length + ' receipts' })}
          ${kpi('Cash', U.inr(cash), { accent: 'blue' })}
          ${kpi('Bank / Online', U.inr(online), { accent: 'amber' })}
        </div>
        <div class="panel"><div class="panel-head"><h2>Business-wise</h2></div><div class="panel-body pad"><div class="cards" style="margin:0">${bizCards}</div></div></div>
        <div class="panel"><div class="panel-head"><h2>Daily Summary</h2></div><div class="table-scroll"><table><thead><tr><th>Date</th><th class="t-right">Cash</th><th class="t-right">Bank/Online</th><th class="t-right">Total</th><th class="t-right">Receipts</th></tr></thead><tbody>${dayRows}</tbody></table></div></div>
        <div class="panel"><div class="panel-head"><h2>By Business</h2></div><div class="table-scroll"><table><thead><tr><th>Business</th><th class="t-right">Cash</th><th class="t-right">Bank/Online</th><th class="t-right">Total</th></tr></thead><tbody>${bizRows}</tbody></table></div></div>
        <div class="panel"><div class="panel-head"><h2>Transactions</h2><span class="muted">latest 400</span></div><div class="table-scroll"><table><thead><tr><th>Date</th><th>Receipt</th><th>Student</th><th>For</th><th>Mode</th><th>Business</th><th class="t-right">Amount</th></tr></thead><tbody>${txnRows}</tbody></table></div></div>`;
      $$('[data-rcpt]').forEach(tr => tr.onclick = () => { const p = Store.payments.find(x => x.id === tr.dataset.rcpt); if (p) Receipt.open(p); });
      bindNav();
    }
    $('#cFrom').onchange = e => { colState.from = e.target.value; render(); };
    $('#cTo').onchange = e => { colState.to = e.target.value; render(); };
    $('#cBiz').onchange = e => { colState.business = e.target.value; render(); };
    $('#cMode').onchange = e => { colState.mode = e.target.value; render(); };
    $('#cClear').onclick = () => { colState.business = ''; colState.mode = ''; collections(); };
    $('#expCol').onclick = () => {
      const list = Store.payments.filter(p => (!colState.from || p.date >= colState.from) && (!colState.to || p.date <= colState.to) && (!colState.business || (p.business || 'school') === colState.business) && (!colState.mode || p.mode === colState.mode));
      const rows = [['Date', 'Receipt', 'Business', 'Student ID', 'Student', 'Grade', 'For', 'Mode', 'Amount']];
      list.forEach(p => rows.push([p.date, p.receiptNo, p.businessName || '', p.studentId, p.studentName, p.grade, p.items.map(i => i.label).join('; '), p.mode, p.amount]));
      U.download('akb_collections.csv', U.toCSV(rows), 'text/csv'); U.toast('Exported collections CSV', 'success');
    };
    render();
  }

  /* -------------------------------------------------- Reports (multi-filter) */
  let repState = { q: '', grade: '', business: '', head: '', status: 'due', sort: 'balance' };
  function reports(params) {
    if (params && params.business != null) { repState.business = params.business; }
    const grades = Array.from(new Set(Store.students.map(s => s.grade).filter(Boolean))).sort();
    const cats = Store.HEAD_ORDER.map(k => { let total = 0, paid = 0; Store.students.forEach(s => { const h = s.fees[k]; if (h) { total += h.total; paid += h.paid; } }); return { key: k, label: Store.HEAD_LABELS[k], biz: Store.BUSINESSES[Store.businessOfHead(k)].name, total, paid, bal: total - paid }; });
    const gt = cats.reduce((a, c) => a + c.total, 0), gp = cats.reduce((a, c) => a + c.paid, 0);
    const defaulters = Store.students.filter(s => Store.studentTotals(s).balance > 0).length;
    // business summary
    const bizSum = Store.BUSINESS_ORDER.map(bk => { const c = cats.filter(x => Store.businessOfHead(x.key) === bk); return { bk, B: Store.BUSINESSES[bk], total: c.reduce((a, x) => a + x.total, 0), paid: c.reduce((a, x) => a + x.paid, 0) }; });

    view().innerHTML = `
      <div class="page-head"><div><h1>Reports</h1><p>Filter dues by grade, business, fee head & status</p></div></div>
      <div class="cards">
        ${kpi('Total Billed', U.inr(gt), { accent: 'blue' })}
        ${kpi('Collected', U.inr(gp), { accent: 'green', sub: (gt ? Math.round(gp / gt * 100) : 0) + '%' })}
        ${kpi('Outstanding', U.inr(gt - gp), { accent: 'red' })}
        ${kpi('Defaulters', defaulters, { accent: 'amber' })}
      </div>

      <div class="panel"><div class="panel-head"><h2>Business-wise Summary</h2></div>
        <div class="table-scroll"><table><thead><tr><th>Business</th><th class="t-right">Billed</th><th class="t-right">Collected</th><th class="t-right">Outstanding</th><th class="t-right">%</th></tr></thead>
        <tbody>${bizSum.map(b => `<tr class="clickable" data-nav="#/business/${b.bk}"><td><span class="biz-head"><img class="biz-logo" src="${b.B.logo}" alt=""/>${U.esc(b.B.name)}</span></td>
          <td class="num">${U.inr(b.total)}</td><td class="num" style="color:var(--green)">${U.inr(b.paid)}</td>
          <td class="num" style="color:${b.total - b.paid > 0 ? 'var(--red)' : 'var(--muted)'}">${U.inr(b.total - b.paid)}</td>
          <td class="num">${b.total ? Math.round(b.paid / b.total * 100) : 0}%</td></tr>`).join('')}</tbody></table></div></div>

      <div class="panel"><div class="panel-head"><h2>Fee Category Summary — Total, Paid &amp; Pending</h2><button class="btn sm" id="expCat">⬇ CSV</button></div>
        <div class="table-scroll"><table><thead><tr><th>Category</th><th>Business</th><th class="t-right">Total Fees</th><th class="t-right">Paid</th><th class="t-right">Pending</th><th class="t-right">% Paid</th></tr></thead>
        <tbody>${cats.map(c => `<tr><td>${U.esc(c.label)}</td><td class="muted" style="font-size:12px">${U.esc(c.biz)}</td><td class="num">${U.inr(c.total)}</td><td class="num" style="color:var(--green)">${U.inr(c.paid)}</td><td class="num" style="color:${c.bal > 0 ? 'var(--red)' : 'var(--muted)'}">${U.inr(c.bal)}</td><td class="num">${c.total ? Math.round(c.paid / c.total * 100) : 0}%</td></tr>`).join('')}</tbody>
        <tfoot><tr style="font-weight:700;background:#f8fafc"><td>TOTAL</td><td></td><td class="num">${U.inr(gt)}</td><td class="num" style="color:var(--green)">${U.inr(gp)}</td><td class="num" style="color:var(--red)">${U.inr(gt - gp)}</td><td class="num">${gt ? Math.round(gp / gt * 100) : 0}%</td></tr></tfoot></table></div></div>

      <div class="panel">
        <div class="panel-head"><h2>Outstanding Dues</h2>
          <div class="toolbar">
            <input id="rQ" type="search" placeholder="name / ID / phone" value="${U.esc(repState.q)}" style="min-width:150px"/>
            <select id="rGrade"><option value="">All grades</option>${grades.map(g => `<option${repState.grade === g ? ' selected' : ''}>${U.esc(g)}</option>`).join('')}</select>
            <select id="rBiz"><option value="">All businesses</option>${Store.BUSINESS_ORDER.map(b => `<option value="${b}"${repState.business === b ? ' selected' : ''}>${U.esc(Store.BUSINESSES[b].name)}</option>`).join('')}</select>
            <select id="rHead"><option value="">Any fee head</option>${Store.HEAD_ORDER.map(k => `<option value="${k}"${repState.head === k ? ' selected' : ''}>${U.esc(Store.HEAD_LABELS[k])}</option>`).join('')}</select>
            <select id="rStatus">
              <option value="due"${repState.status === 'due' ? ' selected' : ''}>Has dues</option>
              <option value="partial"${repState.status === 'partial' ? ' selected' : ''}>Partial</option>
              <option value="pending"${repState.status === 'pending' ? ' selected' : ''}>Not paid</option>
              <option value="all"${repState.status === 'all' ? ' selected' : ''}>All</option>
            </select>
            <select id="rSort">
              <option value="balance"${repState.sort === 'balance' ? ' selected' : ''}>Sort: Balance ↓</option>
              <option value="name"${repState.sort === 'name' ? ' selected' : ''}>Sort: Name</option>
              <option value="grade"${repState.sort === 'grade' ? ' selected' : ''}>Sort: Grade</option>
            </select>
            <button class="btn sm" id="expDue">⬇ CSV</button>
            <button class="btn sm" id="expRemind">⬇ Reminders CSV</button>
            <button class="btn sm wa hidden" id="bulkWa">📣 Send WhatsApp Reminders</button>
          </div></div>
        <div class="table-scroll"><table><thead><tr><th>Student</th><th>Grade</th><th>Contact</th><th class="t-right">Total</th><th class="t-right">Paid</th><th class="t-right">Outstanding</th><th></th></tr></thead><tbody id="dueBody"></tbody></table></div>
        <div class="panel-body pad" id="dueFoot"></div>
      </div>`;

    // outstanding relevant to the active filter: head > business > overall
    function bizBal(r, bk) { let s = 0; Store.HEAD_ORDER.forEach(k => { if (Store.businessOfHead(k) === bk) s += (r.s.fees[k] || {}).balance || 0; }); return s; }
    function balOf(r) {
      if (repState.head) return (r.s.fees[repState.head] || {}).balance || 0;
      if (repState.business) return bizBal(r, repState.business);
      return r.t.balance;
    }
    function filtered() {
      const q = repState.q.trim().toLowerCase();
      let rows = Store.students.map(s => ({ s, t: Store.studentTotals(s) }));
      if (repState.grade) rows = rows.filter(r => r.s.grade === repState.grade);
      if (q) rows = rows.filter(r => (r.s.name + ' ' + r.s.id + ' ' + (r.s.contact || '')).toLowerCase().indexOf(q) >= 0);
      // status (evaluated against the filter-relevant balance)
      rows = rows.filter(r => {
        const b = balOf(r);
        if (repState.status === 'due') return b > 0;
        if (repState.status === 'pending') return r.t.total > 0 && r.t.paid <= 0;
        if (repState.status === 'partial') return r.t.balance > 0 && r.t.balance < r.t.total;
        return true; // all
      });
      rows.sort((a, b) => {
        if (repState.sort === 'name') return a.s.name.localeCompare(b.s.name);
        if (repState.sort === 'grade') return (a.s.grade || '').localeCompare(b.s.grade || '');
        return balOf(b) - balOf(a);
      });
      return rows;
    }
    function dues() {
      const rows = filtered();
      $('#dueBody').innerHTML = rows.slice(0, 1000).map(r => `<tr class="clickable" data-id="${U.esc(r.s.id)}">
          <td><b>${U.esc(r.s.name)}</b><div class="muted" style="font-size:11px">ID ${U.esc(r.s.id)}</div></td>
          <td>${U.esc(r.s.grade || '')}</td><td class="mono">${U.esc(r.s.contact || '')}</td>
          <td class="num">${U.inr(r.t.total)}</td><td class="num" style="color:var(--green)">${U.inr(r.t.paid)}</td>
          <td class="num" style="color:${balOf(r) > 0 ? 'var(--red)' : 'var(--muted)'};font-weight:700">${U.inr(balOf(r))}</td>
          <td class="t-right">${remindIcon(r.s)}<button class="btn green sm" data-pay="${U.esc(r.s.id)}">Collect</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No students match these filters.</td></tr>';
      const sum = rows.reduce((a, r) => a + balOf(r), 0);
      $('#dueFoot').innerHTML = `<b>${rows.length}</b> students · Total ${repState.head ? U.esc(Store.HEAD_LABELS[repState.head]) + ' ' : ''}outstanding <b style="color:var(--red)">${U.inr(sum)}</b>`;
      $$('#dueBody [data-id]').forEach(tr => tr.onclick = e => { if (e.target.dataset.pay) return; location.hash = '#/student/' + encodeURIComponent(tr.dataset.id); });
      $$('#dueBody [data-pay]').forEach(b => b.onclick = ev => { ev.stopPropagation(); openPaymentModal(b.dataset.pay); });
    }
    $('#rQ').oninput = U.debounce(e => { repState.q = e.target.value; dues(); }, 150);
    $('#rGrade').onchange = e => { repState.grade = e.target.value; dues(); };
    $('#rBiz').onchange = e => { repState.business = e.target.value; dues(); };
    $('#rHead').onchange = e => { repState.head = e.target.value; dues(); };
    $('#rStatus').onchange = e => { repState.status = e.target.value; dues(); };
    $('#rSort').onchange = e => { repState.sort = e.target.value; dues(); };
    $('#expCat').onclick = () => { const rows = [['Category', 'Business', 'Amount', 'Received', 'Receivable']]; cats.forEach(c => rows.push([c.label, c.biz, c.total, c.paid, c.bal])); rows.push(['TOTAL', '', gt, gp, gt - gp]); U.download('akb_category_summary.csv', U.toCSV(rows), 'text/csv'); U.toast('Exported', 'success'); };
    $('#expDue').onclick = () => {
      const rows = filtered();
      const out = [['Student ID', 'Name', 'Grade', 'Father', 'Contact', 'Total', 'Paid', 'Outstanding']];
      rows.forEach(r => out.push([r.s.id, r.s.name, r.s.grade, r.s.father, r.s.contact, r.t.total, r.t.paid, balOf(r)]));
      U.download('akb_dues_filtered.csv', U.toCSV(out), 'text/csv'); U.toast('Exported ' + rows.length + ' rows', 'success');
    };
    $('#expRemind').onclick = () => {
      const rows = filtered().filter(r => r.s.contact);
      const out = [['Student', 'Grade', 'Parent Mobile', 'Outstanding', 'Message', 'WhatsApp Link']];
      rows.forEach(r => out.push([r.s.name, r.s.grade, r.s.contact, balOf(r), reminderText(r.s), U.waLink(r.s.contact, reminderText(r.s))]));
      U.download('akb_fee_reminders.csv', U.toCSV(out), 'text/csv');
      U.toast('Exported ' + rows.length + ' reminders', 'success');
    };
    // Bulk send via the school WhatsApp API number (only if the server is configured & user is admin)
    if (Store.isAdmin()) getWaStatus().then(st => {
      if (!st || !st.configured) return;
      const btn = $('#bulkWa'); if (!btn) return;
      btn.classList.remove('hidden');
      btn.title = 'Send from school WhatsApp (' + (st.provider || 'api') + ')';
      btn.onclick = async () => {
        const rows = filtered().filter(r => r.s.contact);
        if (!rows.length) { U.toast('No recipients with a mobile number', 'error'); return; }
        if (!confirm('Send ' + rows.length + ' fee reminders from the school WhatsApp number?\n\nThis sends real messages and may incur charges.')) return;
        btn.disabled = true; btn.textContent = 'Sending…';
        const recipients = rows.map(r => ({ phone: r.s.contact, name: r.s.name, grade: r.s.grade || '', balance: U.inr(balOf(r)), id: r.s.id }));
        try {
          const res = await fetch('api/send-reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients }) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
          U.toast('Sent ' + (data.sent || 0) + (data.failed ? ' · failed ' + data.failed : ''), data.failed ? 'error' : 'success');
          if (data.failed && data.errors) console.warn('WhatsApp send errors:', data.errors);
        } catch (e) { U.toast('Send failed: ' + e.message, 'error'); }
        btn.disabled = false; btn.textContent = '📣 Send WhatsApp Reminders';
      };
    });
    bindNav();
    dues();
  }

  /* -------------------------------------------------- Business dashboard (admin) */
  let bizState = { q: '', grade: '', head: '', sort: 'balance' };
  function businessDashboard(key) {
    const B = Store.BUSINESSES[key];
    if (!B) { view().innerHTML = `<div class="empty">Unknown business. <a href="#/dashboard">Back to dashboard</a></div>`; return; }
    const heads = Store.HEAD_ORDER.filter(k => Store.businessOfHead(k) === key);
    // aggregate totals for this business
    let total = 0, paid = 0;
    const headAgg = heads.map(k => {
      let t = 0, p = 0; Store.students.forEach(s => { const h = s.fees[k]; if (h) { t += h.total; p += h.paid; } });
      total += t; paid += p; return { k, label: Store.HEAD_LABELS[k], t, p, bal: t - p };
    });
    const outstanding = total - paid;
    const bizBal = s => heads.reduce((a, k) => a + ((s.fees[k] || {}).balance || 0), 0);
    const bizPaid = s => heads.reduce((a, k) => a + ((s.fees[k] || {}).paid || 0), 0);
    const bizTotal = s => heads.reduce((a, k) => a + ((s.fees[k] || {}).total || 0), 0);
    const pendingCount = Store.students.filter(s => bizBal(s) > 0).length;
    const grades = Array.from(new Set(Store.students.map(s => s.grade).filter(Boolean))).sort();

    // collected in-app for this business
    const appCollected = Store.payments.filter(p => (p.business || 'school') === key).reduce((a, p) => a + p.amount, 0);

    view().innerHTML = `
      <div class="page-head">
        <div class="flex gap" style="align-items:center">
          <a href="#/dashboard" class="btn ghost sm">← Back</a>
          <div class="biz-head"><span class="brand-logo" style="width:46px;height:46px;box-shadow:var(--shadow)"><img src="${B.logo}" alt=""/></span>
            <div><h1 style="margin:0">${U.esc(B.name)}</h1><p>${U.esc(B.sub)} · pending students</p></div>
          </div>
        </div>
        <div class="flex gap">
          <button class="btn" id="bizPrint">🖨️ Print pending list</button>
          <button class="btn" id="bizExp">⬇ Export CSV</button>
        </div>
      </div>

      <div class="cards">
        ${kpi('Billed', U.inr(total), { accent: 'blue' })}
        ${kpi('Collected', U.inr(paid), { accent: 'green', sub: (total ? Math.round(paid / total * 100) : 0) + '% collected' })}
        ${kpi('Outstanding', U.inr(outstanding), { accent: 'red' })}
        ${kpi('Pending Students', pendingCount, { accent: 'amber' })}
      </div>

      <div class="panel"><div class="panel-head"><h2>Fee Heads — ${U.esc(B.name)}</h2></div>
        <div class="table-scroll"><table><thead><tr><th>Fee Head</th><th class="t-right">Billed</th><th class="t-right">Collected</th><th class="t-right">Outstanding</th></tr></thead>
        <tbody>${headAgg.map(h => `<tr><td><b>${U.esc(h.label)}</b></td><td class="num">${U.inr(h.t)}</td><td class="num" style="color:var(--green)">${U.inr(h.p)}</td><td class="num" style="color:${h.bal > 0 ? 'var(--red)' : 'var(--muted)'}">${U.inr(h.bal)}</td></tr>`).join('')}</tbody>
        <tfoot><tr style="font-weight:700;background:#f8fafc"><td>TOTAL</td><td class="num">${U.inr(total)}</td><td class="num" style="color:var(--green)">${U.inr(paid)}</td><td class="num" style="color:var(--red)">${U.inr(outstanding)}</td></tr></tfoot></table></div></div>

      <div class="panel">
        <div class="panel-head"><h2>Students with Pending ${U.esc(B.name)} Fees</h2>
          <div class="toolbar">
            <input id="bizQ" type="search" placeholder="name / ID / phone" value="${U.esc(bizState.q)}" style="min-width:150px"/>
            <select id="bizGrade"><option value="">All grades</option>${grades.map(g => `<option${bizState.grade === g ? ' selected' : ''}>${U.esc(g)}</option>`).join('')}</select>
            ${heads.length > 1 ? `<select id="bizHead"><option value="">All ${U.esc(B.name)} heads</option>${heads.map(k => `<option value="${k}"${bizState.head === k ? ' selected' : ''}>${U.esc(Store.HEAD_LABELS[k])}</option>`).join('')}</select>` : ''}
            <select id="bizSort"><option value="balance"${bizState.sort === 'balance' ? ' selected' : ''}>Sort: Pending ↓</option><option value="name"${bizState.sort === 'name' ? ' selected' : ''}>Sort: Name</option><option value="grade"${bizState.sort === 'grade' ? ' selected' : ''}>Sort: Grade</option></select>
          </div></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Student</th><th>Grade</th><th>Contact</th>${heads.map(k => `<th class="t-right">${U.esc(Store.HEAD_LABELS[k])}</th>`).join('')}<th class="t-right">Pending</th><th></th></tr></thead>
          <tbody id="bizBody"></tbody></table></div>
        <div class="panel-body pad" id="bizFoot"></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>${U.esc(B.name)} — Collections</h2><a href="#/collections?business=${key}" class="btn sm">Open in Collections →</a></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Date</th><th>Receipt</th><th>Student</th><th>For</th><th>Mode</th><th class="t-right">Amount</th><th></th></tr></thead>
          <tbody>${bizPayRows(key)}</tbody></table></div>
        <div class="panel-body pad muted">In-app collected for ${U.esc(B.name)}: <b style="color:var(--green)">${U.inr(appCollected)}</b></div>
      </div>`;

    function pendingHeadBal(s, k) { return (s.fees[k] || {}).balance || 0; }
    function filtered() {
      const q = bizState.q.trim().toLowerCase();
      let rows = Store.students.map(s => ({ s, bal: bizState.head ? pendingHeadBal(s, bizState.head) : bizBal(s) }));
      rows = rows.filter(r => r.bal > 0);
      if (bizState.grade) rows = rows.filter(r => r.s.grade === bizState.grade);
      if (q) rows = rows.filter(r => (r.s.name + ' ' + r.s.id + ' ' + (r.s.contact || '')).toLowerCase().indexOf(q) >= 0);
      rows.sort((a, b) => bizState.sort === 'name' ? a.s.name.localeCompare(b.s.name) : (bizState.sort === 'grade' ? (a.s.grade || '').localeCompare(b.s.grade || '') : b.bal - a.bal));
      return rows;
    }
    function draw() {
      const rows = filtered();
      $('#bizBody').innerHTML = rows.slice(0, 1000).map(r => `<tr class="clickable" data-id="${U.esc(r.s.id)}">
        <td><b>${U.esc(r.s.name)}</b><div class="muted" style="font-size:11px">ID ${U.esc(r.s.id)} · ${U.esc(r.s.father || '')}</div></td>
        <td>${U.esc(r.s.grade || '')}</td><td class="mono">${U.esc(r.s.contact || '')}</td>
        ${heads.map(k => { const b = pendingHeadBal(r.s, k); return `<td class="num" style="color:${b > 0 ? 'var(--red)' : 'var(--muted)'}">${U.inr(b)}</td>`; }).join('')}
        <td class="num" style="color:var(--red);font-weight:700">${U.inr(r.bal)}</td>
        <td class="t-right">${remindIcon(r.s)}<button class="btn green sm" data-pay="${U.esc(r.s.id)}">Collect</button></td></tr>`).join('')
        || `<tr><td colspan="${4 + heads.length}" class="empty">No students pending for ${U.esc(B.name)} 🎉</td></tr>`;
      const sum = rows.reduce((a, r) => a + r.bal, 0);
      $('#bizFoot').innerHTML = `<b>${rows.length}</b> pending students · Outstanding <b style="color:var(--red)">${U.inr(sum)}</b>`;
      $$('#bizBody [data-id]').forEach(tr => tr.onclick = e => { if (e.target.dataset.pay) return; location.hash = '#/student/' + encodeURIComponent(tr.dataset.id); });
      $$('#bizBody [data-pay]').forEach(b => b.onclick = ev => { ev.stopPropagation(); openPaymentModal(b.dataset.pay); });
    }
    $('#bizQ').oninput = U.debounce(e => { bizState.q = e.target.value; draw(); }, 150);
    $('#bizGrade').onchange = e => { bizState.grade = e.target.value; draw(); };
    if ($('#bizHead')) $('#bizHead').onchange = e => { bizState.head = e.target.value; draw(); };
    $('#bizSort').onchange = e => { bizState.sort = e.target.value; draw(); };
    $('#bizExp').onclick = () => {
      const rows = filtered();
      const out = [['Student ID', 'Name', 'Grade', 'Father', 'Contact'].concat(heads.map(k => Store.HEAD_LABELS[k] + ' Pending')).concat(['Total Pending'])];
      rows.forEach(r => out.push([r.s.id, r.s.name, r.s.grade, r.s.father, r.s.contact].concat(heads.map(k => pendingHeadBal(r.s, k))).concat([r.bal])));
      U.download('akb_' + key + '_pending.csv', U.toCSV(out), 'text/csv'); U.toast('Exported ' + rows.length + ' rows', 'success');
    };
    $('#bizPrint').onclick = () => {
      const rows = filtered();
      const filterNote = [bizState.grade ? 'Class: ' + bizState.grade : '', bizState.head ? Store.HEAD_LABELS[bizState.head] : '', bizState.q ? 'Search: "' + bizState.q + '"' : '']
        .filter(Boolean).join(' · ');
      printPendingList(B, heads, rows, pendingHeadBal, filterNote);
    };
    draw();
    bindNav();
    $$('[data-print]').forEach(b => b.onclick = () => { const p = Store.payments.find(x => x.id === b.dataset.print); if (p) Receipt.open(p); });
    $$('[data-rcpt]').forEach(tr => tr.onclick = e => { if (e.target.dataset.print) return; const p = Store.payments.find(x => x.id === tr.dataset.rcpt); if (p) Receipt.open(p); });
  }

  // Printable list of pending students for a firm/business (respects current filters)
  function printPendingList(B, heads, rows, pendingHeadBal, filterNote) {
    const school = (Store.meta && Store.meta.school) || 'AKB School of Excellence';
    const dt = U.fmtDate(U.todayISO());
    const grand = rows.reduce((a, r) => a + r.bal, 0);
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const headTh = heads.length > 1 ? heads.map(k => `<th class="num">${U.esc(Store.HEAD_LABELS[k])}</th>`).join('') : '';
    const colSpan = 4 + (heads.length > 1 ? heads.length : 0) + 1;
    const body = rows.map((r, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${U.esc(r.s.name)}</b><div class="sub">ID ${U.esc(r.s.id)}${r.s.father ? ' · ' + U.esc(r.s.father) : ''}</div></td>
      <td class="c">${U.esc(r.s.grade || '')}</td>
      <td>${U.esc(r.s.contact || '')}</td>
      ${heads.length > 1 ? heads.map(k => { const b = pendingHeadBal(r.s, k); return `<td class="num">${b > 0 ? U.inr(b) : '—'}</td>`; }).join('') : ''}
      <td class="num due">${U.inr(r.bal)}</td></tr>`).join('')
      || `<tr><td colspan="${colSpan}" style="text-align:center;padding:24px">No pending students 🎉</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pending — ${U.esc(B.name)}</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:22px}
        .hd{display:flex;align-items:center;gap:14px;border-bottom:3px solid ${B.color || '#1d4ed8'};padding-bottom:10px}
        .hd img{height:56px}
        .hd h1{margin:0;font-size:19px;color:${B.color || '#1d4ed8'}}
        .hd p{margin:2px 0;font-size:12px;color:#475569}
        .meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:12px 0;font-size:12px;color:#475569}
        .meta b{color:#0f172a}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}
        th{background:#f1f5f9}
        th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
        td.c,th.c{text-align:center}
        .sub{font-size:10px;color:#64748b;margin-top:1px}
        td.due{color:#dc2626;font-weight:700}
        tfoot td{font-weight:700;background:#f8fafc}
        .foot{margin-top:16px;display:flex;justify-content:space-between;font-size:11px;color:#64748b}
        @media print{.noprint{display:none}}
      </style></head><body>
      <div class="hd"><img src="${base}${B.logo}" alt=""/>
        <div><h1>${U.esc(B.name)}</h1><p>${U.esc(B.sub || '')} — Pending Fees Report</p></div></div>
      <div class="meta"><span><b>${U.esc(school)}</b> · Academic Year ${U.esc(Store.meta.year || '')}${filterNote ? ' · ' + U.esc(filterNote) : ''}</span>
        <span>Date: <b>${dt}</b> · <b>${rows.length}</b> pending student(s)</span></div>
      <table>
        <thead><tr><th class="c">#</th><th>Student</th><th class="c">Class</th><th>Parent Mobile</th>${headTh}<th class="num">Pending</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="${colSpan - 1}">TOTAL OUTSTANDING (${rows.length} student${rows.length === 1 ? '' : 's'})</td><td class="num due">${U.inr(grand)}</td></tr></tfoot>
      </table>
      <div class="foot"><span>Generated by AKB School Management</span><span>Signature: ____________________</span></div>
      <div class="noprint" style="margin-top:20px"><button onclick="window.print()">🖨️ Print</button></div>
      </body></html>`;
    const wdw = window.open('', '_blank');
    if (!wdw) { U.toast('Please allow pop-ups to print', 'error'); return; }
    wdw.document.write(html); wdw.document.close();
  }

  /* -------------------------------------------------- Users (admin) */
  function roleBadge(r) {
    const cls = r === 'admin' ? 'blue' : (r === 'teacher' ? 'amber' : 'gray');
    return `<span class="badge ${cls}">${U.esc(r)}</span>`;
  }
  function users() {
    const rows = Store.users.map(u => {
      const isT = u.role === 'teacher';
      const gr = isT ? (Array.isArray(u.grades) && u.grades.length ? u.grades.join(', ') : '<span style="color:var(--red)">no class assigned</span>') : '<span class="muted">—</span>';
      return `<tr>
      <td><b>${U.esc(u.name || u.username)}</b><div class="muted" style="font-size:11px">@${U.esc(u.username)}</div></td>
      <td>${roleBadge(u.role)}${u.mustChange ? ' <span class="badge amber">default pwd</span>' : ''}</td>
      <td>${gr}</td>
      <td class="t-right">
        <select class="sel-inline" data-roleselect="${U.esc(u.username)}">
          <option value="account"${u.role === 'account' ? ' selected' : ''}>Account</option>
          <option value="teacher"${u.role === 'teacher' ? ' selected' : ''}>Teacher</option>
          <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option>
        </select>
        ${isT ? `<button class="btn sm" data-grades="${U.esc(u.username)}">Classes</button>` : ''}
        <button class="btn sm" data-reset="${U.esc(u.username)}">Reset pwd</button>
        <button class="btn sm danger" data-del="${U.esc(u.username)}">Delete</button>
      </td></tr>`;
    }).join('');
    const nAdmin = Store.users.filter(u => u.role === 'admin').length;
    const nAcct = Store.users.filter(u => u.role === 'account').length;
    const nTeach = Store.users.filter(u => u.role === 'teacher').length;
    view().innerHTML = `
      <div class="page-head"><div><h1>Users &amp; Access</h1><p>Admins see everything · accounts handle fees · teachers handle attendance &amp; report cards only</p></div>
        <button class="btn primary" id="addUser">＋ Add user</button></div>
      <div class="cards">
        ${kpi('Total Users', Store.users.length, { accent: 'blue' })}
        ${kpi('Admins', nAdmin, { accent: 'green' })}
        ${kpi('Accounts', nAcct, { accent: 'amber' })}
        ${kpi('Teachers', nTeach, { accent: 'blue' })}
      </div>
      <div class="panel"><div class="panel-head"><h2>User Accounts</h2></div><div class="table-scroll"><table>
        <thead><tr><th>User</th><th>Role</th><th>Class(es)</th><th class="t-right">Actions</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="panel"><div class="panel-body pad">
        <p class="muted" style="margin:0"><b>Teachers</b> can only open <b>Attendance</b> and <b>Report Cards</b> for the class(es) you assign — they never see fees, collections or reports. <b>Note on security:</b> this login runs in the browser, so it's an access convenience for staff on shared devices — not server‑grade protection. For a public deploy, also set the <code>APP_PASSWORD</code> environment variable.</p>
      </div></div>`;
    $('#addUser').onclick = () => userModal();
    $$('[data-reset]').forEach(b => b.onclick = () => resetPwModal(b.dataset.reset));
    $$('[data-grades]').forEach(b => b.onclick = () => gradeAssignModal(b.dataset.grades));
    $$('[data-roleselect]').forEach(sel => sel.onchange = async () => {
      const u = Store.getUser(sel.dataset.roleselect);
      const newRole = sel.value;
      await Store.updateUserRole(u.username, newRole);
      U.toast('Role updated', 'success');
      if (newRole === 'teacher' && (!u.grades || !u.grades.length)) gradeAssignModal(u.username);
      else users();
    });
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete user "' + b.dataset.del + '"?')) return;
      try { await Store.deleteUser(b.dataset.del); U.toast('User deleted', 'success'); users(); }
      catch (e) { U.toast(e.message, 'error'); }
    });
  }

  // checkbox list of grades → assign to a teacher
  function gradeCheckboxes(selected) {
    const sel = selected || [];
    return Store.gradeList().map(g =>
      `<label class="chk-inline"><input type="checkbox" value="${U.esc(g)}"${sel.indexOf(g) >= 0 ? ' checked' : ''}/> ${U.esc(g)}</label>`
    ).join('') || '<span class="muted">No grades found in the student roster yet.</span>';
  }
  function gradeAssignModal(username) {
    const u = Store.getUser(username); if (!u) return;
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop" id="gBackdrop"><div class="modal">
        <div class="modal-head"><h3>Assign class(es) — ${U.esc(u.name || u.username)}</h3><button class="x-close" id="gClose">&times;</button></div>
        <div class="modal-body">
          <p class="muted">Tick the class(es) this teacher is responsible for. They'll see attendance &amp; report cards for these students only.</p>
          <div class="chk-grid" id="gGrades">${gradeCheckboxes(u.grades)}</div>
        </div>
        <div class="modal-foot"><button class="btn" id="gCancel">Cancel</button><button class="btn primary" id="gSave">Save classes</button></div>
      </div></div>`;
    const close = () => { root.innerHTML = ''; };
    $('#gClose', root).onclick = close; $('#gCancel', root).onclick = close;
    $('#gBackdrop', root).onclick = e => { if (e.target.id === 'gBackdrop') close(); };
    $('#gSave', root).onclick = async () => {
      const grades = $$('#gGrades input:checked', root).map(c => c.value);
      await Store.setUserGrades(username, grades);
      close(); U.toast('Classes assigned', 'success'); users();
    };
  }

  function userModal() {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop" id="uBackdrop"><div class="modal">
        <div class="modal-head"><h3>Add user</h3><button class="x-close" id="uClose">&times;</button></div>
        <div class="modal-body">
          <div class="field"><label>Full name</label><input id="uName" placeholder="e.g. Mrs. Priya (Grade 3 teacher)"/></div>
          <div class="field"><label>Username</label><input id="uUser" placeholder="e.g. teacher_g3"/></div>
          <div class="field"><label>Role</label><select id="uRole">
            <option value="account">Account (fees data entry)</option>
            <option value="teacher">Teacher (attendance &amp; report cards)</option>
            <option value="admin">Admin (full access)</option>
          </select></div>
          <div class="field hidden" id="uGradesField"><label>Class(es) this teacher handles</label>
            <div class="chk-grid" id="uGrades">${gradeCheckboxes([])}</div></div>
          <div class="field"><label>Password</label><input id="uPass" type="text" placeholder="min 4 characters"/></div>
        </div>
        <div class="modal-foot"><button class="btn" id="uCancel">Cancel</button><button class="btn primary" id="uSave">Create user</button></div>
      </div></div>`;
    const close = () => { root.innerHTML = ''; };
    $('#uClose', root).onclick = close; $('#uCancel', root).onclick = close;
    $('#uBackdrop', root).onclick = e => { if (e.target.id === 'uBackdrop') close(); };
    $('#uRole', root).onchange = () => { $('#uGradesField', root).classList.toggle('hidden', $('#uRole', root).value !== 'teacher'); };
    $('#uSave', root).onclick = async () => {
      try {
        const role = $('#uRole', root).value;
        const grades = role === 'teacher' ? $$('#uGrades input:checked', root).map(c => c.value) : undefined;
        await Store.addUser({ name: $('#uName', root).value, username: $('#uUser', root).value, role, password: $('#uPass', root).value, grades });
        close(); U.toast('User created', 'success'); users();
      } catch (e) { U.toast(e.message, 'error'); }
    };
  }

  function resetPwModal(username) {
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="modal-backdrop" id="rBackdrop"><div class="modal">
        <div class="modal-head"><h3>Reset password — ${U.esc(username)}</h3><button class="x-close" id="rClose">&times;</button></div>
        <div class="modal-body"><div class="field"><label>New password</label><input id="rPass" type="text" placeholder="min 4 characters"/></div></div>
        <div class="modal-foot"><button class="btn" id="rCancel">Cancel</button><button class="btn primary" id="rSave">Set password</button></div>
      </div></div>`;
    const close = () => { root.innerHTML = ''; };
    $('#rClose', root).onclick = close; $('#rCancel', root).onclick = close;
    $('#rBackdrop', root).onclick = e => { if (e.target.id === 'rBackdrop') close(); };
    $('#rSave', root).onclick = async () => {
      const p = $('#rPass', root).value; if (!p || p.length < 4) { U.toast('Password too short', 'error'); return; }
      await Store.setPassword(username, p); close(); U.toast('Password updated', 'success'); if (location.hash.indexOf('users') >= 0) users();
    };
  }

  // change own password (from sidebar)
  function changePassword() {
    const root = document.getElementById('modalRoot');
    const me = Store.currentUser.username;
    root.innerHTML = `
      <div class="modal-backdrop" id="cpBackdrop"><div class="modal">
        <div class="modal-head"><h3>Change my password</h3><button class="x-close" id="cpClose">&times;</button></div>
        <div class="modal-body">
          <div class="field"><label>Current password</label><input id="cpOld" type="password"/></div>
          <div class="field"><label>New password</label><input id="cpNew" type="password" placeholder="min 4 characters"/></div>
        </div>
        <div class="modal-foot"><button class="btn" id="cpCancel">Cancel</button><button class="btn primary" id="cpSave">Update</button></div>
      </div></div>`;
    const close = () => { root.innerHTML = ''; };
    $('#cpClose', root).onclick = close; $('#cpCancel', root).onclick = close;
    $('#cpBackdrop', root).onclick = e => { if (e.target.id === 'cpBackdrop') close(); };
    $('#cpSave', root).onclick = async () => {
      const ok = await Store.verifyLogin(me, $('#cpOld', root).value);
      if (!ok) { U.toast('Current password is wrong', 'error'); return; }
      const np = $('#cpNew', root).value; if (!np || np.length < 4) { U.toast('New password too short', 'error'); return; }
      await Store.setPassword(me, np); close(); U.toast('Password changed', 'success');
    };
  }

  /* -------------------------------------------------- Data & Backup */
  function data() {
    const totalPaid = Store.payments.reduce((a, p) => a + p.amount, 0);
    view().innerHTML = `
      <div class="page-head"><div><h1>Data &amp; Backup</h1><p>Backup, restore, and manage your data (stored locally in this browser)</p></div></div>
      <div class="cards">
        <div class="card accent-blue"><div class="k">Students</div><div class="v">${Store.students.length}</div></div>
        <div class="card accent-green"><div class="k">Payments Recorded</div><div class="v">${Store.payments.length}</div><div class="sub">${U.inr(totalPaid)} in app</div></div>
        <div class="card accent-amber"><div class="k">Receipts Issued</div><div class="v">${Store.meta.receiptSeq || 0}</div></div>
      </div>
      <div class="panel"><div class="panel-head"><h2>Backup &amp; Restore</h2></div>
        <div class="panel-body pad">
          <p class="muted">Your data lives only in this browser. Download a backup regularly, and restore it on another device or after clearing the browser.</p>
          <div class="flex gap wrap mt">
            <button class="btn primary" id="expJson">⬇ Download Full Backup (JSON)</button>
            <label class="btn" style="cursor:pointer">⬆ Restore from Backup<input type="file" id="impJson" accept="application/json" class="hidden"/></label>
            <button class="btn" id="expAllCsv">⬇ Students + Fees (CSV)</button>
          </div>
        </div></div>
      <div class="panel"><div class="panel-head"><h2>Server &amp; Weekly Email Backup</h2><span class="muted" id="srvMode"></span></div>
        <div class="panel-body pad" id="srvBox"><div class="muted">Checking…</div></div></div>
      <div class="panel"><div class="panel-head"><h2>Fee Categories</h2><span class="muted">used across fees, receipts, dashboards & reports</span></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Fee Category</th><th>Business (receipt)</th><th class="t-right">Order</th><th class="t-right">Actions</th></tr></thead>
          <tbody id="fhBody"></tbody></table></div>
        <div class="panel-body pad">
          <div class="toolbar">
            <input id="fhLabel" placeholder="New fee category (e.g. Exam Fees)" style="min-width:220px"/>
            <select id="fhBiz">${Store.BUSINESS_ORDER.map(b => `<option value="${b}">${U.esc(Store.BUSINESSES[b].name)}</option>`).join('')}</select>
            <button class="btn primary sm" id="fhAdd">＋ Add fee category</button>
          </div>
          <p class="muted" style="font-size:12px;margin:8px 0 0">The business controls which firm's receipt a fee is billed under. New categories are added to every student at ₹0 — set amounts via Edit, Add Student, or Import.</p>
        </div></div>
      <div class="panel"><div class="panel-head"><h2>Danger Zone</h2></div>
        <div class="panel-body pad">
          <p class="muted">Reset discards all app-recorded payments and reloads the original student list & balances from the bundled workbook data.</p>
          <button class="btn danger" id="resetBtn">↺ Reset to Original Workbook Data</button>
        </div></div>`;

    function renderFeeHeads() {
      const bizOpts = k => Store.BUSINESS_ORDER.map(b => `<option value="${b}"${Store.HEAD_BUSINESS[k] === b ? ' selected' : ''}>${U.esc(Store.BUSINESSES[b].name)}</option>`).join('');
      $('#fhBody').innerHTML = Store.HEAD_ORDER.map((k, i) => `<tr>
        <td><b>${U.esc(Store.HEAD_LABELS[k])}</b></td>
        <td><select class="fh-biz" data-k="${k}" style="padding:5px 8px;border:1px solid var(--border);border-radius:7px">${bizOpts(k)}</select></td>
        <td class="t-right"><button class="btn sm" data-up="${k}" ${i === 0 ? 'disabled' : ''}>▲</button> <button class="btn sm" data-down="${k}" ${i === Store.HEAD_ORDER.length - 1 ? 'disabled' : ''}>▼</button></td>
        <td class="t-right"><button class="btn sm" data-rename="${k}">Rename</button> <button class="btn sm danger" data-del="${k}">Delete</button></td></tr>`).join('');
      $$('.fh-biz', view()).forEach(sel => sel.onchange = async () => { await Store.updateFeeHead(sel.dataset.k, null, sel.value); U.toast('Updated', 'success'); });
      $$('[data-up]', view()).forEach(b => b.onclick = async () => { await Store.moveFeeHead(b.dataset.up, -1); renderFeeHeads(); });
      $$('[data-down]', view()).forEach(b => b.onclick = async () => { await Store.moveFeeHead(b.dataset.down, 1); renderFeeHeads(); });
      $$('[data-rename]', view()).forEach(b => b.onclick = async () => {
        const cur = Store.HEAD_LABELS[b.dataset.rename]; const nv = prompt('Rename fee category:', cur);
        if (nv && nv.trim() && nv.trim() !== cur) { await Store.updateFeeHead(b.dataset.rename, nv.trim(), null); U.toast('Renamed', 'success'); renderFeeHeads(); }
      });
      $$('[data-del]', view()).forEach(b => b.onclick = async () => {
        const k = b.dataset.del; const lbl = Store.HEAD_LABELS[k];
        const warn = Store.feeHeadHasMoney(k) ? '\n\nThis category HAS amounts recorded — deleting removes it from every student.' : '';
        if (!confirm('Delete fee category "' + lbl + '"?' + warn)) return;
        await Store.deleteFeeHead(k); U.toast('Deleted', 'success'); renderFeeHeads();
      });
    }
    $('#fhAdd').onclick = async () => {
      try { await Store.addFeeHead($('#fhLabel').value, $('#fhBiz').value); $('#fhLabel').value = ''; U.toast('Fee category added', 'success'); renderFeeHeads(); }
      catch (e) { U.toast(e.message, 'error'); }
    };
    renderFeeHeads();

    $('#expJson').onclick = () => { U.download('akb_fees_backup_' + U.todayISO() + '.json', JSON.stringify(Store.exportAll(true)), 'application/json'); U.toast('Backup downloaded', 'success'); };
    $('#expAllCsv').onclick = exportStudentsCSV;
    $('#impJson').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = async () => {
        try { const obj = JSON.parse(rd.result); if (!confirm('Restore will REPLACE all current data with the backup. Continue?')) return; await Store.importAll(obj); U.toast('Restored ' + Store.students.length + ' students', 'success'); Router.render(); }
        catch (err) { U.toast('Invalid backup: ' + err.message, 'error'); }
      };
      rd.readAsText(f);
    };
    $('#resetBtn').onclick = async () => { if (!confirm('This will DELETE all payments recorded in the app and reload original balances. Continue?')) return; await Store.resetToSeed(); U.toast('Reset complete', 'success'); Router.render(); };

    // Server / weekly email backup status
    (async () => {
      let st = null; try { const r = await fetch('api/backup-status'); if (r.ok) st = await r.json(); } catch (e) {}
      const box = $('#srvBox'), mode = $('#srvMode'); if (!box) return;
      if (!st) {
        mode.innerHTML = '<span class="badge gray">Local (this browser)</span>';
        box.innerHTML = '<p class="muted" style="margin:0">Not running on the server — data is stored only in this browser. Deploy on the server (Railway) to share data across devices and enable the weekly Excel email backup.</p>';
        return;
      }
      mode.innerHTML = '<span class="badge green">Shared server mode</span>';
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const sched = st.emailConfigured
        ? ('emails <b>' + U.esc(st.to) + '</b> every <b>' + days[st.day] + ' ' + String(st.hour).padStart(2, '0') + ':00</b>')
        : ('<span class="badge amber">email not configured</span> — set SMTP_* env vars to auto-email <b>' + U.esc(st.to) + '</b>');
      box.innerHTML = `<p class="muted" style="margin:0 0 10px">Data is shared across all devices. Weekly Excel backup ${sched}. Last sent: <b>${st.lastBackupAt ? U.fmtDate(st.lastBackupAt.slice(0, 10)) : 'never'}</b>.</p>
        <div class="flex gap wrap">
          <a class="btn primary" href="api/backup.xlsx">⬇ Download Excel (all data + dashboard)</a>
          <button class="btn ${st.emailConfigured ? '' : 'hidden'}" id="emailNow">✉️ Email backup now</button>
        </div>`;
      const en = $('#emailNow');
      if (en) en.onclick = async () => {
        en.disabled = true; en.textContent = 'Sending…';
        try { const r = await fetch('api/send-backup', { method: 'POST' }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); U.toast('Backup emailed to ' + j.to, 'success'); }
        catch (e) { U.toast('Email failed: ' + e.message, 'error'); }
        en.disabled = false; en.textContent = '✉️ Email backup now';
      };
    })();
  }

  /* ==================================================================
     TEACHER MODULE — Attendance, Report Cards (marks) & Academics
     ================================================================== */

  // grades the current user may work with (admin = all; teacher = assigned).
  // Resolve the FULL user record from the store — the lightweight session
  // object only carries username/role/name, so read grades from Store.users
  // (this also reflects class re-assignments made while the teacher is logged in).
  function myGrades() {
    const cu = Store.currentUser; if (!cu) return [];
    if (cu.role === 'admin') return Store.gradeList();
    const u = Store.getUser(cu.username) || cu;
    return Array.isArray(u.grades) ? u.grades.filter(Boolean) : [];
  }
  const GRADE_COLORS = { EX: '#16a34a', GD: '#2563eb', SA: '#d97706', NI: '#dc2626' };
  // Grades 1-9 store numeric marks (0-100); KG stores skill grade codes.
  // Derive the EX/GD/SA/NI band from a numeric mark, matching the grade scale.
  function gradeFromMark(m) { m = Number(m); if (!isFinite(m)) return ''; if (m >= 90) return 'EX'; if (m >= 75) return 'GD'; if (m >= 60) return 'SA'; return 'NI'; }
  // Return the grade code for a stored cell value (numeric mark OR grade code).
  function cellGrade(v) { if (v == null || v === '') return ''; return /^\d+(\.\d+)?$/.test(String(v)) ? gradeFromMark(v) : String(v); }
  function isNumericCell(v) { return /^\d+(\.\d+)?$/.test(String(v)); }
  // 0-100 marks options for a <select>
  function markOptions(val) {
    let o = '<option value="">–</option>';
    for (let m = 100; m >= 0; m--) o += `<option value="${m}"${String(val) === String(m) ? ' selected' : ''}>${m}</option>`;
    return o;
  }
  function lastDates(n) {
    const out = [], d = new Date();
    for (let i = n - 1; i >= 0; i--) { const dd = new Date(d); dd.setDate(d.getDate() - i); out.push(dd.toISOString().slice(0, 10)); }
    return out;
  }
  function absentText(s, date) {
    const school = (Store.meta && Store.meta.school) || 'AKB School of Excellence';
    return 'Dear Parent, this is to inform you that ' + s.name + (s.grade ? ' (' + s.grade + ')' : '') +
      ' was marked ABSENT today (' + U.fmtDate(date) + ') at ' + school +
      '. If this is unexpected, kindly contact the school. Please ensure regular attendance. Thank you.';
  }

  /* -------------------------------------------------- Attendance */
  let attState = { date: '', grade: '' };
  function attendance() {
    const grades = myGrades();
    if (!attState.date) attState.date = U.todayISO();
    if (!attState.grade || grades.indexOf(attState.grade) < 0) attState.grade = grades[0] || '';
    const isAdmin = Store.isAdmin();

    if (!grades.length) {
      view().innerHTML = `<div class="page-head"><div><h1>Attendance</h1></div></div>
        <div class="panel"><div class="panel-body pad"><div class="empty">No class has been assigned to you yet. Please ask the administrator to assign your class under <b>Users &amp; Access</b>.</div></div></div>`;
      return;
    }

    const gradeOpts = grades.map(g => `<option value="${U.esc(g)}"${attState.grade === g ? ' selected' : ''}>${U.esc(g)}</option>`).join('');
    const roster = Store.students.filter(s => s.grade === attState.grade)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const day = Store.getAttendance(attState.date);
    let present = 0, absent = 0, unmarked = 0;
    roster.forEach(s => { const v = day[s.id]; if (v === 'P') present++; else if (v === 'A') absent++; else unmarked++; });

    const rows = roster.map(s => {
      const v = day[s.id] || '';
      const wa = (v === 'A' && s.contact)
        ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${U.waLink(s.contact, absentText(s, attState.date))}" title="WhatsApp absent notice to parent">💬 Notify</a>`
        : (v === 'A' && !s.contact ? '<span class="muted" style="font-size:11px">no mobile</span>' : '');
      return `<tr class="${v === 'A' ? 'row-absent' : ''}">
        <td><b>${U.esc(s.name)}</b><div class="muted" style="font-size:11px">${U.esc(s.id)}${s.contact ? ' · ' + U.esc(s.contact) : ''}</div></td>
        <td class="t-center">
          <div class="att-toggle">
            <button class="att-btn p ${v === 'P' ? 'on' : ''}" data-att="P" data-id="${U.esc(s.id)}">Present</button>
            <button class="att-btn a ${v === 'A' ? 'on' : ''}" data-att="A" data-id="${U.esc(s.id)}">Absent</button>
          </div>
        </td>
        <td class="t-right">${wa}</td></tr>`;
    }).join('') || '<tr><td colspan="3" class="empty">No students in this class.</td></tr>';

    view().innerHTML = `
      <div class="page-head">
        <div><h1>Attendance</h1><p>Mark each student, then WhatsApp the parents of absentees</p></div>
      </div>
      <div class="panel"><div class="panel-head">
        <div class="toolbar">
          <label class="fld"><span>Date</span><input type="date" id="attDate" value="${attState.date}" max="${U.todayISO()}"/></label>
          <label class="fld"><span>Class</span><select id="attGrade">${gradeOpts}</select></label>
          <button class="btn" id="attAllPresent">✔ Mark all present</button>
        </div>
        <span class="muted">${U.fmtDate(attState.date)}</span>
      </div>
      <div class="cards" style="margin:12px">
        ${kpi('Students', roster.length, { accent: 'blue' })}
        ${kpi('Present', present, { accent: 'green' })}
        ${kpi('Absent', absent, { accent: 'red' })}
        ${kpi('Not marked', unmarked, { accent: unmarked ? 'amber' : 'green' })}
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>Student</th><th class="t-center">Attendance</th><th class="t-right">Absent action</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
      ${isAdmin ? adminAbsenteePanel(attState.date) : ''}`;

    $('#attDate').onchange = e => { attState.date = e.target.value || U.todayISO(); attendance(); };
    $('#attGrade').onchange = e => { attState.grade = e.target.value; attendance(); };
    $('#attAllPresent').onclick = async () => { await Store.markAllPresent(attState.date, attState.grade); U.toast('All marked present', 'success'); attendance(); };
    $$('[data-att]').forEach(b => b.onclick = async () => {
      await Store.setAttendance(attState.date, b.dataset.id, b.dataset.att);
      attendance();
    });
  }
  // admin: absentees across ALL grades for the date
  function adminAbsenteePanel(date) {
    const abs = Store.absenteesOn(date).sort((a, b) => String(a.grade).localeCompare(String(b.grade)) || String(a.name).localeCompare(String(b.name)));
    const rows = abs.map(s => `<tr>
      <td>${U.esc(s.grade || '—')}</td>
      <td><b>${U.esc(s.name)}</b></td>
      <td>${U.esc(s.contact || '—')}</td>
      <td class="t-right">${s.contact ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${U.waLink(s.contact, absentText(s, date))}">💬 Notify</a>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">No students marked absent for this date. 🎉</td></tr>';
    return `<div class="panel"><div class="panel-head"><h2>Daily Absentee Report — All Classes</h2><span class="muted">${U.fmtDate(date)}</span></div>
      <div class="table-scroll"><table><thead><tr><th>Class</th><th>Student</th><th>Parent mobile</th><th class="t-right">Action</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
  }

  /* -------------------------------------------------- Report Cards (marks) */
  let markState = { grade: '', studentId: '' };
  function reportKeysFor(grade) {
    // returns [{key,label,group}] rows for the marks grid
    if (Store.isKG(grade)) {
      const out = [];
      Store.REPORT.KG_DOMAINS.forEach((d, di) => d.items.forEach((it, ii) => out.push({ key: 'K:' + di + ':' + ii, label: it, group: d.title })));
      return out;
    }
    return Store.REPORT.SUBJECTS.map(s => ({ key: 'S:' + s, label: s, group: 'Subjects' }));
  }
  function marks() {
    const grades = myGrades();
    if (!grades.length) {
      view().innerHTML = `<div class="page-head"><div><h1>Report Cards</h1></div></div>
        <div class="panel"><div class="panel-body pad"><div class="empty">No class assigned yet. Ask the administrator to assign your class under <b>Users &amp; Access</b>.</div></div></div>`;
      return;
    }
    if (!markState.grade || grades.indexOf(markState.grade) < 0) { markState.grade = grades[0]; markState.studentId = ''; }
    const roster = Store.students.filter(s => s.grade === markState.grade).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!markState.studentId || !roster.find(s => s.id === markState.studentId)) markState.studentId = roster[0] ? roster[0].id : '';
    const student = roster.find(s => s.id === markState.studentId);
    const kg = Store.isKG(markState.grade);

    const gradeOpts = grades.map(g => `<option value="${U.esc(g)}"${markState.grade === g ? ' selected' : ''}>${U.esc(g)}</option>`).join('');
    const stuOpts = roster.map(s => `<option value="${U.esc(s.id)}"${markState.studentId === s.id ? ' selected' : ''}>${U.esc(s.name)}</option>`).join('')
      || '<option value="">No students</option>';

    let gridHtml = '<div class="empty">No student selected.</div>';
    if (student) {
      const report = student.report || {}; const marksData = report.marks || {};
      const rowsCfg = reportKeysFor(markState.grade);
      // KG → skill grade (EX/GD/SA/NI); Grades 1-9 → numeric marks 0-100
      const gradeSelectOpts = code => Store.REPORT.GRADE_SCALE.map(g => `<option value="${g.code}"${code === g.code ? ' selected' : ''}>${g.code}</option>`).join('');
      const cellControl = (key, aKey, val) => kg
        ? `<select class="mk-sel" data-key="${U.esc(key)}" data-as="${aKey}"><option value="">–</option>${gradeSelectOpts(val || '')}</select>`
        : `<select class="mk-sel mk-num" data-key="${U.esc(key)}" data-as="${aKey}" style="color:${GRADE_COLORS[cellGrade(val)] || '#334155'}" title="${val !== '' && val != null ? val + ' = ' + cellGrade(val) : 'marks 0-100'}">${markOptions(val)}</select>`;
      let body = '', lastGroup = null;
      rowsCfg.forEach(r => {
        if (r.group !== lastGroup) { body += `<tr class="grp-row"><td colspan="${1 + Store.REPORT.ASSESSMENTS.length}">${U.esc(r.group)}</td></tr>`; lastGroup = r.group; }
        const cell = marksData[r.key] || {};
        const tds = Store.REPORT.ASSESSMENTS.map(a => `<td class="t-center">${cellControl(r.key, a.key, cell[a.key] == null ? '' : cell[a.key])}</td>`).join('');
        body += `<tr><td>${U.esc(r.label)}</td>${tds}</tr>`;
      });
      const asHead = Store.REPORT.ASSESSMENTS.map(a => `<th class="t-center">${U.esc(a.label)}</th>`).join('');
      gridHtml = `
        <div class="scale-legend">${kg ? '' : '<span class="muted">Enter marks 0–100; grade is derived → </span>'}${Store.REPORT.GRADE_SCALE.map(g => `<span><b style="color:${GRADE_COLORS[g.code]}">${g.code}</b> ${U.esc(g.label)}</span>`).join('')}</div>
        <div class="table-scroll"><table class="marks-grid">
          <thead><tr><th>${kg ? 'Skill / Ability' : 'Subject'}</th>${asHead}</tr></thead>
          <tbody>${body}</tbody></table></div>
        <div class="field mt"><label>Class teacher's remarks</label><textarea id="mkRemarks" rows="2" placeholder="Overall remarks for the report card…">${U.esc(report.remarks || '')}</textarea></div>
        <div class="flex gap wrap mt">
          <button class="btn primary" id="mkSave">💾 Save report card</button>
          <button class="btn" id="mkPrint">🖨️ Preview / Print report card</button>
          ${student.reportUpdatedAt ? `<span class="muted" style="align-self:center">Last saved ${U.fmtDate(student.reportUpdatedAt.slice(0, 10))}</span>` : ''}
        </div>`;
    }

    view().innerHTML = `
      <div class="page-head"><div><h1>Report Cards</h1><p>${kg ? 'Tick skill grades for each student' : 'Enter numeric marks (0–100) per assessment — grade is auto-derived'} — as per the AKB report card</p></div></div>
      <div class="panel"><div class="panel-head">
        <div class="toolbar">
          <label class="fld"><span>Class</span><select id="mkGrade">${gradeOpts}</select></label>
          <label class="fld"><span>Student</span><select id="mkStudent">${stuOpts}</select></label>
        </div>
        <span class="muted">${kg ? 'Skill-based checklist' : 'Grades 1–9 subjects'}</span>
      </div><div class="panel-body pad">${gridHtml}</div></div>`;

    $('#mkGrade').onchange = e => { markState.grade = e.target.value; markState.studentId = ''; marks(); };
    $('#mkStudent').onchange = e => { markState.studentId = e.target.value; marks(); };
    // recolor numeric marks by their derived grade band as they're picked
    $$('.mk-num').forEach(sel => sel.onchange = () => {
      const g = cellGrade(sel.value);
      sel.style.color = GRADE_COLORS[g] || '#334155';
      sel.title = sel.value ? sel.value + ' = ' + g : 'marks 0-100';
    });
    const save = $('#mkSave');
    if (save) save.onclick = async () => {
      const marksData = {};
      $$('.mk-sel').forEach(sel => {
        const k = sel.dataset.key, a = sel.dataset.as, v = sel.value;
        if (!v) return; (marksData[k] = marksData[k] || {})[a] = v;
      });
      await Store.saveStudentReport(student.id, { marks: marksData, remarks: $('#mkRemarks').value.trim() });
      U.toast('Report card saved', 'success'); marks();
    };
    const pr = $('#mkPrint'); if (pr) pr.onclick = () => printReportCard(student);
  }

  // printable report card (AKB format)
  function printReportCard(s) {
    const kg = Store.isKG(s.grade);
    const report = s.report || {}; const marksData = report.marks || {};
    const rowsCfg = reportKeysFor(s.grade);
    const asHead = Store.REPORT.ASSESSMENTS.map(a => `<th>${U.esc(a.label)}</th>`).join('');
    let body = '', lastGroup = null;
    rowsCfg.forEach(r => {
      if (kg && r.group !== lastGroup) { body += `<tr class="grp"><td colspan="${1 + Store.REPORT.ASSESSMENTS.length}">${U.esc(r.group)}</td></tr>`; lastGroup = r.group; }
      const cell = marksData[r.key] || {};
      const tds = Store.REPORT.ASSESSMENTS.map(a => {
        const v = cell[a.key] == null ? '' : cell[a.key];
        const g = cellGrade(v);
        // Grades 1-9: show the numeric mark + derived grade; KG: show the grade code
        const disp = v === '' ? '' : (isNumericCell(v) ? v + ' <small>(' + g + ')</small>' : v);
        return `<td style="text-align:center;font-weight:700;color:${GRADE_COLORS[g] || '#334155'}">${disp}</td>`;
      }).join('');
      body += `<tr><td>${U.esc(r.label)}</td>${tds}</tr>`;
    });
    const school = (Store.meta && Store.meta.school) || 'AKB School of Excellence';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Report Card — ${U.esc(s.name)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:24px}
        .rc-head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1d4ed8;padding-bottom:10px}
        .rc-head img{height:64px}
        .rc-head h1{margin:0;font-size:20px;color:#1d4ed8}
        .rc-head p{margin:2px 0;font-size:12px;color:#475569}
        .meta{display:flex;gap:24px;flex-wrap:wrap;margin:14px 0;font-size:13px}
        .meta b{color:#0f172a}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px}
        th{background:#eff6ff;text-align:left}
        tr.grp td{background:#f1f5f9;font-weight:700}
        .scale{margin:12px 0;font-size:11px;color:#475569}
        .scale b{margin-right:2px}
        .remarks{margin-top:14px;font-size:13px}
        .sign{margin-top:40px;display:flex;justify-content:space-between;font-size:12px}
        @media print{ .noprint{display:none} }
      </style></head><body>
      <div class="rc-head"><img src="${location.origin + location.pathname.replace(/[^/]*$/, '')}assets/img/logo-school.svg" alt=""/>
        <div><h1>${U.esc(school)}</h1><p>Student Progress Report — Academic Year ${U.esc(Store.meta.year || '')}</p></div></div>
      <div class="meta"><span><b>Name:</b> ${U.esc(s.name)}</span><span><b>Class:</b> ${U.esc(s.grade || '')}</span><span><b>ID:</b> ${U.esc(s.id)}</span>${s.father ? `<span><b>Parent:</b> ${U.esc(s.father)}</span>` : ''}</div>
      <table><thead><tr><th>${kg ? 'Skill / Ability' : 'Subject'}</th>${asHead}</tr></thead><tbody>${body}</tbody></table>
      <div class="scale"><b>Grading:</b> ${Store.REPORT.GRADE_SCALE.map(g => g.code + ' = ' + g.label).join(' &nbsp;·&nbsp; ')}</div>
      ${report.remarks ? `<div class="remarks"><b>Class teacher's remarks:</b> ${U.esc(report.remarks)}</div>` : ''}
      <div class="sign"><span>Class Teacher</span><span>Principal / Chairman</span></div>
      <div class="noprint" style="margin-top:24px"><button onclick="window.print()">Print</button></div>
      </body></html>`;
    const wdw = window.open('', '_blank');
    if (!wdw) { U.toast('Please allow pop-ups to print', 'error'); return; }
    wdw.document.write(html); wdw.document.close();
  }

  /* -------------------------------------------------- Academics dashboard (admin/chairman) */
  function hasReport(s) {
    const m = s.report && s.report.marks; if (!m) return false;
    return Object.keys(m).some(k => Object.keys(m[k] || {}).some(a => m[k][a]));
  }
  // horizontal bar chart: items=[{label,value,color,sub}]
  function hbars(items, opts) {
    opts = opts || {};
    const max = Math.max(1, ...items.map(i => i.value));
    return `<div class="hbars">` + items.map(i => `
      <div class="hbar-row"><div class="hbar-lbl">${U.esc(i.label)}</div>
        <div class="hbar-track"><span style="width:${Math.round(i.value / max * 100)}%;background:${i.color || '#2563eb'}"></span></div>
        <div class="hbar-val">${opts.pct ? i.value + '%' : U.inum(i.value)}${i.sub ? ' <span class="muted">' + i.sub + '</span>' : ''}</div></div>`).join('') + `</div>`;
  }
  // donut chart: segments=[{label,value,color}]
  function donut(segments) {
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    const R = 60, C = 2 * Math.PI * R; let off = 0;
    const rings = segments.map(s => {
      const frac = s.value / total, len = frac * C;
      const el = `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${s.color}" stroke-width="26"
        stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"><title>${U.esc(s.label)}: ${s.value}</title></circle>`;
      off += len; return el;
    }).join('');
    const legend = segments.map(s => `<span><i style="background:${s.color}"></i>${U.esc(s.label)} <b>${s.value}</b> (${Math.round(s.value / total * 100)}%)</span>`).join('');
    return `<div class="donut-wrap"><svg viewBox="0 0 160 160" width="160" height="160">
      <circle r="${R}" cx="80" cy="80" fill="none" stroke="#eef2f7" stroke-width="26"/>${rings}
      <text x="80" y="76" text-anchor="middle" font-size="22" font-weight="700" fill="#0f172a">${total}</text>
      <text x="80" y="96" text-anchor="middle" font-size="10" fill="#64748b">grades</text></svg>
      <div class="donut-legend">${legend}</div></div>`;
  }
  // line chart of daily present% : points=[{label,value|null}]
  function lineChart(points) {
    const W = 720, H = 200, padL = 34, padB = 30, padT = 12, padR = 10;
    const n = points.length, iw = (W - padL - padR);
    const x = i => padL + (n <= 1 ? iw / 2 : iw * i / (n - 1));
    const y = v => padT + (H - padT - padB) * (1 - v / 100);
    let grid = '';
    for (let t = 0; t <= 4; t++) { const val = 25 * t, yy = y(val); grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#eef2f7"/><text x="${padL - 6}" y="${yy + 3}" text-anchor="end" font-size="9" fill="#94a3b8">${val}%</text>`; }
    const pts = points.map((p, i) => p.value == null ? null : [x(i), y(p.value)]);
    let path = '', dots = '', prev = null;
    pts.forEach((p, i) => {
      if (p) { path += (prev ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; prev = p; dots += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#1d4ed8"><title>${U.esc(points[i].label)}: ${points[i].value}%</title></circle>`; }
    });
    const labels = points.map((p, i) => `<text x="${x(i)}" y="${H - padB + 14}" text-anchor="middle" font-size="9" fill="#475569">${U.esc(p.label)}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${grid}
      <path d="${path}" fill="none" stroke="#1d4ed8" stroke-width="2.5"/>${dots}
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#cbd5e1"/>${labels}</svg>`;
  }

  function academics() {
    const students = Store.students;
    const grades = Store.gradeList();
    const withReport = students.filter(hasReport);
    const today = U.todayISO();

    // grade-scale distribution across all entered marks
    const scaleCount = { EX: 0, GD: 0, SA: 0, NI: 0 };
    students.forEach(s => { const m = (s.report && s.report.marks) || {}; Object.keys(m).forEach(k => Object.keys(m[k]).forEach(a => { const g = cellGrade(m[k][a]); if (scaleCount[g] != null) scaleCount[g]++; })); });
    const totalMarks = scaleCount.EX + scaleCount.GD + scaleCount.SA + scaleCount.NI;
    const segs = Store.REPORT.GRADE_SCALE.map(g => ({ label: g.code, value: scaleCount[g.code], color: GRADE_COLORS[g.code] }));

    // attendance today
    const day = Store.getAttendance(today);
    let present = 0, absent = 0; students.forEach(s => { if (day[s.id] === 'P') present++; else if (day[s.id] === 'A') absent++; });
    const marked = present + absent;
    const presentPct = marked ? Math.round(present / marked * 100) : 0;

    // 7-day attendance trend
    const days = lastDates(7).map(d => {
      const dd = Store.getAttendance(d); let p = 0, a = 0;
      students.forEach(s => { if (dd[s.id] === 'P') p++; else if (dd[s.id] === 'A') a++; });
      return { label: d.slice(5), value: (p + a) ? Math.round(p / (p + a) * 100) : null };
    });

    // per-grade report completion
    const gradeBars = grades.map(g => {
      const inG = students.filter(s => s.grade === g);
      const done = inG.filter(hasReport).length;
      return { label: g, value: inG.length ? Math.round(done / inG.length * 100) : 0, color: '#2563eb', sub: done + '/' + inG.length };
    });

    // per-grade absentees today
    const absToday = Store.absenteesOn(today);

    view().innerHTML = `
      <div class="page-head"><div><h1>Academics Dashboard</h1><p>Report cards &amp; attendance overview — ${U.esc(Store.meta.school || 'AKB School')}</p></div>
        <div class="flex gap"><a class="btn" href="#/attendance">📝 Attendance</a><a class="btn" href="#/marks">📚 Report Cards</a></div></div>
      <div class="cards">
        ${kpi('Students', students.length, { accent: 'blue' })}
        ${kpi('Report cards started', withReport.length, { accent: 'green', sub: (students.length ? Math.round(withReport.length / students.length * 100) : 0) + '% of students' })}
        ${kpi('Present today', present, { accent: 'green', sub: presentPct + '% of ' + marked + ' marked' })}
        ${kpi('Absent today', absent, { accent: absent ? 'red' : 'green', sub: absToday.length + ' across school' })}
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h2>Overall Grade Distribution</h2><span class="muted">${totalMarks} grades entered</span></div>
          <div class="panel-body pad">${totalMarks ? donut(segs) : '<div class="empty">No report-card grades entered yet.</div>'}</div></div>
        <div class="panel"><div class="panel-head"><h2>Attendance Trend (7 days)</h2><span class="muted">% present</span></div>
          <div class="panel-body pad">${lineChart(days)}</div></div>
      </div>
      <div class="panel"><div class="panel-head"><h2>Report Card Completion by Class</h2><span class="muted">% of students entered</span></div>
        <div class="panel-body pad">${gradeBars.length ? hbars(gradeBars, { pct: true }) : '<div class="empty">No classes yet.</div>'}</div></div>
      <div class="panel"><div class="panel-head"><h2>Absentees Today</h2><span class="muted">${U.fmtDate(today)}</span></div>
        <div class="table-scroll"><table><thead><tr><th>Class</th><th>Student</th><th>Parent mobile</th><th class="t-right">Notify</th></tr></thead>
        <tbody>${absToday.length ? absToday.sort((a, b) => String(a.grade).localeCompare(String(b.grade))).map(s => `<tr>
          <td>${U.esc(s.grade || '—')}</td><td><b>${U.esc(s.name)}</b></td><td>${U.esc(s.contact || '—')}</td>
          <td class="t-right">${s.contact ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${U.waLink(s.contact, absentText(s, today))}">💬</a>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="4" class="empty">No absentees recorded today. 🎉</td></tr>'}</tbody></table></div></div>`;
    bindNav();
  }

  w.Views = { dashboard, students, studentDetail, businessDashboard, collect, collections, reports, attendance, marks, academics, users, data, openPaymentModal, changePassword };
})(window);
