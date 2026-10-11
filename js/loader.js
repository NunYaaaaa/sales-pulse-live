// ─── DATA LOADING PIPELINE + DATE FILTER ───────────────────────────────────
import { ApiError, apiError, AuthError, etsyFetch, fetchLedger, fetchListings, fetchOrders, fetchPayment, fetchReviews, fetchTransactions, isAbort } from './api.js';
import { renderFinances, renderKPIs, renderTable } from './render.js';
import { session } from './session.js';
import { cacheCurrentRange, cachedRange, cachedReviews, cacheReviews, clearRangeData, lineItems, state } from './state.js';
import { renderActiveTab, TABS, togglePeriod } from './tabs.js';
import { clearError, setFetchStatus, showConnect, showDashboard, showError, showLoading, showSkeletons } from './ui.js';
import { dateStrToTs, daysAgoStr, fmtPeriod, plural, setCurrency, todayStr, ytdStr } from './util.js';

const $ = id => document.getElementById(id);

const ledgerPlaceholder = text =>
  `<tr><td colspan="6" style="text-align:center;color:var(--muted2);font-family:'DM Mono',monospace;font-size:0.72rem;padding:2rem">${text}</td></tr>`;

const LISTINGS_TTL_MS = 10 * 60 * 1000;

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

/**
 * Common failure handling for background loads. `what` names the data in
 * plain words ("your orders"); `retry` says how to try again. Returns true
 * if handled silently.
 */
function handleLoadError(e, what, retry) {
  if (isAbort(e)) return true; // superseded by a newer load
  if (e instanceof AuthError) {
    cancelLoad();
    session.remove('token');
    showConnect();
    showError(e.message);
    return true;
  }
  setFetchStatus(`Couldn't load ${what}`, true);
  // fetch throws a TypeError when it can't reach Etsy at all; Etsy's own errors are ApiErrors
  const why = e instanceof TypeError ? "Couldn't reach Etsy. Check your connection." : `Couldn't load ${what}.`;
  showError(`${why} ${retry} (${e.message})`);
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
    if (!userId) throw new Error("Etsy sign-in didn't finish. Connect again.");
    const shopResp = await etsyFetch(`/application/users/${userId}/shops`);
    if (!shopResp.ok) throw await apiError(shopResp);
    const shopData = await shopResp.json();
    const shop     = (shopData.results && shopData.results[0]) || shopData;
    shopId   = shop.shop_id;
    shopName = shop.shop_name || 'Your Shop';
    if (!shopId) {
      console.warn('[loadDashboard] no shop in the reply:', shopData);
      throw new Error("Etsy didn't return a shop for this account. Sign in with the Etsy account that owns the shop, then connect again.");
    }
    session.set('shop_id',   shopId);
    session.set('shop_name', shopName);
    setCurrency(shop.currency_code);
    state.shop = shop;
  } catch(e) {
    showConnect();
    showError(e instanceof ApiError
      ? `Couldn't load your Etsy shop. Check that you signed in with the account that owns the shop, then connect again. (${e.message})`
      : e instanceof TypeError ? `Couldn't reach Etsy. Check your connection, then connect again. (${e.message})`
      : e.message);
    return;
  }

  // ── Step 2: show dashboard shell immediately ─────────────────────────────
  $('shop-name').textContent = shopName;
  $('shop-sub').textContent  = `Shop ID ${shopId}`;

  // Default date filter
  if (state.filterFrom === null && state.filterTo === null) {
    state.filterFrom = dateStrToTs(daysAgoStr(29), false);
    state.filterTo   = dateStrToTs(todayStr(),     true);
    $('filter-from').value = daysAgoStr(29);
    $('filter-to').value   = todayStr();
  }

  showDashboard();
  reload();
}

/** Enable the finance exports and mark details as loaded. */
function markDetailsLoaded() {
  state.detailsLoaded = true;
  state.ledgerFailed  = false;
  $('load-details-btn').style.display = 'none'; // it's only there to retry a failed ledger
  for (const id of ['fin-export-csv', 'fin-export-json']) {
    $(id).disabled = false;
    $(id).title    = '';
  }
}

function renderAll() {
  renderKPIs();
  renderTable();
  renderFinances();
  renderActiveTab();
}

/** Show orders, then full details, for the active date filter (from cache when fresh). */
async function reload() {
  const signal = beginLoad();
  clearRangeData();
  clearError();

  $('load-details-btn').style.display = 'none';
  $('fin-export-csv').disabled  = true;
  $('fin-export-json').disabled = true;
  $('finances-tbody').innerHTML = ledgerPlaceholder('Loading the payment ledger…');
  $('ledger-pagination').innerHTML = '';
  $('fee-chart-panel').style.display = 'none';

  const hit = cachedRange();
  if (hit) {
    state.allOrders     = hit.orders;
    state.ledgerEntries = hit.ledger;
    state.ledgerSpan    = hit.ledgerSpan;
    markDetailsLoaded();
    renderAll();
    setFetchStatus(`${plural(hit.orders.length, 'order')} · loaded earlier`, true);
    ensureTabData();
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
    renderActiveTab();
    setFetchStatus(`${plural(orders.length, 'order')} loaded`, false);
  } catch(e) {
    if (!handleLoadError(e, 'your orders', 'Pick a period to try again.')) {
      $('orders-tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted2);font-family:'DM Mono',monospace;font-size:0.72rem;padding:2rem">Couldn't load your orders. Pick a period to try again.</td></tr>`;
      $('order-count').textContent = '—';
    }
    return;
  }

  // Phase B: full details (ledger, plus any missing line items) in background
  setFetchStatus('Loading the payment ledger…');
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
    state.ledgerFailed = false;
    if (!background) {
      btn.disabled = true;
      btn.textContent = 'Loading…';
      prog.style.display = 'flex';
      $('finances-tbody').innerHTML = ledgerPlaceholder('Loading the payment ledger…');
      renderActiveTab(); // panels go back from "didn't load" to "loading"
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
        console.warn(`[loadAllDetails] line items for #${o.receipt_id}: ${e.message}`); // skip; row can retry on expand
      }
      done++;
      const pct = Math.round((done / missing.length) * 80);
      fill.style.width  = `${pct}%`;
      ptext.textContent = `${pct}% (${done} of ${plural(missing.length, 'order')})`;
    }

    // ── Phase 2: ledger in 30-day windows (80–100%) ──
    if (!background) { ptext.textContent = 'Loading the payment ledger…'; fill.style.width = '85%'; }
    else setFetchStatus('Loading the payment ledger…');

    // Same period as the orders, so gross, fees and net cover the same days.
    // Without a lower bound, go back to the oldest order (Etsy keeps the
    // whole ledger; it only limits each request to 31 days).
    const now         = Math.floor(Date.now() / 1000);
    const timestamps  = orders.map(o => o.create_timestamp).filter(t => t > 0);
    const oldestOrder = timestamps.length ? Math.min(...timestamps) : now - 30 * 86400;
    const floor   = state.filterFrom ?? oldestOrder;
    const ceiling = state.filterTo ? Math.min(state.filterTo, now) : now;

    const entries = await fetchLedger(floor, ceiling, { signal });
    if (signal?.aborted) return;
    state.ledgerEntries = entries;
    state.ledgerSpan    = { from: floor, to: ceiling };
    markDetailsLoaded();
    cacheCurrentRange();

    if (!background) {
      fill.style.width = '100%';
      prog.style.display = 'none';
    }

    renderFinances();
    renderKPIs();
    renderActiveTab(); // refreshes top products too, now every order has line items
    setFetchStatus('Orders and ledger loaded ✓', true);
    ensureTabData();

  } catch (err) {
    if (isAbort(err)) return;
    prog.style.display = 'none';
    btn.style.display  = '';   // surface the manual button so user can retry
    btn.disabled = false;
    btn.textContent = 'Retry ledger';
    if (handleLoadError(err, 'the payment ledger', 'Use “Retry ledger” to try again.')) return;
    // The ledger-based numbers stop loading, not keep shimmering, and the panels say why
    state.ledgerFailed = true;
    renderKPIs();
    for (const id of ['kpi-fees', 'kpi-net', 'fin-gross', 'fin-fees', 'fin-net']) $(id).textContent = '—';
    $('kpi-fees-sub').textContent = $('kpi-net-sub').textContent = "ledger didn't load";
    $('fin-count').textContent = '—';
    $('finances-tbody').innerHTML = ledgerPlaceholder("Couldn't load the payment ledger, so fees and Net after Fees aren't shown. Use “Retry ledger” to try again.");
    renderActiveTab();
  }
}

// ─── TAB DATA ───────────────────────────────────────────────────────────────
// Listings and reviews are only used by the Products and Customers tabs (see
// TABS[tab].needs), so each is fetched the first time a tab that needs it is
// open after a range has fully loaded. Listings don't depend on the range and
// are reused for 10 minutes; reviews are cached per period start like the
// range data.
const ranFor = { listings: null, reviews: null }; // the load signal each fetch last ran (or is running) for

/**
 * Run one tab-data fetch, tracking its progress or error in state[statusKey].
 * run(progress) does the fetching and stores the result. Returns false on failure.
 */
async function tabDataStep(statusKey, signal, run) {
  const progress = (done, total) => {
    state[statusKey] = { loading: true, done, total };
    renderActiveTab();
  };
  try {
    progress(0, null);
    await run(progress);
    if (signal.aborted) return true;
    state[statusKey] = null;
  } catch (e) {
    if (isAbort(e)) return true;
    if (e instanceof AuthError) { handleLoadError(e, 'your listings and reviews', ''); return true; }
    state[statusKey] = { error: e.message };
    return false;
  } finally {
    if (!signal.aborted) renderActiveTab();
  }
  return true;
}

/** Fetch the extra data the showing tab needs, once the range has loaded. */
export async function ensureTabData() {
  const signal = currentLoad?.signal;
  const needs  = TABS[state.activeTab].needs || [];
  if (!needs.length || !signal || signal.aborted || !state.detailsLoaded) return;

  if (needs.includes('listings') && ranFor.listings !== signal) {
    ranFor.listings = signal;
    if (!state.listings || Date.now() - state.listingsAt > LISTINGS_TTL_MS) {
      const ok = await tabDataStep('listingsStatus', signal, async progress => {
        const active  = await fetchListings('active',   { signal, onPage: progress });
        const soldOut = await fetchListings('sold_out', { signal });
        if (signal.aborted) return;
        state.listings   = [...active, ...soldOut];
        state.listingsAt = Date.now();
      });
      if (!ok) ranFor.listings = null; // let the retry button run it again
    }
    if (signal.aborted) return;
  }

  if (needs.includes('reviews') && ranFor.reviews !== signal) {
    ranFor.reviews = signal;
    if (!state.reviews) {
      state.reviews = cachedReviews();
      if (!state.reviews) {
        // Up to now, so reviews of this period's orders count even if left later.
        const from = state.filterFrom ?? 0;
        const ok = await tabDataStep('reviewsStatus', signal, async progress => {
          const reviews = await fetchReviews(from, { signal, onPage: progress });
          if (signal.aborted) return;
          state.reviews = reviews;
          cacheReviews(reviews);
        });
        if (!ok) ranFor.reviews = null;
      } else {
        renderActiveTab();
      }
    }
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
      console.warn(`[ensurePayments] payment for #${o.receipt_id}: ${e.message}`);
    }
    onProgress(++done, missing.length);
  }
}

// ─── DATE FILTER ────────────────────────────────────────────────────────────
// "N days" is today plus the N - 1 days before it
const PRESETS = {
  '7d':  () => [daysAgoStr(6),   todayStr()],
  '30d': () => [daysAgoStr(29),  todayStr()],
  '90d': () => [daysAgoStr(89),  todayStr()],
  'ytd': () => [ytdStr(),        todayStr()],
  '1y':  () => [daysAgoStr(364), todayStr()],
  'all': () => [null, null],
};

export function applyPreset(preset, el) {
  document.querySelectorAll('.preset-chip').forEach(c => { c.classList.toggle('active', c === el); c.setAttribute('aria-pressed', String(c === el)); });

  const [from, to] = PRESETS[preset]();
  $('filter-from').value = from || '';
  $('filter-to').value   = to   || '';
  setPeriodLabel(el.textContent.trim());
  setDateFilter(from, to);
}

/** Name the period on the phone's period button and close the picker. */
function setPeriodLabel(text) {
  $('period-label').textContent = text;
  togglePeriod(false);
}

export function applyCustomRange() {
  const from = $('filter-from').value;
  const to   = $('filter-to').value;

  if (from && to && from > to) {
    showError('The start date must be on or before the end date.'); return;
  }

  document.querySelectorAll('.preset-chip').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
  setPeriodLabel(fmtPeriod(dateStrToTs(from), dateStrToTs(to), { compact: true }));
  setDateFilter(from || null, to || null);
}

function setDateFilter(fromStr, toStr) {
  state.filterFrom = dateStrToTs(fromStr, false);
  state.filterTo   = dateStrToTs(toStr,   true);

  // Update active badge
  const badge = $('filter-active-badge');
  if (state.filterFrom || state.filterTo) {
    $('filter-active-label').textContent = fmtPeriod(dateStrToTs(fromStr), dateStrToTs(toStr));
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }

  // Re-fetch within the new range whenever a shop is connected
  if (session.get('token') && session.get('shop_id')) reload();
}
