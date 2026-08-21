/* ===== AKB Fee Collection — router & bootstrap ===== */
(function (w) {
  'use strict';

  // Sub-routes that ride on a top-level page's access grant.
  const ROUTE_PAGE = { student: 'students', business: 'dashboard' };
  function pageOf(name) { return ROUTE_PAGE[name] || name; }

  const Router = {
    render() { route(); },
    start: startApp
  };
  w.Router = Router;

  function parseHash() {
    let h = location.hash.replace(/^#\/?/, '');
    if (!h) h = 'dashboard';
    const [path, query] = h.split('?');
    const parts = path.split('/');
    const params = {};
    if (query) query.split('&').forEach(kv => { const [k, v] = kv.split('='); params[k] = decodeURIComponent(v || ''); });
    return { seg: parts, params };
  }

  function setActive(routeName) {
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === routeName));
  }

  function role() { return (Store.currentUser && Store.currentUser.role) || 'account'; }
  // First page this user can actually open (used as their home screen).
  function landing() {
    if (Store.isAdmin()) return 'dashboard';
    const pages = Store.userPages();
    return (pages && pages.length) ? pages[0] : 'dashboard';
  }

  function allowed(name) {
    if (Store.isAdmin()) return true;
    return Store.canAccess(pageOf(name));
  }

  function route() {
    const { seg, params } = parseHash();
    let name = seg[0];
    if (!allowed(name)) {
      // send the user to their landing page for their role
      const land = landing();
      name = land;
      if (location.hash.replace(/^#\/?/, '').split('/')[0] !== land) { location.hash = '#/' + land; return; }
    }
    try {
      switch (name) {
        case 'dashboard': setActive('dashboard'); Views.dashboard(); break;
        case 'students': setActive('students'); Views.students(params); break;
        case 'student': setActive('students'); Views.studentDetail(decodeURIComponent(seg[1] || '')); break;
        case 'business': setActive('dashboard'); Views.businessDashboard(decodeURIComponent(seg[1] || ''), params); break;
        case 'collect': setActive('collect'); Views.collect(); break;
        case 'collections': setActive('collections'); Views.collections(params); break;
        case 'expenses': setActive('expenses'); Views.expenses(params); break;
        case 'reports': setActive('reports'); Views.reports(params); break;
        case 'attendance': setActive('attendance'); Views.attendance(params); break;
        case 'attreport': setActive('attreport'); Views.attReport(params); break;
        case 'marks': setActive('marks'); Views.marks(params); break;
        case 'academics': setActive('academics'); Views.academics(params); break;
        case 'users': setActive('users'); Views.users(); break;
        case 'data': setActive('data'); Views.data(); break;
        default: location.hash = '#/' + landing();
      }
    } catch (e) {
      console.error(e);
      document.getElementById('view').innerHTML = '<div class="empty">Something went wrong: ' + U.esc(e.message) + '</div>';
    }
    document.getElementById('sidebar').classList.remove('open');
    // close any open modal/receipt when navigating
    const mr = document.getElementById('modalRoot'); if (mr) mr.innerHTML = '';
    document.body.classList.remove('receipt-open');
    window.scrollTo(0, 0);
  }

  function applyRoleUI() {
    const admin = Store.isAdmin();
    const r = role();
    // Show a nav link only if this user has access to that page ("as per my wish").
    document.querySelectorAll('#nav a[data-route]').forEach(a => {
      const pg = pageOf(a.dataset.route);
      a.classList.toggle('hidden', !(admin || Store.canAccess(pg)));
    });
    const u = Store.currentUser || {};
    document.getElementById('userBox').innerHTML = `
      <div class="user-row">
        <div class="user-ava">${U.esc(U.initials(u.name || u.username || '?'))}</div>
        <div class="user-meta"><strong>${U.esc(u.name || u.username)}</strong><span class="badge ${admin ? 'blue' : (r === 'teacher' ? 'amber' : 'gray')}">${U.esc((Store.ROLE_LABEL && Store.ROLE_LABEL[u.role]) || u.role)}</span></div>
      </div>
      <div class="user-actions">
        <button class="btn sm" id="changePw">Password</button>
        <button class="btn sm" id="logoutBtn">Logout</button>
      </div>`;
    document.getElementById('logoutBtn').onclick = () => Auth.logout();
    document.getElementById('changePw').onclick = () => Views.changePassword();
    updateSyncBadge();
  }

  // Sidebar badge: is this device connected to the shared server, and is
  // everything saved? Green = all saved · amber = saving · red = offline.
  function updateSyncBadge() {
    const el = document.getElementById('syncBadge');
    const st = (Store.syncState && Store.syncState()) || 'saved';
    const map = {
      saved:   { cls: 'ok',      txt: 'All saved to server' },
      saving:  { cls: 'saving',  txt: 'Saving…' },
      offline: { cls: 'offline', txt: 'Offline — this device only' }
    };
    const m = map[st] || map.offline;
    if (el) { el.className = 'sync-badge ' + m.cls; el.innerHTML = '<span class="dot"></span><span>' + m.txt + '</span>'; }
    const dot = document.getElementById('dbStatus');
    if (dot) { dot.className = 'db-status ' + m.cls; dot.title = m.txt; }
  }

  function wireGlobalSearch() {
    const input = document.getElementById('globalSearch');
    const box = document.getElementById('searchResults');
    const run = U.debounce(() => {
      const q = input.value.trim().toLowerCase();
      if (!q) { box.classList.remove('open'); box.innerHTML = ''; return; }
      const rows = Store.students.filter(s =>
        (s.name + ' ' + s.id + ' ' + (s.father || '') + ' ' + (s.contact || '')).toLowerCase().indexOf(q) >= 0
      ).slice(0, 12);
      box.innerHTML = rows.map(s => {
        const t = Store.studentTotals(s);
        return `<div class="sr-item" data-id="${U.esc(s.id)}">
          <span>${U.esc(s.name)} <span class="muted">· ${U.esc(s.grade || '')} · ${U.esc(s.id)}</span></span>
          <span class="sr-bal" style="color:${t.balance > 0 ? 'var(--red)' : 'var(--green)'}">${U.inr(t.balance)}</span></div>`;
      }).join('') || '<div class="sr-item muted">No match</div>';
      box.classList.add('open');
      box.querySelectorAll('[data-id]').forEach(el => el.onclick = () => {
        location.hash = '#/student/' + encodeURIComponent(el.dataset.id);
        box.classList.remove('open'); input.value = '';
      });
    }, 150);
    input.oninput = run; input.onfocus = run;
    document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) box.classList.remove('open'); });
  }

  let wired = false;
  function startApp() {
    applyRoleUI();
    if (!wired) {
      wireGlobalSearch();
      window.addEventListener('hashchange', route);
      window.addEventListener('akb-sync', updateSyncBadge);
      document.getElementById('hamburger').onclick = () => document.getElementById('sidebar').classList.toggle('open');
      wired = true;
    }
    document.getElementById('yearBadge').textContent = (Store.meta.school || 'AKB School') + ' · ' + (Store.meta.year || '');
    // land on the role's home page
    if (!location.hash || location.hash === '#/' ) location.hash = '#/' + landing();
    route();
  }

  async function boot() {
    try {
      await Store.init();
      const u = Store.restoreSession();
      if (u) startApp(u);
      else Auth.showLogin(startApp);
    } catch (e) {
      console.error(e);
      document.getElementById('view').innerHTML =
        '<div class="empty">Failed to load data: ' + U.esc(e.message) +
        '<br><br>If you opened this file directly, try a local server:<br><code>python3 -m http.server</code> then open <code>http://localhost:8000</code></div>';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
