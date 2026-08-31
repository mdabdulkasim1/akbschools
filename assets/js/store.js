/* ===== AKB Fee Collection — storage layer =====
   IndexedDB persistence with an in-memory cache so views can render
   synchronously. Falls back to localStorage if IndexedDB is unavailable.
*/
(function (w) {
  'use strict';

  // Safe storage: real localStorage when available, else an in-memory shim
  // (keeps the app working in sandboxed iframes / private-mode restrictions).
  var LS = (function () {
    try { var s = w['local' + 'Storage']; var t = '__akbtest'; s.setItem(t, '1'); s.removeItem(t); return s; }
    catch (e) {
      var m = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem: function (k, v) { m[k] = String(v); },
        removeItem: function (k) { delete m[k]; }
      };
    }
  })();

  const DB_NAME = 'akb_fees';
  const DB_VERSION = 2;
  const STORES = ['students', 'payments', 'meta', 'users'];

  // Business entities / bank accounts (from PAYMENT COLLECTION SUMMARY REPO)
  const ENTITIES = [
    'AKB School of Excellence - HDFC',
    'AKB School of Excellence - IB',
    'AKB & CO',
    'Falcon Trading & Transport',
    'Summer Camp'
  ];
  const MODES = ['Cash', 'G.Pay', 'Bank', 'Cheque', 'Card'];
  // Default fee categories (admin can add/rename/remove/reorder these at runtime).
  // Each: {key, label, business}. Term is split into three terms; Event Fees added.
  const DEFAULT_FEE_HEADS = [
    { key: 'term1', label: 'Term 1 Fees', business: 'school' },
    { key: 'term2', label: 'Term 2 Fees', business: 'school' },
    { key: 'term3', label: 'Term 3 Fees', business: 'school' },
    { key: 'supplies', label: 'School Supplies', business: 'co' },
    { key: 'app_fees', label: 'App Fees Paid', business: 'school' },
    { key: 'uniform', label: 'Uniform & Accessories', business: 'co' },
    { key: 'transport', label: 'Transport Fees', business: 'falcon' },
    { key: 'extra_curricular', label: 'Extra Curricular Fees', business: 'school' },
    { key: 'evening_sports', label: 'Evening Sports', business: 'sports' },
    { key: 'event', label: 'Event Fees', business: 'school' }
  ];
  // Transport is billed & collected MONTHLY across the academic year
  // (April → March). The single 'transport' fee head is the roll-up of the
  // 12 monthly amounts kept on student.transport = { 'YYYY-MM': {total, paid} }.
  const TRANSPORT_HEAD = 'transport';
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function pad2(n) { return String(n).padStart(2, '0'); }
  // 12 months Apr(startYear) … Mar(startYear+1), derived from the academic year
  function buildTransportMonths(yearStr) {
    const y0 = parseInt(String(yearStr || '2026-2027').split('-')[0], 10) || 2026;
    const out = []; let y = y0, m = 4;
    for (let i = 0; i < 12; i++) { out.push({ key: y + '-' + pad2(m), label: MONTH_NAMES[m - 1] + ' ' + y }); m++; if (m > 12) { m = 1; y++; } }
    return out;
  }
  // Fee heads split into admin-managed named sub-items (dropdowns). The single
  // head is the roll-up of student.subs[head] = { itemKey: {total, paid} }.
  const MULTI_HEADS = ['event', 'extra_curricular'];
  const DEFAULT_SUB_ITEMS = {
    event: [{ key: 'event1', label: 'Event 1' }, { key: 'event2', label: 'Event 2' }],
    extra_curricular: [{ key: 'summer_camp', label: 'Summer Camp' }, { key: 'olympiad', label: 'Olympiad Exam' }]
  };
  // These are kept in sync (mutated in place) by rebuildHeads() from the active
  // fee-head config, so views that read Store.HEAD_ORDER/HEAD_LABELS stay current.
  const HEAD_ORDER = [];
  const HEAD_LABELS = {};
  const HEAD_BUSINESS = {};
  const BUSINESS = {}; // fee head -> business display name (Chairman Dashboard)
  // The 4 businesses, each issuing its own receipt with its own logo
  const BUSINESSES = {
    school: { key: 'school', name: 'AKB School of Excellence', sub: 'Senior Secondary CBSE School', logo: 'assets/img/logo-school.svg', logoFull: 'assets/img/logo-school-full.svg', color: '#7f1d1d', prefix: 'AKB' },
    sports: { key: 'sports', name: 'AKB Sports Academy', sub: 'One Team · One Passion · One Legacy', logo: 'assets/img/logo-sports.svg', logoFull: 'assets/img/logo-sports.svg', color: '#7c1d2e', prefix: 'SA' },
    co: { key: 'co', name: 'AKB & Co', sub: 'School Supplies · Games · Playing Courts', logo: 'assets/img/logo-co.svg', logoFull: 'assets/img/logo-co.svg', color: '#1e3a8a', prefix: 'CO' },
    falcon: { key: 'falcon', name: 'Falcon Trading & Transport', sub: 'Transport Services', logo: 'assets/img/logo-falcon.svg', logoFull: 'assets/img/logo-falcon.svg', color: '#c2410c', prefix: 'FTT' }
  };
  const BUSINESS_ORDER = ['school', 'co', 'falcon', 'sports'];
  // School WhatsApp / contact number (shown on receipts & in reminders)
  const SCHOOL_WHATSAPP = '+917200263979';
  const SCHOOL_WHATSAPP_DISPLAY = '+91 72002 63979';

  // ---- Report card config (attendance + marks) ----
  const ASSESSMENTS = [
    { key: 'pt1', label: 'PT1' }, { key: 'pt2', label: 'PT2' }, { key: 'term1', label: 'Term I' },
    { key: 'pt3', label: 'PT3' }, { key: 'term2', label: 'Term II' }
  ];
  const GRADE_SCALE = [
    { code: 'EX', label: 'Excellent (90-100%)' }, { code: 'GD', label: 'Good (75-89%)' },
    { code: 'SA', label: 'Satisfactory (60-74%)' }, { code: 'NI', label: 'Need Improvement (<60%)' }
  ];
  const SUBJECTS = ['English', 'Tamil', 'Maths', 'EVS/Science', 'Social', 'Robotics', 'Hindi', 'Arabic/V.E'];
  const KG_DOMAINS = [
    { title: 'Personal, Social & Emotional Development', items: ['Adjusts well to new environment', 'Interacts confidently with peers and teachers', 'Shares and takes turns willingly', 'Follows classroom rules and routines', 'Demonstrates responsibility in handling belongings', 'Expresses feelings appropriately'] },
    { title: 'Language & Communication Skills', items: ['Listens attentively to stories and instructions', 'Identifies letters (uppercase & lowercase)', 'Recognizes beginning sounds of words', 'Speaks clearly in simple sentences', 'Participates in storytelling, rhymes, and role play', 'Vocabulary development'] },
    { title: 'Cognitive / Pre-Math Skills', items: ['Recognizes numbers 1-20', 'Counts objects with one-to-one correspondence', 'Understands basic concepts (big/small, more/less)', 'Identifies and sorts shapes and colors', 'Recognizes patterns and sequences', 'Matches objects and pictures correctly'] },
    { title: 'Environmental Awareness & GK', items: ['Identifies common animals, birds, and insects', 'Recognizes fruits and vegetables', 'Knows days of the week and seasons', 'Shows curiosity and interest in surroundings', 'Understands basic safety and hygiene rules'] },
    { title: 'Creative & Aesthetic Development', items: ['Enjoys drawing, coloring, and painting', 'Participates in music, dance, and singing', 'Demonstrates creativity in craft work', 'Uses imagination in role-play/dramatic activities'] },
    { title: 'Physical Development & Fine Motor', items: ['Holds pencil/crayons correctly', 'Can trace lines, shapes, and letters', 'Can cut, paste, and handle small objects', 'Runs, jumps, and climbs confidently', 'Participates actively in outdoor games', 'Shows balance and coordination'] }
  ];
  const REPORT = { ASSESSMENTS, GRADE_SCALE, SUBJECTS, KG_DOMAINS };
  // Kindergarten classes use the skill checklist (not numeric subject marks).
  // Matches PRE KG, PREKG, LKG, JKG, UKG, SKG, KG, KINDER… — note "JKG"/"SKG"
  // have no word boundary before "KG", so anchor on the END boundary instead.
  function isKG(grade) { return /KG\b|KINDER/i.test(String(grade || '')); }

  /* ---- Roles & page-level access ----
   * PAGES are the dashboard "topics" an admin can grant per user (matching the
   * sidebar). ROLES are labels/groupings; each has a DEFAULT set of pages, but
   * the admin can override any user's access with a custom `pages` list
   * ("give access as per my wish"). Admin always has every page. */
  const PAGES = [
    { key: 'dashboard',   label: 'Dashboard',         icon: '📊' },
    { key: 'students',    label: 'Students',          icon: '👨‍🎓' },
    { key: 'collect',     label: 'Receive Payment',   icon: '🧾' },
    { key: 'collections', label: 'Collections',       icon: '💵' },
    { key: 'reports',     label: 'Reports',           icon: '📈' },
    { key: 'attendance',  label: 'Attendance',        icon: '📝' },
    { key: 'attreport',   label: 'Attendance Report', icon: '📅' },
    { key: 'marks',       label: 'Report Cards',      icon: '📚' },
    { key: 'academics',   label: 'Academics',         icon: '🎓' },
    { key: 'users',       label: 'Users',             icon: '👥' },
    { key: 'data',        label: 'Data & Backup',     icon: '⚙️' }
  ];
  const PAGE_KEYS = PAGES.map(p => p.key);
  // Money pages: collecting payments / issuing receipts / viewing collections.
  // Restricted to Account + Administrator only, regardless of page grants.
  const FINANCIAL_PAGES = ['collect', 'collections'];
  function roleCanCollect(role) { return role === 'admin' || role === 'account'; }
  // Pages that may be offered to a role in the access picker (hide money pages
  // for roles that can never collect).
  function pageListFor(role) { return PAGES.filter(p => FINANCIAL_PAGES.indexOf(p.key) < 0 || roleCanCollect(role)); }
  const ROLES = [
    { key: 'admin',           label: 'Admin' },
    { key: 'account',         label: 'Account' },
    { key: 'teacher',         label: 'Teacher' },
    { key: 'akbch_academics', label: 'AKBCH ACADEMICS' },
    { key: 'akb_admins',      label: 'AKB ADMINS' }
  ];
  const ROLE_KEYS = ROLES.map(r => r.key);
  const ROLE_LABEL = ROLES.reduce((m, r) => (m[r.key] = r.label, m), {});
  // Sensible starting page-set for each role (admin => everything).
  const DEFAULT_PAGES = {
    admin: PAGE_KEYS.slice(),
    account: ['dashboard', 'students', 'collect', 'collections', 'reports'],
    teacher: ['attendance', 'marks'],
    akbch_academics: ['dashboard', 'students', 'attendance', 'attreport', 'marks', 'academics'],
    akb_admins: ['dashboard', 'students', 'reports', 'attendance', 'attreport', 'marks', 'academics']
  };
  function normRole(role) { return ROLE_KEYS.indexOf(role) >= 0 ? role : 'account'; }
  function defaultPagesFor(role) { return (DEFAULT_PAGES[normRole(role)] || DEFAULT_PAGES.account).slice(); }
  // Effective pages for a user record: admin => all; explicit list wins; else role default.
  function effectivePages(u) {
    if (!u) return [];
    if (u.role === 'admin') return PAGE_KEYS.slice();
    let list = Array.isArray(u.pages) ? u.pages.filter(k => PAGE_KEYS.indexOf(k) >= 0) : defaultPagesFor(u.role);
    // Money pages never apply to a role that can't collect (defence in depth).
    if (!roleCanCollect(u.role)) list = list.filter(k => FINANCIAL_PAGES.indexOf(k) < 0);
    return list;
  }

  // Rebuild the HEAD_* lookups (in place) from a fee-head config array.
  function rebuildHeads(feeHeads) {
    HEAD_ORDER.length = 0;
    Object.keys(HEAD_LABELS).forEach(k => delete HEAD_LABELS[k]);
    Object.keys(HEAD_BUSINESS).forEach(k => delete HEAD_BUSINESS[k]);
    Object.keys(BUSINESS).forEach(k => delete BUSINESS[k]);
    (feeHeads || []).forEach(h => {
      const biz = BUSINESSES[h.business] ? h.business : 'school';
      HEAD_ORDER.push(h.key);
      HEAD_LABELS[h.key] = h.label;
      HEAD_BUSINESS[h.key] = biz;
      BUSINESS[h.key] = BUSINESSES[biz].name;
    });
  }
  rebuildHeads(DEFAULT_FEE_HEADS); // valid defaults at module load

  let db = null;
  let useIDB = true;
  // server-shared-state mode (set at init if /api/state is reachable)
  let serverMode = false, baseVersion = 0, syncTimer = null, syncing = false, syncAgain = false, dirty = false;

  const Store = {
    students: [],   // in-memory cache
    payments: [],
    users: [],
    feeHeads: [],
    meta: {},
    currentUser: null,
    ENTITIES, MODES, HEAD_ORDER, HEAD_LABELS, BUSINESS, BUSINESSES, BUSINESS_ORDER, HEAD_BUSINESS,
    SCHOOL_WHATSAPP, SCHOOL_WHATSAPP_DISPLAY, DEFAULT_FEE_HEADS,
    REPORT, isKG, MULTI_HEADS,
    PAGES, PAGE_KEYS, ROLES, ROLE_LABEL, defaultPagesFor, pageListFor,

    serverMode() { return serverMode; },

    async init() {
      // Prefer shared server state (all devices see one dataset)
      try {
        const r = await fetch('api/state', { cache: 'no-store' });
        if (r.ok) { serverMode = true; this._applyServer(await r.json()); }
      } catch (e) { serverMode = false; }

      if (!serverMode) {
        try { db = await openDB(); } catch (e) { console.warn('IndexedDB unavailable, using localStorage', e); useIDB = false; }
        await this.load();
      } else if (!this.students.length) {
        // Server is empty on first connect — migrate this browser's saved data (if any)
        try {
          if (!db) { try { db = await openDB(); } catch (e) { db = null; } }
          if (db) {
            const local = await idbAll('students');
            if (local && local.length) {
              this.students = local;
              this.payments = (await idbAll('payments')) || [];
              this.users = (await idbAll('users')) || [];
              const mr = await idbAll('meta'); this.meta = (mr[0] && mr[0].value) || this.meta;
              U.toast('Uploading this device’s saved data to the server…', 'success');
            }
          }
        } catch (e) {}
      }

      // seed only when truly empty (never clobber existing server data)
      if (!this.meta.seeded && !this.students.length) await this.seed();
      else if (!this.meta.seeded) this.meta.seeded = true;
      if (!this.users.length) await this.seedUsers();

      if (!Array.isArray(this.meta.feeHeads) || !this.meta.feeHeads.length) {
        this.meta.feeHeads = DEFAULT_FEE_HEADS.map(h => Object.assign({}, h));
      }
      this.feeHeads = this.meta.feeHeads;
      rebuildHeads(this.feeHeads);
      this.migrateLegacyHeads(); this.ensureStudentHeads();
      await this.persist(); // pushes seed/migration to server (or writes locally)
      this.recomputeAll();

      // save any pending change before the tab is closed/hidden so the last
      // transaction is never lost (keepalive lets the request finish on unload)
      if (typeof window !== 'undefined' && !this._unloadHooked) {
        this._unloadHooked = true;
        const beacon = () => {
          if (!serverMode || !dirty) return;
          try {
            fetch('api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ baseVersion, state: this._snapshot() }) }).then(() => { dirty = false; }).catch(() => {});
          } catch (e) {}
        };
        window.addEventListener('pagehide', beacon);
        window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beacon(); });
      }
      return this;
    },

    /* ---- persistence (server if available, else IndexedDB/localStorage) ---- */
    _snapshot() { return { students: this.students, payments: this.payments, users: this.users, meta: this.meta }; },
    _applyServer(dbObj) {
      baseVersion = (dbObj && dbObj.version) || 0;
      const st = (dbObj && dbObj.state) || {};
      this.students = st.students || [];
      this.payments = st.payments || [];
      this.users = st.users || [];
      this.meta = st.meta || {};
      if (Array.isArray(this.meta.feeHeads) && this.meta.feeHeads.length) { this.feeHeads = this.meta.feeHeads; rebuildHeads(this.feeHeads); }
      this.recomputeAll();
    },
    async persist() {
      if (serverMode) {
        this._scheduleSync();
        this._mirrorLocal(); // keep a local copy so this device can recover if the server resets
        return;
      }
      if (useIDB) {
        await idbClear('students'); await idbPutMany('students', this.students);
        await idbClear('payments'); await idbPutMany('payments', this.payments);
        await idbClear('users'); await idbPutMany('users', this.users);
        await idbPut('meta', { id: 'meta', value: this.meta });
      } else {
        LS.setItem('akb_students', JSON.stringify(this.students));
        LS.setItem('akb_payments', JSON.stringify(this.payments));
        LS.setItem('akb_users', JSON.stringify(this.users));
        LS.setItem('akb_meta', JSON.stringify(this.meta));
      }
    },
    // best-effort background copy of the shared state into this browser's IndexedDB
    _mirrorLocal() {
      if (!useIDB) return;
      Promise.resolve().then(async () => {
        try {
          if (!db) { db = await openDB().catch(() => null); }
          if (!db) return;
          await idbClear('students'); await idbPutMany('students', this.students);
          await idbClear('payments'); await idbPutMany('payments', this.payments);
          await idbClear('users'); await idbPutMany('users', this.users);
          await idbPut('meta', { id: 'meta', value: this.meta });
        } catch (e) { /* mirror is best-effort */ }
      });
    },
    _scheduleSync() { dirty = true; clearTimeout(syncTimer); syncTimer = setTimeout(() => this._syncNow(), 350); },
    async _syncNow() {
      if (syncing) { syncAgain = true; return; }
      syncing = true;
      try {
        const r = await fetch('api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion, state: this._snapshot() }) });
        if (r.status === 409) {
          this._applyServer(await r.json());
          U.toast('Reloaded latest data (another device was editing)', 'error');
          if (w.Router && w.Router.render) w.Router.render();
        } else if (r.ok) { baseVersion = (await r.json()).version; dirty = false; }
      } catch (e) { /* offline — will retry on next change */ }
      syncing = false;
      if (syncAgain) { syncAgain = false; this._scheduleSync(); }
    },
    // force any pending change to the server now (called on logout / tab close)
    async flush() {
      if (!serverMode || !dirty) return;
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
      await this._syncNow();
    },

    async load() {
      if (useIDB) {
        this.students = await idbAll('students');
        this.payments = await idbAll('payments');
        this.users = await idbAll('users');
        const metaRows = await idbAll('meta');
        this.meta = (metaRows[0] && metaRows[0].value) || {};
      } else {
        this.students = JSON.parse(LS.getItem('akb_students') || '[]');
        this.payments = JSON.parse(LS.getItem('akb_payments') || '[]');
        this.users = JSON.parse(LS.getItem('akb_users') || '[]');
        this.meta = JSON.parse(LS.getItem('akb_meta') || '{}');
      }
    },

    async seed() {
      const seed = w.__AKB_SEED__ || { students: [] };
      this.students = (seed.students || []).map(s => normalizeStudent(s));
      this.payments = [];
      this.meta = {
        seeded: true,
        school: seed.school || 'AKB School of Excellence',
        year: seed.year || '2026-2027',
        receiptSeq: 0,
        seededAt: U.todayISO()
      };
      await this.persistStudents();
      await this.persistMeta();
      U.toast('Loaded ' + this.students.length + ' students from workbook', 'success');
    },

    async resetToSeed() {
      this.meta = {};
      await this.seed();
      this.meta.feeHeads = DEFAULT_FEE_HEADS.map(h => Object.assign({}, h));
      this.feeHeads = this.meta.feeHeads; rebuildHeads(this.feeHeads);
      this.ensureStudentHeads();
      await this.persist();
      this.recomputeAll();
    },

    /* ---- students ---- */
    getStudent(id) { return this.students.find(s => s.id === id); },

    studentTotals(s) {
      let total = 0, paid = 0;
      HEAD_ORDER.forEach(k => {
        const h = s.fees[k]; if (!h) return;
        total += Number(h.total) || 0; paid += Number(h.paid) || 0;
      });
      return { total, paid, balance: total - paid };
    },

    recompute(s) {
      // Transport head is the roll-up of its 12 monthly amounts.
      if (HEAD_ORDER.indexOf(TRANSPORT_HEAD) >= 0) {
        this.ensureTransport(s);
        let t = 0, p = 0;
        this.transportMonths().forEach(mm => { const c = s.transport[mm.key] || {}; t += Number(c.total) || 0; p += Number(c.paid) || 0; });
        if (s.fees[TRANSPORT_HEAD]) { s.fees[TRANSPORT_HEAD].total = t; s.fees[TRANSPORT_HEAD].paid = p; }
      }
      // Event & Extra-Curricular heads roll up from their named sub-items.
      MULTI_HEADS.forEach(head => {
        if (HEAD_ORDER.indexOf(head) < 0) return;
        this.ensureSubs(s);
        let t = 0, p = 0; const bag = (s.subs && s.subs[head]) || {};
        Object.keys(bag).forEach(k => { t += Number(bag[k].total) || 0; p += Number(bag[k].paid) || 0; });
        if (s.fees[head]) { s.fees[head].total = t; s.fees[head].paid = p; }
      });
      HEAD_ORDER.forEach(k => {
        const h = s.fees[k]; if (!h) return;
        h.balance = Math.round(((Number(h.total) || 0) - (Number(h.paid) || 0)) * 100) / 100;
      });
    },
    recomputeAll() { this.students.forEach(s => this.recompute(s)); },

    /* ---- multi-item fee heads (Event, Extra-Curricular): admin-managed named sub-items ---- */
    subItems(head) {
      const m = (this.meta.subItems || {})[head];
      return (Array.isArray(m) && m.length) ? m : (DEFAULT_SUB_ITEMS[head] || []).map(x => Object.assign({}, x));
    },
    _subList(head) { // the mutable, persisted list (seed from defaults on first use)
      this.meta.subItems = this.meta.subItems || {};
      if (!Array.isArray(this.meta.subItems[head]) || !this.meta.subItems[head].length) this.meta.subItems[head] = this.subItems(head).slice();
      return this.meta.subItems[head];
    },
    _slugSub(head, label) {
      let base = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
      const list = this.subItems(head); let k = base, i = 2;
      while (list.some(x => x.key === k)) k = base + '_' + (i++);
      return k;
    },
    async addSubItem(head, label) {
      label = String(label || '').trim(); if (!label) throw new Error('Name is required');
      const list = this._subList(head);
      if (list.some(x => x.label.toLowerCase() === label.toLowerCase())) throw new Error('That item already exists');
      list.push({ key: this._slugSub(head, label), label });
      this.recomputeAll(); await this.persist();
    },
    async renameSubItem(head, key, label) {
      label = String(label || '').trim(); if (!label) throw new Error('Name is required');
      const it = this._subList(head).find(x => x.key === key); if (it) it.label = label;
      await this.persist();
    },
    async removeSubItem(head, key) {
      const list = this._subList(head);
      this.meta.subItems[head] = list.filter(x => x.key !== key);
      this.students.forEach(s => { if (s.subs && s.subs[head]) delete s.subs[head][key]; });
      this.recomputeAll(); await this.persist();
    },
    // ensure a student has an entry for every configured sub-item (migrating any
    // legacy single-head amount into a "General" item so nothing is lost)
    ensureSubs(s) {
      s.subs = s.subs || {};
      MULTI_HEADS.forEach(head => {
        if (HEAD_ORDER.indexOf(head) < 0) return;
        s.subs[head] = s.subs[head] || {};
        const hasData = Object.keys(s.subs[head]).length > 0;
        const headObj = s.fees && s.fees[head];
        if (!hasData && headObj && ((Number(headObj.total) || 0) > 0 || (Number(headObj.paid) || 0) > 0)) {
          const list = this._subList(head);
          if (!list.some(x => x.key === 'general')) list.unshift({ key: 'general', label: 'General' });
          s.subs[head]['general'] = { total: Number(headObj.total) || 0, paid: Number(headObj.paid) || 0 };
        }
        this.subItems(head).forEach(it => { const c = s.subs[head][it.key] || {}; s.subs[head][it.key] = { total: Number(c.total) || 0, paid: Number(c.paid) || 0 }; });
      });
      return s.subs;
    },
    subBreakdown(s, head) {
      this.ensureSubs(s);
      return this.subItems(head).map(it => { const c = (s.subs[head] || {})[it.key] || { total: 0, paid: 0 }; return { key: it.key, label: it.label, total: Number(c.total) || 0, paid: Number(c.paid) || 0, balance: (Number(c.total) || 0) - (Number(c.paid) || 0) }; });
    },
    async setSubs(s, head, data) {
      this.ensureSubs(s);
      this.subItems(head).forEach(it => { const c = (data && data[it.key]) || {}; s.subs[head][it.key] = { total: Number(c.total) || 0, paid: Number(c.paid) || 0 }; });
      await this.saveStudent(s);
    },

    /* ---- transport (monthly, Apr → Mar) ---- */
    transportMonths() { return buildTransportMonths(this.meta && this.meta.year); },
    // Ensure student.transport has all 12 months. First time (legacy data), split
    // the existing single transport total/paid evenly across the months.
    ensureTransport(s) {
      const months = this.transportMonths();
      s.transport = s.transport || {};
      const hasData = months.some(mm => s.transport[mm.key] && ((Number(s.transport[mm.key].total) || 0) || (Number(s.transport[mm.key].paid) || 0)));
      const head = s.fees && s.fees[TRANSPORT_HEAD];
      if (!hasData && head && ((Number(head.total) || 0) > 0 || (Number(head.paid) || 0) > 0)) {
        const T = Math.round(Number(head.total) || 0), P = Math.round(Number(head.paid) || 0);
        const per = Math.floor(T / 12), rem = T - per * 12;
        let paidLeft = P;
        months.forEach((mm, i) => {
          const mt = per + (i < rem ? 1 : 0);
          const mp = Math.min(paidLeft, mt); paidLeft -= mp;
          s.transport[mm.key] = { total: mt, paid: mp };
        });
        if (paidLeft > 0) { const last = months[months.length - 1].key; s.transport[last].paid += paidLeft; s.transport[last].total = Math.max(s.transport[last].total, s.transport[last].paid); }
      } else {
        months.forEach(mm => { const c = s.transport[mm.key] || {}; s.transport[mm.key] = { total: Number(c.total) || 0, paid: Number(c.paid) || 0 }; });
      }
      return s.transport;
    },
    // Save an edited set of monthly amounts (from the edit modal).
    async setTransportMonths(s, data) {
      this.ensureTransport(s);
      this.transportMonths().forEach(mm => {
        const c = (data && data[mm.key]) || {};
        s.transport[mm.key] = { total: Number(c.total) || 0, paid: Number(c.paid) || 0 };
      });
      await this.saveStudent(s); // recomputes the roll-up + persists
    },
    // Per-student monthly view: [{key,label,total,paid,balance}]
    transportBreakdown(s) {
      this.ensureTransport(s);
      return this.transportMonths().map(mm => {
        const c = s.transport[mm.key] || { total: 0, paid: 0 };
        return { key: mm.key, label: mm.label, total: Number(c.total) || 0, paid: Number(c.paid) || 0, balance: (Number(c.total) || 0) - (Number(c.paid) || 0) };
      });
    },

    async persistStudents() { return this.persist(); },
    async persistStudent(s) { return this.persist(); },
    async persistMeta() { return this.persist(); },

    /* ---- payments ----
       A single collection is SPLIT by business, producing one receipt (and one
       payment record) per business, each with its own logo & receipt number. */
    async addPayment(p) {
      // p: {studentId, date, mode, remarks, items:[{head,amount}]}
      const student = this.getStudent(p.studentId);
      if (!student) throw new Error('Student not found');
      const year = (this.meta.year || '2026-2027').split('-')[0];
      this.meta.seqByBiz = this.meta.seqByBiz || {};
      const createdAt = new Date().toISOString();
      const groupId = U.uid(); // ties the split receipts of one transaction together

      // group valid items by business
      const groups = {};
      p.items.forEach(it => {
        const amt = Number(it.amount) || 0; if (amt <= 0) return;
        const biz = HEAD_BUSINESS[it.head] || 'school';
        let label = HEAD_LABELS[it.head] || it.head;
        if (it.head === TRANSPORT_HEAD && it.month) {
          // monthly transport collection → apply to that month
          this.ensureTransport(student);
          const mm = student.transport[it.month] || { total: 0, paid: 0 };
          mm.paid = (Number(mm.paid) || 0) + amt;
          mm.total = Math.max(Number(mm.total) || 0, mm.paid);
          student.transport[it.month] = mm;
          const ml = (this.transportMonths().find(x => x.key === it.month) || {}).label || it.month;
          label = (HEAD_LABELS[TRANSPORT_HEAD] || 'Transport Fees') + ' – ' + ml;
        } else if (MULTI_HEADS.indexOf(it.head) >= 0 && it.sub) {
          // event / extra-curricular collection → apply to that named item
          this.ensureSubs(student);
          const c = student.subs[it.head][it.sub] || { total: 0, paid: 0 };
          c.paid = (Number(c.paid) || 0) + amt;
          c.total = Math.max(Number(c.total) || 0, c.paid);
          student.subs[it.head][it.sub] = c;
          const sl = (this.subItems(it.head).find(x => x.key === it.sub) || {}).label || it.sub;
          label = (HEAD_LABELS[it.head] || it.head) + ' – ' + sl;
        } else {
          const h = student.fees[it.head];
          if (h) {
            h.paid = (Number(h.paid) || 0) + amt;
            // ad-hoc fee (e.g. student newly joins Evening Sports/an event): bill it
            // on the spot so the balance never goes negative.
            h.total = Math.max(Number(h.total) || 0, h.paid);
          }
        }
        const item = { head: it.head, label, amount: amt };
        if (it.month) item.month = it.month;
        if (it.sub) item.sub = it.sub;
        (groups[biz] = groups[biz] || []).push(item);
      });
      this.recompute(student);

      const records = [];
      BUSINESS_ORDER.concat(Object.keys(groups)).filter((v, i, a) => a.indexOf(v) === i).forEach(biz => {
        const items = groups[biz]; if (!items || !items.length) return;
        const B = BUSINESSES[biz];
        this.meta.seqByBiz[biz] = (this.meta.seqByBiz[biz] || 0) + 1;
        const seq = this.meta.seqByBiz[biz];
        const rec = {
          id: U.uid(), groupId,
          receiptNo: B.prefix + '/' + year + '/' + String(seq).padStart(5, '0'), seq,
          business: biz, businessName: B.name,
          studentId: student.id, studentName: student.name, grade: student.grade,
          date: p.date || U.todayISO(), mode: p.mode || 'Cash', remarks: p.remarks || '',
          items, amount: items.reduce((a, x) => a + x.amount, 0), createdAt
        };
        records.push(rec); this.payments.push(rec);
      });
      // keep a running overall receipt count for stats
      this.meta.receiptSeq = (this.meta.receiptSeq || 0) + records.length;

      await this.persist();
      return records; // array — one per business
    },
    businessOfHead(k) { return HEAD_BUSINESS[k] || 'school'; },

    async deletePayment(id) {
      const idx = this.payments.findIndex(p => p.id === id);
      if (idx < 0) return;
      const rec = this.payments[idx];
      const student = this.getStudent(rec.studentId);
      if (student) {
        rec.items.forEach(it => {
          if (it.head === TRANSPORT_HEAD && it.month) {
            this.ensureTransport(student);
            const mm = student.transport[it.month]; if (mm) mm.paid = Math.max(0, (Number(mm.paid) || 0) - (Number(it.amount) || 0));
          } else if (MULTI_HEADS.indexOf(it.head) >= 0 && it.sub) {
            this.ensureSubs(student);
            const c = student.subs[it.head] && student.subs[it.head][it.sub]; if (c) c.paid = Math.max(0, (Number(c.paid) || 0) - (Number(it.amount) || 0));
          } else {
            const h = student.fees[it.head];
            if (h) h.paid = Math.max(0, (Number(h.paid) || 0) - (Number(it.amount) || 0));
          }
        });
        this.recompute(student);
      }
      this.payments.splice(idx, 1);
      await this.persist();
    },

    studentPayments(id) {
      return this.payments.filter(p => p.studentId === id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    /* ---- students: add ---- */
    suggestId() {
      const nums = this.students.map(s => String(s.id).replace(/\D/g, '')).filter(Boolean);
      if (!nums.length) return '25260001';
      // use the most common id length so a stray long/short id doesn't skew it
      const byLen = {};
      nums.forEach(n => { byLen[n.length] = (byLen[n.length] || 0) + 1; });
      const modeLen = Object.keys(byLen).sort((a, b) => byLen[b] - byLen[a])[0];
      let max = 0;
      nums.forEach(n => { if (String(n.length) === modeLen) { const v = parseInt(n, 10); if (v > max) max = v; } });
      return String(max + 1);
    },
    async addStudent(data) {
      const id = String(data.id || '').trim();
      if (!id) throw new Error('Student ID is required');
      if (this.getStudent(id)) throw new Error('Student ID "' + id + '" already exists');
      if (!data.name || !String(data.name).trim()) throw new Error('Student name is required');
      const fees = {};
      HEAD_ORDER.forEach(k => {
        const total = Number((data.fees && data.fees[k]) || 0) || 0;
        fees[k] = { label: HEAD_LABELS[k], total, paid: 0, balance: total };
      });
      const s = {
        id, name: String(data.name).trim(), grade: data.grade || '', classTeacher: data.classTeacher || '',
        gender: data.gender || '', dob: data.dob || '', admissionDate: data.admissionDate || '', age: data.age || '', prevSchool: data.prevSchool || '',
        father: data.father || '', mother: data.mother || '', location: data.location || '', dropLocation: data.dropLocation || '',
        transportType: data.transportType || '', vehicle: data.vehicle || '', contact: data.contact || '',
        religion: data.religion || '', discount: Number(data.discount) || 0, admission: data.admission || 'NEW',
        sportsActivity: data.sportsActivity || '', photo: data.photo || '',
        marks: { english: '', maths: '', science: '' }, fees
      };
      await this.saveStudent(s);
      return s;
    },

    /* ---- fee categories (admin-managed) ---- */
    // Rename the legacy single 'term' head to 'term1' (one-time, preserves amounts)
    migrateLegacyHeads() {
      let changed = 0;
      const hasTerm1 = HEAD_ORDER.indexOf('term1') >= 0;
      this.students.forEach(s => {
        s.fees = s.fees || {};
        const t1 = s.fees.term1;
        if (hasTerm1 && s.fees.term && (!t1 || (!t1.total && !t1.paid))) {
          const t = s.fees.term;
          s.fees.term1 = { label: HEAD_LABELS.term1 || 'Term 1 Fees', total: t.total, paid: t.paid, balance: t.balance };
          delete s.fees.term; changed = 1;
        }
      });
      return changed;
    },
    // Make sure every student has an entry for every current fee head
    ensureStudentHeads() {
      let changed = 0;
      this.students.forEach(s => {
        s.fees = s.fees || {};
        HEAD_ORDER.forEach(k => {
          if (!s.fees[k]) { s.fees[k] = { label: HEAD_LABELS[k], total: 0, paid: 0, balance: 0 }; changed = 1; }
        });
      });
      return changed;
    },
    async _saveFeeHeads() {
      this.meta.feeHeads = this.feeHeads;
      rebuildHeads(this.feeHeads);
      await this.persistMeta();
    },
    _slugKey(label) {
      let base = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'fee';
      let k = base, i = 2;
      while (this.feeHeads.some(h => h.key === k)) k = base + '_' + (i++);
      return k;
    },
    async addFeeHead(label, business) {
      label = String(label || '').trim();
      if (!label) throw new Error('Fee category name is required');
      if (this.feeHeads.some(h => h.label.toLowerCase() === label.toLowerCase())) throw new Error('That fee category already exists');
      const biz = BUSINESSES[business] ? business : 'school';
      const key = this._slugKey(label);
      this.feeHeads.push({ key, label, business: biz });
      this.students.forEach(s => { s.fees[key] = { label, total: 0, paid: 0, balance: 0 }; });
      await this._saveFeeHeads(); await this.persistStudents();
      return key;
    },
    async updateFeeHead(key, label, business) {
      const h = this.feeHeads.find(x => x.key === key); if (!h) return;
      if (label != null) { label = String(label).trim(); if (label) { h.label = label; this.students.forEach(s => { if (s.fees[key]) s.fees[key].label = label; }); } }
      if (business != null && BUSINESSES[business]) h.business = business;
      await this._saveFeeHeads(); await this.persistStudents();
    },
    async deleteFeeHead(key) {
      this.feeHeads = this.feeHeads.filter(h => h.key !== key);
      this.students.forEach(s => { delete s.fees[key]; });
      await this._saveFeeHeads(); await this.persistStudents();
    },
    async moveFeeHead(key, dir) {
      const i = this.feeHeads.findIndex(h => h.key === key); if (i < 0) return;
      const j = i + dir; if (j < 0 || j >= this.feeHeads.length) return;
      const tmp = this.feeHeads[i]; this.feeHeads[i] = this.feeHeads[j]; this.feeHeads[j] = tmp;
      await this._saveFeeHeads();
    },
    feeHeadHasMoney(key) {
      return this.students.some(s => s.fees[key] && (s.fees[key].total > 0 || s.fees[key].paid > 0));
    },

    /* ---- students: edit ---- */
    async saveStudent(s) {
      this.recompute(s);
      const i = this.students.findIndex(x => x.id === s.id);
      if (i < 0) this.students.push(s);
      if (serverMode) { await this.persist(); return; }   // sync edits to the shared server
      if (useIDB && db) await idbPut('students', s);
      else LS.setItem('akb_students', JSON.stringify(this.students));
    },
    // Delete a student record. Past receipts are kept (they carry the student's
    // name/grade) unless withPayments is true.
    async deleteStudent(id, withPayments) {
      const i = this.students.findIndex(s => s.id === id);
      if (i < 0) return;
      this.students.splice(i, 1);
      if (withPayments) this.payments = this.payments.filter(p => p.studentId !== id);
      await this.persist();
    },

    /* ---- attendance (meta.attendance = { 'YYYY-MM-DD': { studentId: 'P'|'A' } }) ---- */
    getAttendance(date) {
      const a = this.meta.attendance || {};
      return a[date] || {};
    },
    async setAttendance(date, studentId, status) {
      if (!this.meta.attendance) this.meta.attendance = {};
      if (!this.meta.attendance[date]) this.meta.attendance[date] = {};
      this.meta.attendance[date][studentId] = status; // 'P' | 'A'
      await this.persist();
    },
    // Mark every student in a grade present for a date (default fill).
    async markAllPresent(date, grade) {
      if (!this.meta.attendance) this.meta.attendance = {};
      if (!this.meta.attendance[date]) this.meta.attendance[date] = {};
      const day = this.meta.attendance[date];
      this.students.filter(s => !grade || s.grade === grade).forEach(s => {
        if (!day[s.id]) day[s.id] = 'P';
      });
      await this.persist();
    },
    // Students absent on a date (optionally within a grade).
    absenteesOn(date, grade) {
      const day = this.getAttendance(date);
      return this.students.filter(s => (!grade || s.grade === grade) && day[s.id] === 'A');
    },
    // list of grades present in the roster, in a sensible order
    // (kindergarten first, then numeric/Roman-numeral grades in order, sections after)
    gradeList() {
      const kg = ['PRE KG', 'PREKG', 'PRE-KG', 'LKG', 'JKG', 'UKG', 'SKG', 'KG'];
      const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
      const set = Array.from(new Set(this.students.map(s => s.grade).filter(Boolean)));
      const rank = g => {
        const u = String(g).toUpperCase().trim();
        const oi = kg.indexOf(u); if (oi >= 0) return oi;                 // 0..7 KG classes
        const kgSection = u.match(/^(PRE KG|PREKG|PRE-KG|LKG|JKG|UKG|SKG|KG)\b/);
        if (kgSection) return kg.indexOf(kgSection[1]) + 0.5;             // e.g. "JKG A"
        const ar = u.match(/(\d+)/); if (ar) return 100 + parseInt(ar[1], 10); // Arabic "Grade 3"
        const rm = u.match(/^([IVX]+)\b/); if (rm && roman[rm[1]]) return 100 + roman[rm[1]]; // "IX A"
        return 900;
      };
      return set.sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
    },

    /* ---- report cards (student.report) ---- */
    async saveStudentReport(id, report) {
      const s = this.students.find(x => x.id === id);
      if (!s) throw new Error('Student not found');
      s.report = report || {};
      s.reportUpdatedAt = new Date().toISOString();
      await this.persist();
    },

    /* ---- users & auth (client-side gate) ---- */
    async seedUsers() {
      const defs = [
        { username: 'admin', role: 'admin', pass: 'admin@123', name: 'Administrator' },
        { username: 'account1', role: 'account', pass: 'account1@123', name: 'Account 1' },
        { username: 'account2', role: 'account', pass: 'account2@123', name: 'Account 2' }
      ];
      this.users = [];
      for (const d of defs) {
        const salt = randSalt();
        this.users.push({
          username: d.username, role: d.role, name: d.name,
          salt, hash: await pbkdf(d.pass, salt), mustChange: true,
          createdAt: new Date().toISOString()
        });
      }
      await this.persistUsers();
    },
    getUser(username) { return this.users.find(u => u.username && u.username.toLowerCase() === String(username).toLowerCase()); },
    async verifyLogin(username, password) {
      const u = this.getUser(username);
      if (!u) return null;
      let salt = u.salt;
      let hash = u.hash;
      if ((!salt || !hash) && u.passwordHash) {
        if (u.passwordHash.indexOf(':') >= 0) {
          const parts = u.passwordHash.split(':');
          salt = parts[0];
          hash = parts[1];
        } else {
          hash = u.passwordHash;
        }
      }
      if (!salt) return null;
      const h = await pbkdf(password, salt);
      return h === hash ? u : null;
    },
    async setPassword(username, password) {
      const u = this.getUser(username);
      if (!u) throw new Error('User not found');
      u.salt = randSalt();
      u.hash = await pbkdf(password, u.salt);
      u.mustChange = false;
      await this.persistUsers();
    },
    async addUser({ username, role, name, password, grades, pages }) {
      username = String(username || '').trim();
      if (!username) throw new Error('Username required');
      if (this.getUser(username)) throw new Error('Username already exists');
      if (!password || password.length < 4) throw new Error('Password too short (min 4)');
      const salt = randSalt();
      const u = {
        username, role: normRole(role), name: name || username,
        salt, hash: await pbkdf(password, salt), mustChange: false, createdAt: new Date().toISOString()
      };
      if (u.role === 'teacher') u.grades = Array.isArray(grades) ? grades.slice() : [];
      // Store an explicit page list when given (unless admin, who always has all).
      if (u.role !== 'admin' && Array.isArray(pages)) u.pages = pages.filter(k => PAGE_KEYS.indexOf(k) >= 0);
      this.users.push(u);
      await this.persistUsers();
    },
    async updateUserRole(username, role) {
      const u = this.getUser(username); if (!u) return;
      u.role = normRole(role);
      if (u.role === 'teacher') { if (!Array.isArray(u.grades)) u.grades = []; }
      else delete u.grades;
      // Admin implies full access; drop any custom page list.
      if (u.role === 'admin') delete u.pages;
      await this.persistUsers();
    },
    async setUserGrades(username, grades) {
      const u = this.getUser(username); if (!u) return;
      u.grades = Array.isArray(grades) ? grades.slice() : [];
      await this.persistUsers();
    },
    async setUserPages(username, pages) {
      const u = this.getUser(username); if (!u) return;
      if (u.role === 'admin') { delete u.pages; }
      else u.pages = Array.isArray(pages) ? pages.filter(k => PAGE_KEYS.indexOf(k) >= 0) : [];
      await this.persistUsers();
    },
    // Effective page keys for a username (or the current user when omitted).
    userPages(username) {
      const u = username ? this.getUser(username) : (this.currentUser && this.getUser(this.currentUser.username));
      return effectivePages(u || (username ? null : this.currentUser));
    },
    // Can this user collect payments / issue receipts / see collections?
    // Account + Administrator only — never teacher / AKBCH Academics / AKB Admins.
    canCollect() { return roleCanCollect(this.currentUser && this.currentUser.role); },
    canAccess(pageKey) {
      if (FINANCIAL_PAGES.indexOf(pageKey) >= 0) return this.canCollect();
      if (this.currentUser && this.currentUser.role === 'admin') return true;
      return this.userPages().indexOf(pageKey) >= 0;
    },
    async deleteUser(username) {
      const admins = this.users.filter(u => u.role === 'admin');
      const target = this.getUser(username);
      if (target && target.role === 'admin' && admins.length <= 1) throw new Error('Cannot delete the last admin');
      this.users = this.users.filter(u => u.username !== username);
      await this.persist();
    },
    async persistUsers() { return this.persist(); },
    // session (persisted so a refresh keeps you logged in on this device)
    setSession(u) {
      this.currentUser = u ? { username: u.username, role: u.role, name: u.name, grades: Array.isArray(u.grades) ? u.grades.slice() : undefined } : null;
      if (u) LS.setItem('akb_session', JSON.stringify({ username: u.username, ts: Date.now() }));
      else LS.removeItem('akb_session');
    },
    restoreSession() {
      try {
        const s = JSON.parse(LS.getItem('akb_session') || 'null');
        if (!s) return null;
        const u = this.getUser(s.username);
        if (u) { this.currentUser = { username: u.username, role: u.role, name: u.name, grades: Array.isArray(u.grades) ? u.grades.slice() : undefined }; return this.currentUser; }
      } catch (e) {}
      return null;
    },
    isAdmin() { return this.currentUser && this.currentUser.role === 'admin'; },

    /* ---- backup ---- */
    exportAll(includeUsers) {
      const o = { app: 'akb-fees', version: 2, exportedAt: new Date().toISOString(),
        meta: this.meta, students: this.students, payments: this.payments };
      if (includeUsers) o.users = this.users;
      return o;
    },
    async importAll(obj) {
      if (!obj || !Array.isArray(obj.students)) throw new Error('Invalid backup file');
      this.students = obj.students.map(normalizeStudent);
      this.payments = Array.isArray(obj.payments) ? obj.payments : [];
      this.meta = obj.meta || { seeded: true, receiptSeq: 0 };
      this.meta.seeded = true;
      if (Array.isArray(obj.users) && obj.users.length) this.users = obj.users;
      // re-apply fee-head config from the restored data (or defaults) and reconcile students
      if (!Array.isArray(this.meta.feeHeads) || !this.meta.feeHeads.length) this.meta.feeHeads = DEFAULT_FEE_HEADS.map(h => Object.assign({}, h));
      this.feeHeads = this.meta.feeHeads;
      rebuildHeads(this.feeHeads);
      this.migrateLegacyHeads(); this.ensureStudentHeads();
      await this.persist();
      this.recomputeAll();
    }
  };

  /* password hashing via Web Crypto (PBKDF2-SHA256). Falls back to a
     lightweight hash if SubtleCrypto is unavailable (e.g. insecure origin). */
  function randSalt() {
    const a = new Uint8Array(16);
    (w.crypto || {}).getRandomValues ? w.crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = (i * 131 + 7) & 255);
    return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function pbkdf(password, saltHex) {
    try {
      const enc = new TextEncoder();
      const salt = Uint8Array.from(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
      const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
      return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // fallback (non-crypto) — still salted; only used if Web Crypto is missing
      let h = 2166136261 >>> 0; const str = saltHex + '|' + password;
      for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return 'fb' + h.toString(16);
    }
  }

  /* ---------- helpers ---------- */
  function normalizeStudent(s) {
    s = Object.assign({}, s);
    s.fees = s.fees || {};
    HEAD_ORDER.forEach(k => {
      const h = s.fees[k] || { label: HEAD_LABELS[k], total: 0, paid: 0, balance: 0 };
      h.total = Number(h.total) || 0;
      h.paid = Number(h.paid) || 0;
      h.label = h.label || HEAD_LABELS[k];
      h.balance = Math.round((h.total - h.paid) * 100) / 100;
      s.fees[k] = h;
    });
    return s;
  }

  /* ---------- IndexedDB primitives ---------- */
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!w.indexedDB) return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('students')) d.createObjectStore('students', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('payments')) d.createObjectStore('payments', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('users')) d.createObjectStore('users', { keyPath: 'username' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(store, mode) { return db.transaction(store, mode).objectStore(store); }
  function idbAll(store) {
    return new Promise((res, rej) => { const r = tx(store, 'readonly').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
  }
  function idbPut(store, val) {
    return new Promise((res, rej) => { const r = tx(store, 'readwrite').put(val); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  }
  function idbPutMany(store, arr) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, 'readwrite'); const os = t.objectStore(store);
      arr.forEach(v => os.put(v));
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    });
  }
  function idbDelete(store, key) {
    return new Promise((res, rej) => { const r = tx(store, 'readwrite').delete(key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  }
  function idbClear(store) {
    return new Promise((res, rej) => { const r = tx(store, 'readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
  }

  w.Store = Store;
})(window);
