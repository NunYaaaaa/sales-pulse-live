// ─── UTILS ─────────────────────────────────────────────────────────────────
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function money(obj) {
  if (!obj) return 0;
  return (obj.amount || 0) / (obj.divisor || 100);
}
export function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(n);
}
export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
export function daysAgoStr(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
export function ytdStr() {
  return new Date().getFullYear() + '-01-01';
}

/**
 * Convert a date string (YYYY-MM-DD) to a unix timestamp.
 * "from" is start of that day (00:00:00 UTC).
 * "to"   is end of that day (23:59:59 UTC).
 */
export function dateStrToTs(str, isEnd = false) {
  if (!str) return null;
  const d = new Date(str + (isEnd ? 'T23:59:59Z' : 'T00:00:00Z'));
  return Math.floor(d.getTime() / 1000);
}
