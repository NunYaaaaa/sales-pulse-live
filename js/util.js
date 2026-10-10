// ─── UTILS ─────────────────────────────────────────────────────────────────
/** Resolve after ms; rejects with AbortError as soon as signal aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

export function money(obj) {
  if (!obj) return 0;
  return (obj.amount || 0) / (obj.divisor || 100);
}
/**
 * An order's sales: items after discounts, plus shipping and gift wrap. Leaves
 * out sales tax and state delivery fees, which the buyer pays but Etsy takes
 * back out, so it matches the order's sale in the ledger before refunds.
 */
export function orderSales(o) {
  if (!o.subtotal) return money(o.grandtotal) - money(o.total_tax_cost);
  return money(o.subtotal) + money(o.total_shipping_cost) + money(o.gift_wrap_price);
}
// Shop currency (ISO 4217), set once the shop is loaded
let currency = 'USD';
export function setCurrency(code) { currency = code || 'USD'; }
export function getCurrency() { return currency; }
export function fmtMoney(n) {
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency }).format(n); }
  catch { return `${n.toFixed(2)} ${currency}`; } // unknown currency code
}
/** Rounded to whole units ("$384"), for labels with little room. */
export function fmtMoneyWhole(n) {
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency, maximumFractionDigits:0, minimumFractionDigits:0 }).format(n); }
  catch { return `${Math.round(n)} ${currency}`; }
}
const HTML_ESCAPES = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
/** Escape for both element content and quoted attribute values. */
export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}
export function getStatus(o) {
  if (o.status)      return o.status;
  if (o.was_shipped) return 'shipped';
  if (o.was_paid)    return 'paid';
  return 'open';
}
export function statusClass(s) {
  const sl = (s || '').toLowerCase();
  if (sl === 'paid')                          return 's-paid';
  if (sl === 'completed' || sl === 'complete') return 's-completed';
  if (sl === 'shipped')                       return 's-shipped';
  if (sl === 'open' || sl === 'payment processing') return 's-open';
  return 's-other';
}
// Etsy's receipt payment_method codes
const PAYMENT_METHODS = {
  cc: 'Card', paypal: 'PayPal', check: 'Check', mo: 'Money order', bt: 'Bank transfer', other: 'Other',
  ideal: 'iDEAL', sofort: 'Sofort', apple_pay: 'Apple Pay',
  google: 'Google Pay', google_pay: 'Google Pay', android_pay: 'Google Pay',
  klarna: 'Klarna', k_pay_in_4: 'Klarna Pay in 4', k_pay_in_3: 'Klarna Pay in 3', k_financing: 'Klarna financing',
};
/** How a payment method reads to the seller; an unknown code is shown as words. */
export function paymentMethodLabel(code) {
  if (!code) return '—';
  if (PAYMENT_METHODS[code]) return PAYMENT_METHODS[code];
  const words = String(code).replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ─── DATES ─────────────────────────────────────────────────────────────────
// Everything is in the viewer's local timezone: presets, filter bounds,
// chart buckets and exports all agree on what "a day" is.
const pad2 = n => String(n).padStart(2, '0');

/** Local calendar date of d as YYYY-MM-DD. */
export function localDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function todayStr() {
  return localDateKey(new Date());
}
export function daysAgoStr(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return localDateKey(d);
}
export function ytdStr() {
  return new Date().getFullYear() + '-01-01';
}

/**
 * The local calendar bucket a unix timestamp falls in.
 * size: 'day' | 'week' (starting Monday) | 'month'. Returns { key, label, ts }.
 */
export function bucketStart(ts, size) {
  const d = new Date(ts * 1000);
  const fmt = (date, opts) => date.toLocaleDateString('en-US', opts);
  let start, label, tip; // label: short, for the axis; tip: unambiguous, for tooltips
  if (size === 'day') {
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    label = fmt(start, { month:'short', day:'numeric' });
    tip   = fmt(start, { weekday:'short', month:'short', day:'numeric', year:'numeric' });
  } else if (size === 'week') {
    const day = d.getDay();
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (day === 0 ? -6 : 1 - day));
    label = fmt(start, { month:'short', day:'numeric' });
    tip   = `Week of ${fmt(start, { month:'short', day:'numeric', year:'numeric' })}`;
  } else if (size === 'year') {
    start = new Date(d.getFullYear(), 0, 1);
    label = tip = String(d.getFullYear());
  } else {
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    label = fmt(start, { month:'short', year:'numeric' });
    tip   = fmt(start, { month:'long', year:'numeric' });
  }
  return { key: localDateKey(start), label, tip, ts: Math.floor(start.getTime() / 1000) };
}

/**
 * Every local calendar bucket from the one holding fromTs to the one holding
 * toTs, inclusive, so time charts show empty days, weeks and months instead
 * of skipping them. Empty when either end is missing or the span is reversed.
 */
export function bucketRange(fromTs, toTs, size) {
  const out = [];
  if (fromTs == null || toTs == null || toTs < fromTs) return out;
  const last = bucketStart(toTs, size).key;
  const d = new Date(bucketStart(fromTs, size).ts * 1000);
  for (let guard = 0; guard < 10000; guard++) {
    const b = bucketStart(d.getTime() / 1000, size);
    out.push(b);
    if (b.key >= last) break;
    if (size === 'day')       d.setDate(d.getDate() + 1);
    else if (size === 'week') d.setDate(d.getDate() + 7);
    else if (size === 'year') d.setFullYear(d.getFullYear() + 1);
    else                      d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/**
 * How many times each weekday (0 = Sunday) occurs among the local calendar
 * days from the day of fromTs to the day of toTs, inclusive.
 */
export function weekdayCounts(fromTs, toTs) {
  const counts = Array(7).fill(0);
  const s = new Date(fromTs * 1000), e = new Date(toTs * 1000);
  const end = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  for (const d = new Date(s.getFullYear(), s.getMonth(), s.getDate()); d <= end; d.setDate(d.getDate() + 1)) counts[d.getDay()]++;
  return counts;
}

/**
 * How many day/week/month/year buckets bucketRange would return for the span,
 * worked out without building them (a day count over years of data is long).
 */
export function countBuckets(fromTs, toTs, size) {
  if (fromTs == null || toTs == null || toTs < fromTs) return 0;
  const a = new Date(fromTs * 1000), b = new Date(toTs * 1000);
  if (size === 'year')  return b.getFullYear() - a.getFullYear() + 1;
  if (size === 'month') return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
  const days = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
  if (size === 'day') return days + 1;
  const sinceMonday = d => (d.getDay() + 6) % 7; // weeks start on Monday
  return Math.round((days + sinceMonday(a) - sinceMonday(b)) / 7) + 1;
}

export const BUCKET_SIZES = ['day', 'week', 'month', 'year'];
const MAX_BUCKETS = 370; // a year of days; more points than that don't read on a chart

/**
 * The bucket sizes a time chart offers for a span, in BUCKET_SIZES order. A
 * size is ok with 2 to MAX_BUCKETS buckets: one bar shows no change over time.
 */
export function bucketOptions(fromTs, toTs) {
  return BUCKET_SIZES.map(size => {
    const count = countBuckets(fromTs, toTs, size);
    return { size, count, ok: count >= 2 && count <= MAX_BUCKETS };
  });
}

/** Start of the bucket after the one that starts at ts. */
function nextBucketTs(ts, size) {
  const d = new Date(ts * 1000);
  if (size === 'week')       d.setDate(d.getDate() + 7);
  else if (size === 'month') d.setMonth(d.getMonth() + 1);
  else if (size === 'year')  d.setFullYear(d.getFullYear() + 1);
  else                       d.setDate(d.getDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Add to the tooltip of a first or last bucket that the period covers only
 * part of it ("October 2026 (Oct 1–9 only)"), so a short edge week, month or
 * year isn't read as a slow one. Days are left as they are. Changes and
 * returns the buckets ({ ts, label, tip }).
 */
export function markPartialBuckets(buckets, fromTs, toTs, size) {
  if (size === 'day' || !buckets.length || fromTs == null || toTs == null) return buckets;
  const short = ts => new Date(ts * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  for (const b of new Set([buckets[0], buckets.at(-1)])) {
    const end = nextBucketTs(b.ts, size) - 1;
    const s = Math.max(b.ts, fromTs), e = Math.min(end, toTs);
    if (!(s <= e && (s > b.ts || e < end))) continue;
    const sameMonth = new Date(s * 1000).getMonth() === new Date(e * 1000).getMonth();
    const last = sameMonth ? new Date(e * 1000).getDate() : short(e); // Oct 1–9, Sep 28–Oct 4
    const days = short(s) === short(e) ? short(s) : `${short(s)}–${last}`;
    b.tip = `${b.tip ?? b.label} (${days} only)`;
  }
  return buckets;
}

/** The size to draw: the viewer's pick while it suits the span, else the automatic one. */
export function chooseBucket(pick, options, auto) {
  return options.find(o => o.size === pick)?.ok ? pick : auto;
}

/** Bucket size that gives a readable number of points for a span (unix seconds). */
export function pickBucket(minTs, maxTs) {
  const spanDays = (maxTs - minTs) / 86400;
  if (spanDays <= 35)  return 'day';
  if (spanDays <= 180) return 'week';
  return 'month';
}

/**
 * Convert a date string (YYYY-MM-DD) to a unix timestamp.
 * "from" is start of that local day (00:00:00).
 * "to"   is end of that local day (23:59:59).
 */
export function dateStrToTs(str, isEnd = false) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  const dt = isEnd ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d);
  return Math.floor(dt.getTime() / 1000);
}
