// ─── TABS: what each tab draws, switching, and section navigation ──────────
import { renderDowChart, renderRevChart, renderTopProducts } from './charts.js';
import { refreshDrill } from './drill.js';
import { renderCustomersPanels, renderFinancesPanels, renderOrdersPanels, renderOverviewPanels, renderProductsPanels } from './insights-view.js';
import { renderFinances } from './render.js';
import { state } from './state.js';
import { fitFigures, syncTitle } from './ui.js';

const $ = id => document.getElementById(id);

/**
 * Each tab's chart and Insights panels, and the extra data it needs
 * (fetched by ensureTabData in loader.js). Tables and the fee donut don't
 * depend on their size, so loader.js renders those whether or not they show.
 */
export const TABS = {
  overview:  { render: () => { renderRevChart(); renderTopProducts(); renderOverviewPanels(); } },
  orders:    { render: () => { renderDowChart(); renderOrdersPanels(); } },
  products:  { render: renderProductsPanels,  needs: ['listings'] },
  customers: { render: renderCustomersPanels, needs: ['listings', 'reviews'] }, // listings give reviews their titles
  finances:  { render: renderFinancesPanels },
};

let frameQueued = false;

/**
 * Redraw the showing tab's panels on the next frame. Only that tab is drawn:
 * charts size themselves from clientWidth, which is 0 while hidden.
 */
export function renderActiveTab() {
  if ($('dashboard').style.display !== 'block' || frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    TABS[state.activeTab].render();
    fitFigures(); // tiles that were hidden or resized
    refreshDrill(); // an open breakdown shows the data that just arrived
  });
}

/** Show a tab, then scroll to its top or to the section jumpId. */
export function switchTab(name, jumpId) {
  if (!TABS[name]) return;
  document.querySelectorAll('.tab-btn').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else    b.removeAttribute('aria-current');
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // keep it in view in the phone tab strip
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  state.activeTab = name;
  syncTitle();
  togglePeriod(false);

  if (name === 'finances' && state.detailsLoaded) renderFinances();
  renderActiveTab();
  watchSections();
  // After the render frame, so the target sits where it will stay
  requestAnimationFrame(() => jumpId ? jumpTo(jumpId) : window.scrollTo({ top: 0 }));
}

/** Scroll a section of the showing tab into view (CSS scroll-margin clears the sticky bars). */
export function jumpTo(id) {
  $(id)?.scrollIntoView({ block: 'start' });
}

/** Open or close the period picker (a dropdown on phones; always open in the desktop rail). */
export function togglePeriod(force) {
  const bar  = $('rail-sticky');
  const open = bar.classList.toggle('period-open', force);
  bar.querySelector('.period-toggle').setAttribute('aria-expanded', String(open));
}

// ─── SCROLL-SPY ─────────────────────────────────────────────────────────────
// Highlights the rail link of the section at the top of the screen.
let spy = null;

function watchSections() {
  spy?.disconnect();
  const sections = [...document.querySelectorAll(`#tab-${state.activeTab} [data-section]`)];
  const links    = document.querySelectorAll('.rail-sec');
  links.forEach(l => l.classList.remove('active'));
  if (!sections.length) return;

  const inBand = new Set();
  spy = new IntersectionObserver(entries => {
    for (const e of entries) e.isIntersecting ? inBand.add(e.target) : inBand.delete(e.target);
    const current = sections.find(s => inBand.has(s));
    if (current) links.forEach(l => l.classList.toggle('active', l.dataset.target === current.id));
  }, { rootMargin: '-120px 0px -55% 0px' }); // a band from under the sticky bars to just below mid-screen
  sections.forEach(s => spy.observe(s));
}
