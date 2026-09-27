// ─── DATA LOADING PIPELINE + DATE FILTER ───────────────────────────────────
import { ApiError, AuthError, etsyFetch, fetchLedger, fetchOrders, fetchPayment, fetchTransactions, isAbort } from './api.js';
import { renderOrderCharts } from './charts.js';
import { renderFinances, renderKPIs, renderTable } from './render.js';
import { session } from './session.js';
import { cacheCurrentRange, cachedRange, clearRangeData, lineItems, state } from './state.js';
import { clearError, setFetchStatus, showConnect, showDashboard, showError, showLoading, showSkeletons } from './ui.js';
import { dateStrToTs, daysAgoStr, setCurrency, todayStr, ytdStr } from './util.js';

const $ = id => document.getElementById(id);

const FINANCES_PLACEHOLDER =
  `<tr><td colspan="6" style="text-align:center;color:var(--muted2);font-family:'DM Mono',monospace;font-size:0.72rem;padding:2rem">Click "⚡ Load full details" to fetch ledger data.</td></tr>`;

const MAX_LOOKBACK = 365 * 24 * 60 * 60;

// Only one load runs at a time. Starting a new one aborts the previous run,
// so a stale run can never write old-range data into state.
let currentLoad = null;

function beginLoad() {
  currentLoad?.abort();
  currentLoad = new AbortController();
  return currentLoad.signal;
}

/** Stop any in-flight load (used on disconnect). */
export function cancelLoad() {
  currentLoad?.abort();
  currentLoad = null;
}

/** Common failure handling for background loads. Returns true if handled silently. */
function handleLoadError(e, what) {
  if (isAbort(e)) return true; // superseded by a newer load
  if (e instanceof AuthError) {
    cancelLoad();
    session.remove('token');
    showConnect();
    showError(e.message);
    return true;
  }
  setFetchStatus(`${what} failed`, true);
  showError(e instanceof ApiError ? e.message : `${what} failed: ${e.message}`); // ApiError already says what failed
  return false;
}

// ─── DASHBOARD LOAD ─────────────────────────────────────────────────────────
export async function loadDashboard() {
  if (!session.get('token')) { showConnect(); return; }

  // ── Step 1: fetch shop info (fast — just one call) ──────────────────────
  showLoading('Connecting to your shop…');
  let shopId, shopName;
  try {
    const userId = session.get('user_id');
    if (!userId) throw new Error('User ID not found — please reconnect.');
    const shopResp = await etsyFetch(`/application/users/${userId}/shops`);
    if (!shopResp.ok) {
      const errBody = await shopResp.json().catch(() => ({}));
      throw new ApiError(shopResp.status, `Shop fetch failed (${shopResp.status}): ${errBody.error_description || errBody.error || shopResp.statusText}`);
    }
    const shopData = await shopResp.json();
    const shop     = (shopData.results && shopData.results[0]) || shopData;
    shopId   = shop.shop_id;
    shopName = shop.shop_name || 'Your Shop';
    if (!shopId) throw new Error(`Shop ID missing. Raw: ${JSON.stringify(shopData).slice(0, 200)}`);
    session.set('shop_id',   shopId);
    session.set('shop_name', shopName);
    setCurrency(shop.currency_code);
  } catch(e) {
    showConnect();
    showError(`Could not connect: ${e.message}`);
    return;
  }

  // ── Step 2: show dashboard shell immediately ─────────────────────────────
  $('shop-name').textContent = shopName;
  $('shop-sub').textContent  = `Shop ID: ${shopId} · @${shopName.toLowerCase()}`;

  // Default date filter
  if (state.filterFrom === null && state.filterTo === null) {
    state.filterFrom = dateStrToTs(daysAgoStr(30), false);
    state.filterTo   = dateStrToTs(todayStr(),     true);
    $('filter-from').value = daysAgoStr(30);
    $('filter-to').value   = todayStr();
  }

  showDashboard();
  reload();
}

/** Enable the finance exports and mark details as loaded. */
function markDetailsLoaded() {
  state.detailsLoaded = true;
  const btn = $('load-details-btn');
  btn.textContent = '✓ Full details loaded';
  btn.disabled = true;
  for (const id of ['fin-export-csv', 'fin-export-json']) {
    $(id).disabled = false;
    $(id).title    = '';
  }
}

function renderAll() {
  renderKPIs();
  renderTable();
  renderOrderCharts();
  renderFinances();
}

/** Show orders, then full details, for the active date filter (from cache when fresh). */
async function reload() {
  const signal = beginLoad();
  clearRangeData();
  clearError();

  const btn = $('load-details-btn');
  btn.disabled = false;
  btn.textContent = '⚡ Load full details';
  $('fin-export-csv').disabled  = true;
  $('fin-export-json').disabled = true;
  $('finances-tbody').innerHTML = FINANCES_PLACEHOLDER;
  $('fee-chart-panel').style.display = 'none';

  const hit = cachedRange();
  if (hit) {
    state.allOrders     = hit.orders;
    state.ledgerEntries = hit.ledger;
    markDetailsLoaded();
    renderAll();
    setFetchStatus(`${hit.orders.length} orders (cached)`, true);
    return;
  }

  showSkeletons();

  // Phase A: orders
  try {
    const orders = await fetchOrders({ from: state.filterFrom, to: state.filterTo, signal });
    if (signal.aborted) return;
    state.allOrders = orders;
    renderKPIs();
    renderTable();
    renderOrderCharts();
    setFetchStatus(`${orders.length} orders loaded`, false);
  } catch(e) {
    if (!handleLoadError(e, 'Order fetch')) {
      $('orders-tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted2);font-family:'DM Mono',monospace;font-size:0.72rem;padding:2rem">Couldn't load orders — pick a period to retry.</td></tr>`;
      $('order-count').textContent = '—';
    }
    return;
  }

  // Phase B: full details (ledger, plus any missing line items) in background
  setFetchStatus('Loading financial details…');
  await loadAllDetails(true /* background */, signal);
}

// ─── LOAD FULL DETAILS ──────────────────────────────────────────────────────
/**
 * Fetch line items for receipts that came without them (normally none —
 * getShopReceipts embeds them), then the ledger for the active range.
 * Payments are not fetched here; see ensurePayments().
 * `background` hides the progress bar. `signal` ties it to the current load.
 */
export async function loadAllDetails(background = false, signal = currentLoad?.signal) {
  const btn   = $('load-details-btn');
  const prog  = $('details-progress');
  const fill  = $('progress-fill');
  const ptext = $('progress-text');

  try {
    if (!background) {
      btn.disabled = true;
      btn.textContent = 'Loading…';
      prog.style.display = 'flex';
    }

    const orders  = state.allOrders;
    const missing = orders.filter(o => !lineItems(o));
    let done = 0;

    // ── Phase 1: line items the receipts didn't include (0–80%) ──
    for (const o of missing) {
      try {
        const txs = await fetchTransactions(o.receipt_id, { signal });
        if (signal?.aborted) return;
        state.lineItems[o.receipt_id] = txs;
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        console.warn(`[loadAllDetails] ${e.message}`); // skip; row can retry on expand
      }
      done++;
      const pct = Math.round((done / missing.length) * 80);
      fill.style.width  = `${pct}%`;
      ptext.textContent = `${pct}% (${done}/${missing.length} orders)`;
    }

    // ── Phase 2: ledger in 30-day windows (80–100%) ──
    if (!background) { ptext.textContent = 'Fetching financial ledger…'; fill.style.width = '85%'; }
    else setFetchStatus('Fetching ledger…');

    // Respect the active date filter for the ledger too.
    // Without a lower bound, go back to the oldest order (max 1 year).
    const now         = Math.floor(Date.now() / 1000);
    const timestamps  = orders.map(o => o.create_timestamp).filter(t => t > 0);
    const oldestOrder = timestamps.length ? Math.min(...timestamps) : now - MAX_LOOKBACK;
    const floor   = Math.max(state.filterFrom ?? oldestOrder, now - MAX_LOOKBACK);
    const ceiling = state.filterTo ? Math.min(state.filterTo, now) : now;

    const entries = await fetchLedger(floor, ceiling, { signal });
    if (signal?.aborted) return;
    state.ledgerEntries = entries;
    markDetailsLoaded();
    cacheCurrentRange();

    if (!background) {
      fill.style.width = '100%';
      prog.style.display = 'none';
    }

    renderFinances();
    renderKPIs();
    renderOrderCharts(); // refresh top products now we have line items
    setFetchStatus('All data loaded ✓', true);

  } catch (err) {
    if (isAbort(err)) return;
    prog.style.display = 'none';
    btn.style.display  = '';   // surface the manual button so user can retry
    btn.disabled = false;
    btn.textContent = '⚡ Load full details';
    handleLoadError(err, 'Detail load');
  }
}

/**
 * Fetch the Etsy Payments record for every order that doesn't have one
 * cached yet (used by the order exports). onProgress(done, total).
 */
export async function ensurePayments(orders, onProgress = () => {}) {
  const missing = orders.filter(o => !(o.receipt_id in state.payments));
  let done = 0;
  for (const o of missing) {
    try {
      state.payments[o.receipt_id] = await fetchPayment(o.receipt_id);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      console.warn(`[ensurePayments] ${e.message}`);
    }
    onProgress(++done, missing.length);
  }
}

// ─── DATE FILTER ────────────────────────────────────────────────────────────
const PRESETS = {
  '7d':  () => [daysAgoStr(7),   todayStr()],
  '30d': () => [daysAgoStr(30),  todayStr()],
  '90d': () => [daysAgoStr(90),  todayStr()],
  'ytd': () => [ytdStr(),        todayStr()],
  '1y':  () => [daysAgoStr(365), todayStr()],
  'all': () => [null, null],
};

export function applyPreset(preset, el) {
  document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');

  const [from, to] = PRESETS[preset]();
  $('filter-from').value = from || '';
  $('filter-to').value   = to   || '';
  setDateFilter(from, to);
}

export function applyCustomRange() {
  const from = $('filter-from').value;
  const to   = $('filter-to').value;

  if (from && to && from > to) {
    showError('Date range error: "From" must be before "To".'); return;
  }

  document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
  setDateFilter(from || null, to || null);
}

function setDateFilter(fromStr, toStr) {
  state.filterFrom = dateStrToTs(fromStr, false);
  state.filterTo   = dateStrToTs(toStr,   true);

  // Update active badge
  const badge = $('filter-active-badge');
  if (state.filterFrom || state.filterTo) {
    $('filter-active-label').textContent = `${fromStr || ''} → ${toStr || 'now'}`.trim();
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }

  // Re-fetch within the new range whenever a shop is connected
  if (session.get('token') && session.get('shop_id')) reload();
}
