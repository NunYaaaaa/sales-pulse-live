// ─── SCREEN / STATUS HELPERS ───────────────────────────────────────────────
import { closeDrill } from './drill.js';
import { todayStr } from './util.js';

const $ = id => document.getElementById(id);

/** Show an error in the banner of whichever screen is visible. */
export function showError(msg) {
  const onDashboard = $('dashboard').style.display === 'block';
  const el = $(onDashboard ? 'dash-error' : 'error-banner');
  el.querySelector('.error-text').textContent = '⚠ ' + msg;
  el.style.display = onDashboard ? 'flex' : 'block';
}
export function clearError() {
  $('error-banner').style.display = 'none';
  $('dash-error').style.display   = 'none';
}
/**
 * Shrink a summary figure that's wider than its tile (a seven-figure total in
 * a narrow tile) until it fits; figures that already fit keep their size.
 */
function fitFigure(el) {
  el.style.fontSize = '';
  const room = el.clientWidth;
  if (!room || el.scrollWidth <= room) return; // hidden, or fits
  const size = parseFloat(getComputedStyle(el).fontSize);
  el.style.fontSize = `${Math.max(11, Math.floor(size * room / el.scrollWidth * 10) / 10)}px`;
}
export const fitFigures = (root = document) => root.querySelectorAll('.kpi-val').forEach(fitFigure);

/** Refit a figure whenever its text changes; the tab redraw refits them all after a resize or tab switch. */
export function watchFigures() {
  new MutationObserver(records => {
    const changed = new Set();
    for (const r of records) {
      const target = r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : r.target;
      const own = target?.closest?.('.kpi-val');
      if (own) changed.add(own);
      for (const n of r.addedNodes) {
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        if (n.matches('.kpi-val')) changed.add(n);
        n.querySelectorAll('.kpi-val').forEach(el => changed.add(el));
      }
    }
    changed.forEach(fitFigure);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
}

const BASE_TITLE = document.title;
/**
 * Name the open tab in the page title ("Orders · Sales Pulse Live") while the
 * dashboard shows, so a browser tab or a screen reader says where you are.
 */
export function syncTitle() {
  const tab = $('dashboard').style.display === 'block' && document.querySelector('.tab-btn.active');
  document.title = tab ? `${tab.textContent.trim()} · Sales Pulse Live` : BASE_TITLE;
}

export function showConnect() {
  closeDrill(); // a breakdown would stay on top of the connect screen
  $('dash-error').style.display      = 'none';
  $('connect-screen').style.display  = 'flex';
  $('loading-screen').style.display  = 'none';
  $('dashboard').style.display       = 'none';
  $('live-badge').style.display      = 'none';
  $('disconnect-btn').style.display  = 'none';
  syncTitle();
}
export function showLoading(msg) {
  $('loading-text').textContent      = msg || 'Loading…';
  $('connect-screen').style.display  = 'none';
  $('loading-screen').style.display  = 'flex';
  $('dashboard').style.display       = 'none';
}
export function showDashboard() {
  $('connect-screen').style.display  = 'none';
  $('loading-screen').style.display  = 'none';
  $('dashboard').style.display       = 'block';
  $('live-badge').style.display      = 'flex';
  $('disconnect-btn').style.display  = 'block';
  syncTitle();

  // Initialise date inputs to sensible defaults on first show
  if (!$('filter-to').value) $('filter-to').value = todayStr();
}

/** Update the inline status pill in the header */
export function setFetchStatus(msg, done = false) {
  const pill = $('fetch-status');
  const dot  = $('fetch-status-dot');
  const txt  = $('fetch-status-text');
  if (!pill) return; // dashboard not shown yet
  pill.classList.add('visible');
  dot.className  = 'fetch-status-dot' + (done ? ' done' : '');
  txt.textContent = msg;
  if (done) setTimeout(() => pill.classList.remove('visible'), 3000);
}

/** Show skeleton placeholders so the page looks alive before data arrives */
export function showSkeletons() {
  ['kpi-revenue','kpi-fees','kpi-net','kpi-orders','kpi-aov','fin-gross','fin-fees','fin-net'].forEach(id => {
    $(id).innerHTML = '<span class="skeleton skeleton-kpi-val"></span>';
  });
  $('kpi-fees-sub').innerHTML = '<span class="skeleton skeleton-kpi-sub"></span>';
  $('kpi-net-sub').innerHTML  = '<span class="skeleton skeleton-kpi-sub"></span>';
  $('fin-count').textContent  = '…';

  $('orders-tbody').innerHTML = Array(8).fill(0).map(() => `
    <tr style="border-bottom:1px solid var(--border)">
      <td colspan="7" style="padding:0.85rem 1.25rem">
        <span class="skeleton skeleton-row ${['med','short','med','','short','med',''][Math.floor(Math.random()*7)]}"></span>
      </td>
    </tr>`).join('');

  $('order-count').textContent = '…';
  setFetchStatus('Loading orders…', false);
}
