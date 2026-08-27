/* ===== AKB Fee Collection — login / auth UI ===== */
(function (w) {
  'use strict';

  function showLogin(onSuccess) {
    const root = document.getElementById('authRoot');
    document.getElementById('app').style.display = 'none';
    root.innerHTML = `
      <div class="login-screen">
        <form class="login-card" id="loginForm" autocomplete="on">
          <div class="login-logo"><img src="assets/img/logo-school.svg" alt="AKB School of Excellence" /></div>
          <h1>AKB School of Excellence</h1>
          <p class="muted">Fee Collection · Sign in to continue</p>
          <div class="field"><label>Username</label><input id="lgUser" autofocus autocomplete="username" placeholder="admin / account1 / account2"/></div>
          <div class="field"><label>Password</label>
            <div class="pw-wrap">
              <input id="lgPass" type="password" autocomplete="current-password" placeholder="••••••••"/>
              <button type="button" class="pw-eye" id="lgEye" aria-label="Show password" title="Show password">👁</button>
            </div>
          </div>
          <div id="lgErr" class="login-err"></div>
          <button class="btn primary" style="width:100%;justify-content:center" id="lgBtn" type="submit">Sign in</button>
          <div class="login-hint muted" id="lgHint"></div>
        </form>
      </div>`;
    // one-time default-credentials hint (only while users are still default)
    if (Store.users.some(u => u.mustChange)) {
      document.getElementById('lgHint').innerHTML =
        'First‑time defaults — change them after signing in:<br>' +
        '<code>admin / admin@123</code> · <code>account1 / account1@123</code> · <code>account2 / account2@123</code>';
    }

    // show/hide password so staff can check for typos
    const eye = document.getElementById('lgEye');
    if (eye) eye.onclick = () => {
      const pw = document.getElementById('lgPass');
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      eye.textContent = show ? '🙈' : '👁';
      eye.title = show ? 'Hide password' : 'Show password';
      eye.setAttribute('aria-label', eye.title);
      pw.focus();
    };

    const form = document.getElementById('loginForm');
    const err = document.getElementById('lgErr');
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = '';
      const u = document.getElementById('lgUser').value.trim();
      const p = document.getElementById('lgPass').value;
      if (!u || !p) { err.textContent = 'Enter username and password'; return; }
      const btn = document.getElementById('lgBtn');
      btn.disabled = true; btn.textContent = 'Signing in…';
      const user = await Store.verifyLogin(u, p);
      btn.disabled = false; btn.textContent = 'Sign in';
      if (!user) { err.textContent = 'Invalid username or password'; return; }
      Store.setSession(user);
      root.innerHTML = '';
      document.getElementById('app').style.display = '';
      onSuccess(user);
    };
  }

  async function logout() {
    try { await Store.flush(); } catch (e) {}   // save any pending change before leaving
    Store.setSession(null);
    location.hash = '#/dashboard';
    showLogin((u) => w.Router.start(u));
  }

  w.Auth = { showLogin, logout };
})(window);
