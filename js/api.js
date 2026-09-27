// ─── HTTP / ETSY API ───────────────────────────────────────────────────────
import { ETSY_API_BASE } from './config.js';
import { session } from './session.js';
import { setFetchStatus } from './ui.js';
import { sleep } from './util.js';

/**
 * Fetch with automatic retry on 429 Too Many Requests.
 * Waits for the Retry-After header (seconds) if present, otherwise uses
 * exponential backoff, capped at 60 s.
 * Non-429 errors are returned as-is for the caller to handle.
 */
export async function etsyFetch(path, token, apiKey, { maxRetries = 8 } = {}) {
  const sharedSecret = session.get('shared_secret') || '';
  const url = `${ETSY_API_BASE}${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'x-api-key':     `${apiKey}:${sharedSecret}`,
  };

  let attempt = 0;
  let delay   = 5000; // ms — Workers need more breathing room than raw Etsy API

  while (true) {
    const resp = await fetch(url, { headers });

    if (resp.status !== 429) return resp; // success or non-rate-limit error

    attempt++;
    if (attempt > maxRetries) return resp; // give up, let caller handle

    // Check several possible rate-limit headers (Workers may forward any of these)
    const retryAfter  = resp.headers.get('Retry-After');           // seconds
    const resetHeader = resp.headers.get('X-RateLimit-Reset');     // unix timestamp
    const resetMs     = resetHeader ? (parseInt(resetHeader,10)*1000 - Date.now()) : null;

    let waitMs;
    if (retryAfter)          waitMs = parseInt(retryAfter, 10) * 1000;
    else if (resetMs > 0)    waitMs = resetMs + 500;
    else                     waitMs = delay;

    // Add ±20% jitter so burst retries don't all land at once
    const jitter = waitMs * 0.2 * (Math.random() - 0.5);
    waitMs = Math.max(1000, Math.round(waitMs + jitter));

    console.warn(`[etsyFetch] 429 on ${path} — waiting ${(waitMs/1000).toFixed(1)}s (attempt ${attempt}/${maxRetries})`);
    setFetchStatus(`Rate limited — retrying in ${Math.ceil(waitMs/1000)}s…`);
    await sleep(waitMs);

    // Exponential backoff for next attempt, capped at 60 s
    delay = Math.min(delay * 2, 60_000);
  }
}

export async function fetchOrders(shopId, token, apiKey, { from = null, to = null } = {}) {
  let orders = [], offset = 0;
  const BATCH = 100;

  // Build date filter query params (Etsy uses unix timestamps)
  const dateParams = [];
  if (from) dateParams.push(`min_created=${from}`);
  if (to)   dateParams.push(`max_created=${to}`);
  const dateQS = dateParams.length ? '&' + dateParams.join('&') : '';

  while (true) {
    const resp = await etsyFetch(
      `/application/shops/${shopId}/receipts?limit=${BATCH}&offset=${offset}&was_paid=true${dateQS}`,
      token, apiKey
    );
    if (!resp.ok) break;
    const data  = await resp.json();
    const batch = data.results || [];
    orders = orders.concat(batch);
    if (batch.length < BATCH) break;
    offset += BATCH;
    await sleep(500); // 500ms between batches avoids Worker rate limits
  }
  return orders;
}

/**
 * Fetch line items + payment for one receipt.
 * A 404 on payments is normal — the order was paid outside Etsy Payments.
 * With { strict: true } a failed transactions request throws instead of
 * returning an empty list.
 */
export async function fetchReceiptDetail(shopId, rid, token, apiKey, { strict = false } = {}) {
  const txResp = await etsyFetch(`/application/shops/${shopId}/receipts/${rid}/transactions`, token, apiKey);
  if (!txResp.ok && strict) {
    const errBody = await txResp.json().catch(() => ({}));
    throw new Error(`${txResp.status}: ${errBody.error || txResp.statusText}`);
  }
  const txData = txResp.ok ? await txResp.json() : null;

  let payment = null;
  const payResp = await etsyFetch(`/application/shops/${shopId}/receipts/${rid}/payments`, token, apiKey);
  if (payResp.ok) {
    const payData = await payResp.json();
    const pays = payData.results || payData.payments || (Array.isArray(payData) ? payData : null);
    payment = pays?.[0] || null;
  } else if (payResp.status !== 404) {
    console.warn(`[fetchReceiptDetail] payments ${rid}: HTTP ${payResp.status}`);
  }

  return {
    transactions: txData?.results || txData?.transaction || [],
    payment,
  };
}

/**
 * Fetch ledger entries between floor and ceiling (unix seconds), walking
 * backwards in 30-day windows and paginating each. Deduplicated by entry_id.
 */
export async function fetchLedger(shopId, token, apiKey, floor, ceiling, maxWindows) {
  const windowSize  = 30 * 24 * 60 * 60;
  let entries     = [];
  let windowEnd   = ceiling;
  let windowCount = 0;

  while (windowEnd > floor && windowCount < maxWindows) {
    const windowStart = Math.max(windowEnd - windowSize, floor);
    let offset = 0;
    while (true) {
      const resp = await etsyFetch(
        `/application/shops/${shopId}/payment-account/ledger-entries?min_created=${windowStart}&max_created=${windowEnd}&limit=100&offset=${offset}`,
        token, apiKey
      );
      if (!resp.ok) break;
      const data = await resp.json();
      const batch = data.results || [];
      entries = entries.concat(batch);
      if (batch.length < 100) break;
      offset += 100;
      await sleep(200);
    }
    windowEnd = windowStart;
    windowCount++;
    await sleep(200);
  }

  const seen = new Set();
  return entries.filter(e => {
    if (seen.has(e.entry_id)) return false;
    seen.add(e.entry_id); return true;
  });
}
