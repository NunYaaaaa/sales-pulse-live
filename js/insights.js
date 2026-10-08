// ─── INSIGHTS CALCULATIONS ─────────────────────────────────────────────────
// Pure functions behind the Insights tab — no DOM, no state.
// Covered by test/insights.tests.js. Orders are Etsy receipts with their line
// items in `transactions`; ledger amounts are integer cents; receipt money
// objects go through money(). Anything time-dependent takes `now` as an argument.
import { AD_FEES, AD_REFUNDS, LABEL_FEES, LABEL_REFUNDS, PAYOUT_TYPES } from './config.js';
import { computeLedgerTotals, ledgerType } from './finance.js';
import { bucketStart, money } from './util.js';

const cents = m => Math.round(money(m) * 100);
const sum   = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);

// ─── PROFITABILITY (ledger) ─────────────────────────────────────────────────

/**
 * Gross, fees and net per calendar bucket, with fee rate and margin as
 * fractions of gross (null when a bucket has no gross).
 * `exclude` is a Set of ledger types to leave out entirely (e.g. postage).
 */
export function feeRateSeries(entries, { bucket = 'week', exclude = null } = {}) {
  const groups = new Map();
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

/** Payouts to the bank and the latest running balance, in cents. */
export function payoutStats(entries) {
  const payouts = entries.filter(e => PAYOUT_TYPES.has(ledgerType(e)));
  const totalCents = -sum(payouts, e => e.amount);
  const latest = entries.reduce((best, e) =>
    !best || e.created_timestamp > best.created_timestamp ||
    (e.created_timestamp === best.created_timestamp && (e.sequence_number ?? 0) > (best.sequence_number ?? 0)) ? e : best, null);
  return {
    count: payouts.length,
    totalCents,
    avgCents: payouts.length ? Math.round(totalCents / payouts.length) : 0,
    lastPayoutTs: payouts.length ? Math.max(...payouts.map(e => e.created_timestamp)) : null,
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
