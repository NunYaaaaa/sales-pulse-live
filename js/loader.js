// ─── DATA LOADING PIPELINE + DATE FILTER ───────────────────────────────────
import { etsyFetch, fetchLedger, fetchOrders, fetchReceiptDetail } from './api.js';
import { renderOrderCharts } from './charts.js';
import { renderFinances, renderKPIs, renderTable } from './render.js';
import { creds, session } from './session.js';
import { clearData, state } from './state.js';
import { setFetchStatus, showConnect, showDashboard, showError, showLoading, showSkeletons } from './ui.js';
import { dateStrToTs, daysAgoStr, sleep, todayStr, ytdStr } from './util.js';

const $ = id => document.getElementById(id);

const FINANCES_PLACEHOLDER =
  `<tr><td colspan="6" style="text-align:center;color:var(--muted2);font-family:'DM Mono',monospace;font-size:0.72rem;padding:2rem">Click "⚡ Load full details" to fetch ledger data.</td></tr>`;

// ─── DASHBOARD LOAD ─────────────────────────────────────────────────────────
export async function loadDashboard() {
  const { token, apiKey } = creds();
  if (!token) { showConnect(); return; }

  // ── Step 1: fetch shop info (fast — just one call) ──────────────────────
  showLoading('Connecting to your shop…');
  let shopId, shopName;
  try {
    const userId = session.get('user_id');
    if (!userId) throw new Error('User ID not found — please reconnect.');
    const shopResp = await etsyFetch(`/application/users/${userId}/shops`, token, apiKey);
    if (!shopResp.ok) {
      const errBody = await shopResp.json().catch(() => ({}));
      throw new Error(`Shop fetch failed (${shopResp.status}): ${errBody.error_description || errBody.error || shopResp.statusText}`);
    }
    const shopData = await shopResp.json();
    const shop     = (shopData.results && shopData.results[0]) || shopData;
    shopId   = shop.shop_id;
    shopName = shop.shop_name || 'Your Shop';
    if (!shopId) throw new Error(`Shop ID missing. Raw: ${JSON.stringify(shopData).slice(0, 200)}`);
    session.set('shop_id',   shopId);
    session.set('shop_name', shopName);
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

  showSkeletons();
  showDashboard();

  // ── Step 3: load orders in background ───────────────────────────────────
  backgroundLoad(shopId, token, apiKey);
}

/** Fetch orders then auto-trigger full details — all in background */
async function backgroundLoad(shopId, token, apiKey) {
  // Phase A: orders
  try {
    setFetchStatus('Loading orders…');
    state.allOrders = await fetchOrders(shopId, token, apiKey, { from: state.filterFrom, to: state.filterTo });
    renderKPIs();
    state.currentPage = 1;
    renderTable();
    renderOrderCharts();
    setFetchStatus(`${state.allOrders.length} orders loaded`, false);
  } catch(e) {
    setFetchStatus('Order fetch failed', true);
    showError(`Orders failed: ${e.message}`);
    return;
  }

  // Phase B: auto-load full details (transactions + ledger) in background
  setFetchStatus('Loading financial details…');
  await loadAllDetails(true /* background */);
}

// ─── LOAD FULL DETAILS ──────────────────────────────────────────────────────
export async function loadAllDetails(background = false) {
  const { token, apiKey, shopId } = creds();
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

    const total = state.allOrders.length;
    let done = 0;

    // ── Phase 1: fetch transactions + payment per receipt (0–80%) ──
    for (const order of state.allOrders) {
      const rid = order.receipt_id;
      if (state.detailCache[rid]) { done++; continue; }

      state.detailCache[rid] = await fetchReceiptDetail(shopId, rid, token, apiKey);

      done++;
      const pct = total > 0 ? Math.round((done / total) * 80) : 80;
      fill.style.width  = `${pct}%`;
      ptext.textContent = `${pct}% (${done}/${total} orders)`;
      // 300 ms between receipts keeps us comfortably under Etsy's rate limit
      await sleep(300);
    }

    // ── Phase 2: fetch ledger in 30-day windows (80–100%) ──
    if (!background) { ptext.textContent = 'Fetching financial ledger…'; fill.style.width = '85%'; }
    else setFetchStatus('Fetching ledger…');

    const now          = Math.floor(Date.now() / 1000);
    const MAX_LOOKBACK = 365 * 24 * 60 * 60;

    // Respect the active date filter for ledger too.
    // If a filterFrom is set, use it; otherwise go back to the oldest order or 1 year.
    const timestamps    = state.allOrders.map(o => o.create_timestamp).filter(t => t && t > 0);
    const oldestOrder   = timestamps.length ? Math.min(...timestamps) : now - MAX_LOOKBACK;
    const ledgerFloor   = state.filterFrom
      ? Math.max(state.filterFrom, now - MAX_LOOKBACK)
      : Math.max(oldestOrder, now - MAX_LOOKBACK);
    const ledgerCeiling = state.filterTo ? Math.min(state.filterTo, now) : now;
    const maxWindows    = Math.ceil(MAX_LOOKBACK / (30 * 24 * 60 * 60)) + 1;

    state.ledgerEntries = await fetchLedger(shopId, token, apiKey, ledgerFloor, ledgerCeiling, maxWindows);
    state.detailsLoaded = true;

    if (!background) {
      fill.style.width = '100%';
      prog.style.display = 'none';
      btn.textContent = '✓ Full details loaded';
    }
    for (const id of ['fin-export-csv', 'fin-export-json']) {
      $(id).disabled = false;
      $(id).title    = '';
    }

    renderFinances();
    renderKPIs();
    renderOrderCharts(); // refresh top products now we have line items
    if (background) setFetchStatus('All data loaded ✓', true);

  } catch (err) {
    if (!background) {
      prog.style.display = 'none';
    } else {
      // Background failure — surface the manual button so user can retry
      btn.style.display = '';
      setFetchStatus('Detail load failed — retry manually', true);
    }
    btn.disabled = false;
    btn.textContent = '⚡ Load full details';
    showError('Detail load failed: ' + err.message);
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

  // If we already have data, re-fetch within the new range
  if (state.allOrders.length > 0 || state.detailsLoaded) {
    resetAndReload();
  }
}

async function resetAndReload() {
  clearData();

  const btn = $('load-details-btn');
  btn.disabled = false;
  btn.textContent = '⚡ Load full details';
  $('fin-export-csv').disabled  = true;
  $('fin-export-json').disabled = true;
  $('finances-tbody').innerHTML = FINANCES_PLACEHOLDER;

  const { token, apiKey, shopId } = creds();
  if (!token || !shopId) return;

  showSkeletons();
  try {
    state.allOrders = await fetchOrders(shopId, token, apiKey, { from: state.filterFrom, to: state.filterTo });
    renderKPIs();
    renderTable();
    renderOrderCharts();
    setFetchStatus(`${state.allOrders.length} orders loaded`, false);
    setFetchStatus('Loading financial details…');
    await loadAllDetails(true);
  } catch(e) {
    setFetchStatus('Reload failed', true);
    showError('Reload failed: ' + e.message);
  }
}
