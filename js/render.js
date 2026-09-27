// ─── RENDERING: KPIs, order table, detail panel, finances ─────────────────
import { LEDGER_LABEL, PAGE_SIZE } from './config.js';
import { fetchReceiptDetail } from './api.js';
import { renderFeeChart, renderOrderCharts } from './charts.js';
import { categoriseEntry, computeLedgerTotals, ledgerType } from './finance.js';
import { state } from './state.js';
import { escHtml, fmtMoney, getStatus, money, statusClass } from './util.js';

const $ = id => document.getElementById(id);

// ─── KPIs ──────────────────────────────────────────────────────────────────
export function renderKPIs() {
  // Gross from receipts (what the buyer paid, including shipping + tax)
  const gross = state.allOrders.reduce((s, o) => s + money(o.grandtotal), 0);
  const count = state.allOrders.length;
  const aov   = count ? gross / count : 0;

  $('kpi-revenue').textContent = fmtMoney(gross);
  $('kpi-orders').textContent  = count;
  $('kpi-aov').textContent     = fmtMoney(aov);
  $('order-count').textContent = `${count} order${count !== 1 ? 's' : ''}`;

  if (state.detailsLoaded && state.ledgerEntries) {
    const { feesCents, netCents } = computeLedgerTotals(state.ledgerEntries);
    $('kpi-fees').textContent     = fmtMoney(Math.abs(feesCents / 100));
    $('kpi-net').textContent      = fmtMoney(netCents / 100);
    $('kpi-fees-sub').textContent = 'txn + processing + ads + listing + labels';
    $('kpi-net-sub').textContent  = 'gross minus all fees';
  }
}

// ─── FINANCES TAB ──────────────────────────────────────────────────────────
export function renderFinances() {
  if (!state.detailsLoaded) return;

  const entries = state.ledgerEntries || [];
  if (!entries.length) {
    $('finances-tbody').innerHTML =
      `<tr><td colspan="6" style="text-align:center;color:var(--muted2);font-family:'DM Mono',monospace;font-size:0.72rem;padding:2rem">No ledger entries found for this date range.</td></tr>`;
    $('fin-count').textContent = '0 entries';
    return;
  }

  const { grossCents, feesCents, netCents } = computeLedgerTotals(entries);

  renderFeeChart(entries);

  $('fin-gross').textContent = fmtMoney(grossCents / 100);
  $('fin-fees').textContent  = fmtMoney(Math.abs(feesCents / 100));
  $('fin-net').textContent   = fmtMoney(netCents / 100);
  $('fin-count').textContent = `${entries.length} entries`;

  // Sort newest first
  const sorted = [...entries].sort((a, b) => b.created_timestamp - a.created_timestamp);

  const rows = sorted.map(e => {
    const cat   = categoriseEntry(e);
    const amt   = e.amount / 100;
    const bal   = e.balance / 100;
    const isPos = amt >= 0;
    const date  = new Date(e.created_timestamp * 1000).toLocaleDateString('en-US', {
      month:'short', day:'numeric', year:'numeric'
    });

    const t_key = ledgerType(e);
    const label = escHtml(LEDGER_LABEL[t_key] || e.description || t_key || '');

    // Type badge
    const isPayout = t_key.startsWith('DISBURSE') || t_key === 'deposit';
    const badgeClass = {
      revenue:     'lt-revenue',
      fee:         'lt-fee',
      refund:      'lt-refund',
      passthrough: (t_key === 'DISBURSE' || t_key === 'DISBURSE2') ? 'lt-payout' : 'lt-tax',
    }[cat] || 'lt-other';
    const badgeLabel = { revenue:'sale', fee:'fee', refund:'refund', passthrough: isPayout ? 'payout' : 'pass-through' }[cat] || cat;
    const typeBadge = `<span class="ledger-type-badge ${badgeClass}">${badgeLabel}</span>`;

    // Reference cell
    const refHtml = e.reference_type === 'receipt'
      ? `<span class="td-mono td-muted">#${escHtml(e.reference_id)}</span>`
      : `<span style="color:var(--muted2);font-size:0.65rem;font-family:'DM Mono',monospace">${escHtml((e.reference_type || '—').replace(/_/g, ' '))}</span>`;

    // Amount cell — colour-coded by category
    let amtStyle;
    if      (cat === 'revenue') amtStyle = `color:var(--green);font-family:'Fraunces',serif;font-weight:700;font-size:0.9rem`;
    else if (cat === 'fee')     amtStyle = `color:var(--red);font-family:'DM Mono',monospace;font-size:0.72rem`;
    else if (cat === 'refund')  amtStyle = `color:var(--gold);font-family:'DM Mono',monospace;font-size:0.72rem`;
    else                        amtStyle = `color:var(--muted2);font-family:'DM Mono',monospace;font-size:0.72rem`;

    const amtHtml = `<span style="${amtStyle}">${isPos ? '+' : ''}${fmtMoney(amt)}</span>`;

    return `<tr>
      <td class="td-mono td-muted">${date}</td>
      <td>${typeBadge}</td>
      <td>${label}</td>
      <td>${refHtml}</td>
      <td>${amtHtml}</td>
      <td class="td-mono td-muted">${fmtMoney(bal)}</td>
    </tr>`;
  });

  $('finances-tbody').innerHTML = rows.join('');
}

// ─── ORDER TABLE ────────────────────────────────────────────────────────────
export function renderTable() {
  const tbody = $('orders-tbody');
  const start = (state.currentPage - 1) * PAGE_SIZE;
  const page  = state.allOrders.slice(start, start + PAGE_SIZE);

  if (!page.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted2);font-family:'DM Mono',monospace;font-size:0.72rem;padding:2rem">No orders found.</td></tr>`;
    renderPagination(); return;
  }

  tbody.innerHTML = '';
  page.forEach(o => {
    const rid    = o.receipt_id;
    const date   = o.create_timestamp ? new Date(o.create_timestamp * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—';
    const buyer  = escHtml(o.name || o.buyer_user_id || '—');
    const items  = o.transaction_count || (o.transactions?.length) || '—';
    const gross  = o.grandtotal ? fmtMoney(money(o.grandtotal)) : '—';
    const status = getStatus(o);

    const tr = document.createElement('tr');
    tr.className = 'order-row';
    tr.dataset.rid = rid;
    tr.innerHTML = `
      <td class="td-mono td-muted" style="width:24px"><span class="expand-icon">▶</span></td>
      <td class="td-mono td-muted">#${escHtml(rid || '—')}</td>
      <td class="td-mono td-muted">${date}</td>
      <td>${buyer}</td>
      <td class="td-mono" style="color:var(--muted)">${escHtml(items)}</td>
      <td><span class="status-badge ${statusClass(status)}">${escHtml(status)}</span></td>
      <td><span class="amount-pos">${gross}</span></td>
    `;
    tr.addEventListener('click', () => toggleDetail(tr, o));
    tbody.appendChild(tr);

    const dtr = document.createElement('tr');
    dtr.className = 'detail-row';
    dtr.id = `detail-${rid}`;
    dtr.style.display = 'none';
    const dtd = document.createElement('td');
    dtd.colSpan = 7;
    dtr.appendChild(dtd);
    tbody.appendChild(dtr);
  });

  renderPagination();
}

async function toggleDetail(tr, order) {
  const rid    = order.receipt_id;
  const dtr    = $(`detail-${rid}`);
  const isOpen = dtr.style.display !== 'none';

  if (state.expandedRow && state.expandedRow !== tr) {
    state.expandedRow.classList.remove('expanded');
    const prevDtr = $(`detail-${state.expandedRow.dataset.rid}`);
    if (prevDtr) prevDtr.style.display = 'none';
  }

  if (isOpen) {
    tr.classList.remove('expanded');
    dtr.style.display = 'none';
    state.expandedRow = null;
    return;
  }

  tr.classList.add('expanded');
  dtr.style.display = '';
  state.expandedRow = tr;

  const td = dtr.querySelector('td');

  if (!state.detailCache[rid]) {
    td.innerHTML = `<div class="detail-inner"><div class="detail-loading"><span class="mini-spinner"></span> Fetching order details…</div></div>`;
    try {
      state.detailCache[rid] = await fetchReceiptDetail(rid);
    } catch (err) {
      td.innerHTML = `<div class="detail-inner"><div class="detail-loading" style="color:var(--orange)">⚠ Failed to load details: ${escHtml(err.message)}</div></div>`;
      tr.classList.remove('expanded');
      state.expandedRow = null;
      return;
    }
  }

  renderDetailPanel(td, order, state.detailCache[rid]);
}

/**
 * Pick the best available amount from a payment object.
 * Priority: adjusted (post-refund) → posted (post-shipment) → amount (pre-shipment estimate)
 * field is 'gross', 'fees', or 'net'
 */
export function bestPaymentAmount(pay, field) {
  const adjusted = pay[`adjusted_${field}`];
  const posted   = pay[`posted_${field}`];
  const amount   = pay[`amount_${field}`];
  if (adjusted && adjusted.amount != null) return money(adjusted);
  if (posted   && posted.amount   != null) return money(posted);
  return money(amount);
}

export function hasRefund(pay) {
  return !!(pay && pay.adjusted_gross && pay.adjusted_gross.amount != null);
}

function renderDetailPanel(td, o, detail) {
  const pay = detail?.payment;
  const txs = detail?.transactions || [];

  const grandtotal = money(o.grandtotal);
  const subtotal   = money(o.subtotal);
  const shipping   = money(o.total_shipping_cost);
  const tax        = money(o.total_tax_cost);
  const discount   = money(o.discount_amt);

  // Note: payment.amount_fees is only the CARD PROCESSING fee.
  // Total Etsy fees only appear in the ledger.
  const netAmt   = pay ? bestPaymentAmount(pay, 'net')  : null;
  const feesAmt  = pay ? bestPaymentAmount(pay, 'fees') : null;
  const refunded = hasRefund(pay);

  const addr      = [o.city, o.state, o.country_iso].filter(Boolean).join(', ') || '—';
  const payMethod = o.payment_method ? escHtml(o.payment_method.replace(/_/g, ' ')) : '—';
  const payStatus = escHtml(pay?.status || '—');

  const stats = [
    { label:'Grand Total', val:fmtMoney(grandtotal), cls:'' },
    { label:'Subtotal',    val:fmtMoney(subtotal),   cls:'' },
    { label:'Shipping',    val:fmtMoney(shipping),   cls:'' },
    { label:'Tax',         val:fmtMoney(tax),        cls:'' },
    ...(discount > 0 ? [{ label:'Discount', val:`−${fmtMoney(discount)}`, cls:'red' }] : []),
    ...(refunded ? [{ label:'⚠ Refunded', val:'(see adjusted)', cls:'red' }] : []),
    ...(pay ? [
      { sep:true },
      { label:'Processing Fee', val:`−${fmtMoney(Math.abs(feesAmt))}`, cls:'red' },
      { label:'Net (after proc. fee)', val:fmtMoney(netAmt), cls:'green' },
    ] : []),
  ];

  const summaryHTML = `<div class="detail-summary">${
    stats.map(s => s.sep
      ? `<div class="detail-stat-sep"></div>`
      : `<div class="detail-stat">
           <span class="detail-stat-label">${s.label}</span>
           <span class="detail-stat-val ${s.cls}">${s.val}</span>
         </div>`
    ).join('')
  }</div>`;

  const infoHTML = `
    <div class="detail-col-info">
      <div class="detail-section-title">Order info</div>
      <div class="detail-kv"><span class="detail-kv-label">Payment</span><span class="detail-kv-val" style="text-transform:capitalize">${payMethod}</span></div>
      ${pay ? `<div class="detail-kv"><span class="detail-kv-label">Pay status</span><span class="detail-kv-val" style="text-transform:capitalize">${payStatus}</span></div>` : ''}
      ${refunded ? `<div class="detail-kv"><span class="detail-kv-label">Refunded</span><span class="detail-kv-val red">Yes</span></div>` : ''}
      <div class="detail-kv"><span class="detail-kv-label">Ship to</span><span class="detail-kv-val muted" title="${escHtml(addr)}">${escHtml(addr)}</span></div>
      <div class="detail-kv"><span class="detail-kv-label">Gift order</span><span class="detail-kv-val">${o.is_gift ? 'Yes' : 'No'}</span></div>
      ${pay ? `<div class="detail-note" style="font-size:0.68rem;color:var(--muted2)">⚠ Processing fee only. Full transaction + ad fees appear in the Finances tab.</div>` : ''}
      ${o.message_from_buyer ? `<div class="detail-note"><strong style="font-size:0.7rem;font-weight:500;color:var(--ink)">Buyer note</strong><br>${escHtml(o.message_from_buyer)}</div>` : ''}
      ${o.is_gift && o.gift_message ? `<div class="detail-note"><strong style="font-size:0.7rem;font-weight:500;color:var(--ink)">Gift message</strong><br>${escHtml(o.gift_message)}</div>` : ''}
    </div>`;

  const itemsHTML = txs.length
    ? `<table class="line-items">
        <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th class="li-num">Each</th><th class="li-num">Total</th></tr></thead>
        <tbody>${txs.map(t => {
          const each  = t.price ? money(t.price) : null;
          const qty   = t.quantity || 1;
          const total = each !== null ? each * qty : null;
          return `<tr>
            <td>
              <div class="li-title">${escHtml(t.title || '—')}</div>
              ${t.sku ? `<div class="li-sku">SKU: ${escHtml(t.sku)}</div>` : ''}
            </td>
            <td style="text-align:center;color:var(--muted);font-family:'DM Mono',monospace;font-size:0.72rem">${escHtml(qty)}</td>
            <td class="li-num">${each !== null ? fmtMoney(each) : '—'}</td>
            <td class="li-num" style="font-weight:500">${total !== null ? fmtMoney(total) : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
       </table>`
    : `<p style="padding:1rem 1.25rem;font-size:0.75rem;color:var(--muted2);font-family:'DM Mono',monospace">No line item data available.</p>`;

  td.innerHTML = `
    <div class="detail-inner">
      ${summaryHTML}
      <div class="detail-body">
        ${infoHTML}
        <div class="detail-col-items">${itemsHTML}</div>
      </div>
    </div>`;
}

// ─── TABS ──────────────────────────────────────────────────────────────────
export function switchTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  $(`tab-${name}`).classList.add('active');
  btn.classList.add('active');
  if (name === 'finances' && state.detailsLoaded) renderFinances();
  if (name === 'orders') requestAnimationFrame(() => renderOrderCharts());
}

// ─── PAGINATION ────────────────────────────────────────────────────────────
function renderPagination() {
  const totalPages = Math.ceil(state.allOrders.length / PAGE_SIZE);
  const cur = state.currentPage;
  const pg  = $('pagination');
  if (totalPages <= 1) { pg.innerHTML = ''; return; }

  let html = `<button class="page-btn" data-action="page" data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''}>← Prev</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - cur) <= 1)
      html += `<button class="page-btn ${i === cur ? 'active' : ''}" data-action="page" data-page="${i}">${i}</button>`;
    else if (Math.abs(i - cur) === 2)
      html += `<span style="color:var(--muted2);font-family:'DM Mono',monospace;font-size:0.7rem">…</span>`;
  }
  html += `<button class="page-btn" data-action="page" data-page="${cur + 1}" ${cur === totalPages ? 'disabled' : ''}>Next →</button>`;
  html += `<span class="page-info">Page ${cur} of ${totalPages}</span>`;
  pg.innerHTML = html;
}

export function goPage(n) {
  const totalPages = Math.ceil(state.allOrders.length / PAGE_SIZE);
  if (n < 1 || n > totalPages) return;
  state.expandedRow = null;
  state.currentPage = n;
  renderTable();
  document.querySelector('.panel').scrollIntoView({ behavior:'smooth', block:'start' });
}
