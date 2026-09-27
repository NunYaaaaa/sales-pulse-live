// ─── HTTP / ETSY API ───────────────────────────────────────────────────────
import { ETSY_API_BASE, ETSY_TOKEN_URL } from './config.js';
import { session } from './session.js';
import { setFetchStatus } from './ui.js';
import { sleep } from './util.js';

/** A non-2xx response from the Etsy API. */
export class ApiError extends Error {
  constructor(status, message) { super(message); this.name = 'ApiError'; this.status = status; }
}
/** The session can't be used any more (token expired and refresh failed). */
export class AuthError extends Error {
  constructor(message) { super(message); this.name = 'AuthError'; }
}

export const isAbort = e => e?.name === 'AbortError';

async function apiError(resp, what) {
  const body = await resp.json().catch(() => ({}));
  return new ApiError(resp.status, `${what} failed (${resp.status}): ${body.error_description || body.error || resp.statusText}`);
}

// ── Token refresh ────────────────────────────────────────────────────────────
// Etsy access tokens last 1 hour. Concurrent 401s share one refresh request.
let refreshing = null;

export function refreshAccessToken() {
  refreshing ??= (async () => {
    const refreshToken = session.get('refresh_token');
    if (!refreshToken) throw new AuthError('Your Etsy session expired — please reconnect.');
    const resp = await fetch(ETSY_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: session.get('api_key'), refresh_token: refreshToken }).toString(),
    });
    const data = resp.ok ? await resp.json().catch(() => ({})) : {};
    if (!data.access_token) throw new AuthError('Your Etsy session expired — please reconnect.');
    session.set('token', data.access_token);
    if (data.refresh_token) session.set('refresh_token', data.refresh_token);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * GET an Etsy API path through the Worker.
 * - 429: retries with Retry-After / X-RateLimit-Reset / exponential backoff.
 * - 401: refreshes the access token once and retries; throws AuthError if that fails.
 * Other responses are returned as-is for the caller to handle.
 */
export async function etsyFetch(path, { signal, maxRetries = 8 } = {}) {
  const url = `${ETSY_API_BASE}${path}`;
  const headers = () => ({
    'Authorization': `Bearer ${session.get('token')}`,
    'x-api-key':     `${session.get('api_key')}:${session.get('shared_secret') || ''}`,
  });

  let attempt   = 0;
  let delay     = 5000; // ms — Workers need more breathing room than raw Etsy API
  let refreshed = false;

  while (true) {
    const resp = await fetch(url, { headers: headers(), signal });

    if (resp.status === 401 && !refreshed) {
      refreshed = true;
      await refreshAccessToken();
      continue;
    }
    if (resp.status === 401) throw new AuthError('Etsy rejected the access token — please reconnect.');
    if (resp.status !== 429) return resp;

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
    await sleep(waitMs, signal);

    // Exponential backoff for next attempt, capped at 60 s
    delay = Math.min(delay * 2, 60_000);
  }
}

/** All paid receipts created within [from, to] (unix seconds, either may be null). */
export async function fetchOrders({ from = null, to = null, signal } = {}) {
  const shopId = session.get('shop_id');
  const BATCH  = 100;
  let orders = [], offset = 0;

  // Build date filter query params (Etsy uses unix timestamps)
  const dateParams = [];
  if (from) dateParams.push(`min_created=${from}`);
  if (to)   dateParams.push(`max_created=${to}`);
  const dateQS = dateParams.length ? '&' + dateParams.join('&') : '';

  while (true) {
    const resp = await etsyFetch(
      `/application/shops/${shopId}/receipts?limit=${BATCH}&offset=${offset}&was_paid=true${dateQS}`,
      { signal }
    );
    if (!resp.ok) throw await apiError(resp, 'Order fetch');
    const batch = (await resp.json()).results || [];
    orders = orders.concat(batch);
    if (batch.length < BATCH) break;
    offset += BATCH;
    await sleep(500, signal); // 500ms between batches avoids Worker rate limits
  }
  return orders;
}

/**
 * Fetch line items + payment for one receipt.
 * A 404 on payments is normal — the order was paid outside Etsy Payments.
 */
export async function fetchReceiptDetail(rid, { signal } = {}) {
  const shopId = session.get('shop_id');
  const txResp = await etsyFetch(`/application/shops/${shopId}/receipts/${rid}/transactions`, { signal });
  if (!txResp.ok) throw await apiError(txResp, `Line items for #${rid}`);
  const txData = await txResp.json();

  let payment = null;
  const payResp = await etsyFetch(`/application/shops/${shopId}/receipts/${rid}/payments`, { signal });
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
export async function fetchLedger(floor, ceiling, { signal } = {}) {
  const shopId     = session.get('shop_id');
  const windowSize = 30 * 24 * 60 * 60;
  let entries   = [];
  let windowEnd = ceiling;

  while (windowEnd > floor) {
    const windowStart = Math.max(windowEnd - windowSize, floor);
    let offset = 0;
    while (true) {
      const resp = await etsyFetch(
        `/application/shops/${shopId}/payment-account/ledger-entries?min_created=${windowStart}&max_created=${windowEnd}&limit=100&offset=${offset}`,
        { signal }
      );
      if (!resp.ok) throw await apiError(resp, 'Ledger fetch');
      const batch = (await resp.json()).results || [];
      entries = entries.concat(batch);
      if (batch.length < 100) break;
      offset += 100;
      await sleep(200, signal);
    }
    windowEnd = windowStart;
    await sleep(200, signal);
  }

  const seen = new Set();
  return entries.filter(e => {
    if (seen.has(e.entry_id)) return false;
    seen.add(e.entry_id); return true;
  });
}
