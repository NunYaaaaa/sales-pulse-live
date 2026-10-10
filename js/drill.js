// ─── DRILL-DOWNS: the breakdown popup behind a summary card ────────────────
// A card with data-action="drill" data-drill="<key>" opens #drill with
// DRILLS[key], built from state for the selected period. Each breakdown's
// total is the card's own figure. API text is escaped here.
import { computeLedgerTotals } from './finance.js';
import { aovBreakdown, feeBreakdown, grossBreakdown, orderStatusCounts, unshippedOrders } from './insights.js';
import { ordersWithItems, state } from './state.js';
import { escHtml, fmtMoney, money, orderSales } from './util.js';

const $ = id => document.getElementById(id);

const LEDGER_WAIT = 'Financial details are still loading.';

const fmtC = c => fmtMoney(c / 100);
const signed = c => `${c < 0 ? '−' : '+'}${fmtC(Math.abs(c))}`;
const fmtNum = n => n.toLocaleString('en-US');
const plural = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;
const pct  = x => x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(1)}%`;
const fmtDate = (ts, year = true) => new Date(ts * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric', ...(year && { year:'numeric' }) });
const empty = msg => `<div class="ins-empty">${msg}</div>`;
const note  = msg => `<p class="drill-note">${msg}</p>`;
const tiles = (...t) => `<div class="ins-tiles drill-tiles">${t.map(([label, val]) => `<div class="ins-tile"><div class="ins-tile-label">${label}</div><div class="ins-tile-val">${val}</div></div>`).join('')}</div>`;
const ledgerReady = () => state.detailsLoaded && !!state.ledgerEntries;

/** The selected period, as dates ("Sep 10 – Oct 9, 2026"). */
function periodText() {
  const now = Math.floor(Date.now() / 1000);
  const from = state.filterFrom, to = Math.min(state.filterTo ?? now, now);
  if (from == null) return `All time, to ${fmtDate(to)}`;
  const sameYear = new Date(from * 1000).getFullYear() === new Date(to * 1000).getFullYear();
  return `${fmtDate(from, !sameYear)} – ${fmtDate(to)}`;
}

/**
 * A breakdown table: a row per part, with a bar and (unless share is false)
 * its share of the total, then the total row. Rows are { name, sub, value,
 * amount, color, share }: name and sub are escaped here; amount and a row's
 * own share text (in place of value ÷ total) must already be safe.
 */
function breakdown(rows, { head, total, totalLabel, totalAmount, share = true }) {
  const max = Math.max(0, ...rows.map(r => Math.abs(r.value))) || 1;
  const body = rows.map(r => `<tr>
      <th scope="row">
        <span class="drill-name">${r.color ? `<i style="background:${r.color}"></i>` : ''}${escHtml(r.name)}</span>
        ${r.sub ? `<span class="drill-sub">${escHtml(r.sub)}</span>` : ''}
        <span class="drill-bar" aria-hidden="true"><span style="width:${(Math.abs(r.value) / max * 100).toFixed(1)}%;background:${r.color || 'var(--orange)'}"></span></span>
      </th>
      ${share ? `<td class="drill-pct">${r.share ?? (total > 0 ? pct(r.value / total) : '')}</td>` : ''}
      <td class="drill-amt">${r.amount}</td>
    </tr>`).join('');
  return `<table class="drill-table">
    <thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><th scope="row">${totalLabel}</th>${share ? '<td></td>' : ''}<td class="drill-amt">${totalAmount}</td></tr></tfoot>
  </table>`;
}

// Order statuses as a seller reads them, coloured like their badges in Order History
const STATUS_NAMES = {
  'paid':               { name: 'Paid',                  color: 'var(--green)', sub: 'not marked complete yet' },
  'payment processing': { name: 'Payment processing',    color: 'var(--gold)' },
  'open':               { name: 'Open, not paid yet',    color: 'var(--gold)' },
  'completed':          { name: 'Completed',             color: 'var(--purple)', sub: 'marked shipped' },
  'shipped':            { name: 'Shipped',               color: 'var(--purple)' },
  'partially refunded': { name: 'Partially refunded',    color: '#d4622a' },
  'fully refunded':     { name: 'Fully refunded',        color: '#b91c1c' },
  'canceled':           { name: 'Canceled',              color: '#a89e90' },
};
const statusName = s => STATUS_NAMES[s] || { name: s.charAt(0).toUpperCase() + s.slice(1), color: '#6b7280' };

/**
 * A list of orders: the buyer with the receipt number and a detail line, a
 * middle column and a right-hand value, then the total row. Rows are
 * { order, sub, mid, end }: API text is escaped here; sub, mid and end must
 * already be safe.
 */
function orderList(rows, { head, totalLabel, totalAmount }) {
  const body = rows.map(r => `<tr>
      <th scope="row">
        <span class="drill-name">${escHtml(r.order.name || (r.order.buyer_user_id ? `Buyer #${r.order.buyer_user_id}` : 'Buyer'))}</span>
        <span class="drill-sub">#${escHtml(r.order.receipt_id)}${r.sub ? ` · ${r.sub}` : ''}</span>
      </th>
      <td class="drill-pct">${r.mid}</td>
      <td class="drill-amt">${r.end}</td>
    </tr>`).join('');
  return `<table class="drill-table drill-list">
    <thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr><th scope="row">${totalLabel}</th><td></td><td class="drill-amt">${totalAmount}</td></tr></tfoot>
  </table>`;
}

const badge = (cls, text) => `<span class="ledger-type-badge ${cls}">${text}</span>`;
const waited = days => days < 1 ? 'today' : plural(Math.floor(days), 'day');

/** Physical orders not marked shipped yet (only the past-due ones when overdueOnly), oldest first. */
function shipList(overdueOnly) {
  const list = unshippedOrders(ordersWithItems(), Math.floor(Date.now() / 1000)).filter(u => !overdueOnly || u.overdue);
  const figure = fmtNum(list.length);
  if (!list.length) return { figure, html: empty(overdueOnly ? "No order is past Etsy's expected ship date." : 'Every physical order in this period has been marked shipped.') };
  const rows = list.map(u => {
    const items = u.order.transactions.reduce((s, t) => s + (t.quantity || 1), 0);
    return {
      order: u.order,
      sub: [items ? plural(items, 'item') : '', u.order.grandtotal ? fmtMoney(money(u.order.grandtotal)) : '', u.expected ? `ship by ${fmtDate(u.expected, false)}` : '']
        .filter(Boolean).join(' · '),
      mid: fmtDate(u.paid, false),
      end: `${waited(u.ageDays)}${u.overdue ? badge('lt-fee', 'past due') : ''}`,
    };
  });
  return {
    figure, cls: overdueOnly ? 'red' : '',
    html: orderList(rows, { head: ['Order', 'Paid', 'Waiting'], totalLabel: overdueOnly ? 'Past due' : 'Not shipped', totalAmount: plural(list.length, 'order') }) +
      note("Physical orders from this period that aren't marked shipped, oldest first. \"Ship by\" is Etsy's expected ship date. Digital, canceled and fully refunded orders don't need shipping."),
  };
}

/**
 * Each drill-down: its title, and build() returning { figure, cls, html } for
 * the current data, or { wait } while that data is still loading.
 */
const DRILLS = {
  unshipped: { title: 'Not Shipped Yet', build: () => shipList(false) },
  overdue:   { title: 'Past Due',        build: () => shipList(true) },
  aov: {
    title: 'Avg. Order Value',
    build() {
      const orders = state.allOrders;
      // The card's own sum, so the figure matches it to the cent
      const figure = fmtMoney(orders.length ? orders.reduce((s, o) => s + orderSales(o), 0) / orders.length : 0);
      const a = aovBreakdown(orders);
      if (!a) return { figure, html: empty('No orders in this period.') };
      const rows = [
        { name: 'Items', value: a.parts.items, color: 'var(--orange)',
          sub: a.discountCents ? `after ${fmtC(a.discountCents)} of discounts per order` : 'what the items sold for' },
        { name: 'Shipping', value: a.parts.shipping, color: '#2563eb', sub: 'charged to buyers' },
        { name: 'Gift wrap', value: a.parts.giftWrap, color: '#db2777' },
        { name: 'Other', value: a.parts.other, color: '#6b7280', sub: "orders whose price isn't broken down" },
      ].filter((r, i) => i < 2 || r.value);
      return {
        figure,
        html: tiles(['Median order', fmtC(a.medianCents)], ['Smallest', fmtC(a.minCents)], ['Largest', fmtC(a.maxCents)]) +
          breakdown(rows.map(r => ({ ...r, amount: fmtC(r.value) })),
            { head: ['Per order', 'Share', 'Amount'], total: a.avgCents, totalLabel: 'Avg. Order Value', totalAmount: figure }) +
          note(`Averaged over ${plural(a.orders, 'order')}, canceled and refunded ones included, before refunds and without sales tax. The Orders tab's Order Values chart shows how they spread.`),
      };
    },
  },
  orders: {
    title: 'Total Orders',
    build() {
      const orders = state.allOrders, figure = fmtNum(orders.length);
      if (!orders.length) return { figure, html: empty('No orders in this period.') };
      const rows = orderStatusCounts(orders).map(r => {
        const s = statusName(r.status);
        return { name: s.name, color: s.color, value: r.count, amount: fmtNum(r.count),
          sub: `${s.sub ? `${s.sub} · ` : ''}${fmtMoney(r.sales)} in sales` };
      });
      return {
        figure,
        html: breakdown(rows, { head: ['Status', 'Share', 'Orders'], total: orders.length, totalLabel: 'Total Orders', totalAmount: figure }) +
          note('Sales are before refunds and without sales tax, as in Avg. Order Value. Open the Orders tab for each order.'),
      };
    },
  },
  gross: {
    title: 'Total Gross',
    build() {
      if (!ledgerReady()) return { wait: LEDGER_WAIT };
      const g = grossBreakdown(state.ledgerEntries);
      const figure = fmtC(g.grossCents);
      if (!g.sales && !g.refunds) return { figure, html: empty('No sales or refunds in the ledger for this period.') };
      const rows = [
        { name: 'Payments for sales', sub: `${plural(g.sales, 'sale')}, including the sales tax buyers paid`, value: g.paidCents, color: 'var(--green)' },
        { name: 'Sales tax passed on', sub: 'Etsy pays it to the tax authorities', value: g.taxCents, color: '#a89e90' },
        { name: 'Retail delivery fees passed on', sub: "state fees the buyer paid, such as Colorado's", value: g.deliveryCents, color: '#6b7280' },
        { name: 'Refunds to buyers', sub: plural(g.refunds, 'refund'), value: g.refundCents, color: 'var(--gold)' },
        { name: 'Sales tax returned on refunds', sub: 'the refunds included tax Etsy had already passed on', value: g.taxBackCents, color: '#a89e90' },
      ].filter((r, i) => i === 0 || r.value);
      return {
        figure,
        html: breakdown(rows.map(r => ({ ...r, amount: signed(r.value) })),
          { head: ['Part', 'Amount'], share: false, totalLabel: 'Total Gross', totalAmount: figure }) +
          note('Gross is what you sold after refunds, without the sales tax Etsy collects and pays on your behalf. Fees come off it next, to give Net Earnings.'),
      };
    },
  },
  net: {
    title: 'Net Earnings',
    build() {
      if (!ledgerReady()) return { wait: LEDGER_WAIT };
      const entries = state.ledgerEntries;
      const { netCents } = computeLedgerTotals(entries);
      const gross = grossBreakdown(entries).grossCents;
      const fees  = feeBreakdown(entries).rows.filter(r => r.cents);
      const figure = fmtC(netCents);
      if (!gross && !fees.length) return { figure, cls: 'green', html: empty('No sales or fees in the ledger for this period.') };
      const ofGross = c => gross > 0 ? pct(c / gross) : '—';
      const rows = [
        { name: 'Total Gross', sub: 'sales after refunds, excl. tax', value: gross, amount: signed(gross), color: 'var(--ink2)', share: '' }, // not green: Transaction Fees are
        ...fees.map(f => ({ name: f.label, value: -f.cents, amount: signed(-f.cents), color: f.color, share: ofGross(f.cents) })),
      ];
      return {
        figure, cls: 'green',
        html: breakdown(rows, { head: ['Part', 'Of gross', 'Amount'], totalLabel: 'Net Earnings', totalAmount: figure }) +
          note(`${gross > 0 ? `You kept ${pct(netCents / gross)} of gross after Etsy's fees. ` : ''}Payouts to your bank aren't counted: they move money you've already earned.`),
      };
    },
  },
  fees: {
    title: 'Total Fees',
    build() {
      if (!ledgerReady()) return { wait: LEDGER_WAIT };
      const f = feeBreakdown(state.ledgerEntries);
      const rows = f.rows.filter(r => r.chargedCents || r.creditedCents);
      const figure = fmtC(f.totalCents);
      if (!rows.length) return { figure, cls: 'red', html: empty('No fees in this period.') };
      return {
        figure, cls: 'red',
        html: breakdown(rows.map(r => ({
          name: r.label, color: r.color, value: r.cents,
          amount: (r.cents < 0 ? '−' : '') + fmtC(Math.abs(r.cents)),
          sub: r.creditedCents ? `${fmtC(r.chargedCents)} charged · ${fmtC(r.creditedCents)} credited back` : '',
        })), { head: ['Fee', 'Share', 'Amount'], total: f.totalCents, totalLabel: 'Total Fees', totalAmount: figure }) +
          note(f.creditedCents
            ? `Etsy charged ${fmtC(f.chargedCents)} and gave ${fmtC(f.creditedCents)} back, mostly fees on refunded orders and adjusted labels. Each credit comes off the fee it reverses.`
            : 'Every fee Etsy charged in the ledger for this period.'),
      };
    },
  },
};

let openKey = null, opener = null;

function fill() {
  const d = DRILLS[openKey], r = d.build();
  $('drill-title').textContent = d.title;
  $('drill-period').textContent = periodText();
  const fig = $('drill-figure');
  fig.textContent = r.wait ? '—' : r.figure;
  fig.className = `drill-figure ${r.wait ? '' : r.cls || ''}`;
  $('drill-body').innerHTML = r.wait ? empty(r.wait) : r.html;
}

let wired = false;
/** Listen for closing, once. Not at import: pages without the popup (the tests) import this module too. */
function wire(dialog) {
  if (wired) return;
  wired = true;
  // Esc closes a modal dialog by itself. The content (.drill-box) fills the dialog,
  // so a click that lands on the dialog element itself is on the backdrop.
  dialog.addEventListener('click', ev => { if (ev.target === dialog) closeDrill(); });
  dialog.addEventListener('close', () => {
    // Back where the viewer was; a tile redrawn while the popup was open is a new element with the same key
    const back = opener?.isConnected ? opener : document.querySelector(`.tab-panel.active [data-drill="${openKey}"]`);
    if (back?.offsetParent) back.focus();
    openKey = null;
    opener = null;
  });
}

/** Open the breakdown behind a card (data-drill names it). */
export function openDrill(card) {
  const dialog = $('drill');
  if (!DRILLS[card.dataset.drill]) return;
  wire(dialog);
  openKey = card.dataset.drill;
  opener = card;
  fill();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.drill-box').scrollTop = 0;
}

export function closeDrill() {
  if ($('drill')?.open) $('drill').close();
}

/** Redraw the open breakdown after new data arrives (the loader's redraws call this). */
export function refreshDrill() {
  if ($('drill')?.open && openKey) fill();
}
