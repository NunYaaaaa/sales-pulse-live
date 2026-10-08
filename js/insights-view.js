// ─── INSIGHTS TAB (rendering) ──────────────────────────────────────────────
// Draws the Insights panels from state. The numbers come from the pure
// functions in insights.js; this module only formats and escapes them.
import { FEE_GROUPS, FEE_OTHER_COLOR, LABEL_FEES, LABEL_REFUNDS, PALETTE } from './config.js';
import { animateBars, DAY_NAMES, drawBarChart, drawHeatmap, drawLineChart, hourLabel, setToggleActive } from './charts.js';
import {
  adSpend, backlog, basketStats, customerStats, discountStats, feeRateSeries, fulfilment, geography,
  heatmapMatrix, payoutStats, refundStats, revenueComposition, shippingPnL, variationStats,
} from './insights.js';
import { lineItems, state } from './state.js';
import { escHtml, fmtMoney, getCurrency, pickBucket } from './util.js';

const $ = id => document.getElementById(id);

const POSTAGE = new Set([...LABEL_FEES, ...LABEL_REFUNDS]);
const MODES   = new Set(['insFeeMode', 'insGeoMode']);
const NO_ORDERS     = 'No orders to show yet.';
const LEDGER_WAIT   = 'Financial details are still loading.';

const pct     = (x, digits = 1) => x == null || !isFinite(x) ? '—' : `${(x * 100).toFixed(digits)}%`;
const fmtC    = c => fmtMoney(c / 100);
const fmtNum  = n => n == null ? '—' : Number(n).toLocaleString('en-US');
const fmtDate = ts => new Date(ts * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
const plural  = (n, word) => `${fmtNum(n)} ${word}${n === 1 ? '' : 's'}`;
const feeColor = type => FEE_GROUPS.find(g => g.key === type)?.color;

// Small HTML builders. Labels and subs are our own text; values must already be safe.
const tile = (label, val, sub = '', cls = '') =>
  `<div class="ins-tile"><div class="ins-tile-label">${label}</div><div class="ins-tile-val ${cls}">${val}</div>${sub ? `<div class="ins-tile-sub">${sub}</div>` : ''}</div>`;
const tiles  = (...t) => `<div class="ins-tiles">${t.join('')}</div>`;
const kpi    = (label, val, sub = '', cls = '') =>
  `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-val ${cls}">${val}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
const empty  = msg => `<div class="ins-empty">${msg}</div>`;
const caveat = msg => `<div class="ins-caveat">${msg}</div>`;

/**
 * Horizontal bar rows (top-prod-row styling). name(r) is escaped here;
 * value(r) sizes the bar; fmt(r) and sub(r) must return safe HTML.
 */
function barRows(rows, { name, value, fmt, sub = () => '' }) {
  const max = Math.max(0, ...rows.map(r => Math.abs(value(r)))) || 1;
  return rows.map((r, i) => {
    const n = escHtml(name(r));
    return `<div class="top-prod-row">
      <div><div class="top-prod-name" title="${n}">${n}</div><div class="top-prod-sub">${sub(r)}</div></div>
      <div class="top-prod-bar-track"><div class="top-prod-bar-fill" style="width:0%;background:${r.color || PALETTE[i % PALETTE.length]}" data-target="${(Math.abs(value(r)) / max * 100).toFixed(1)}"></div></div>
      <div><div class="top-prod-val">${fmt(r)}</div></div>
    </div>`;
  }).join('');
}

function setHtml(el, html) {
  el.innerHTML = html;
  animateBars(el, '.top-prod-bar-fill');
}

/** Orders with their line items attached, whether embedded or fetched separately. */
const ordersWithItems = () => state.allOrders.map(o => o.transactions ? o : { ...o, transactions: lineItems(o) || [] });

// ─── ENTRY POINTS ───────────────────────────────────────────────────────────

/** Redraw every Insights panel. No-op unless the tab is showing (charts size from clientWidth). */
export function renderInsights() {
  if (state.activeTab !== 'insights') return;
  requestAnimationFrame(() => {
    const orders = ordersWithItems();
    renderSnapshot();
    renderProfitability(orders);
    renderCustomers(orders);
    renderProducts(orders);
    renderOperations(orders, Math.floor(Date.now() / 1000));
  });
}

/** Handle an Insights toggle (data-key names a state field). */
export function setInsightMode(key, mode, btn) {
  if (!MODES.has(key)) return;
  state[key] = mode;
  setToggleActive(btn);
  renderInsights();
}

// ─── SHOP SNAPSHOT ──────────────────────────────────────────────────────────
function renderSnapshot() {
  const s = state.shop;
  $('ins-snapshot-section').style.display = s ? '' : 'none';
  if (!s) return;
  const avg = s.review_average != null ? `${Number(s.review_average).toFixed(2)} ★` : '—';
  $('ins-snapshot').innerHTML = [
    kpi('Shop Favorites', fmtNum(s.num_favorers), 'people who favorited your shop'),
    kpi('Active Listings', fmtNum(s.listing_active_count), s.digital_listing_count ? `${fmtNum(s.digital_listing_count)} digital` : 'live on Etsy now'),
    kpi('Lifetime Sales', fmtNum(s.transaction_sold_count), 'since the shop opened'),
    kpi('Review Average', avg, `${plural(s.review_count ?? 0, 'review')} · past 12 months`),
  ].join('');
  const note = $('ins-snapshot-note');
  note.textContent = (s.is_vacation ? 'Shop is in vacation mode · ' : '') + "Etsy's own counts, not limited to the selected period";
  note.classList.toggle('warn', !!s.is_vacation);
}

// ─── PROFITABILITY ──────────────────────────────────────────────────────────
function renderProfitability(orders) {
  renderComposition(orders);

  const entries = state.ledgerEntries;
  if (!state.detailsLoaded || !entries) {
    $('ins-ledger-note').textContent = '';
    $('ins-fee-sub').textContent = LEDGER_WAIT;
    $('ins-fee-svg').innerHTML = '';
    for (const id of ['ins-ads', 'ins-shipping', 'ins-payouts']) $(id).innerHTML = empty(LEDGER_WAIT);
    return;
  }
  renderLedgerNote();
  renderFeeChart(entries);
  renderAds(entries);
  renderShipping(orders, entries);
  renderPayouts(entries);
}

/** Say which dates the ledger covers, and warn when it's shorter than the period. */
function renderLedgerNote() {
  const span = state.ledgerSpan, el = $('ins-ledger-note');
  if (!span) { el.textContent = ''; return; }
  const ts = state.allOrders.map(o => o.create_timestamp).filter(Boolean);
  const periodStart = state.filterFrom ?? (ts.length ? Math.min(...ts) : span.from);
  const clipped = periodStart < span.from - 86400;
  el.textContent = `ledger ${fmtDate(span.from)} – ${fmtDate(span.to)}` + (clipped ? ' · fee figures cover the last 365 days only' : '');
  el.classList.toggle('warn', clipped);
}

function renderFeeChart(entries) {
  const svg = $('ins-fee-svg'), tip = $('ins-fee-tooltip'), sub = $('ins-fee-sub');
  const span = state.ledgerSpan;
  let bucket = span ? pickBucket(span.from, span.to) : 'week';
  if (bucket === 'day') bucket = 'week'; // daily fee rates are too noisy (ads and renewals post daily)

  const exclude = state.insFeeMode === 'excl-postage' ? POSTAGE : null;
  const all     = feeRateSeries(entries, { bucket, exclude });
  const gross   = all.reduce((s, r) => s + r.grossCents, 0);
  const fees    = all.reduce((s, r) => s + r.feesCents, 0);
  const data    = all.filter(r => r.feeRate !== null).map(r => ({ ...r, feePct: r.feeRate * 100 }));

  if (!data.length) { svg.innerHTML = ''; sub.textContent = 'No sales in the ledger for this period'; return; }
  sub.textContent = `${pct(gross > 0 ? fees / gross : null)} of sales (excl. tax) went to fees · by ${bucket}`;

  const tipHtml = d => `<strong>${escHtml(d.label)}</strong><br>Fees ${pct(d.feeRate)} · Margin ${pct(d.margin)}<br>Gross ${fmtC(d.grossCents)} · Fees ${fmtC(d.feesCents)}<br>Net ${fmtC(d.netCents)}`;
  const fmt = v => `${v.toFixed(1)}%`;
  if (data.length > 14) drawLineChart(svg, tip, data, 'feePct', fmt, '#b91c1c', tipHtml);
  else                  drawBarChart(svg,  tip, data, 'feePct', fmt, '#b91c1c', tipHtml);
}

function renderAds(entries) {
  const a  = adSpend(entries);
  const el = $('ins-ads');
  const note = caveat("Spend only. Etsy's API doesn't report ad views, clicks or the sales ads brought in.");
  if (!a.totalCents && !a.offsiteSales) { el.innerHTML = empty('No Etsy Ads or Offsite Ads fees in this period.') + note; return; }
  const rows = a.rows.map(r => ({ ...r, color: feeColor(r.type) }));
  setHtml(el,
    tiles(
      tile('Ad spend', fmtC(a.totalCents), '', 'red'),
      tile('Share of sales', pct(a.share), 'ad fees ÷ ledger gross'),
      tile('Offsite Ads sales', fmtNum(a.offsiteSales), 'sales charged the fee'),
    ) +
    `<div class="top-prod-rows">${barRows(rows, {
      name: r => r.label, value: r => r.cents, fmt: r => fmtC(r.cents),
      sub: r => a.totalCents ? `${pct(r.cents / a.totalCents)} of ad spend` : '',
    })}</div>` + note);
}

function renderShipping(orders, entries) {
  const s  = shippingPnL(orders, entries, state.ledgerSpan);
  const el = $('ins-shipping');
  if (!s.labelCount) {
    el.innerHTML = tiles(tile('Charged to buyers', fmtC(s.chargedCents))) +
      empty("No Etsy shipping labels were bought in this period, so there's nothing to compare. Labels bought elsewhere don't appear in Etsy's ledger.");
    return;
  }
  const profit = s.diffCents >= 0;
  setHtml(el,
    tiles(
      tile('Charged to buyers', fmtC(s.chargedCents)),
      tile('Labels bought', fmtC(s.labelsCents), plural(s.labelCount, 'label')),
      tile(profit ? 'Shipping profit' : 'Shipping loss', fmtC(Math.abs(s.diffCents)), '', profit ? 'green' : 'red'),
    ) +
    `<div class="top-prod-rows">${barRows([
      { label: 'Charged to buyers', cents: s.chargedCents, color: '#3a7d4c' },
      { label: 'Etsy labels bought', cents: s.labelsCents, color: '#d4622a' },
    ], { name: r => r.label, value: r => r.cents, fmt: r => fmtC(r.cents) })}</div>` +
    caveat('Counts only labels bought through Etsy. Labels are charged when bought, so orders near the edges of the period may not line up.'));
}

function renderComposition(orders) {
  const el = $('ins-composition');
  if (!orders.length) { el.innerHTML = empty(NO_ORDERS); return; }
  const c = revenueComposition(orders);
  const rows = [
    { label: 'Items',     amt: c.items,      color: '#d4622a' },
    { label: 'Discounts', amt: -c.discounts, color: '#b91c1c' },
    { label: 'Shipping',  amt: c.shipping,   color: '#2563eb' },
    { label: 'Sales tax', amt: c.tax,        color: '#a89e90' },
    { label: 'Gift wrap', amt: c.giftWrap,   color: '#db2777' },
    { label: 'Other',     amt: c.other,      color: '#6b7280' },
  ].filter((r, i) => i === 0 || Math.abs(r.amt) >= 0.005);
  setHtml(el,
    `<div class="top-prod-rows">${barRows(rows, {
      name: r => r.label, value: r => r.amt,
      fmt: r => (r.amt < 0 ? '−' : '') + fmtMoney(Math.abs(r.amt)),
      sub: r => c.grand ? `${pct(r.amt / c.grand)} of gross` : '',
    })}</div>` +
    caveat(`These add up to Total Gross (${fmtMoney(c.grand)}). Sales tax is collected for the tax authority. "Other" is anything the parts don't explain, such as VAT.`));
}

function renderPayouts(entries) {
  const p  = payoutStats(entries);
  const el = $('ins-payouts');
  const balance = p.balanceCents != null ? tile('Balance', fmtC(p.balanceCents), 'after the latest entry') : '';
  if (!p.count) { el.innerHTML = (balance ? tiles(balance) : '') + empty('No payouts in this period.'); return; }
  el.innerHTML = tiles(
    tile('Paid out', fmtC(p.totalCents), plural(p.count, 'payout')),
    tile('Average payout', fmtC(p.avgCents)),
    tile('Last payout', fmtDate(p.lastPayoutTs)),
    balance,
  );
}

// ─── CUSTOMERS ──────────────────────────────────────────────────────────────
function renderCustomers(orders) {
  const kpis = $('ins-customers'), top = $('ins-top-customers');
  renderGeo(orders);
  if (!orders.length) { kpis.innerHTML = ''; top.innerHTML = empty(NO_ORDERS); return; }

  const c = customerStats(orders);
  kpis.innerHTML = [
    kpi('Unique Buyers', fmtNum(c.buyers), c.noId ? `${plural(c.noId, 'order')} without a buyer ID` : 'distinct Etsy accounts'),
    kpi('Repeat Buyers', fmtNum(c.repeatBuyers), `${pct(c.repeatRate)} ordered 2+ times this period`),
    kpi('Repeat Buyer Revenue', pct(c.repeatRevenueShare), 'share of gross from repeat buyers'),
    kpi('Orders per Buyer', c.ordersPerBuyer == null ? '—' : c.ordersPerBuyer.toFixed(2), 'average this period'),
  ].join('');

  setHtml(top, c.top.length
    ? barRows(c.top, {
        name: b => b.name || `Buyer #${b.id}`, value: b => b.revenue, fmt: b => fmtMoney(b.revenue),
        sub: b => plural(b.orders, 'order'),
      })
    : empty('None of these orders has a buyer ID.'));
}

let regionNames;
function countryName(code) {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) || code;
  } catch { return code; } // not a valid region code
}

function renderGeo(orders) {
  const el = $('ins-geo'), sub = $('ins-geo-sub');
  const byState = state.insGeoMode === 'us-state';
  const g    = geography(orders, byState ? 'us-state' : 'country');
  const rows = g.rows.slice(0, 8);
  const n = g.rows.length;
  const places = byState ? (n === 1 ? 'state' : 'states') : (n === 1 ? 'country' : 'countries');
  sub.textContent = g.known ? `${fmtNum(n)} ${places} · by revenue` : '—';
  const note = g.unknown
    ? caveat(`${plural(g.unknown, byState ? 'US order' : 'order')} without a shared address ${g.unknown === 1 ? 'is' : 'are'} left out; shares are of known addresses.`)
    : '';
  if (!rows.length) {
    el.innerHTML = empty(byState ? 'No US orders with a state in this period.' : 'No orders with a shipping country in this period.') + note;
    return;
  }
  setHtml(el, barRows(rows, {
    name: r => byState ? r.key : countryName(r.key),
    value: r => r.revenue, fmt: r => fmtMoney(r.revenue),
    sub: r => `${plural(r.orders, 'order')} · ${pct(r.orders / g.known)}`,
  }) + note);
}

// ─── PRODUCTS & ORDERS ──────────────────────────────────────────────────────

/** Money without forced cents, for chart bins ("$25", "$2.5"). */
function fmtShort(n) {
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency: getCurrency(), minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n); }
  catch { return fmtMoney(n); }
}

function renderProducts(orders) {
  renderVariations(orders);
  renderBasket(orders);
  renderDiscounts(orders);
}

function renderVariations(orders) {
  const el = $('ins-variations'), sub = $('ins-var-sub');
  const products = variationStats(orders);
  if (!products.length) {
    sub.textContent = '—';
    el.innerHTML = empty(orders.length ? 'None of these orders has variations such as size or color.' : NO_ORDERS);
    return;
  }
  sub.textContent = `top ${products.length} product${products.length === 1 ? '' : 's'} with variations · by units sold`;
  el.innerHTML = products.map(p => {
    const segs = p.combos.map((c, i) => ({ ...c, color: c.other ? FEE_OTHER_COLOR : PALETTE[i % PALETTE.length], pct: c.units / p.units * 100 }));
    const title = escHtml(p.title);
    return `<div class="ins-var">
      <div class="ins-var-head">
        <span class="top-prod-name" title="${title}">${title}</span>
        <span class="top-prod-sub">${plural(p.units, 'unit')}${p.dims ? ` · ${escHtml(p.dims)}` : ''}</span>
      </div>
      <div class="ins-seg">${segs.map(c => `<span style="width:${c.pct.toFixed(2)}%;background:${c.color}" title="${escHtml(c.label)}: ${c.units}"></span>`).join('')}</div>
      <div class="ins-legend">${segs.map(c => `<span><i style="background:${c.color}"></i>${escHtml(c.label)}<b>${c.units}</b></span>`).join('')}</div>
    </div>`;
  }).join('') + caveat('Units by variation combination. Personalization text is left out.');
}

function renderBasket(orders) {
  const uSvg = $('ins-units-svg'), vSvg = $('ins-values-svg');
  if (!orders.length) {
    uSvg.innerHTML = vSvg.innerHTML = '';
    $('ins-units-sub').textContent = $('ins-values-sub').textContent = NO_ORDERS;
    return;
  }
  const b = basketStats(orders);
  const orderCount = d => plural(d.count, 'order');

  $('ins-units-sub').textContent = b.avgUnits == null ? 'line items not loaded yet'
    : `avg. ${b.avgUnits.toFixed(2)} units · ${pct(b.multiShare)} of orders have 2+`;
  drawBarChart(uSvg, $('ins-units-tooltip'), b.unitBins, 'count', v => plural(v, 'order'), '#5a3d9e',
    d => `<strong>${d.label} unit${d.label === '1' ? '' : 's'}</strong><br>${orderCount(d)}`);

  const range = d => d.max == null ? `${fmtShort(d.min)} or more` : `${fmtShort(d.min)} – ${fmtShort(d.max)}`;
  const data  = b.valueBins.map(d => ({ ...d, label: d.max == null ? `${fmtShort(d.min)}+` : fmtShort(d.min) }));
  $('ins-values-sub').textContent = `order totals incl. shipping + tax · ${fmtShort(b.step)} bands`;
  drawBarChart(vSvg, $('ins-values-tooltip'), data, 'count', v => plural(v, 'order'), '#2563eb',
    d => `<strong>${range(d)}</strong><br>${orderCount(d)}`);
}

function renderDiscounts(orders) {
  const el = $('ins-discounts');
  if (!orders.length) { el.innerHTML = ''; return; }
  const d = discountStats(orders);
  const avg = v => v == null ? '—' : fmtMoney(v);
  el.innerHTML = [
    kpi('Discounted Orders', fmtNum(d.discounted), `${pct(d.share)} of orders`),
    kpi('Discounts Given', fmtMoney(d.totalDiscount), 'percent and fixed-amount coupons', d.totalDiscount ? 'red' : ''),
    kpi('Avg. Order, Discounted', avg(d.aovWith), 'orders with a discount'),
    kpi('Avg. Order, Full Price', avg(d.aovWithout), 'orders without one'),
  ].join('');
}

// ─── OPERATIONS ─────────────────────────────────────────────────────────────

const dayCount = label => label === '0' ? 'Under a day' : label === '1' ? '1 day' : `${label} days`;

function renderOperations(orders, now) {
  renderShipTime(orders);
  renderBacklog(orders, now);
  renderRefunds(orders);
  renderHeatmap(orders);
}

function renderShipTime(orders) {
  const svg = $('ins-ship-svg'), body = $('ins-ship-tiles');
  const f = fulfilment(orders);
  if (!f.shipped) {
    svg.innerHTML = '';
    body.innerHTML = empty(orders.length ? 'No physical orders in this period have been marked shipped.' : NO_ORDERS);
    return;
  }
  body.innerHTML = tiles(
    tile('Median', `${f.medianDays.toFixed(1)} days`),
    tile('On time', pct(f.onTimeRate), f.withExpected ? "by Etsy's expected ship date" : 'no expected dates'),
    tile('Shipped', fmtNum(f.shipped), 'physical orders'),
  ) + caveat("Until the order was marked shipped. Etsy's API has no delivery dates.");
  drawBarChart(svg, $('ins-ship-tooltip'), f.bins, 'count', v => plural(v, 'order'), '#3a7d4c',
    d => `<strong>${dayCount(d.label)}</strong><br>${plural(d.count, 'order')}`);
}

function renderBacklog(orders, now) {
  const el = $('ins-backlog');
  if (!orders.length) { el.innerHTML = empty(NO_ORDERS); return; }
  const b = backlog(orders, now);
  if (!b.count) { el.innerHTML = empty('Every physical order in this period has been marked shipped.'); return; }
  setHtml(el,
    tiles(
      tile('Not shipped', fmtNum(b.count)),
      tile('Past due', fmtNum(b.overdue), "past Etsy's expected date", b.overdue ? 'red' : ''),
      tile('Oldest', `${Math.floor(b.oldestDays)} days`),
    ) +
    `<div class="top-prod-rows">${barRows(b.bins, {
      name: r => r.label, value: r => r.count, fmt: r => fmtNum(r.count), sub: () => 'since payment',
    })}</div>` +
    caveat('Only orders from the selected period are counted.'));
}

function renderRefunds(orders) {
  const el = $('ins-refunds');
  if (!orders.length) { el.innerHTML = ''; return; }
  const r = refundStats(orders);
  el.innerHTML = [
    kpi('Canceled', fmtNum(r.canceled), 'orders'),
    kpi('Fully Refunded', fmtNum(r.fullyRefunded), 'orders'),
    kpi('Partially Refunded', fmtNum(r.partiallyRefunded), 'orders'),
    kpi('Refunded', fmtMoney(r.refundedAmount), `${pct(r.rate)} of orders affected`, r.refundedAmount ? 'red' : ''),
  ].join('');
}

function renderHeatmap(orders) {
  const svg = $('ins-heat-svg'), sub = $('ins-heat-sub');
  if (!orders.length) { svg.innerHTML = ''; sub.textContent = NO_ORDERS; return; }
  const m = heatmapMatrix(orders);
  const p = m.peak;
  sub.textContent = `your local time · busiest: ${DAY_NAMES[p.day]} ${hourLabel(p.hour)}–${hourLabel((p.hour + 1) % 24)} (${plural(p.count, 'order')})`;
  drawHeatmap(svg, $('ins-heat-tooltip'), m.counts, m.revenue, '#d4622a', fmtMoney);
}
