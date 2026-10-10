// ─── INSIGHTS PANELS (rendering) ───────────────────────────────────────────
// Draws the analysis panels on every tab from state. The numbers come from
// the pure functions in insights.js; this module only formats and escapes them.
import { FEE_GROUPS, FEE_OTHER_COLOR, LABEL_FEES, LABEL_REFUNDS, PALETTE } from './config.js';
import { animateBars, DAY_NAMES, drawBarChart, drawHeatmap, drawLineChart, hourLabel, setToggleActive } from './charts.js';
import {
  adSpend, backlog, basketStats, customerStats, discountStats, feeRateSeries, fulfilment, geography,
  heatmapMatrix, listingStats, payoutStats, productKey, productNames, refundStats, revenueComposition, reviewStats,
  shippingPnL, variationStats,
} from './insights.js';
import { lineItems, state } from './state.js';
import { escHtml, fmtMoney, getCurrency, pickBucket } from './util.js';

const $ = id => document.getElementById(id);

const POSTAGE = new Set([...LABEL_FEES, ...LABEL_REFUNDS]);
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
// One per tab. js/tabs.js calls only the showing tab's (charts size from clientWidth).

const nowTs = () => Math.floor(Date.now() / 1000);

export function renderOverviewPanels() {
  renderAttention(ordersWithItems(), nowTs());
  renderSnapshot();
}

export function renderOrdersPanels() {
  const orders = ordersWithItems();
  renderOperations(orders, nowTs());
  renderBasket(orders);
  renderDiscounts(orders);
}

export function renderProductsPanels() {
  const orders = ordersWithItems();
  renderVariations(orders);
  renderListings(orders);
}

export function renderCustomersPanels() {
  const orders = ordersWithItems();
  renderCustomers(orders);
  renderReviews(orders);
}

export function renderFinancesPanels() {
  renderProfitability(ordersWithItems());
}

// Toggles (data-key names a state field) redraw just their own panel
const MODE_RENDER = {
  insFeeMode: () => { if (state.detailsLoaded && state.ledgerEntries) renderFeeChart(state.ledgerEntries); },
  insGeoMode: () => renderGeo(ordersWithItems()),
};

/** Handle an Insights toggle. */
export function setInsightMode(key, mode, btn) {
  if (!MODE_RENDER[key]) return;
  state[key] = mode;
  setToggleActive(btn);
  MODE_RENDER[key]();
}

// ─── NEEDS ATTENTION (Overview) ─────────────────────────────────────────────
function renderAttention(orders, now) {
  const el = $('ov-attention');
  if (!orders.length) { el.style.display = 'none'; return; }
  const b = backlog(orders, now);
  el.style.display = '';
  el.className = `attention ${b.overdue ? 'is-late' : b.count ? 'is-open' : 'is-clear'}`;
  el.innerHTML = b.count
    ? `<span class="attention-dot"></span>
       <span class="attention-text"><strong>${plural(b.count, 'order')}</strong> not shipped yet${b.overdue ? ` · <strong>${fmtNum(b.overdue)}</strong> past Etsy's expected ship date` : ''} · oldest paid ${plural(Math.floor(b.oldestDays), 'day')} ago</span>
       <button class="attention-link" data-action="tab" data-tab="orders" data-jump="sec-fulfilment">See fulfilment →</button>`
    : `<span class="attention-dot"></span>
       <span class="attention-text">Every physical order in this period has been marked shipped.</span>`;
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

/** Say which dates the ledger covers. */
function renderLedgerNote() {
  const span = state.ledgerSpan, el = $('ins-ledger-note');
  el.textContent = span ? `ledger ${fmtDate(span.from)} – ${fmtDate(span.to)}` : '';
}

function renderFeeChart(entries) {
  const svg = $('ins-fee-svg'), tip = $('ins-fee-tooltip'), sub = $('ins-fee-sub');
  const span = state.ledgerSpan;
  let bucket = span ? pickBucket(span.from, span.to) : 'week';
  if (bucket === 'day') bucket = 'week'; // daily fee rates are too noisy (ads and renewals post daily)

  const exclude = state.insFeeMode === 'excl-postage' ? POSTAGE : null;
  // Every bucket of the ledger span; one without sales has no rate and shows as a gap
  const all     = feeRateSeries(entries, { bucket, exclude, from: span?.from, to: span?.to });
  const gross   = all.reduce((s, r) => s + r.grossCents, 0);
  const fees    = all.reduce((s, r) => s + r.feesCents, 0);
  const data    = all.map(r => ({ ...r, feePct: r.feeRate === null ? null : r.feeRate * 100 }));

  if (!data.some(r => r.feePct !== null)) { svg.innerHTML = ''; sub.textContent = 'No sales in the ledger for this period'; return; }
  sub.textContent = `${pct(gross > 0 ? fees / gross : null)} of sales (excl. tax) went to fees · by ${bucket}`;

  // No rate when gross isn't positive: either nothing sold, or refunds outweighed the week's sales
  const tipHtml = d => d.feeRate !== null
    ? `<strong>${escHtml(d.label)}</strong><br>Fees ${pct(d.feeRate)} · Margin ${pct(d.margin)}<br>Gross ${fmtC(d.grossCents)} · Fees ${fmtC(d.feesCents)}<br>Net ${fmtC(d.netCents)}`
    : d.grossCents < 0
      ? `<strong>${escHtml(d.label)}</strong><br>Refunds exceeded sales<br>Gross ${fmtC(d.grossCents)} · Fees ${fmtC(d.feesCents)}<br>Net ${fmtC(d.netCents)}`
      : `<strong>${escHtml(d.label)}</strong><br>No sales${d.feesCents ? `<br>Fees ${fmtC(d.feesCents)}` : ''}`;
  const fmt = v => `${v.toFixed(1)}%`;
  if (data.length > 14) drawLineChart(svg, tip, data, 'feePct', fmt, '#b91c1c', tipHtml);
  else                  drawBarChart(svg,  tip, data, 'feePct', fmt, '#b91c1c', tipHtml, { values: v => `${Math.round(v)}%` });
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
      sub: r => c.grand ? `${pct(r.amt / c.grand)} of what buyers paid` : '',
    })}</div>` +
    caveat(`These add up to what buyers paid (${fmtMoney(c.grand)}). Total Gross leaves out sales tax, which is collected for the tax authority, and refunds. "Other" is anything the parts don't explain, such as a state retail delivery fee or VAT.`));
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
  ) + caveat('Payouts move money you already earned from your Etsy balance to your bank. They aren\'t extra income, so gross, fees and net leave them out.');
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

function renderVariations(orders) {
  const el = $('ins-variations'), sub = $('ins-var-sub');
  const products = variationStats(orders, { listings: state.listings });
  if (!products.length) {
    sub.textContent = '—';
    el.innerHTML = empty(orders.length ? 'None of these orders has variations such as size or color.' : NO_ORDERS);
    return;
  }
  sub.textContent = `top ${products.length} product${products.length === 1 ? '' : 's'} with variations · by units sold`;
  el.innerHTML = products.map(p => {
    const segs = p.combos.map((c, i) => ({ ...c, color: c.other ? FEE_OTHER_COLOR : PALETTE[i % PALETTE.length], pct: c.units / p.units * 100 }));
    const title = escHtml(p.title);
    const hover = escHtml(p.otherNames.length ? `${p.title}\nAlso sold as: ${p.otherNames.join('; ')}` : p.title);
    return `<div class="ins-var">
      <div class="ins-var-head">
        <span class="top-prod-name" title="${hover}">${title}</span>
        <span class="top-prod-sub">${plural(p.units, 'unit')}${p.dims ? ` · ${escHtml(p.dims)}` : ''}${p.otherNames.length ? ` · <span title="${hover}">renamed</span>` : ''}</span>
      </div>
      <div class="ins-seg">${segs.map(c => `<span style="width:${c.pct.toFixed(2)}%;background:${c.color}" title="${escHtml(c.label)}: ${c.units}"></span>`).join('')}</div>
      <div class="ins-legend">${segs.map(c => `<span><i style="background:${c.color}"></i>${escHtml(c.label)}<b>×${c.units}</b></span>`).join('')}</div>
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

// ─── LISTINGS ───────────────────────────────────────────────────────────────

const flag = (cls, text) => `<span class="ledger-type-badge ${cls}">${text}</span>`;
const rate = (v, digits) => v == null ? '—' : v.toFixed(digits);

function renderListings(orders) {
  const el = $('ins-listings'), kpis = $('ins-listing-kpis'), count = $('ins-listing-count');
  if (!state.listings) {
    const st = state.listingsStatus;
    kpis.innerHTML = '';
    count.textContent = '—';
    el.innerHTML = st?.error
      ? empty(`Couldn't load listings: ${escHtml(st.error)}`) + '<button class="apply-btn" data-action="tab-data-retry">Retry</button>'
      : st?.loading
        ? empty(`Loading listings…${st.total ? ` ${fmtNum(st.done)} of ${fmtNum(st.total)}` : ''}`)
        : empty('Listings load once the orders and ledger for this period are in.');
    return;
  }

  const L = listingStats(state.listings, orders);
  const allTime = state.filterFrom == null && state.filterTo == null;
  kpis.innerHTML = [
    kpi('Active Listings', fmtNum(L.active), `${fmtNum(L.soldOut)} sold out`),
    kpi('No Sales This Period', fmtNum(L.noSales), `${pct(L.active ? L.noSales / L.active : null, 0)} of active listings`),
    kpi('Low Stock', fmtNum(L.lowStock), 'active, 2 or fewer left', L.lowStock ? 'red' : ''),
    kpi('Favorites per 100 Views', rate(L.favPer100Views, 1), 'lifetime, all listings'),
  ].join('');
  count.textContent = plural(L.rows.length, 'listing');

  const right = 'style="text-align:right"';
  const head = ['<th>Listing</th>', `<th ${right}>Price</th>`, `<th ${right}>Stock</th>`, `<th ${right}>Views</th>`,
    `<th ${right}>Favorites</th>`, `<th ${right}>Favs / 100 views</th>`, `<th ${right}>Sold</th>`, `<th ${right}>Item revenue</th>`,
    ...(allTime ? [`<th ${right}>Sales / 100 views</th>`] : []), '<th></th>'].join('');
  const rows = L.rows.map(r => {
    const title = escHtml(r.title);
    const flags = [
      r.soldOut  ? flag('lt-fee', 'sold out') : '',
      r.lowStock ? flag('lt-refund', 'low stock') : '',
      r.noSales  ? flag('lt-tax', 'no sales') : '',
    ].join('');
    return `<tr>
      <td class="ins-title-cell"><a href="https://www.etsy.com/listing/${encodeURIComponent(String(r.id))}" target="_blank" rel="noopener" title="${title}">${title}</a></td>
      <td class="ins-num">${r.price == null ? '—' : fmtMoney(r.price)}</td>
      <td class="ins-num">${r.quantity == null ? '—' : fmtNum(r.quantity)}</td>
      <td class="ins-num">${r.views == null ? '—' : fmtNum(r.views)}</td>
      <td class="ins-num">${fmtNum(r.favorites)}</td>
      <td class="ins-num">${rate(r.favPer100Views, 1)}</td>
      <td class="ins-num">${fmtNum(r.units)}</td>
      <td class="ins-num">${r.units ? fmtMoney(r.revenue) : '—'}</td>
      ${allTime ? `<td class="ins-num">${rate(r.salesPer100Views, 2)}</td>` : ''}
      <td><span class="ins-flags">${flags}</span></td>
    </tr>`;
  }).join('');

  const notes = [
    "Views and favorites are Etsy's lifetime totals for each listing, updated about once a day. Etsy's API has no visit, conversion or search data.",
    allTime ? 'Sales per 100 views compares lifetime sales with lifetime views.' : 'Pick "All time" to compare sales with views.',
  ];
  if (L.gone.listings) {
    notes.push(`${plural(L.gone.listings, 'listing')} sold in this period ${L.gone.listings === 1 ? 'is' : 'are'} no longer active or sold out (${plural(L.gone.units, 'unit')}, ${fmtMoney(L.gone.revenue)}), so ${L.gone.listings === 1 ? "it isn't" : "they aren't"} in the table.`);
  }
  el.innerHTML = `<div class="table-wrap ins-scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>` +
    caveat(notes.join(' '));
}

// ─── REVIEWS ────────────────────────────────────────────────────────────────

const STAR_COLORS = { 5: '#3a7d4c', 4: '#65a30d', 3: '#b8860b', 2: '#d4622a', 1: '#b91c1c' };
const starText = n => '★'.repeat(n) + '☆'.repeat(5 - n);

/** listing_id → its current title (or newest title it sold under), see productNames. */
function listingTitles(orders) {
  const names = productNames(orders, state.listings);
  return id => names(productKey({ listing_id: id })).name || `Listing #${id}`;
}

function renderReviews(orders) {
  const status = $('ins-reviews-status'), body = $('ins-reviews-body');
  if (!state.reviews) {
    const st = state.reviewsStatus;
    body.style.display = 'none';
    status.innerHTML = st?.error
      ? empty(`Couldn't load reviews: ${escHtml(st.error)}`) + '<button class="apply-btn" data-action="tab-data-retry">Retry</button>'
      : st?.loading
        ? empty(`Loading reviews…${st.total ? ` ${fmtNum(st.done)} of ${fmtNum(st.total)}` : ''}`)
        : empty('Reviews load once the orders and ledger for this period are in.');
    return;
  }
  status.innerHTML = '';
  body.style.display = '';

  // Months run to the period end or today, whichever is earlier, like the other time charts
  const r = reviewStats(state.reviews, orders, { from: state.filterFrom, to: Math.min(state.filterTo ?? nowTs(), nowTs()) });
  const fiveStar = r.count ? r.stars[0].count / r.count : null;
  const lowCount = r.stars.slice(2).reduce((s, x) => s + x.count, 0);
  $('ins-review-kpis').innerHTML = [
    kpi('Average Rating', r.avg == null ? '—' : `${r.avg.toFixed(2)} ★`, `${plural(r.count, 'review')} this period`),
    kpi('5-Star Reviews', pct(fiveStar, 0), 'of reviews this period', 'green'),
    kpi('Rated 3 or Less', fmtNum(lowCount), 'reviews this period', lowCount ? 'red' : ''),
    kpi('Items Reviewed', pct(r.coverage, 0), r.items ? `${fmtNum(r.itemsReviewed)} of ${fmtNum(r.items)} items sold this period, so far` : 'no items to match'),
  ].join('');

  const title = listingTitles(orders);
  if (!r.count) {
    $('ins-stars').innerHTML = $('ins-review-listings').innerHTML = $('ins-low-reviews').innerHTML = empty('No reviews were left in this period.');
    $('ins-rating-svg').innerHTML = '';
    $('ins-rating-sub').textContent = '—';
    return;
  }

  setHtml($('ins-stars'), `<div class="top-prod-rows">${barRows(r.stars.map(s => ({ ...s, color: STAR_COLORS[s.stars] })), {
    name: s => `${s.stars} star${s.stars === 1 ? '' : 's'}`, value: s => s.count, fmt: s => fmtNum(s.count),
    sub: s => pct(s.count / r.count, 0),
  })}</div>` + caveat("Buyers review days or weeks after delivery, so recent periods show fewer reviews."));

  $('ins-rating-sub').textContent = `${r.monthly.length} month${r.monthly.length === 1 ? '' : 's'} · hover or tap a bar for its review count`;
  drawBarChart($('ins-rating-svg'), $('ins-rating-tooltip'), r.monthly, 'avg', v => `${v.toFixed(2)} ★`, '#b8860b',
    d => d.avg === null
      ? `<strong>${escHtml(d.label)}</strong><br>No reviews`
      : `<strong>${escHtml(d.label)}</strong><br>${d.avg.toFixed(2)} ★ average<br>${plural(d.count, 'review')}`,
    { values: v => v.toFixed(1) });

  const top = r.byListing.slice(0, 8);
  setHtml($('ins-review-listings'), top.length
    ? `<div class="top-prod-rows">${barRows(top, {
        name: l => title(l.id), value: l => l.avg, fmt: l => `${l.avg.toFixed(2)} ★`, sub: l => plural(l.count, 'review'),
      })}</div>`
    : empty('No listing has 3 or more reviews in this period.'));

  $('ins-low-reviews').innerHTML = r.low.length
    ? r.low.map(v => `<div class="ins-review">
        <div class="ins-review-head"><span class="stars">${starText(Math.round(v.rating))}</span><span class="what">${escHtml(title(v.listing_id))} · ${fmtDate(v.created_timestamp)}</span></div>
        <p>${v.review ? escHtml(v.review) : '<span class="ins-empty">(no written review)</span>'}</p>
      </div>`).join('')
    : empty('No reviews of 3 stars or fewer in this period.');
}
