// ─── INSIGHTS CALCULATIONS ─────────────────────────────────────────────────
// Pure functions behind the Insights tab — no DOM, no state.
// Covered by test/insights.tests.js. Orders are Etsy receipts with their line
// items in `transactions`; ledger amounts are integer cents; receipt money
// objects go through money(). Anything time-dependent takes `now` as an argument.
import { AD_FEES, AD_REFUNDS, LABEL_FEES, LABEL_REFUNDS, PAYOUT_REVERSALS, PAYOUT_TYPES } from './config.js';
import { computeLedgerTotals, ledgerType } from './finance.js';
import { bucketRange, bucketStart, money } from './util.js';

const cents = m => Math.round(money(m) * 100);
const sum   = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);

// ─── PROFITABILITY (ledger) ─────────────────────────────────────────────────

/**
 * Gross, fees and net per calendar bucket, with fee rate and margin as
 * fractions of gross (null when a bucket has no gross). Every bucket from
 * `from` to `to` (default: the first and last entry) is included, empty or not.
 * `exclude` is a Set of ledger types to leave out entirely (e.g. postage).
 */
export function feeRateSeries(entries, { bucket = 'week', exclude = null, from = null, to = null } = {}) {
  const groups = new Map();
  const ts = entries.map(e => e.created_timestamp);
  for (const b of bucketRange(from ?? (ts.length ? Math.min(...ts) : null), to ?? (ts.length ? Math.max(...ts) : null), bucket)) {
    groups.set(b.key, { label: b.label, ts: b.ts, entries: [] });
  }
  for (const e of entries) {
    if (exclude?.has(ledgerType(e))) continue;
    const b = bucketStart(e.created_timestamp, bucket);
    if (!groups.has(b.key)) groups.set(b.key, { label: b.label, ts: b.ts, entries: [] });
    groups.get(b.key).entries.push(e);
  }
  return [...groups.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(({ label, ts, entries }) => {
      const t = computeLedgerTotals(entries);
      const feesCents = -t.feesCents; // positive cost
      return {
        label, ts,
        grossCents: t.grossCents, feesCents, netCents: t.netCents,
        feeRate: t.grossCents > 0 ? feesCents / t.grossCents : null,
        margin:  t.grossCents > 0 ? t.netCents / t.grossCents : null,
      };
    });
}

/**
 * Advertising spend from the ledger, net of ad-fee refunds.
 * `offsiteSales` counts distinct references charged an Offsite Ads fee.
 */
export function adSpend(entries) {
  const byType = Object.fromEntries(Object.keys(AD_FEES).map(t => [t, 0]));
  const offsiteRefs = new Set();
  for (const e of entries) {
    const t = ledgerType(e);
    if (t in AD_FEES) {
      byType[t] -= e.amount; // fees are negative
      if (t === 'offsite_ads_fee' && e.reference_id != null) offsiteRefs.add(String(e.reference_id));
    } else if (t in AD_REFUNDS) {
      byType[AD_REFUNDS[t]] -= e.amount; // refunds are positive, so this reduces spend
    }
  }
  const rows = Object.entries(byType).map(([type, c]) => ({ type, label: AD_FEES[type], cents: c }));
  const totalCents = sum(rows, r => r.cents);
  const { grossCents } = computeLedgerTotals(entries);
  return { rows, totalCents, grossCents, share: grossCents > 0 ? totalCents / grossCents : null, offsiteSales: offsiteRefs.size };
}

/**
 * Shipping charged to buyers vs Etsy shipping labels bought, in cents.
 * Orders are clipped to the ledger's span so both sides cover the same days.
 */
export function shippingPnL(orders, entries, span) {
  const inSpan = o => !span || (o.create_timestamp >= span.from && o.create_timestamp <= span.to);
  const chargedCents = sum(orders.filter(inSpan), o => cents(o.total_shipping_cost));
  let labelsCents = 0, labelCount = 0;
  for (const e of entries) {
    const t = ledgerType(e);
    if (LABEL_FEES.has(t))         { labelsCents -= e.amount; labelCount++; }
    else if (LABEL_REFUNDS.has(t)) { labelsCents -= e.amount; }
  }
  return { chargedCents, labelsCents, diffCents: chargedCents - labelsCents, labelCount };
}

/**
 * Payouts to the bank and the latest running balance, in cents. A payout
 * that bounced back (and was usually sent again) counts once.
 */
export function payoutStats(entries) {
  const sent     = entries.filter(e => PAYOUT_TYPES.has(ledgerType(e)));
  const returned = entries.filter(e => PAYOUT_REVERSALS.has(ledgerType(e)));
  const payouts  = sent.slice(0, Math.max(0, sent.length - returned.length)); // for the count only
  const totalCents = -sum(sent, e => e.amount) - sum(returned, e => e.amount);
  const latest = entries.reduce((best, e) =>
    !best || e.created_timestamp > best.created_timestamp ||
    (e.created_timestamp === best.created_timestamp && (e.sequence_number ?? 0) > (best.sequence_number ?? 0)) ? e : best, null);
  return {
    count: payouts.length,
    totalCents,
    avgCents: payouts.length ? Math.round(totalCents / payouts.length) : 0,
    lastPayoutTs: sent.length ? Math.max(...sent.map(e => e.created_timestamp)) : null,
    balanceCents: latest ? latest.balance : null,
  };
}

// ─── REVENUE COMPOSITION (receipts) ─────────────────────────────────────────

/**
 * What buyers' payments were made of, in currency units. `other` is whatever
 * the parts don't explain (VAT, rounding, adjustments).
 */
export function revenueComposition(orders) {
  let items = 0, discounts = 0, shipping = 0, tax = 0, giftWrap = 0, grand = 0;
  for (const o of orders) {
    const itemTotal = o.total_price
      ? money(o.total_price)
      : sum(o.transactions || [], t => money(t.price) * (t.quantity || 1));
    items     += itemTotal;
    discounts += money(o.discount_amt);
    shipping  += money(o.total_shipping_cost);
    tax       += money(o.total_tax_cost);
    giftWrap  += money(o.gift_wrap_price);
    grand     += money(o.grandtotal);
  }
  const r2 = n => Math.round(n * 100) / 100;
  const other = r2(grand - (items - discounts + shipping + tax + giftWrap));
  return { items: r2(items), discounts: r2(discounts), shipping: r2(shipping), tax: r2(tax), giftWrap: r2(giftWrap), other, grand: r2(grand) };
}

// ─── CUSTOMERS (receipts) ───────────────────────────────────────────────────

/**
 * Buyers grouped by buyer_user_id. "Repeat" means 2+ orders among the orders
 * passed in (i.e. within the selected period). `top` is sorted by spend.
 */
export function customerStats(orders, topN = 8) {
  const byBuyer = new Map();
  let noId = 0;
  for (const o of orders) {
    const id = o.buyer_user_id;
    if (id == null || id === '') { noId++; continue; }
    const b = byBuyer.get(id) ?? { id, name: '', orders: 0, revenue: 0 };
    b.orders++;
    b.revenue += money(o.grandtotal);
    if (o.name) b.name = o.name;
    byBuyer.set(id, b);
  }
  const buyers  = [...byBuyer.values()];
  const repeat  = buyers.filter(b => b.orders > 1);
  const revenue = sum(buyers, b => b.revenue);
  return {
    buyers: buyers.length,
    repeatBuyers: repeat.length,
    repeatRate: buyers.length ? repeat.length / buyers.length : null,
    repeatRevenueShare: revenue > 0 ? sum(repeat, b => b.revenue) / revenue : null,
    ordersPerBuyer: buyers.length ? (orders.length - noId) / buyers.length : null,
    noId,
    top: [...buyers].sort((a, b) => b.revenue - a.revenue).slice(0, topN),
  };
}

/**
 * Orders and revenue by destination. level 'country' groups by country_iso;
 * 'us-state' groups US orders by state. Orders without that field are counted
 * in `unknown` and left out of `known` (shares should use `known`).
 */
export function geography(orders, level = 'country') {
  const map = new Map();
  let known = 0, unknown = 0;
  for (const o of orders) {
    let key;
    if (level === 'us-state') {
      if (String(o.country_iso || '').toUpperCase() !== 'US') continue;
      key = o.state;
    } else {
      key = o.country_iso;
    }
    key = String(key ?? '').trim();
    if (!key) { unknown++; continue; }
    if (level === 'country') key = key.toUpperCase();
    const row = map.get(key) ?? { key, orders: 0, revenue: 0 };
    row.orders++;
    row.revenue += money(o.grandtotal);
    map.set(key, row);
    known++;
  }
  const rows = [...map.values()].sort((a, b) => b.revenue - a.revenue);
  return { rows, known, unknown };
}

// ─── PRODUCT IDENTITY ───────────────────────────────────────────────────────
// A product is its Etsy listing. listing_id stays the same when the seller
// renames a listing, while each line item keeps the title it sold under, so
// products are grouped by listing_id and never by title (the title is only a
// fallback for a line item without a listing_id).

/** The key that identifies a line item's (or review's) product. */
export const productKey = t => t.listing_id != null ? String(t.listing_id) : `title:${t.title || ''}`;

/**
 * Names for product keys: the listing's current title when `listings` has it,
 * otherwise the title of its most recent sale in `orders`. `otherNames` lists
 * the other titles it sold under (it was renamed). name is null if unknown.
 */
export function productNames(orders, listings = null) {
  const sold = new Map(); // key → { title, ts, titles }
  for (const o of orders) {
    const ts = o.create_timestamp ?? 0;
    for (const t of o.transactions || []) {
      if (!t.title) continue;
      const key = productKey(t);
      const s = sold.get(key) ?? { title: t.title, ts, titles: new Set() };
      s.titles.add(t.title);
      if (ts > s.ts) { s.title = t.title; s.ts = ts; }
      sold.set(key, s);
    }
  }
  const current = new Map((listings || []).filter(l => l.title).map(l => [productKey(l), l.title]));
  return key => {
    const s = sold.get(key);
    const name = current.get(key) ?? s?.title ?? null;
    return { name, otherNames: [...(s?.titles || [])].filter(t => t !== name) };
  };
}

/**
 * Products ranked by item revenue (price × quantity) or units sold in
 * `orders`, grouped by listing. Returns { rows: [{ key, name, otherNames,
 * revenue, units }], total } where total counts every product sold.
 */
export function topProducts(orders, { by = 'revenue', limit = 8, listings = null } = {}) {
  const map = new Map();
  for (const o of orders) {
    for (const t of o.transactions || []) {
      const key = productKey(t);
      const p   = map.get(key) ?? { key, revenue: 0, units: 0 };
      const qty = t.quantity || 1;
      p.revenue += (t.price ? money(t.price) : 0) * qty;
      p.units   += qty;
      map.set(key, p);
    }
  }
  const names = productNames(orders, listings);
  const rows = [...map.values()]
    .sort((a, b) => by === 'revenue' ? b.revenue - a.revenue : b.units - a.units)
    .slice(0, limit)
    .map(p => { const n = names(p.key); return { ...p, name: n.name ?? '(Unknown)', otherNames: n.otherNames }; });
  return { rows, total: map.size };
}

// ─── PRODUCTS & ORDERS (receipts) ───────────────────────────────────────────

const isPersonalization = v => v.question_id != null || /personali[sz]ation/i.test(v.formatted_name || '');

/**
 * Best-selling variation combinations (e.g. "7 · Gold") for the top products
 * by units, grouped by listing (see productKey) and named by productNames.
 * Personalization text is left out; combinations past maxCombos become "Other".
 */
export function variationStats(orders, { topN = 5, maxCombos = 5, listings = null } = {}) {
  const products = new Map();
  for (const o of orders) {
    for (const t of o.transactions || []) {
      const vars = (t.variations || []).filter(v => !isPersonalization(v));
      if (!vars.length) continue;
      const key = productKey(t);
      const p = products.get(key) ?? {
        key, units: 0, combos: new Map(),
        dims: vars.map(v => v.formatted_name).filter(Boolean).join(' · '),
      };
      const qty   = t.quantity || 1;
      const combo = vars.map(v => v.formatted_value).join(' · ');
      p.units += qty;
      p.combos.set(combo, (p.combos.get(combo) || 0) + qty);
      products.set(key, p);
    }
  }
  const names = productNames(orders, listings);
  return [...products.values()]
    .sort((a, b) => b.units - a.units)
    .slice(0, topN)
    .map(p => {
      const all  = [...p.combos].map(([label, units]) => ({ label, units })).sort((a, b) => b.units - a.units);
      const top  = all.slice(0, maxCombos);
      const rest = sum(all.slice(maxCombos), c => c.units);
      if (rest) top.push({ label: 'Other', units: rest, other: true });
      const n = names(p.key);
      return { key: p.key, title: n.name ?? '(Unknown)', otherNames: n.otherNames, dims: p.dims, units: p.units, combos: top, comboCount: all.length };
    });
}

/** Smallest of 1, 2, 2.5, 5 × 10^k that is at least `raw`. */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw - 1e-9);
}

/**
 * Units per order (1, 2, 3, 4, 5+) and order totals in about 4–8 "nice" bins
 * sized from the 95th percentile, so one huge order doesn't flatten the rest
 * (the last bin is open-ended: max = null).
 */
export function basketStats(orders) {
  const unitBins = ['1', '2', '3', '4', '5+'].map(label => ({ label, count: 0 }));
  let units = 0, multi = 0, counted = 0;
  const values = [];
  for (const o of orders) {
    const u = sum(o.transactions || [], t => t.quantity || 1);
    if (u > 0) {
      unitBins[Math.min(u, 5) - 1].count++;
      units += u; counted++;
      if (u > 1) multi++;
    }
    values.push(money(o.grandtotal));
  }
  const sorted = [...values].sort((a, b) => a - b);
  const p95  = sorted.length ? sorted[Math.floor(0.95 * (sorted.length - 1))] : 0;
  const step = niceStep(p95 / 8);
  const n    = Math.max(1, Math.ceil(p95 / step - 1e-9));
  const valueBins = Array.from({ length: n }, (_, i) => ({ min: i * step, max: i === n - 1 ? null : (i + 1) * step, count: 0 }));
  for (const v of values) valueBins[Math.max(0, Math.min(n - 1, Math.floor(v / step + 1e-9)))].count++;
  return {
    unitBins, step, valueBins,
    avgUnits:   counted ? units / counted : null,
    multiShare: counted ? multi / counted : null,
  };
}

/** Orders with a percent or fixed-amount discount (free-shipping coupons aren't in discount_amt). */
export function discountStats(orders) {
  const discounted = orders.filter(o => money(o.discount_amt) > 0);
  const fullPrice  = orders.filter(o => !(money(o.discount_amt) > 0));
  const aov = list => list.length ? sum(list, o => money(o.grandtotal)) / list.length : null;
  return {
    orders: orders.length,
    discounted: discounted.length,
    share: orders.length ? discounted.length / orders.length : null,
    totalDiscount: Math.round(sum(discounted, o => money(o.discount_amt)) * 100) / 100,
    aovWith: aov(discounted),
    aovWithout: aov(fullPrice),
  };
}

// ─── OPERATIONS (receipts) ──────────────────────────────────────────────────

const lower = s => String(s ?? '').toLowerCase();
const NEVER_SHIPS = new Set(['canceled', 'cancelled', 'fully refunded']);
const isDigitalOnly = o => (o.transactions || []).length > 0 && o.transactions.every(t => t.is_digital);
const earliest = arr => { const v = arr.filter(x => x > 0); return v.length ? Math.min(...v) : null; };
const latest   = arr => { const v = arr.filter(x => x > 0); return v.length ? Math.max(...v) : null; };

/** 23:59:59 local time on the day of ts. */
function endOfLocalDay(ts) {
  const d = new Date(ts * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).getTime() / 1000);
}

/** When an order was paid, first marked shipped (null if not yet) and expected to ship. */
function shipTimes(o) {
  const txs = o.transactions || [];
  return {
    paid:     earliest(txs.map(t => t.paid_timestamp)) ?? o.create_timestamp,
    shipped:  earliest((o.shipments || []).map(s => s.shipment_notification_timestamp)) ?? earliest(txs.map(t => t.shipped_timestamp)),
    expected: latest(txs.map(t => t.expected_ship_date)),
  };
}

/** Index of the last bin whose `min` is <= value. */
const binFor = (bins, value) => bins.reduce((idx, b, i) => (value >= b.min ? i : idx), 0);

const SHIP_BINS = [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4–5'], [6, '6–7'], [8, '8–14'], [15, '15+']];

/**
 * Days from payment to the first "shipped" mark for physical orders (digital,
 * canceled and fully refunded orders are left out). onTimeRate compares with
 * Etsy's expected ship date (until the end of that day, local time).
 */
export function fulfilment(orders) {
  const days = [];
  let onTime = 0, withExpected = 0;
  for (const o of orders) {
    if (isDigitalOnly(o) || NEVER_SHIPS.has(lower(o.status))) continue;
    const { paid, shipped, expected } = shipTimes(o);
    if (!shipped) continue;
    days.push(Math.max(0, (shipped - paid) / 86400));
    if (expected) {
      withExpected++;
      if (shipped <= endOfLocalDay(expected)) onTime++;
    }
  }
  const bins = SHIP_BINS.map(([min, label]) => ({ min, label, count: 0 }));
  for (const d of days) bins[binFor(bins, Math.floor(d))].count++;
  const sorted = [...days].sort((a, b) => a - b), mid = sorted.length >> 1;
  return {
    shipped: days.length,
    medianDays: !sorted.length ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    bins,
    onTimeRate: withExpected ? onTime / withExpected : null,
    withExpected,
  };
}

const AGE_BINS = [[0, '0–1 days'], [2, '2–3 days'], [4, '4–7 days'], [8, '8+ days']];

/**
 * Physical orders not yet marked shipped, by days since payment, and how many
 * are past Etsy's expected ship date. Orders whose shipped flag is unknown are skipped.
 */
export function backlog(orders, now) {
  const bins = AGE_BINS.map(([min, label]) => ({ min, label, count: 0 }));
  let count = 0, overdue = 0, oldestDays = null;
  for (const o of orders) {
    if (isDigitalOnly(o) || NEVER_SHIPS.has(lower(o.status))) continue;
    if ((o.is_shipped ?? o.was_shipped) !== false || (o.shipments || []).length) continue;
    const { paid, expected } = shipTimes(o);
    const age = Math.max(0, (now - paid) / 86400);
    count++;
    bins[binFor(bins, age)].count++;
    oldestDays = Math.max(oldestDays ?? 0, age);
    if (expected && now > endOfLocalDay(expected)) overdue++;
  }
  return { count, overdue, oldestDays, bins };
}

/** Canceled / refunded orders (by status or a recorded refund) and the amount refunded. */
export function refundStats(orders) {
  let canceled = 0, fullyRefunded = 0, partiallyRefunded = 0, affected = 0, refunded = 0;
  for (const o of orders) {
    const s = lower(o.status);
    const refunds = o.refunds || [];
    if (s === 'canceled' || s === 'cancelled') canceled++;
    else if (s === 'fully refunded') fullyRefunded++;
    else if (s === 'partially refunded') partiallyRefunded++;
    if (s === 'canceled' || s === 'cancelled' || s.endsWith('refunded') || refunds.length) affected++;
    refunded += sum(refunds, r => money(r.amount));
  }
  return {
    orders: orders.length, canceled, fullyRefunded, partiallyRefunded, affected,
    rate: orders.length ? affected / orders.length : null,
    refundedAmount: Math.round(refunded * 100) / 100,
  };
}

// ─── LISTINGS (extra calls) ─────────────────────────────────────────────────

/**
 * Listings joined with their sales in `orders` (by listing_id). views and
 * num_favorers are Etsy's lifetime totals; a views count of 0 can mean "not
 * counted yet", so per-view rates are null then. `gone` sums sales of
 * listings that aren't in `listings` any more (deactivated, expired…).
 */
export function listingStats(listings, orders, { lowStock = 2 } = {}) {
  const sales = new Map();
  for (const o of orders) {
    for (const t of o.transactions || []) {
      if (t.listing_id == null) continue;
      const key = productKey(t);
      const s = sales.get(key) ?? { units: 0, revenue: 0 };
      s.units   += t.quantity || 1;
      s.revenue += money(t.price) * (t.quantity || 1);
      sales.set(key, s);
    }
  }
  const r2 = n => Math.round(n * 100) / 100;
  const rows = listings.map(l => {
    const s     = sales.get(productKey(l)) ?? { units: 0, revenue: 0 };
    const views = l.views || 0;
    const state = lower(l.state) || 'active';
    const qty   = l.quantity ?? null;
    return {
      id: l.listing_id, title: l.title || '(Untitled)', state,
      price: l.price ? money(l.price) : null, quantity: qty,
      views: views || null, favorites: l.num_favorers || 0,
      units: s.units, revenue: r2(s.revenue),
      favPer100Views:   views ? (l.num_favorers || 0) / views * 100 : null,
      salesPer100Views: views ? s.units / views * 100 : null,
      noSales:  state === 'active' && s.units === 0,
      lowStock: state === 'active' && qty != null && qty <= lowStock,
      soldOut:  state === 'sold_out',
    };
  }).sort((a, b) => b.revenue - a.revenue || (b.views || 0) - (a.views || 0));

  const listed = new Set(listings.map(productKey));
  const gone   = [...sales].filter(([id]) => !listed.has(id)).map(([, s]) => s);
  const active = rows.filter(r => r.state === 'active');
  const views  = sum(rows, r => r.views || 0);
  const favs   = sum(rows.filter(r => r.views), r => r.favorites);
  return {
    rows,
    active: active.length,
    soldOut: rows.filter(r => r.soldOut).length,
    noSales: active.filter(r => r.noSales).length,
    lowStock: active.filter(r => r.lowStock).length,
    favPer100Views: views ? favs / views * 100 : null,
    gone: { listings: gone.length, units: sum(gone, g => g.units), revenue: r2(sum(gone, g => g.revenue)) },
  };
}

// ─── REVIEWS (extra calls) ──────────────────────────────────────────────────

/**
 * Ratings from reviews left within [from, to] (stars, monthly average,
 * per-listing average for listings with minReviews+, recent ratings of 3 or
 * less), and coverage: the share of these orders' line items that have a
 * review so far, joined on transaction_id (`reviews` may run past `to`).
 * `monthly` has every month of the period (or between the first and last
 * review); a month without reviews has count 0 and avg null.
 */
export function reviewStats(reviews, orders, { from = null, to = null, minReviews = 3, recentLow = 5 } = {}) {
  const period = reviews.filter(r =>
    r.rating >= 1 && r.rating <= 5 &&
    (from == null || r.created_timestamp >= from) && (to == null || r.created_timestamp <= to));

  const stars = [5, 4, 3, 2, 1].map(n => ({ stars: n, count: 0 }));
  for (const r of period) stars[5 - Math.round(r.rating)].count++;

  const months = new Map(), listings = new Map();
  if (period.length) {
    const ts = period.map(r => r.created_timestamp);
    for (const b of bucketRange(from ?? Math.min(...ts), to ?? Math.max(...ts), 'month')) {
      months.set(b.key, { label: b.label, ts: b.ts, total: 0, count: 0 });
    }
  }
  for (const r of period) {
    const b = bucketStart(r.created_timestamp, 'month');
    const m = months.get(b.key) ?? { label: b.label, ts: b.ts, total: 0, count: 0 };
    m.total += r.rating; m.count++;
    months.set(b.key, m);
    if (r.listing_id != null) {
      const l = listings.get(r.listing_id) ?? { id: r.listing_id, total: 0, count: 0 };
      l.total += r.rating; l.count++;
      listings.set(r.listing_id, l);
    }
  }

  const reviewed = new Set(reviews.map(r => r.transaction_id).filter(id => id != null).map(String));
  let items = 0, itemsReviewed = 0;
  for (const o of orders) {
    for (const t of o.transactions || []) {
      if (t.transaction_id == null) continue;
      items++;
      if (reviewed.has(String(t.transaction_id))) itemsReviewed++;
    }
  }

  return {
    count: period.length,
    avg: period.length ? sum(period, r => r.rating) / period.length : null,
    stars,
    monthly: [...months.values()].sort((a, b) => a.ts - b.ts)
      .map(m => ({ label: m.label, ts: m.ts, count: m.count, avg: m.count ? m.total / m.count : null })),
    byListing: [...listings.values()].filter(l => l.count >= minReviews)
      .map(l => ({ id: l.id, count: l.count, avg: l.total / l.count }))
      .sort((a, b) => b.count - a.count || a.avg - b.avg),
    low: period.filter(r => r.rating <= 3).sort((a, b) => b.created_timestamp - a.created_timestamp).slice(0, recentLow),
    items, itemsReviewed,
    coverage: items ? itemsReviewed / items : null,
  };
}

/** Orders and revenue by local weekday (0 = Sunday) × hour (0–23). */
export function heatmapMatrix(orders) {
  const counts  = Array.from({ length: 7 }, () => Array(24).fill(0));
  const revenue = Array.from({ length: 7 }, () => Array(24).fill(0));
  let peak = null;
  for (const o of orders) {
    const d = new Date(o.create_timestamp * 1000);
    const w = d.getDay(), h = d.getHours();
    counts[w][h]++;
    revenue[w][h] += money(o.grandtotal);
    if (!peak || counts[w][h] > peak.count) peak = { day: w, hour: h, count: counts[w][h] };
  }
  return { counts, revenue, peak };
}
