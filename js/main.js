// ─── ENTRY POINT: event wiring + boot ──────────────────────────────────────
import { handleCallback, startOAuth } from './auth.js';
import { highlightFee, renderOrderCharts, setChartMode } from './charts.js';
import { exportCSV, exportFinancesCSV, exportFinancesJSON, exportJSON } from './export.js';
import { renderInsights, setInsightMode } from './insights-view.js';
import { applyCustomRange, applyPreset, cancelLoad, ensureInsightsData, loadAllDetails, loadDashboard } from './loader.js';
import { goPage, switchTab } from './render.js';
import { session } from './session.js';
import { clearData, state } from './state.js';
import { clearError, showConnect, showError } from './ui.js';
import { setCurrency } from './util.js';

const $ = id => document.getElementById(id);

function disconnect() {
  cancelLoad();
  session.clear();
  clearData();
  setCurrency('USD');
  state.filterFrom = null; state.filterTo = null;
  // Reset filter bar UI back to 30d default
  document.querySelectorAll('.preset-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.preset === '30d');
  });
  $('filter-from').value = '';
  $('filter-to').value   = '';
  $('filter-active-badge').classList.remove('visible');
  $('fetch-status').classList.remove('visible');
  $('load-details-btn').style.display = 'none';
  showConnect();
  clearError();
}

// Click handlers keyed by data-action. `el` is the element carrying the attribute.
const ACTIONS = {
  'connect':         () => startOAuth(),
  'disconnect':      () => disconnect(),
  'load-details':    () => loadAllDetails(),
  'export-csv':      el => exportCSV(el),
  'export-json':     el => exportJSON(el),
  'export-fin-csv':  () => exportFinancesCSV(),
  'export-fin-json': () => exportFinancesJSON(),
  'preset':          el => applyPreset(el.dataset.preset, el),
  'clear-filter':    () => applyPreset('all', document.querySelector('.preset-chip[data-preset="all"]')),
  'apply-range':     () => applyCustomRange(),
  'tab':             el => { switchTab(el.dataset.tab, el); ensureInsightsData(); },
  'chart-mode':      el => setChartMode(el.dataset.chart, el.dataset.mode, el),
  'insight-mode':    el => setInsightMode(el.dataset.key, el.dataset.mode, el),
  'insights-retry':  () => ensureInsightsData(),
  'page':            el => goPage(parseInt(el.dataset.page, 10)),
  'dismiss-error':   () => clearError(),
};

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  ACTIONS[el.dataset.action]?.(el);
});

// Fee chart cross-highlighting (donut segments + bar rows share data-idx)
for (const id of ['fee-donut-svg', 'fee-bars-wrap']) {
  const root = $(id);
  root.addEventListener('mouseover', ev => {
    const el = ev.target.closest('[data-idx]');
    if (el) highlightFee(parseInt(el.dataset.idx, 10));
  });
  root.addEventListener('mouseleave', () => highlightFee(null));
}

// Charts size themselves from clientWidth, so redraw after resizing settles
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if ($('dashboard').style.display !== 'block') return;
    renderOrderCharts();
    renderInsights(); // no-op unless the Insights tab is showing
  }, 150);
});

// ─── BOOT ──────────────────────────────────────────────────────────────────
(async () => {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  const state  = params.get('state');
  const error  = params.get('error');

  if (error) { history.replaceState({}, '', window.location.pathname); showConnect(); showError(`Etsy declined the request: ${params.get('error_description') || error}`); return; }
  if (code && state) { await handleCallback(code, state, loadDashboard); return; }

  if (session.get('token')) { await loadDashboard(); return; }

  const saved       = session.get('api_key');
  const savedSecret = session.get('shared_secret');
  const savedUri    = session.get('redirect_uri');
  if (saved)       $('api-key-input').value       = saved;
  if (savedSecret) $('shared-secret-input').value = savedSecret;
  if (savedUri)    $('redirect-uri-input').value  = savedUri;

  showConnect();
})();
