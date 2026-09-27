// ─── SCREEN / STATUS HELPERS ───────────────────────────────────────────────
import { todayStr } from './util.js';

const $ = id => document.getElementById(id);

export function showError(msg) {
  const el = $('error-banner');
  el.style.display = 'block'; el.textContent = '⚠ ' + msg;
}
export function showConnect() {
  $('connect-screen').style.display  = 'flex';
  $('loading-screen').style.display  = 'none';
  $('dashboard').style.display       = 'none';
  $('date-filter-bar').style.display = 'none';
  $('live-badge').style.display      = 'none';
  $('disconnect-btn').style.display  = 'none';
}
export function showLoading(msg) {
  $('loading-text').textContent      = msg || 'Loading…';
  $('connect-screen').style.display  = 'none';
  $('loading-screen').style.display  = 'flex';
  $('dashboard').style.display       = 'none';
  $('date-filter-bar').style.display = 'none';
}
export function showDashboard() {
  $('connect-screen').style.display  = 'none';
  $('loading-screen').style.display  = 'none';
  $('dashboard').style.display       = 'block';
  $('date-filter-bar').style.display = 'flex';
  $('live-badge').style.display      = 'flex';
  $('disconnect-btn').style.display  = 'block';

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
  ['kpi-revenue','kpi-fees','kpi-net','kpi-orders','kpi-aov'].forEach(id => {
    $(id).innerHTML = '<span class="skeleton skeleton-kpi-val"></span>';
  });
  $('kpi-fees-sub').innerHTML = '<span class="skeleton skeleton-kpi-sub"></span>';
  $('kpi-net-sub').innerHTML  = '<span class="skeleton skeleton-kpi-sub"></span>';

  $('orders-tbody').innerHTML = Array(8).fill(0).map(() => `
    <tr style="border-bottom:1px solid var(--border)">
      <td colspan="7" style="padding:0.85rem 1.25rem">
        <span class="skeleton skeleton-row ${['med','short','med','','short','med',''][Math.floor(Math.random()*7)]}"></span>
      </td>
    </tr>`).join('');

  $('order-count').textContent = '…';
  setFetchStatus('Loading orders…', false);
}
