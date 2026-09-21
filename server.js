/* AKB Fee Collection — server
 * - Serves the static SPA
 * - Holds the shared app state (students/payments/users/meta) on disk so all
 *   devices share one dataset (GET/PUT /api/state with an optimistic version)
 * - Generates a formatted Excel workbook and can email it weekly
 * - Optional WhatsApp Business API bulk reminders
 *
 * Env vars (all optional unless noted):
 *   PORT                          (Railway sets this)
 *   APP_USER / APP_PASSWORD       HTTP Basic Auth for the whole site (recommended)
 *   DATA_DIR                      where state.json is stored (default: a writable
 *                                 /data volume, else ./.data). MOUNT A RAILWAY
 *                                 VOLUME at /data so data survives redeploys.
 *   Weekly email (SMTP via nodemailer):
 *     SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true/false),
 *     SMTP_USER, SMTP_PASS, MAIL_FROM
 *     BACKUP_EMAIL   (default contact@akbschools.com)
 *     BACKUP_DAY     0-6, 1=Mon (default 1)
 *     BACKUP_HOUR    0-23 (default 6)   -- server local time
 *   WhatsApp (see waSendOne): WA_PROVIDER/WA_TOKEN/WA_TEMPLATE/WA_PARAMS/...
 */
'use strict';
try { require('dotenv').config(); } catch (e) {}
const http = require('http');
const fs = require('fs');
const path = require('path');

let ExcelJS = null, nodemailer = null, mysql = null;
try { ExcelJS = require('exceljs'); } catch (e) { console.warn('exceljs not installed — Excel export disabled'); }
try { nodemailer = require('nodemailer'); } catch (e) { console.warn('nodemailer not installed — email disabled'); }
try { mysql = require('mysql2/promise'); } catch (e) { console.warn('mysql2 not installed — MySQL database storage disabled'); }

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const BOOT_AT = new Date().toISOString(); // when this server process last started
const USER = process.env.APP_USER || 'admin';
const PASS = process.env.APP_PASSWORD || '';
const SCHOOL = 'AKB School of Excellence';
const BACKUP_EMAIL = process.env.BACKUP_EMAIL || 'contact@akbschools.com';
const BACKUP_DAY = clampInt(process.env.BACKUP_DAY, 1, 0, 6);
const BACKUP_HOUR = clampInt(process.env.BACKUP_HOUR, 6, 0, 23);
function clampInt(v, def, lo, hi) { v = parseInt(v, 10); return isNaN(v) ? def : Math.max(lo, Math.min(hi, v)); }

/* ---------------- MySQL / Database Integration ---------------- */
const MYSQL_URL = process.env.MYSQL_URL || process.env.DATABASE_URL || '';
const MYSQL_HOST = process.env.MYSQL_HOST || '';
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD !== undefined ? process.env.MYSQL_PASSWORD : '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'akb-school-mk';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT, 10) || 3306;

let pool = null;
function getPool() {
  if (pool) return pool;
  if (!mysql) return null;
  try {
    if (MYSQL_URL) {
      pool = mysql.createPool(MYSQL_URL);
      return pool;
    }
    if (MYSQL_HOST) {
      pool = mysql.createPool({
        host: MYSQL_HOST,
        user: MYSQL_USER,
        password: MYSQL_PASSWORD,
        database: MYSQL_DATABASE,
        port: MYSQL_PORT,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
      return pool;
    }
  } catch (err) {
    console.warn('[MySQL Pool Error]', err.message);
  }
  return null;
}
function hasMySQL() { return !!(mysql && (MYSQL_URL || MYSQL_HOST)); }

/* ---------------- persistent state ---------------- */
const DATA_DIR = resolveDataDir();
const STATE_FILE = path.join(DATA_DIR, 'state.json');
function resolveDataDir() {
  const cand = process.env.DATA_DIR || '/data';
  try { fs.mkdirSync(cand, { recursive: true }); fs.accessSync(cand, fs.constants.W_OK); return cand; }
  catch (e) { const local = path.join(ROOT, '.data'); try { fs.mkdirSync(local, { recursive: true }); } catch (e2) {} return local; }
}
let DB = { version: 0, state: { students: [], payments: [], users: [], meta: {} }, lastBackupAt: null };
function loadDB() {
  try { DB = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); if (!DB.state) DB.state = { students: [], payments: [], users: [], meta: {} }; }
  catch (e) { /* fresh */ }

  if (!DB.state || !Array.isArray(DB.state.students) || !DB.state.students.length) {
    try {
      const seedPath = path.join(ROOT, 'data', 'students.seed.json');
      if (fs.existsSync(seedPath)) {
        const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        const st = Array.isArray(seedData) ? seedData : (seedData && seedData.students ? seedData.students : []);
        if (st.length) {
          DB.state = DB.state || {};
          DB.state.students = st;
          DB.state.meta = Object.assign({ seeded: true, school: seedData.school || 'AKB School of Excellence', year: seedData.year || '2026-2027' }, DB.state.meta || {});
          console.log('[Server] Loaded ' + st.length + ' students from data/students.seed.json');
        }
      }
    } catch (e) {
      console.warn('[Server] Seed load warning:', e.message);
    }
  }
}
let writeChain = Promise.resolve();
function saveDB() {
  writeChain = writeChain.then(() => new Promise((res) => {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(DB), err => { if (!err) { try { fs.renameSync(tmp, STATE_FILE); } catch (e) {} } res(); });
  }));
  return writeChain;
}
loadDB();

let lastMySqlLoadAt = 0;
async function loadDBFromMySQL(force) {
  const p = getPool();
  if (!p) return false;
  if (!force && Date.now() - lastMySqlLoadAt < 10000) return true;
  try {
    const [stRows] = await p.query('SELECT * FROM students');
    const [sfRows] = await p.query('SELECT * FROM student_fees');
    const [trRows] = await p.query('SELECT * FROM student_transport_monthly').catch(() => [[]]);
    const [subRows] = await p.query('SELECT * FROM student_sub_fees').catch(() => [[]]);
    const [repRows] = await p.query('SELECT * FROM report_cards').catch(() => [[]]);
    const [attRows] = await p.query('SELECT * FROM attendance').catch(() => [[]]);
    const [setRows] = await p.query('SELECT * FROM app_settings').catch(() => [[]]);

    const feesMap = {};
    for (const sf of sfRows) {
      if (!feesMap[sf.student_id]) feesMap[sf.student_id] = {};
      feesMap[sf.student_id][sf.head_key] = {
        label: sf.head_key,
        total: Number(sf.total_amount) || 0,
        paid: Number(sf.paid_amount) || 0,
        balance: Number(sf.balance_amount) || 0
      };
    }

    const transportMap = {};
    for (const tr of trRows) {
      if (!transportMap[tr.student_id]) transportMap[tr.student_id] = {};
      transportMap[tr.student_id][tr.month_key] = {
        total: Number(tr.total_amount) || 0,
        paid: Number(tr.paid_amount) || 0,
        balance: Number(tr.balance_amount) || 0
      };
    }

    const subFeesMap = {};
    for (const sub of subRows) {
      if (!subFeesMap[sub.student_id]) subFeesMap[sub.student_id] = {};
      if (!subFeesMap[sub.student_id][sub.parent_head_key]) subFeesMap[sub.student_id][sub.parent_head_key] = {};
      subFeesMap[sub.student_id][sub.parent_head_key][sub.sub_key] = {
        total: Number(sub.total_amount) || 0,
        paid: Number(sub.paid_amount) || 0,
        balance: Number(sub.balance_amount) || 0
      };
    }

    const reportMap = {};
    for (const rep of repRows) {
      try {
        let repObj = null;
        if (rep.report_json) {
          repObj = typeof rep.report_json === 'string' ? JSON.parse(rep.report_json) : rep.report_json;
        } else if (rep.marks_json) {
          const marks = typeof rep.marks_json === 'string' ? JSON.parse(rep.marks_json) : rep.marks_json;
          repObj = { marks: marks || {}, remarks: rep.remarks || '' };
        }
        if (repObj) {
          reportMap[rep.student_id] = repObj;
        }
      } catch (e) {}
    }

    const students = stRows.map(s => ({
      id: s.id,
      name: s.name,
      grade: s.grade,
      classTeacher: s.class_teacher,
      gender: s.gender,
      dob: s.dob,
      age: s.age,
      prevSchool: s.prev_school || s.prevSchool || '',
      father: s.father,
      mother: s.mother,
      contact: s.contact,
      religion: s.religion,
      location: s.location,
      dropLocation: s.drop_location,
      transportType: s.transport_type,
      vehicle: s.vehicle,
      status: s.status,
      discount: Number(s.discount) || 0,
      admission: s.admission,
      sportsActivity: s.sports_activity,
      photo: s.photo || '',
      fees: feesMap[s.id] || {},
      transport: transportMap[s.id] || undefined,
      subs: subFeesMap[s.id] || undefined,
      report: reportMap[s.id] || undefined
    }));

    const [pmRows] = await p.query('SELECT * FROM payments');
    const payments = pmRows.map(pm => {
      let items = [];
      try { items = typeof pm.items_json === 'string' ? JSON.parse(pm.items_json) : (pm.items_json || []); } catch (e) {}
      return {
        id: pm.receipt_no,
        receiptNo: pm.receipt_no,
        date: pm.date,
        businessName: pm.business_name,
        studentId: pm.student_id,
        studentName: pm.student_name,
        grade: pm.grade,
        mode: pm.mode,
        amount: Number(pm.amount) || 0,
        items
      };
    });

    const [usrRows] = await p.query('SELECT * FROM users');
    const prevUsers = (DB.state && Array.isArray(DB.state.users)) ? DB.state.users : [];
    const prevByName = {};
    prevUsers.forEach(pu => { if (pu && pu.username) prevByName[String(pu.username).toLowerCase()] = pu; });
    const users = usrRows.map(u => {
      let salt = u.salt || '';
      let hash = u.hash || '';
      const ph = u.password_hash || u.passwordHash || '';
      if ((!salt || !hash) && ph.indexOf(':') >= 0) {
        const parts = ph.split(':');
        salt = parts[0];
        hash = parts[1];
      }
      let pages = undefined;
      if (u.pages_json) {
        try { pages = typeof u.pages_json === 'string' ? JSON.parse(u.pages_json) : u.pages_json; } catch(e) {}
      }
      let grades = undefined;
      if (u.grades_json) {
        try { grades = typeof u.grades_json === 'string' ? JSON.parse(u.grades_json) : u.grades_json; } catch(e) {}
      }

      const prev = prevByName[String(u.username).toLowerCase()] || {};
      if (!pages && Array.isArray(prev.pages)) pages = prev.pages.slice();
      if (!grades && Array.isArray(prev.grades)) grades = prev.grades.slice();

      const obj = {
        username: u.username,
        name: u.name,
        role: u.role,
        salt,
        hash,
        passwordHash: ph
      };
      if (Array.isArray(pages)) obj.pages = pages;
      if (Array.isArray(grades)) obj.grades = grades;
      if (prev.mustChange !== undefined) obj.mustChange = prev.mustChange;
      if (prev.pwCustom !== undefined) obj.pwCustom = prev.pwCustom;
      if (prev.updatedAt) obj.updatedAt = prev.updatedAt;
      return obj;
    });

    const [fhRows] = await p.query('SELECT * FROM fee_heads');
    const feeHeads = fhRows.map(fh => ({
      key: fh.head_key,
      label: fh.label,
      business: fh.business
    }));

    const settingsMap = {};
    for (const set of setRows) {
      try {
        settingsMap[set.setting_key] = typeof set.setting_value === 'string' ? JSON.parse(set.setting_value) : set.setting_value;
      } catch (e) {
        settingsMap[set.setting_key] = set.setting_value;
      }
    }

    const attendanceMap = {};
    for (const att of attRows) {
      if (!attendanceMap[att.date]) attendanceMap[att.date] = {};
      attendanceMap[att.date][att.student_id] = att.status;
    }

    const meta = Object.assign({}, DB.state.meta || {}, settingsMap);
    if (feeHeads.length > 0) meta.feeHeads = feeHeads;
    if (Object.keys(attendanceMap).length > 0) meta.attendance = attendanceMap;

    if (students.length > 0 || payments.length > 0) {
      lastMySqlLoadAt = Date.now();
      DB.state = {
        students,
        payments,
        users: users.length > 0 ? users : DB.state.users,
        meta
      };
      return true;
    }
  } catch (err) {
    console.warn('[MySQL Load Warn]', err.message);
  }
  return false;
}

function getActor(req, body) {
  if (req && req.headers && req.headers['x-user-name']) return req.headers['x-user-name'];
  if (body && body.currentUser && body.currentUser.username) return body.currentUser.username;
  if (body && body.actor) return body.actor;
  if (body && body.updatedBy) return body.updatedBy;
  if (body && body.createdBy) return body.createdBy;
  if (req && req.headers && req.headers['authorization']) {
    try {
      const h = req.headers['authorization'];
      if (h.startsWith('Basic ')) {
        const d = Buffer.from(h.slice(6), 'base64').toString('utf8');
        return d.split(':')[0] || 'system';
      }
    } catch(e) {}
  }
  return 'system';
}

async function logAudit(action, entityType, entityId, details, actor, req) {
  actor = actor || 'system';
  const detailsJson = typeof details === 'object' ? JSON.stringify(details) : (details ? String(details) : null);
  let ip = null;
  if (req) {
    ip = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || (req.socket && req.socket.remoteAddress) || null;
    if (ip && ip.indexOf(',') >= 0) ip = ip.split(',')[0].trim();
  }
  const now = new Date().toISOString();

  if (!DB.state.auditLogs) DB.state.auditLogs = [];
  const logObj = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    action,
    entityType,
    entityId: String(entityId || ''),
    details: details || {},
    performedBy: actor,
    ipAddress: ip,
    createdAt: now
  };
  DB.state.auditLogs.unshift(logObj);
  if (DB.state.auditLogs.length > 1000) DB.state.auditLogs.pop();

  if (hasMySQL()) {
    const p = getPool();
    if (p) {
      p.query(
        `INSERT INTO audit_logs (action, entity_type, entity_id, details_json, performed_by, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [action, entityType, String(entityId || ''), detailsJson, actor, ip]
      ).catch(err => console.warn('[Audit Log MySQL Warn]', err.message));
    }
  }
}

async function saveStudentInMySQL(p, s, stateMeta, actor) {
  if (!p || !s || !s.id) return;
  actor = actor || s.updatedBy || s.createdBy || 'system';

  // 1. Guarantee Fee Heads exist first (in parallel) so foreign key constraint in student_fees never fails
  const feeHeadsList = (stateMeta && Array.isArray(stateMeta.feeHeads) && stateMeta.feeHeads.length)
    ? stateMeta.feeHeads
    : DEFAULT_FEE_HEADS;

  const fhPromises = feeHeadsList
    .filter(fh => fh && fh.key)
    .map(fh => p.query(
      `INSERT INTO fee_heads (head_key, label, business, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE label=VALUES(label), business=VALUES(business), updated_by=VALUES(updated_by), updated_at=NOW()`,
      [fh.key, fh.label || fh.key, fh.business || 'school', actor, actor]
    ).catch(() => {}));
  await Promise.all(fhPromises);

  // 2. Insert/Update Student record
  await p.query(
    `INSERT INTO students (id, name, grade, class_teacher, gender, dob, age, prev_school, father, mother, contact, religion, location, drop_location, transport_type, vehicle, status, discount, admission, sports_activity, photo, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       name=VALUES(name), grade=VALUES(grade), class_teacher=VALUES(class_teacher), gender=VALUES(gender),
       dob=VALUES(dob), age=VALUES(age), prev_school=VALUES(prev_school), father=VALUES(father), mother=VALUES(mother),
       contact=VALUES(contact), religion=VALUES(religion), location=VALUES(location), drop_location=VALUES(drop_location),
       transport_type=VALUES(transport_type), vehicle=VALUES(vehicle), status=VALUES(status), discount=VALUES(discount),
       admission=VALUES(admission), sports_activity=VALUES(sports_activity), photo=VALUES(photo), updated_by=VALUES(updated_by), updated_at=NOW()`,
    [
      s.id, s.name || '', s.grade || '', s.classTeacher || null, s.gender || null, s.dob || null, s.age || null, s.prevSchool || null,
      s.father || null, s.mother || null, s.contact || null, s.religion || null, s.location || null, s.dropLocation || null,
      s.transportType || null, s.vehicle || null, s.status || 'active', Number(s.discount) || 0, s.admission || 'NEW',
      s.sportsActivity || null, s.photo || null, actor, actor
    ]
  );

  const subTasks = [];

  // 3. Insert/Update Student Fee Heads (parallel, no redundant fee_heads calls)
  if (s.fees && typeof s.fees === 'object') {
    for (const headKey of Object.keys(s.fees)) {
      const f = s.fees[headKey];
      if (!f) continue;
      const tot = typeof f === 'object' ? (Number(f.total) || 0) : (Number(f) || 0);
      const pd = typeof f === 'object' ? (Number(f.paid) || 0) : 0;
      const bal = typeof f === 'object' ? (Number(f.balance) || (tot - pd)) : tot;

      subTasks.push(p.query(
        `INSERT INTO student_fees (student_id, head_key, total_amount, paid_amount, balance_amount, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           total_amount=VALUES(total_amount), paid_amount=VALUES(paid_amount), balance_amount=VALUES(balance_amount), updated_by=VALUES(updated_by), updated_at=NOW()`,
        [s.id, headKey, tot, pd, bal, actor, actor]
      ).catch(fe => console.warn('[MySQL Save Student Fee Warn]', s.id, headKey, fe.message)));
    }
  }

  // 4. Insert/Update Student Transport Monthly (parallel)
  if (s.transport && typeof s.transport === 'object') {
    for (const mKey of Object.keys(s.transport)) {
      const tr = s.transport[mKey];
      if (!tr) continue;
      subTasks.push(p.query(
        `INSERT INTO student_transport_monthly (student_id, month_key, total_amount, paid_amount, balance_amount, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           total_amount=VALUES(total_amount), paid_amount=VALUES(paid_amount), balance_amount=VALUES(balance_amount), updated_by=VALUES(updated_by), updated_at=NOW()`,
        [s.id, mKey, Number(tr.total) || 0, Number(tr.paid) || 0, Number(tr.balance) || 0, actor, actor]
      ).catch(() => {}));
    }
  }

  // 5. Insert/Update Student Sub Fees (parallel)
  if (s.subs && typeof s.subs === 'object') {
    for (const pHead of Object.keys(s.subs)) {
      const bag = s.subs[pHead];
      if (!bag || typeof bag !== 'object') continue;
      for (const subKey of Object.keys(bag)) {
        const sb = bag[subKey];
        if (!sb) continue;
        subTasks.push(p.query(
          `INSERT INTO student_sub_fees (student_id, parent_head_key, sub_key, total_amount, paid_amount, balance_amount, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             total_amount=VALUES(total_amount), paid_amount=VALUES(paid_amount), balance_amount=VALUES(balance_amount), updated_by=VALUES(updated_by), updated_at=NOW()`,
          [s.id, pHead, subKey, Number(sb.total) || 0, Number(sb.paid) || 0, Number(sb.balance) || 0, actor, actor]
        ).catch(() => {}));
      }
    }
  }

  // 6. Insert/Update Student Report Cards
  if (s.report && typeof s.report === 'object') {
    const reportJson = JSON.stringify(s.report);
    const marksJson = JSON.stringify(s.report.marks || {});
    const remarksStr = s.report.remarks || '';
    subTasks.push(p.query(
      `INSERT INTO report_cards (student_id, term, report_json, marks_json, remarks, created_by, updated_by, created_at, updated_at)
       VALUES (?, 'Term I', ?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE report_json=VALUES(report_json), marks_json=VALUES(marks_json), remarks=VALUES(remarks), updated_by=VALUES(updated_by), updated_at=NOW()`,
      [s.id, reportJson, marksJson, remarksStr, actor, actor]
    ).catch(err => console.warn('[Batch ReportCard MySQL Update Warn]', err.message)));
  }

  await Promise.all(subTasks);
}

async function saveDBToMySQL(state, actor) {
  actor = actor || 'system';
  const p = getPool();
  if (!p || !state) return;
  try {
    // 1. Sync Fee Heads FIRST so foreign keys exist
    if (state.meta && Array.isArray(state.meta.feeHeads)) {
      for (const fh of state.meta.feeHeads) {
        if (!fh.key) continue;
        await p.query(
          `INSERT INTO fee_heads (head_key, label, business, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             label=VALUES(label), business=VALUES(business), updated_by=VALUES(updated_by), updated_at=NOW()`,
          [fh.key, fh.label || fh.key, fh.business || 'school', actor, actor]
        ).catch(() => {});
      }
    }

    // 2. Sync Payments & Payment Items
    if (Array.isArray(state.payments)) {
      for (const pm of state.payments) {
        const receiptNo = pm.receiptNo || pm.id;
        if (!receiptNo) continue;
        const pmActor = pm.createdBy || pm.updatedBy || actor;
        const itemsJson = JSON.stringify(pm.items || []);
        await p.query(
          `INSERT INTO payments (receipt_no, date, business_name, student_id, student_name, grade, mode, amount, items_json, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             date=VALUES(date), business_name=VALUES(business_name), student_id=VALUES(student_id), student_name=VALUES(student_name),
             grade=VALUES(grade), mode=VALUES(mode), amount=VALUES(amount), items_json=VALUES(items_json), updated_by=VALUES(updated_by), updated_at=NOW()`,
          [receiptNo, pm.date || '', pm.businessName || '', pm.studentId || '', pm.studentName || '', pm.grade || '', pm.mode || '', Number(pm.amount) || 0, itemsJson, pmActor, pmActor]
        );

        if (Array.isArray(pm.items)) {
          for (const item of pm.items) {
            await p.query(
              `INSERT INTO payment_items (receipt_no, head_key, head_label, business_name, amount, created_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE head_label=VALUES(head_label), amount=VALUES(amount), updated_by=VALUES(updated_by), updated_at=NOW()`,
              [receiptNo, item.headKey || item.key || item.head || '', item.label || '', pm.businessName || '', Number(item.amount) || 0, pmActor, pmActor]
            ).catch(() => {});
          }
        }
      }
    }

    // 3. Sync Students
    if (Array.isArray(state.students)) {
      for (const s of state.students) {
        if (!s.id) continue;
        await saveStudentInMySQL(p, s, state.meta, actor);
      }
    }

    // 4. Sync Users
    if (Array.isArray(state.users)) {
      for (const u of state.users) {
        if (!u.username) continue;
        const pwd = u.salt ? `${u.salt}:${u.hash}` : (u.passwordHash || u.hash || u.password || 'admin@123');
        const pagesJson = Array.isArray(u.pages) ? JSON.stringify(u.pages) : null;
        const gradesJson = Array.isArray(u.grades) ? JSON.stringify(u.grades) : null;
        await p.query(
          `INSERT INTO users (username, password_hash, role, name, pages_json, grades_json, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             password_hash=VALUES(password_hash), role=VALUES(role), name=VALUES(name),
             pages_json=COALESCE(VALUES(pages_json), pages_json),
             grades_json=COALESCE(VALUES(grades_json), grades_json),
             updated_by=VALUES(updated_by), updated_at=NOW()`,
          [u.username, pwd, u.role || 'account', u.name || u.username, pagesJson, gradesJson, actor, actor]
        ).catch(err => {
          return p.query(
            `INSERT INTO users (username, password_hash, role, name, created_by, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role), name=VALUES(name), updated_by=VALUES(updated_by), updated_at=NOW()`,
            [u.username, pwd, u.role || 'account', u.name || u.username, actor, actor]
          );
        });
      }
    }

    // 5. Sync Attendance
    if (state.meta && state.meta.attendance && typeof state.meta.attendance === 'object') {
      const attObj = state.meta.attendance;
      for (const dKey of Object.keys(attObj)) {
        const stMap = attObj[dKey];
        if (!stMap || typeof stMap !== 'object') continue;
        for (const stId of Object.keys(stMap)) {
          const stVal = stMap[stId];
          if (!stVal) continue;
          // Guarantee parent student record exists in students table to prevent FK constraint error
          await p.query(
            `INSERT INTO students (id, name, created_by, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE updated_at=NOW()`,
            [stId, stId, actor, actor]
          ).catch(() => {});

          await p.query(
            `INSERT INTO attendance (date, student_id, status, created_by, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE status=VALUES(status), updated_by=VALUES(updated_by), updated_at=NOW()`,
            [dKey, stId, String(stVal), actor, actor]
          ).catch(err => {
            console.warn('[MySQL Save Attendance Warn]', dKey, stId, err.message);
          });
        }
      }
    }

    // 6. Sync App Settings (meta)
    if (state.meta && typeof state.meta === 'object') {
      for (const k of Object.keys(state.meta)) {
        if (k === 'attendance' || k === 'feeHeads') continue;
        if (state.meta[k] !== undefined) {
          const valStr = JSON.stringify(state.meta[k]);
          await p.query(
            `INSERT INTO app_settings (setting_key, setting_value, created_by, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by), updated_at=NOW()`,
            [k, valStr, actor, actor]
          ).catch(err => {
            console.warn('[MySQL Save App Settings Warn]', k, err.message);
          });
        }
      }
    }
  } catch (err) {
    console.warn('[MySQL Save Warn]', err.message);
  }
}

if (hasMySQL()) {
  try {
    const { setupDatabase } = require('./scripts/setup');
    setupDatabase()
      .then(() => loadDBFromMySQL())
      .then(() => { if (ensureProvisionedUsers()) { saveDB(); return persistProvisionedUsersToMySQL(); } })
      .catch(err => {
        console.warn('[DB Auto-Setup Warn]', err.message);
        loadDBFromMySQL().then(() => { if (ensureProvisionedUsers()) { saveDB(); return persistProvisionedUsersToMySQL(); } });
      });
  } catch (e) {
    loadDBFromMySQL().then(() => { if (ensureProvisionedUsers()) { saveDB(); return persistProvisionedUsersToMySQL(); } });
  }
}

/* ---------------- guaranteed / server-managed logins ----------------
 * The built-in accounts (admin/account/teacher/academic) must always exist and,
 * for teacher/academic, always carry the right role, page access and all-class
 * scope. They are (re)created on boot, restored on every save if deleted, and
 * their access is enforced on load — so they never silently drift. Passwords a
 * user deliberately changes (pwCustom) are preserved. */
const _crypto = require('crypto');
function makeCred(password) {
  const salt = _crypto.randomBytes(16).toString('hex');
  const hash = _crypto.pbkdf2Sync(String(password), Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');
  return { salt, hash };
}
function verifyCred(password, u) {
  try {
    if (!u) return false;
    let salt = u.salt, hash = u.hash;
    if ((!salt || !hash) && u.passwordHash && String(u.passwordHash).indexOf(':') >= 0) {
      const pr = String(u.passwordHash).split(':'); salt = pr[0]; hash = pr[1];
    }
    if (!salt || !hash) return false;
    const h = _crypto.pbkdf2Sync(String(password), Buffer.from(String(salt), 'hex'), 100000, 32, 'sha256').toString('hex');
    return h === hash;
  } catch (e) { return false; }
}
function isStrongHash(h) { return typeof h === 'string' && /^[0-9a-f]{64}$/.test(h); }
function setCred(u, password) { const c = makeCred(password); u.salt = c.salt; u.hash = c.hash; u.passwordHash = c.salt + ':' + c.hash; }

const SEED = [
  { username: 'admin', name: 'System Administrator', password: 'admin@123', role: 'admin' },
  { username: 'account1', name: 'Accounts Manager 1', password: 'account1@123', role: 'account' },
  { username: 'account2', name: 'Accounts Manager 2', password: 'account2@123', role: 'account' }
];
const PROVISIONED = [
  { username: 'teacher', name: 'Teacher', password: 'teacher@123', role: 'teacher',
    pages: ['dashboard', 'students', 'attendance', 'attreport', 'marks', 'reports'], allClasses: true },
  { username: 'academic', name: 'Academic', password: 'academic@123', role: 'akbch_academics',
    pages: ['attendance', 'attreport', 'marks', 'academics', 'data'], allClasses: true }
];

function ensureProvisionedUsers() {
  const st = DB.state || (DB.state = { students: [], payments: [], users: [], meta: {} });
  st.users = st.users || [];
  const allGrades = () => Array.from(new Set((st.students || []).map(s => s && s.grade).filter(Boolean)));
  const now = () => new Date().toISOString();
  const eq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.slice().sort().join('') === b.slice().sort().join('');
  let changed = false;

  SEED.forEach(def => {
    const u = st.users.find(x => String(x.username).toLowerCase() === def.username);
    if (!u) {
      const nu = { username: def.username, name: def.name, role: def.role, mustChange: false, createdAt: now(), updatedAt: now() };
      setCred(nu, def.password); st.users.push(nu); changed = true;
      console.log('Provisioned seed "' + def.username + '".');
    } else if (verifyCred(def.password, u)) {
      if (!isStrongHash(u.hash)) { setCred(u, def.password); u.updatedAt = now(); changed = true; }
      else if (!u.passwordHash && u.salt && u.hash) { u.passwordHash = u.salt + ':' + u.hash; changed = true; }
    } else if (!u.pwCustom) {
      setCred(u, def.password); u.role = def.role; u.mustChange = false; u.updatedAt = now(); changed = true;
      console.log('Reset seed "' + def.username + '" to default password.');
    } // else: a deliberately-changed password (pwCustom) — leave it.
  });

  PROVISIONED.forEach(def => {
    const grades = def.allClasses ? allGrades() : [];
    let u = st.users.find(x => String(x.username).toLowerCase() === def.username);
    if (!u) {
      u = { username: def.username, name: def.name, role: def.role, mustChange: false, grades: grades, pages: def.pages.slice(), createdAt: now(), updatedAt: now() };
      setCred(u, def.password); st.users.push(u); changed = true;
      console.log('Provisioned "' + def.username + '" login with ' + grades.length + ' classes.');
    } else if (!verifyCred(def.password, u)) {
      setCred(u, def.password); u.role = def.role; u.mustChange = false; u.grades = grades; u.pages = def.pages.slice(); u.updatedAt = now();
      changed = true;
      console.log('Reset "' + def.username + '" login to default password.');
    } else {
      if (!isStrongHash(u.hash)) { setCred(u, def.password); changed = true; }
      else if (!u.passwordHash && u.salt && u.hash) { u.passwordHash = u.salt + ':' + u.hash; changed = true; }
      // Enforce the managed role / pages / all-class scope.
      if (u.role !== def.role) { u.role = def.role; changed = true; }
      if (!eq(u.pages, def.pages)) { u.pages = def.pages.slice(); changed = true; }
      if (def.allClasses && !sameSet(u.grades, grades)) { u.grades = grades; changed = true; }
      if (changed) u.updatedAt = now();
    }
  });

  return changed;
}

// Upsert the guaranteed accounts into MySQL so their credentials are durable.
async function persistProvisionedUsersToMySQL() {
  if (!hasMySQL()) return;
  const p = getPool();
  if (!p) return;
  const managed = new Set([].concat(SEED, PROVISIONED).map(d => d.username));
  const users = (DB.state && DB.state.users) || [];
  for (const u of users) {
    if (!managed.has(String(u.username).toLowerCase())) continue;
    const pwd = u.salt ? `${u.salt}:${u.hash}` : (u.passwordHash || u.hash || 'admin@123');
    try {
      await p.query(
        `INSERT INTO users (username, password_hash, role, name, created_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role), name=VALUES(name)`,
        [u.username, pwd, u.role || 'account', u.name || u.username]
      );
    } catch (err) { console.warn('[Provision MySQL Upsert Warn]', err.message); }
  }
}

// File-only mode (no MySQL): guarantee the built-in logins exist on boot.
if (!hasMySQL()) { if (ensureProvisionedUsers()) saveDB(); }

/* ---------------- helpers ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8'
};
function unauthorized(res) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AKB Fee Collection"', 'Content-Type': 'text/plain' }); res.end('Authentication required'); }
function checkAuth(req) {
  if (!PASS) return true;
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Basic ')) return false;
  let d = ''; try { d = Buffer.from(h.slice(6), 'base64').toString('utf8'); } catch (e) { return false; }
  const i = d.indexOf(':'); return d.slice(0, i) === USER && d.slice(i + 1) === PASS;
}
function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readBody(req, limit) {
  return new Promise((resolve, reject) => { let d = '', n = 0; req.on('data', c => { n += c.length; if (n > (limit || 20e6)) { reject(new Error('Body too large')); req.destroy(); } else d += c; }); req.on('end', () => resolve(d)); req.on('error', reject); });
}

/* ---------------- fee-head helpers (server view of state) ---------------- */
const DEFAULT_FEE_HEADS = [
  { key: 'term1', label: 'Term 1 Fees', business: 'school' }, { key: 'term2', label: 'Term 2 Fees', business: 'school' },
  { key: 'term3', label: 'Term 3 Fees', business: 'school' }, { key: 'supplies', label: 'School Supplies', business: 'co' },
  { key: 'app_fees', label: 'App Fees Paid', business: 'school' }, { key: 'uniform', label: 'Uniform & Accessories', business: 'co' },
  { key: 'transport', label: 'Transport Fees', business: 'falcon' }, { key: 'extra_curricular', label: 'Extra Curricular Fees', business: 'school' },
  { key: 'evening_sports', label: 'Evening Sports', business: 'sports' }, { key: 'event', label: 'Event Fees', business: 'school' }
];
const BIZ_NAME = { school: 'AKB School of Excellence', co: 'AKB & Co', falcon: 'Falcon Trading & Transport', sports: 'AKB Sports Academy' };
function feeHeads() { const f = DB.state.meta && DB.state.meta.feeHeads; return (Array.isArray(f) && f.length) ? f : DEFAULT_FEE_HEADS; }
function inr(n) { n = Math.round(Number(n) || 0); return '₹' + n.toLocaleString('en-IN'); }

/* ---------------- Excel workbook ---------------- */
async function buildWorkbook() {
  if (!ExcelJS) throw new Error('exceljs not installed');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AKB Fee Collection';
  const st = DB.state; const heads = feeHeads();
  const students = st.students || [], payments = st.payments || [];
  const tot = s => heads.reduce((a, h) => { const f = (s.fees || {})[h.key] || {}; return { total: a.total + (+f.total || 0), paid: a.paid + (+f.paid || 0) }; }, { total: 0, paid: 0 });

  // category + business summaries
  const cat = heads.map(h => { let total = 0, paid = 0; students.forEach(s => { const f = (s.fees || {})[h.key] || {}; total += +f.total || 0; paid += +f.paid || 0; }); return { label: h.label, biz: BIZ_NAME[h.business] || '', total, paid, bal: total - paid }; });
  const gt = cat.reduce((a, c) => a + c.total, 0), gp = cat.reduce((a, c) => a + c.paid, 0);
  const money = '#,##0';

  // Dashboard
  const d = wb.addWorksheet('Dashboard', { properties: { defaultColWidth: 22 } });
  d.mergeCells('A1:E1'); d.getCell('A1').value = SCHOOL + ' — Fee Collection'; d.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF7A1420' } };
  d.getCell('A2').value = 'Backup generated: ' + new Date().toString();
  d.addRow([]);
  d.addRow(['Students', students.length]);
  d.addRow(['Total Billed', gt]); d.addRow(['Collected', gp]); d.addRow(['Outstanding', gt - gp]);
  [5, 6, 7].forEach(r => d.getCell('B' + r).numFmt = money);
  d.addRow([]);
  const ch = d.addRow(['Fee Category', 'Business', 'Total', 'Collected', 'Outstanding', '% Paid']); ch.font = { bold: true };
  cat.forEach(c => { const r = d.addRow([c.label, c.biz, c.total, c.paid, c.bal, c.total ? Math.round(c.paid / c.total * 100) / 100 : 0]); ['C', 'D', 'E'].forEach(x => r.getCell(x).numFmt = money); r.getCell('F').numFmt = '0%'; });
  const tr = d.addRow(['TOTAL', '', gt, gp, gt - gp, gt ? Math.round(gp / gt * 100) / 100 : 0]); tr.font = { bold: true }; ['C', 'D', 'E'].forEach(x => tr.getCell(x).numFmt = money); tr.getCell('F').numFmt = '0%';

  // Students
  const sh = wb.addWorksheet('Students');
  const sHead = ['Student ID', 'Name', 'Grade', 'Father', 'Parent Mobile', 'Discount %'];
  heads.forEach(h => sHead.push(h.label + ' Total', h.label + ' Paid', h.label + ' Bal'));
  sHead.push('Grand Total', 'Grand Paid', 'Grand Balance');
  const shr = sh.addRow(sHead); shr.font = { bold: true }; sh.views = [{ state: 'frozen', ySplit: 1 }];
  students.forEach(s => {
    const t = tot(s); const row = [s.id, s.name, s.grade, s.father, s.contact, Math.round((+s.discount || 0) * 100)];
    heads.forEach(h => { const f = (s.fees || {})[h.key] || {}; row.push(+f.total || 0, +f.paid || 0, +f.balance || ((+f.total || 0) - (+f.paid || 0))); });
    row.push(t.total, t.paid, t.total - t.paid); sh.addRow(row);
  });

  // Payments
  const ph = wb.addWorksheet('Payments');
  const pHeadRow = ph.addRow(['Date', 'Receipt', 'Business', 'Student ID', 'Student', 'Grade', 'For', 'Mode', 'Amount']); pHeadRow.font = { bold: true }; ph.views = [{ state: 'frozen', ySplit: 1 }];
  payments.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).forEach(p => {
    ph.addRow([p.date, p.receiptNo, p.businessName || '', p.studentId, p.studentName, p.grade, (p.items || []).map(i => i.label).join('; '), p.mode, p.amount]);
  });

  // auto width (rough)
  [d, sh, ph].forEach(ws => ws.columns.forEach(c => { let m = 10; c.eachCell({ includeEmpty: true }, cell => { const v = cell.value; const l = v == null ? 0 : String(v).length; if (l > m) m = l; }); c.width = Math.min(40, m + 2); }));

  return wb.xlsx.writeBuffer();
}

/* ---------------- email ---------------- */
function mailer() {
  if (!nodemailer || !process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: clampInt(process.env.SMTP_PORT, 587, 1, 65535),
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}
function emailConfigured() { return !!(nodemailer && process.env.SMTP_HOST && (process.env.MAIL_FROM || process.env.SMTP_USER)); }
async function sendBackupEmail() {
  const t = mailer(); if (!t) throw new Error('SMTP not configured (set SMTP_HOST/SMTP_USER/SMTP_PASS)');
  const buf = await buildWorkbook();
  const today = new Date().toISOString().slice(0, 10);
  const students = (DB.state.students || []).length;
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: BACKUP_EMAIL,
    subject: 'AKB Fee Collection — Weekly Backup (' + today + ')',
    text: 'Automated weekly backup from the AKB Fee Collection app.\n\nStudents: ' + students + '\nGenerated: ' + new Date().toString(),
    attachments: [{ filename: 'akb-fees-backup-' + today + '.xlsx', content: Buffer.from(buf) }]
  });
  DB.lastBackupAt = new Date().toISOString(); await saveDB();
}

/* weekly scheduler: check twice an hour */
setInterval(() => {
  try {
    if (!emailConfigured()) return;
    const now = new Date();
    if (now.getDay() !== BACKUP_DAY || now.getHours() !== BACKUP_HOUR) return;
    if (DB.lastBackupAt && (Date.now() - new Date(DB.lastBackupAt).getTime()) < 20 * 3600 * 1000) return; // already sent recently
    sendBackupEmail().then(() => console.log('Weekly backup emailed to ' + BACKUP_EMAIL)).catch(e => console.error('Backup email failed:', e.message));
  } catch (e) {}
}, 30 * 60 * 1000);

/* ---------------- WhatsApp (unchanged provider senders) ---------------- */
const WA = {
  provider: (process.env.WA_PROVIDER || '').toLowerCase().trim(), token: process.env.WA_TOKEN || '', template: process.env.WA_TEMPLATE || '',
  lang: process.env.WA_LANG || 'en', phoneId: process.env.WA_PHONE_ID || '', source: process.env.WA_SOURCE || '', app: process.env.WA_APP || '',
  params: (process.env.WA_PARAMS || 'name,balance').split(',').map(s => s.trim()).filter(Boolean)
};
function waConfigured() { return !!(WA.provider && WA.token && WA.template); }
function normPhone(p) { let d = String(p == null ? '' : p).replace(/\D/g, ''); if (d.length === 11 && d[0] === '0') d = d.slice(1); if (d.length === 10) d = '91' + d; return d; }
async function waSendOne(rcpt) {
  const to = normPhone(rcpt.phone); if (to.length < 11) throw new Error('bad phone');
  const fields = { name: rcpt.name || '', balance: rcpt.balance || '', grade: rcpt.grade || '', school: SCHOOL, id: rcpt.id || '' };
  const params = WA.params.map(k => String(fields[k] != null ? fields[k] : ''));
  if (WA.provider === 'meta') {
    const body = { messaging_product: 'whatsapp', to, type: 'template', template: { name: WA.template, language: { code: WA.lang }, components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: t })) }] } };
    const r = await fetch(`https://graph.facebook.com/v20.0/${WA.phoneId}/messages`, { method: 'POST', headers: { Authorization: 'Bearer ' + WA.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('meta ' + r.status + ': ' + (await r.text()).slice(0, 180));
  } else if (WA.provider === 'interakt') {
    const body = { countryCode: '+91', phoneNumber: to.replace(/^91/, ''), type: 'Template', template: { name: WA.template, languageCode: WA.lang, bodyValues: params } };
    const r = await fetch('https://api.interakt.ai/v1/public/message/', { method: 'POST', headers: { Authorization: 'Basic ' + WA.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('interakt ' + r.status + ': ' + (await r.text()).slice(0, 180));
  } else if (WA.provider === 'gupshup') {
    const form = new URLSearchParams(); form.set('channel', 'whatsapp'); form.set('source', WA.source); form.set('destination', to); form.set('src.name', WA.app); form.set('template', JSON.stringify({ id: WA.template, params }));
    const r = await fetch('https://api.gupshup.io/wa/api/v1/template/msg', { method: 'POST', headers: { apikey: WA.token, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (!r.ok) throw new Error('gupshup ' + r.status + ': ' + (await r.text()).slice(0, 180));
  } else throw new Error('unknown WA_PROVIDER "' + WA.provider + '"');
}

/* ---------------- request handling ---------------- */
async function handleSendReminders(req, res) {
  if (!PASS) return sendJSON(res, 403, { error: 'Set APP_PASSWORD before enabling WhatsApp sending.' });
  if (!waConfigured()) return sendJSON(res, 400, { error: 'WhatsApp not configured.' });
  let payload; try { payload = JSON.parse(await readBody(req)); } catch (e) { return sendJSON(res, 400, { error: 'Invalid JSON' }); }
  const recipients = Array.isArray(payload && payload.recipients) ? payload.recipients.slice(0, 1000) : [];
  if (!recipients.length) return sendJSON(res, 400, { error: 'No recipients' });
  let sent = 0, failed = 0; const errors = [];
  for (const r of recipients) { try { await waSendOne(r); sent++; } catch (e) { failed++; if (errors.length < 25) errors.push((r.name || r.phone) + ': ' + e.message); } await new Promise(rs => setTimeout(rs, 120)); }
  sendJSON(res, 200, { sent, failed, errors });
}

const server = http.createServer(async (req, res) => {
  if (!checkAuth(req)) return unauthorized(res);
  const url = (req.url || '/').split('?')[0];
  try {
    if (url === '/api/audit-logs' && req.method === 'GET') {
      const q = (req.url || '').split('?')[1] || '';
      const params = new URLSearchParams(q);
      const limit = Math.min(500, Math.max(1, parseInt(params.get('limit'), 10) || 100));
      const entityType = params.get('entityType') || '';
      const action = params.get('action') || '';
      const search = params.get('search') || '';

      if (hasMySQL()) {
        const p = getPool();
        if (p) {
          try {
            let sql = 'SELECT * FROM audit_logs WHERE 1=1';
            const sqlParams = [];
            if (entityType) { sql += ' AND entity_type = ?'; sqlParams.push(entityType); }
            if (action) { sql += ' AND action = ?'; sqlParams.push(action); }
            if (search) {
              sql += ' AND (entity_id LIKE ? OR performed_by LIKE ? OR action LIKE ? OR details_json LIKE ?)';
              const term = `%${search}%`;
              sqlParams.push(term, term, term, term);
            }
            sql += ' ORDER BY id DESC LIMIT ?';
            sqlParams.push(limit);

            const [rows] = await p.query(sql, sqlParams);
            const logs = rows.map(r => ({
              id: r.id,
              action: r.action,
              entityType: r.entity_type,
              entityId: r.entity_id,
              details: (() => { try { return typeof r.details_json === 'string' ? JSON.parse(r.details_json) : r.details_json; } catch(e) { return r.details_json; } })(),
              performedBy: r.performed_by,
              ipAddress: r.ip_address,
              createdAt: r.created_at
            }));
            return sendJSON(res, 200, { logs });
          } catch(e) {
            console.warn('[Audit Log Endpoint Warn]', e.message);
          }
        }
      }

      let logs = (DB.state && Array.isArray(DB.state.auditLogs)) ? DB.state.auditLogs.slice() : [];
      if (entityType) logs = logs.filter(l => l.entityType === entityType);
      if (action) logs = logs.filter(l => l.action === action);
      if (search) {
        const term = search.toLowerCase();
        logs = logs.filter(l => String(l.entityId).toLowerCase().includes(term) || String(l.performedBy).toLowerCase().includes(term) || String(l.action).toLowerCase().includes(term));
      }
      return sendJSON(res, 200, { logs: logs.slice(0, limit) });
    }
    if (url === '/api/students' && req.method === 'GET') {
      if (hasMySQL()) { try { await loadDBFromMySQL(); } catch (e) {} }
      return sendJSON(res, 200, (DB.state && DB.state.students) || []);
    }
    if (url === '/api/payments' && req.method === 'GET') {
      if (hasMySQL()) { try { await loadDBFromMySQL(); } catch (e) {} }
      return sendJSON(res, 200, (DB.state && DB.state.payments) || []);
    }
    if (url === '/api/users' && req.method === 'GET') {
      if (hasMySQL()) { try { await loadDBFromMySQL(); } catch (e) {} }
      ensureProvisionedUsers();
      return sendJSON(res, 200, (DB.state && DB.state.users) || []);
    }
    if (url === '/api/fee-heads' && req.method === 'GET') {
      if (hasMySQL()) { try { await loadDBFromMySQL(); } catch (e) {} }
      return sendJSON(res, 200, (DB.state && DB.state.meta && DB.state.meta.feeHeads) || []);
    }
    if (url === '/api/settings' && req.method === 'GET') {
      if (hasMySQL()) { try { await loadDBFromMySQL(); } catch (e) {} }
      return sendJSON(res, 200, (DB.state && DB.state.meta) || {});
    }
    if (url === '/api/attendance' && req.method === 'GET') {
      if (hasMySQL()) { try { await loadDBFromMySQL(); } catch (e) {} }
      return sendJSON(res, 200, (DB.state && DB.state.meta && DB.state.meta.attendance) || {});
    }
    if (url === '/api/holidays' && req.method === 'GET') {
      if (hasMySQL()) { try { await loadDBFromMySQL(); } catch (e) {} }
      return sendJSON(res, 200, (DB.state && DB.state.meta && DB.state.meta.holidays) || {});
    }
    if (url === '/api/state' && req.method === 'GET') {
      if (hasMySQL()) {
        try { await loadDBFromMySQL(); } catch (e) {}
      }
      if (ensureProvisionedUsers()) {
        saveDB();
        if (hasMySQL()) persistProvisionedUsersToMySQL().catch(() => {});
      }
      return sendJSON(res, 200, DB);
    }
    if (url === '/api/state' && req.method === 'PUT') {
      const body = JSON.parse(await readBody(req));
      const actor = getActor(req, body);
      if (body && body.state) {
        DB.state = body.state;
        ensureProvisionedUsers();
        DB.version++;
        await saveDB();
        logAudit('SYNC_STATE', 'app_state', 'state', { version: DB.version }, actor, req);
        if (hasMySQL()) {
          saveDBToMySQL(DB.state, actor).catch(err => console.warn('MySQL async save error:', err.message));
        }
      }
      return sendJSON(res, 200, { version: DB.version });
    }
    if (url.startsWith('/api/students') && !url.endsWith('/report') && (req.method === 'PUT' || req.method === 'POST')) {
      const body = JSON.parse(await readBody(req));
      const actor = getActor(req, body);
      const s = body.student || body;
      if (s && s.id) {
        if (!Array.isArray(DB.state.students)) DB.state.students = [];
        const idx = DB.state.students.findIndex(x => x.id === s.id);
        const isNew = idx < 0;
        if (idx >= 0) DB.state.students[idx] = s; else DB.state.students.push(s);
        DB.version++;
        await saveDB();
        logAudit(isNew ? 'CREATE_STUDENT' : 'UPDATE_STUDENT', 'students', s.id, { name: s.name, grade: s.grade, status: s.status, contact: s.contact, father: s.father }, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            saveStudentInMySQL(p, s, DB.state ? DB.state.meta : null, actor).catch(err => console.warn('[Direct Student MySQL Update Warn]', err.message));
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url.startsWith('/api/students/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.slice('/api/students/'.length));
      const actor = getActor(req);
      if (id) {
        if (Array.isArray(DB.state.students)) {
          const idx = DB.state.students.findIndex(x => x.id === id);
          if (idx >= 0) DB.state.students.splice(idx, 1);
        }
        DB.version++;
        await saveDB();
        logAudit('DELETE_STUDENT', 'students', id, { id }, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            await p.query('DELETE FROM student_fees WHERE student_id = ?', [id]).catch(() => {});
            await p.query('DELETE FROM students WHERE id = ?', [id]).catch(err => console.warn('[Direct Student MySQL Delete Warn]', err.message));
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url.startsWith('/api/payments/') && req.method === 'DELETE') {
      const id = decodeURIComponent(url.slice('/api/payments/'.length));
      const actor = getActor(req);
      if (id) {
        if (Array.isArray(DB.state.payments)) {
          const idx = DB.state.payments.findIndex(x => (x.id === id || x.receiptNo === id));
          if (idx >= 0) DB.state.payments.splice(idx, 1);
        }
        DB.version++;
        await saveDB();
        logAudit('DELETE_PAYMENT', 'payments', id, { receiptNo: id }, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            await p.query('DELETE FROM payment_items WHERE receipt_no = ?', [id]).catch(() => {});
            await p.query('DELETE FROM payments WHERE receipt_no = ?', [id]).catch(err => console.warn('[Direct Payment MySQL Delete Warn]', err.message));
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url.startsWith('/api/payments') && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const actor = getActor(req, body);
      const records = Array.isArray(body && body.records) ? body.records : [body];
      for (const rec of records) {
        if (!rec || !rec.receiptNo) continue;
        if (!Array.isArray(DB.state.payments)) DB.state.payments = [];
        const idx = DB.state.payments.findIndex(x => (x.id === rec.id || x.receiptNo === rec.receiptNo));
        if (idx >= 0) DB.state.payments[idx] = rec; else DB.state.payments.push(rec);
        logAudit('RECORD_PAYMENT', 'payments', rec.receiptNo, { receiptNo: rec.receiptNo, studentId: rec.studentId, studentName: rec.studentName, grade: rec.grade, mode: rec.mode, amount: rec.amount }, actor, req);
      }
      if (body.student && body.student.id) {
        const s = body.student;
        if (!Array.isArray(DB.state.students)) DB.state.students = [];
        const idx = DB.state.students.findIndex(x => x.id === s.id);
        if (idx >= 0) DB.state.students[idx] = s;
      }
      DB.version++;
      await saveDB();

      if (hasMySQL()) {
        const p = getPool();
        if (p) {
          for (const rec of records) {
            if (!rec || !rec.receiptNo) continue;
            const itemsJson = JSON.stringify(rec.items || []);
            await p.query(
              `INSERT INTO payments (receipt_no, date, business_name, student_id, student_name, grade, mode, amount, items_json, created_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE
                 date=VALUES(date), business_name=VALUES(business_name), student_id=VALUES(student_id), student_name=VALUES(student_name),
                 grade=VALUES(grade), mode=VALUES(mode), amount=VALUES(amount), items_json=VALUES(items_json), updated_by=VALUES(updated_by), updated_at=NOW()`,
              [rec.receiptNo, rec.date || '', rec.businessName || '', rec.studentId || '', rec.studentName || '', rec.grade || '', rec.mode || '', Number(rec.amount) || 0, itemsJson, actor, actor]
            ).catch(err => console.warn('[Direct Payment MySQL Insert Warn]', err.message));

            if (Array.isArray(rec.items)) {
              for (const item of rec.items) {
                await p.query(
                  `INSERT INTO payment_items (receipt_no, head_key, head_label, business_name, amount, created_by, updated_by, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                   ON DUPLICATE KEY UPDATE head_label=VALUES(head_label), amount=VALUES(amount), updated_by=VALUES(updated_by), updated_at=NOW()`,
                  [rec.receiptNo, item.head || item.headKey || '', item.label || '', rec.businessName || '', Number(item.amount) || 0, actor, actor]
                ).catch(() => {});
              }
            }
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url.startsWith('/api/users') && (req.method === 'POST' || req.method === 'PUT')) {
      const body = JSON.parse(await readBody(req));
      const actor = getActor(req, body);
      const u = body.user || body;
      if (u && u.username) {
        if (!Array.isArray(DB.state.users)) DB.state.users = [];
        const idx = DB.state.users.findIndex(x => x.username.toLowerCase() === u.username.toLowerCase());
        const isNew = idx < 0;
        if (idx >= 0) DB.state.users[idx] = u; else DB.state.users.push(u);
        DB.version++;
        await saveDB();
        logAudit(isNew ? 'CREATE_USER' : 'UPDATE_USER', 'users', u.username, { username: u.username, role: u.role, name: u.name }, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            const pwd = u.salt ? `${u.salt}:${u.hash}` : (u.passwordHash || u.hash || u.password || 'admin@123');
            const pagesJson = Array.isArray(u.pages) ? JSON.stringify(u.pages) : null;
            const gradesJson = Array.isArray(u.grades) ? JSON.stringify(u.grades) : null;
            await p.query(
              `INSERT INTO users (username, password_hash, role, name, pages_json, grades_json, created_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE
                 password_hash=VALUES(password_hash), role=VALUES(role), name=VALUES(name),
                 pages_json=COALESCE(VALUES(pages_json), pages_json),
                 grades_json=COALESCE(VALUES(grades_json), grades_json),
                 updated_by=VALUES(updated_by), updated_at=NOW()`,
              [u.username, pwd, u.role || 'account', u.name || u.username, pagesJson, gradesJson, actor, actor]
            ).catch(err => {
              return p.query(
                `INSERT INTO users (username, password_hash, role, name, created_by, updated_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role), name=VALUES(name), updated_by=VALUES(updated_by), updated_at=NOW()`,
                [u.username, pwd, u.role || 'account', u.name || u.username, actor, actor]
              );
            });
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url.startsWith('/api/users/') && req.method === 'DELETE') {
      const username = decodeURIComponent(url.slice('/api/users/'.length));
      const actor = getActor(req);
      if (username) {
        if (Array.isArray(DB.state.users)) {
          const idx = DB.state.users.findIndex(x => x.username.toLowerCase() === username.toLowerCase());
          if (idx >= 0) DB.state.users.splice(idx, 1);
        }
        DB.version++;
        await saveDB();
        logAudit('DELETE_USER', 'users', username, { username }, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            await p.query('DELETE FROM users WHERE username = ?', [username]).catch(err => console.warn('[Direct User MySQL Delete Warn]', err.message));
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url.startsWith('/api/attendance') && (req.method === 'POST' || req.method === 'PUT')) {
      const body = JSON.parse(await readBody(req));
      const actor = getActor(req, body);
      const date = body.date;
      const studentId = body.studentId || body.id;
      const status = body.status;
      const records = Array.isArray(body.records) ? body.records : (date && studentId ? [{ date, studentId, status: status || 'P' }] : []);

      if (!DB.state.meta) DB.state.meta = {};
      if (!DB.state.meta.attendance) DB.state.meta.attendance = {};

      if (hasMySQL()) {
        const p = getPool();
        for (const r of records) {
          if (!r.date || !r.studentId) continue;
          if (!DB.state.meta.attendance[r.date]) DB.state.meta.attendance[r.date] = {};
          DB.state.meta.attendance[r.date][r.studentId] = r.status || 'P';

          if (p) {
            await p.query(
              `INSERT INTO students (id, name, created_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE updated_at=NOW()`,
              [r.studentId, r.studentId, actor, actor]
            ).catch(() => {});

            await p.query(
              `INSERT INTO attendance (date, student_id, status, created_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE status=VALUES(status), updated_by=VALUES(updated_by), updated_at=NOW()`,
              [r.date, r.studentId, String(r.status || 'P'), actor, actor]
            ).catch(err => console.warn('[Direct Attendance MySQL Update Warn]', err.message));
          }
        }
      }
      DB.version++;
      await saveDB();
      logAudit('UPDATE_ATTENDANCE', 'attendance', date || 'bulk', { count: records.length }, actor, req);
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url === '/api/holidays' && (req.method === 'POST' || req.method === 'PUT')) {
      const body = JSON.parse(await readBody(req));
      const actor = getActor(req, body);
      const { date, grade, on } = body;
      if (date) {
        if (!DB.state.meta) DB.state.meta = {};
        if (!DB.state.meta.holidays) DB.state.meta.holidays = {};
        const token = grade || '__ALL__';
        let arr = Array.isArray(DB.state.meta.holidays[date]) ? DB.state.meta.holidays[date].slice() : [];
        if (token === '__ALL__' && on) {
          arr = ['__ALL__'];
        } else if (on) {
          if (arr.indexOf('__ALL__') < 0 && arr.indexOf(token) < 0) arr.push(token);
        } else {
          if (token === '__ALL__') arr = [];
          else arr = arr.filter(x => x !== token && x !== '__ALL__');
        }
        if (arr.length) DB.state.meta.holidays[date] = arr;
        else delete DB.state.meta.holidays[date];

        DB.version++;
        await saveDB();
        logAudit('UPDATE_HOLIDAY', 'holidays', date, { date, grade, on }, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            const valStr = JSON.stringify(DB.state.meta.holidays);
            await p.query(
              `INSERT INTO app_settings (setting_key, setting_value, created_by, updated_by, created_at, updated_at)
               VALUES ('holidays', ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by), updated_at=NOW()`,
              [valStr, actor, actor]
            ).catch(err => console.warn('[Direct Holiday MySQL Update Warn]', err.message));
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url.startsWith('/api/students/') && url.endsWith('/report') && req.method === 'GET') {
      const parts = url.split('/');
      const id = decodeURIComponent(parts[3]);
      if (hasMySQL()) { try { await loadDBFromMySQL(); } catch (e) {} }
      const s = (DB.state && Array.isArray(DB.state.students)) ? DB.state.students.find(x => x.id === id) : null;
      return sendJSON(res, 200, (s && s.report) ? s.report : {});
    }
    if (url.startsWith('/api/students/') && url.endsWith('/report') && (req.method === 'POST' || req.method === 'PUT')) {
      const parts = url.split('/');
      const id = decodeURIComponent(parts[3]);
      const body = JSON.parse(await readBody(req));
      const actor = getActor(req, body);
      const report = body.report || body;
      if (id) {
        if (Array.isArray(DB.state.students)) {
          const s = DB.state.students.find(x => x.id === id);
          if (s) {
            s.report = report || {};
            s.reportUpdatedAt = new Date().toISOString();
          }
        }
        DB.version++;
        await saveDB();
        logAudit('SAVE_REPORT_CARD', 'report_cards', id, { studentId: id }, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            const reportJson = JSON.stringify(report || {});
            const marksJson = JSON.stringify(report.marks || {});
            const remarksStr = report.remarks || '';
            await p.query(
              `INSERT INTO report_cards (student_id, term, report_json, marks_json, remarks, created_by, updated_by, created_at, updated_at)
               VALUES (?, 'Term I', ?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE report_json=VALUES(report_json), marks_json=VALUES(marks_json), remarks=VALUES(remarks), updated_by=VALUES(updated_by), updated_at=NOW()`,
              [id, reportJson, marksJson, remarksStr, actor, actor]
            ).catch(err => console.warn('[Direct ReportCard MySQL Update Warn]', err.message));
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url === '/api/settings' && (req.method === 'POST' || req.method === 'PUT')) {
      const body = JSON.parse(await readBody(req));
      const actor = getActor(req, body);
      const key = body.key;
      const value = body.value;
      const settingsObj = body.settings || (key !== undefined ? { [key]: value } : null);

      if (settingsObj && typeof settingsObj === 'object') {
        if (!DB.state.meta) DB.state.meta = {};
        for (const k of Object.keys(settingsObj)) {
          DB.state.meta[k] = settingsObj[k];
        }
        DB.version++;
        await saveDB();
        logAudit('UPDATE_SETTINGS', 'settings', key || 'bulk', { settings: settingsObj }, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            for (const k of Object.keys(settingsObj)) {
              const valStr = JSON.stringify(settingsObj[k]);
              await p.query(
                `INSERT INTO app_settings (setting_key, setting_value, created_by, updated_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_by=VALUES(updated_by), updated_at=NOW()`,
                [k, valStr, actor, actor]
              ).catch(err => console.warn('[Direct Setting MySQL Update Warn]', k, err.message));
            }
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url.startsWith('/api/fee-heads') && (req.method === 'POST' || req.method === 'PUT')) {
      const body = JSON.parse(await readBody(req));
      const actor = getActor(req, body);
      const fh = body.feeHead || body;
      if (fh && fh.key) {
        if (!DB.state.meta) DB.state.meta = {};
        if (!Array.isArray(DB.state.meta.feeHeads)) DB.state.meta.feeHeads = [];
        const idx = DB.state.meta.feeHeads.findIndex(x => x.key === fh.key);
        if (idx >= 0) DB.state.meta.feeHeads[idx] = fh; else DB.state.meta.feeHeads.push(fh);
        DB.version++;
        await saveDB();
        logAudit('SAVE_FEE_HEAD', 'fee_heads', fh.key, fh, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            await p.query(
              `INSERT INTO fee_heads (head_key, label, business, created_by, updated_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, NOW(), NOW())
               ON DUPLICATE KEY UPDATE
                 label=VALUES(label), business=VALUES(business), updated_by=VALUES(updated_by), updated_at=NOW()`,
              [fh.key, fh.label || fh.key, fh.business || 'school', actor, actor]
            ).catch(err => console.warn('[Direct FeeHead MySQL Update Warn]', err.message));
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url.startsWith('/api/fee-heads/') && req.method === 'DELETE') {
      const key = decodeURIComponent(url.slice('/api/fee-heads/'.length));
      const actor = getActor(req);
      if (key) {
        if (DB.state.meta && Array.isArray(DB.state.meta.feeHeads)) {
          const idx = DB.state.meta.feeHeads.findIndex(x => x.key === key);
          if (idx >= 0) DB.state.meta.feeHeads.splice(idx, 1);
        }
        DB.version++;
        await saveDB();
        logAudit('DELETE_FEE_HEAD', 'fee_heads', key, { key }, actor, req);

        if (hasMySQL()) {
          const p = getPool();
          if (p) {
            await p.query('DELETE FROM fee_heads WHERE head_key = ?', [key]).catch(err => console.warn('[Direct FeeHead MySQL Delete Warn]', err.message));
          }
        }
      }
      return sendJSON(res, 200, { ok: true, version: DB.version });
    }
    if (url === '/api/backup-status' && req.method === 'GET')
      return sendJSON(res, 200, { serverMode: true, mysql: hasMySQL(), emailConfigured: emailConfigured(), to: BACKUP_EMAIL, day: BACKUP_DAY, hour: BACKUP_HOUR, lastBackupAt: DB.lastBackupAt, excel: !!ExcelJS, dataDir: DATA_DIR, version: DB.version, students: (DB.state.students || []).length, payments: (DB.state.payments || []).length, bootAt: BOOT_AT });
    if (url === '/api/backup.xlsx' && req.method === 'GET') {
      const buf = await buildWorkbook();
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="akb-fees-backup.xlsx"', 'Cache-Control': 'no-store' });
      return res.end(Buffer.from(buf));
    }
    if (url === '/api/send-backup' && req.method === 'POST') { await sendBackupEmail(); return sendJSON(res, 200, { ok: true, to: BACKUP_EMAIL, at: DB.lastBackupAt }); }
    if (url === '/api/wa-status' && req.method === 'GET') return sendJSON(res, 200, { configured: waConfigured(), provider: WA.provider || null });
    if (url === '/api/send-reminders' && req.method === 'POST') return handleSendReminders(req, res);
  } catch (e) { return sendJSON(res, 500, { error: String(e && e.message || e) }); }

  // static
  let urlPath = decodeURIComponent(url); if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(filePath, (err, s) => {
    if (err || !s.isFile()) { if (!err && s && s.isDirectory()) filePath = path.join(filePath, 'index.html'); return sendFile(filePath, res, () => sendFile(path.join(ROOT, 'index.html'), res, () => { res.writeHead(404); res.end('Not found'); })); }
    sendFile(filePath, res, () => { res.writeHead(404); res.end('Not found'); });
  });
});

function sendFile(filePath, res, onErr) {
  fs.readFile(filePath, (err, data) => {
    if (err) return onErr();
    const ext = path.extname(filePath).toLowerCase();
    const fresh = (ext === '.html' || ext === '.js' || ext === '.css');
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': fresh ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400' });
    res.end(data);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('AKB Fee Collection on port ' + PORT +
    (PASS ? ' (auth on)' : ' (NO PASSWORD)') +
    ' · data:' + DATA_DIR +
    ' · mysql:' + (hasMySQL() ? 'yes' : 'no') +
    ' · excel:' + (ExcelJS ? 'yes' : 'no') +
    ' · email:' + (emailConfigured() ? 'yes -> ' + BACKUP_EMAIL : 'not configured') +
    ' · whatsapp:' + (waConfigured() ? WA.provider : 'no'));
});
