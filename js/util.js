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
// Shop currency (ISO 4217), set once the shop is loaded
let currency = 'USD';
export function setCurrency(code) { currency = code || 'USD'; }
export function getCurrency() { return currency; }
export function fmtMoney(n) {
  try { return new Intl.NumberFormat('en-US', { style:'currency', currency }).format(n); }
  catch { return `${n.toFixed(2)} ${currency}`; } // unknown currency code
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
  let start, label;
  if (size === 'day') {
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    label = start.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  } else if (size === 'week') {
    const day = d.getDay();
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (day === 0 ? -6 : 1 - day));
    label = start.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  } else {
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    label = start.toLocaleDateString('en-US', { month:'short', year:'numeric' });
  }
  return { key: localDateKey(start), label, ts: Math.floor(start.getTime() / 1000) };
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
