// ─── DRILL-DOWNS: the breakdown popup behind a summary card ────────────────
// A card with data-action="drill" data-drill="<key>" opens #drill with
// DRILLS[key], built from state for the selected period. Each breakdown's
// total is the card's own figure. API text is escaped here.
import { computeLedgerTotals } from './finance.js';
import { feeBreakdown, grossBreakdown, orderStatusCounts } from './insights.js';
import { state } from './state.js';
import { escHtml, fmtMoney } from './util.js';

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
 * Each drill-down: its title, and build() returning { figure, cls, html } for
 * the current data, or { wait } while that data is still loading.
 */
const DRILLS = {
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
    openKey = null;
    if (opener?.isConnected && opener.offsetParent) opener.focus(); // back where the viewer was
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
