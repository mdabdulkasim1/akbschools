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
const http = require('http');
const fs = require('fs');
const path = require('path');
const urlmod = require('url');

let ExcelJS = null, nodemailer = null;
try { ExcelJS = require('exceljs'); } catch (e) { console.warn('exceljs not installed — Excel export disabled'); }
try { nodemailer = require('nodemailer'); } catch (e) { console.warn('nodemailer not installed — email disabled'); }

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

/* ---------------- Principal Academic Report portal (mounted at /report) ----
 * The report portal is a self-contained sub-app: it keeps its own login and
 * its own data file (db.json) but shares this Railway service and the same
 * DATA_DIR volume. Principals sign in here to file the monthly academic /
 * attendance report; the Chairman reviews. It is exempt from the fee-app's
 * HTTP Basic auth because it has its own account system. */
process.env.DATA_DIR = DATA_DIR; // report-lib/db reads this at require time
let report = null;
try {
  report = require('./report-app');
  report.seedIfEmpty();
  console.log('Principal Report portal mounted at /report (data: ' + DATA_DIR + ')');
} catch (e) {
  console.warn('Principal Report portal NOT mounted:', e && e.message);
}

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
  const rawUrl = req.url || '/';
  const pathOnly = rawUrl.split('?')[0];

  /* Principal Report portal — own login, so it bypasses the fee-app Basic auth */
  if (report && (pathOnly === '/report' || pathOnly.startsWith('/report/'))) {
    if (pathOnly === '/report') { res.writeHead(302, { Location: '/report/' }); return res.end(); }
    const sub = pathOnly.slice('/report'.length) || '/'; // '/', '/app.js', '/api/login', ...
    const query = urlmod.parse(rawUrl, true).query;
    return report.handleReport(req, res, sub, query);
  }

  if (!checkAuth(req)) return unauthorized(res);
  const url = pathOnly;
  try {
    if (url === '/api/state' && req.method === 'GET') return sendJSON(res, 200, DB);
    if (url === '/api/state' && req.method === 'PUT') {
      const body = JSON.parse(await readBody(req));
      if (typeof body.baseVersion === 'number' && body.baseVersion !== DB.version) return sendJSON(res, 409, DB);
      if (body.state) { DB.state = body.state; DB.version++; await saveDB(); }
      return sendJSON(res, 200, { version: DB.version });
    }
    if (url === '/api/backup-status' && req.method === 'GET')
      return sendJSON(res, 200, { serverMode: true, emailConfigured: emailConfigured(), to: BACKUP_EMAIL, day: BACKUP_DAY, hour: BACKUP_HOUR, lastBackupAt: DB.lastBackupAt, excel: !!ExcelJS, dataDir: DATA_DIR, version: DB.version, students: (DB.state.students || []).length, payments: (DB.state.payments || []).length, bootAt: BOOT_AT });
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': fresh ? 'no-cache' : 'public, max-age=86400' });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log('AKB Fee Collection on port ' + PORT +
    (PASS ? ' (auth on)' : ' (NO PASSWORD)') +
    ' · data:' + DATA_DIR +
    ' · excel:' + (ExcelJS ? 'yes' : 'no') +
    ' · email:' + (emailConfigured() ? 'yes -> ' + BACKUP_EMAIL : 'not configured') +
    ' · whatsapp:' + (waConfigured() ? WA.provider : 'no'));
});
