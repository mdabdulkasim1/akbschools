/* ===== AKB Fee Collection — utilities ===== */
(function (w) {
  'use strict';

  // Indian-format currency (no decimals for whole rupees)
  function inr(n) {
    n = Number(n) || 0;
    const neg = n < 0;
    n = Math.round(Math.abs(n));
    const s = n.toString();
    let last3 = s.slice(-3);
    let rest = s.slice(0, -3);
    if (rest) last3 = ',' + last3;
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    return (neg ? '-₹' : '₹') + rest + last3;
  }
  // plain number with Indian grouping, no symbol
  function inum(n) { return inr(n).replace('₹', '').replace('-', '-'); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function initials(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/[\s.]+/).filter(Boolean);
    return ((parts[0] || '')[0] || '' ).toUpperCase() + ((parts[1] || '')[0] || '').toUpperCase();
  }

  function todayISO() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // Rupees in words (Indian system) — for receipts
  function inWords(num) {
    num = Math.round(Number(num) || 0);
    if (num === 0) return 'Zero Rupees Only';
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
      'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function two(n) { return n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : ''); }
    function three(n) { return (n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n)); }
    let out = '';
    const crore = Math.floor(num / 10000000); num %= 10000000;
    const lakh = Math.floor(num / 100000); num %= 100000;
    const thou = Math.floor(num / 1000); num %= 1000;
    const hun = num;
    if (crore) out += three(crore) + ' Crore ';
    if (lakh) out += two(lakh) + ' Lakh ';
    if (thou) out += two(thou) + ' Thousand ';
    if (hun) out += three(hun) + ' ';
    return out.trim() + ' Rupees Only';
  }

  function debounce(fn, ms) {
    let t; return function () { clearTimeout(t); const args = arguments, ctx = this; t = setTimeout(() => fn.apply(ctx, args), ms); };
  }

  // Read an image File, downscale it, and return a compact JPEG data URI.
  function imageToDataURL(file, maxDim) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve('');
      const rd = new FileReader();
      rd.onerror = () => reject(new Error('Could not read file'));
      rd.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Not a valid image'));
        img.onload = () => {
          const M = maxDim || 320;
          let w = img.width, h = img.height;
          const scale = Math.min(1, M / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          try { resolve(c.toDataURL('image/jpeg', 0.85)); }
          catch (e) { resolve(rd.result); } // fallback to original if tainted
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  // Parse CSV text into an array of row-arrays (handles quotes, commas, newlines)
  function fromCSV(text) {
    const rows = []; let cur = [], field = '', inq = false;
    text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inq) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inq = false; }
        else field += c;
      } else {
        if (c === '"') inq = true;
        else if (c === ',') { cur.push(field); field = ''; }
        else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
        else field += c;
      }
    }
    cur.push(field); rows.push(cur);
    return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
  }

  function toCSV(rows) {
    return rows.map(r => r.map(c => {
      c = c == null ? '' : String(c);
      return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    }).join(',')).join('\r\n');
  }

  // Normalise an Indian mobile to international digits (no +). Default CC 91.
  function normalizePhone(num, cc) {
    cc = cc || '91';
    let d = String(num == null ? '' : num).replace(/\D/g, '');
    if (!d) return '';
    if (d.length > 10 && d.indexOf(cc) === 0) return d;   // already has country code
    if (d.length === 11 && d[0] === '0') d = d.slice(1);   // drop leading 0
    if (d.length === 10) return cc + d;
    return d;
  }
  function waLink(num, text, cc) {
    const n = normalizePhone(num, cc);
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(text || '');
  }
  function smsLink(num, text, cc) {
    const n = normalizePhone(num, cc);
    return 'sms:' + (n ? '+' + n : '') + '?body=' + encodeURIComponent(text || '');
  }

  function toast(msg, kind) {
    const root = document.getElementById('toastRoot');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // Global API fetch loader interceptor
  let activeApiRequests = 0;
  const origFetch = w.fetch;
  function setLoaderState(loading) {
    const pBar = document.getElementById('globalProgressBar');
    const badge = document.getElementById('globalLoaderBadge');
    if (pBar) pBar.classList.toggle('loading', loading);
    if (badge) badge.classList.toggle('visible', loading);
  }

  if (origFetch) {
    w.fetch = function () {
      const firstArg = arguments[0];
      const url = typeof firstArg === 'string' ? firstArg : (firstArg && firstArg.url ? firstArg.url : '');
      const isApi = url.indexOf('/api/') !== -1 || url.indexOf('api/') !== -1;

      if (isApi) {
        activeApiRequests++;
        setLoaderState(true);
      }

      return origFetch.apply(this, arguments)
        .finally(() => {
          if (isApi) {
            activeApiRequests = Math.max(0, activeApiRequests - 1);
            if (activeApiRequests === 0) {
              setLoaderState(false);
            }
          }
        });
    };
  }

  w.U = { inr, inum, esc, initials, todayISO, fmtDate, inWords, debounce, download, toCSV, fromCSV, imageToDataURL, normalizePhone, waLink, smsLink, toast, uid, setLoaderState };
})(window);
