/* ===== AKB Fee Collection — receipt rendering & printing =====
   Each receipt belongs to one business and carries that business's logo.
   A single collection may produce several receipts (one per business). */
(function (w) {
  'use strict';

  function html(rec) {
    const s = Store.getStudent(rec.studentId) || {};
    const totals = s.fees ? Store.studentTotals(s) : { balance: 0 };
    const B = Store.BUSINESSES[rec.business] || Store.BUSINESSES.school;
    const rows = rec.items.map(it =>
      `<tr><td style="padding:8px 10px;border:1px solid #e2e8f0">${U.esc(it.label)}</td>
        <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right">${U.inr(it.amount)}</td></tr>`).join('');
    return `
    <div class="receipt" style="font-family:Arial,sans-serif;color:#111;max-width:620px;margin:0 auto 22px;padding:24px 28px;border:1px solid #e2e8f0;border-radius:8px">
      <div style="text-align:center;border-bottom:3px solid ${B.color};padding-bottom:10px;margin-bottom:14px">
        <img src="${B.logoFull || B.logo}" alt="${U.esc(B.name)}" style="max-height:96px;max-width:100%;width:auto"/>
        <div style="font-size:13px;font-weight:700;color:${B.color};letter-spacing:1px;margin-top:6px">FEE RECEIPT &middot; A.Y. ${U.esc(Store.meta.year || '2026-2027')}</div>
      </div>

      <table style="width:100%;font-size:13px;margin-bottom:12px"><tbody>
        <tr><td style="padding:3px 0"><b>Receipt No:</b> ${U.esc(rec.receiptNo)}</td>
            <td style="padding:3px 0;text-align:right"><b>Date:</b> ${U.fmtDate(rec.date)}</td></tr>
        <tr><td style="padding:3px 0"><b>Student:</b> ${U.esc(rec.studentName)}</td>
            <td style="padding:3px 0;text-align:right"><b>Student ID:</b> ${U.esc(rec.studentId)}</td></tr>
        <tr><td style="padding:3px 0"><b>Grade:</b> ${U.esc(rec.grade || s.grade || '')}</td>
            <td style="padding:3px 0;text-align:right"><b>Mode:</b> ${U.esc(rec.mode)}</td></tr>
      </tbody></table>

      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f1f5f9">
          <th style="text-align:left;padding:8px 10px;border:1px solid #e2e8f0">Fee Head</th>
          <th style="text-align:right;padding:8px 10px;border:1px solid #e2e8f0">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="font-weight:700;background:#f8fafc">
          <td style="padding:8px 10px;border:1px solid #e2e8f0">Total Paid</td>
          <td style="padding:8px 10px;border:1px solid #e2e8f0;text-align:right">${U.inr(rec.amount)}</td></tr></tfoot>
      </table>

      <div style="font-size:12px;color:#333;margin:10px 0 3px"><b>In words:</b> ${U.esc(U.inWords(rec.amount))}</div>
      ${rec.remarks ? `<div style="font-size:12px;color:#333;margin-bottom:3px"><b>Remarks:</b> ${U.esc(rec.remarks)}</div>` : ''}
      <div style="font-size:12px;color:#b91c1c;margin-bottom:14px"><b>Student's remaining balance (all fees):</b> ${U.inr(totals.balance)}</div>

      <div style="margin-top:26px;text-align:center;font-size:11px;color:#777;font-style:italic">This is a computer-generated receipt; no need for a signature</div>
    </div>`;
  }

  // rec can be a single record or an array (a split collection)
  function open(rec) {
    const list = Array.isArray(rec) ? rec : [rec];
    if (!list.length) return;
    const root = document.getElementById('modalRoot');
    const many = list.length > 1;
    root.innerHTML = `
      <div class="modal-backdrop" id="rcptBackdrop">
        <div class="modal wide">
          <div class="modal-head no-print">
            <h3>${many ? list.length + ' Receipts (split by business)' : 'Payment Receipt'}</h3>
            <button class="x-close" id="rcptClose">&times;</button>
          </div>
          <div class="modal-body">
            ${many ? `<div class="no-print" style="margin-bottom:12px;font-size:12px;color:#64748b">This collection covers more than one business, so a separate receipt was generated for each. Printing outputs all of them.</div>` : ''}
            ${list.map(html).join('')}
          </div>
          <div class="modal-foot no-print">
            <button class="btn" id="rcptCloseBtn">Close</button>
            <button class="btn primary" id="rcptPrint">🖨️ Print / Save PDF</button>
          </div>
        </div>
      </div>`;
    document.body.classList.add('receipt-open');
    const close = () => { root.innerHTML = ''; document.body.classList.remove('receipt-open'); };
    document.getElementById('rcptClose').onclick = close;
    document.getElementById('rcptCloseBtn').onclick = close;
    document.getElementById('rcptPrint').onclick = () => window.print();
    document.getElementById('rcptBackdrop').onclick = (e) => { if (e.target.id === 'rcptBackdrop') close(); };
  }

  w.Receipt = { html, open };
})(window);
