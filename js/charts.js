// ─── CHARTS (pure SVG, no libraries) ───────────────────────────────────────
import { FEE_GROUPS, FEE_OTHER_COLOR, PALETTE } from './config.js';
import { categoriseEntry, ledgerType } from './finance.js';
import { lineItems, state } from './state.js';
import { escHtml, fmtMoney, localDateKey, money } from './util.js';

const $ = id => document.getElementById(id);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Group orders by calendar period.
 * Returns array of { label, ts (unix), revenue, count } sorted by ts.
 * bucketSize: 'day' | 'week' | 'month'
 */
export function bucketOrders(orders, bucketSize) {
  const map = {};
  for (const o of orders) {
    const d    = new Date(o.create_timestamp * 1000);
    let key, label, ts;
    // All keys use the local calendar, matching the date filter
    let start;
    if (bucketSize === 'day') {
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      label = start.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    } else if (bucketSize === 'week') {
      // ISO week start (Monday)
      const day = d.getDay();
      start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (day === 0 ? -6 : 1 - day));
      label = start.toLocaleDateString('en-US', { month:'short', day:'numeric' });
    } else {
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      label = start.toLocaleDateString('en-US', { month:'short', year:'numeric' });
    }
    key = localDateKey(start);
    ts  = Math.floor(start.getTime() / 1000);
    if (!map[key]) map[key] = { label, ts, revenue:0, count:0 };
    map[key].revenue += money(o.grandtotal);
    map[key].count++;
  }
  return Object.values(map).sort((a, b) => a.ts - b.ts);
}

/** Pick a bucket size that gives 8–40 data points */
function autoBucket(orders) {
  if (!orders.length) return 'day';
  const ts = orders.map(o => o.create_timestamp);
  const spanDays = (Math.max(...ts) - Math.min(...ts)) / 86400;
  if (spanDays <= 35)  return 'day';
  if (spanDays <= 180) return 'week';
  return 'month';
}

/** Draw a smooth line + area chart into an SVG element */
function drawLineChart(svgEl, tooltipEl, data, valueKey, fmtFn, color) {
  const W = svgEl.clientWidth || 400;
  const H = 140;
  const PAD = { top:12, right:12, bottom:28, left:8 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top  - PAD.bottom;

  if (!data.length) { svgEl.innerHTML = ''; return; }

  const vals = data.map(d => d[valueKey]);
  const vMin = 0;
  const vMax = Math.max(...vals) * 1.12 || 1;
  const xStep = data.length > 1 ? iW / (data.length - 1) : iW;

  const xOf = i  => PAD.left + i * xStep;
  const yOf = v  => PAD.top + iH - ((v - vMin) / (vMax - vMin)) * iH;

  // Smooth path via cubic bezier
  const points = data.map((d, i) => [xOf(i), yOf(d[valueKey])]);
  let linePath = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const [x0,y0] = points[i-1], [x1,y1] = points[i];
    const cpX = (x0 + x1) / 2;
    linePath += ` C ${cpX.toFixed(1)} ${y0.toFixed(1)}, ${cpX.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  const areaPath = linePath
    + ` L ${points[points.length-1][0].toFixed(1)} ${(PAD.top+iH).toFixed(1)}`
    + ` L ${points[0][0].toFixed(1)} ${(PAD.top+iH).toFixed(1)} Z`;

  // X-axis labels — show ~5 evenly spaced
  const labelStep = Math.max(1, Math.floor(data.length / 5));
  const xLabels = data.map((d, i) => {
    if (i % labelStep !== 0 && i !== data.length - 1) return '';
    return `<text x="${xOf(i).toFixed(1)}" y="${H - 4}" text-anchor="middle"
      font-family="monospace" font-size="8" fill="var(--muted2)">${d.label}</text>`;
  }).join('');

  const uid = 'g' + Math.random().toString(36).slice(2,7);

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.innerHTML = `
    <defs>
      <linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#${uid})"/>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${xLabels}
    ${points.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5"
      fill="${color}" stroke="var(--offwhite)" stroke-width="1.5"
      class="chart-dot" data-i="${i}" style="cursor:pointer"/>`).join('')}
  `;

  svgEl.querySelectorAll('.chart-dot').forEach(dot => {
    dot.addEventListener('mouseenter', () => {
      const d = data[parseInt(dot.dataset.i)];
      tooltipEl.innerHTML = `<strong>${d.label}</strong><br>${fmtFn(d[valueKey])}`;
      tooltipEl.classList.add('visible');
      positionTooltip(tooltipEl, svgEl, parseFloat(dot.getAttribute('cx')), parseFloat(dot.getAttribute('cy')));
    });
    dot.addEventListener('mouseleave', () => tooltipEl.classList.remove('visible'));
  });
}

/** Draw a vertical bar chart. tooltipHtml(d) overrides the default tooltip. */
function drawBarChart(svgEl, tooltipEl, data, valueKey, fmtFn, color, tooltipHtml = null) {
  const W = svgEl.clientWidth || 400;
  const H = 140;
  const PAD = { top:12, right:8, bottom:28, left:8 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top  - PAD.bottom;

  if (!data.length) { svgEl.innerHTML = ''; return; }

  const vals = data.map(d => d[valueKey]);
  const vMax = Math.max(...vals) * 1.12 || 1;
  const n    = data.length;
  const gap  = Math.max(2, iW / n * 0.15);
  const barW = (iW - gap * (n - 1)) / n;

  const xOf = i => PAD.left + i * (barW + gap);
  const yOf = v => PAD.top + iH - (v / vMax) * iH;
  const hOf = v => (v / vMax) * iH;

  // X labels — show ~5
  const labelStep = Math.max(1, Math.floor(n / 5));

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.innerHTML = data.map((d, i) => {
    const x = xOf(i), y = yOf(d[valueKey]), h = hOf(d[valueKey]);
    const lbl = (i % labelStep === 0 || i === n-1)
      ? `<text x="${(x + barW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" font-family="monospace" font-size="8" fill="var(--muted2)">${d.label}</text>`
      : '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h,1).toFixed(1)}"
        rx="3" fill="${color}" opacity="0.85" class="chart-bar" data-i="${i}" style="cursor:pointer;transition:opacity 0.15s"/>
      ${lbl}`;
  }).join('');

  svgEl.querySelectorAll('.chart-bar').forEach(bar => {
    bar.addEventListener('mouseenter', () => {
      const d = data[parseInt(bar.dataset.i)];
      tooltipEl.innerHTML = tooltipHtml ? tooltipHtml(d) : `<strong>${d.label}</strong><br>${fmtFn(d[valueKey])}`;
      tooltipEl.classList.add('visible');
      const bx = parseFloat(bar.getAttribute('x')) + parseFloat(bar.getAttribute('width')) / 2;
      const by = parseFloat(bar.getAttribute('y'));
      positionTooltip(tooltipEl, svgEl, bx, by);
      bar.style.opacity = '1';
    });
    bar.addEventListener('mouseleave', () => {
      tooltipEl.classList.remove('visible');
      bar.style.opacity = '0.85';
    });
  });
}

function positionTooltip(tip, svgEl, svgX, svgY) {
  const rect   = svgEl.getBoundingClientRect();
  const canvas = svgEl.closest('.ochart-canvas');
  const cRect  = canvas.getBoundingClientRect();
  const scaleX = rect.width  / (parseFloat(svgEl.getAttribute('viewBox')?.split(' ')[2]) || rect.width);
  const scaleY = rect.height / (parseFloat(svgEl.getAttribute('viewBox')?.split(' ')[3]) || rect.height);
  const left = (rect.left - cRect.left) + svgX * scaleX;
  const top  = (rect.top  - cRect.top)  + svgY * scaleY - 52;
  // Keep inside canvas
  tip.style.left = Math.max(0, left - 50) + 'px';
  tip.style.top  = Math.max(0, top) + 'px';
}

/** Toggle the active button within one chart's toggle group. */
function setToggleActive(btn) {
  btn.closest('.ochart-toggle').querySelectorAll('.ochart-toggle-btn').forEach(b => {
    b.classList.toggle('active', b === btn);
  });
}

// ── Revenue / Orders over time ───────────────────────────────────────────────
function renderRevChart() {
  const svgEl = $('rev-chart-svg');
  const tipEl = $('rev-tooltip');
  const subEl = $('rev-chart-sub');
  const orders = state.allOrders;
  if (!svgEl || !orders.length) return;

  const bucket = autoBucket(orders);
  const data   = bucketOrders(orders, bucket);
  const isRev  = state.revChartMode === 'revenue';
  const total  = orders.reduce((s, o) => s + (isRev ? money(o.grandtotal) : 1), 0);
  subEl.textContent = isRev
    ? `${fmtMoney(total)} total · by ${bucket}`
    : `${total} orders · by ${bucket}`;

  const color = isRev ? '#d4622a' : '#3a7d4c';
  const fmtFn = isRev ? fmtMoney : v => `${v} orders`;
  const key   = isRev ? 'revenue' : 'count';

  // Use line for many points, bar for few
  if (data.length > 14) drawLineChart(svgEl, tipEl, data, key, fmtFn, color);
  else                  drawBarChart(svgEl,  tipEl, data, key, fmtFn, color);
}

// ── Day of week chart ────────────────────────────────────────────────────────
function renderDowChart() {
  const svgEl = $('dow-chart-svg');
  const tipEl = $('dow-tooltip');
  const subEl = $('dow-chart-sub');
  if (!svgEl || !state.allOrders.length) return;

  const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const tally = Array(7).fill(0).map(() => ({ revenue:0, count:0, days: new Set() }));

  for (const o of state.allOrders) {
    const d   = new Date(o.create_timestamp * 1000);
    const dow = d.getDay();
    tally[dow].revenue += money(o.grandtotal);
    tally[dow].count++;
    tally[dow].days.add(localDateKey(d));
  }

  const isRev = state.dowChartMode === 'revenue';
  // Compute average per occurrence of that weekday
  const data = DAYS.map((label, i) => {
    const occ = tally[i].days.size || 1;
    return {
      label,
      revenue: tally[i].revenue / occ,
      count:   tally[i].count   / occ,
      rawRev:  tally[i].revenue,
      rawCnt:  tally[i].count,
    };
  });

  subEl.textContent = 'avg. per day';
  const fmtFn = isRev ? fmtMoney : v => `${v.toFixed(1)} orders`;
  const key   = isRev ? 'revenue' : 'count';
  const color = isRev ? '#5a3d9e' : '#b8860b';

  // Richer tooltip showing both avg and total
  drawBarChart(svgEl, tipEl, data, key, fmtFn, color, d => isRev
    ? `<strong>${d.label}</strong><br>Avg: ${fmtMoney(d.revenue)}<br>Total: ${fmtMoney(d.rawRev)}`
    : `<strong>${d.label}</strong><br>Avg: ${d.count.toFixed(1)} orders<br>Total: ${d.rawCnt}`);
}

// ── Top products ─────────────────────────────────────────────────────────────
function renderTopProducts() {
  const wrap = $('top-prod-rows');
  const sub  = $('top-prods-sub');
  if (!wrap) return;

  // Need line items for every order, not just the rows the user has expanded
  if (!state.allOrders.every(lineItems)) {
    wrap.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:0.7rem;color:var(--muted2);padding:0.5rem 0">${state.detailsLoaded ? 'Some line items could not be loaded.' : 'Loading product breakdown…'}</div>`;
    return;
  }

  // Aggregate by title from transaction line items
  const prodMap = {};
  for (const o of state.allOrders) {
    const txs = lineItems(o);
    for (const t of txs) {
      const title = t.title || '(Unknown)';
      if (!prodMap[title]) prodMap[title] = { revenue:0, count:0 };
      const price = t.price ? money(t.price) : 0;
      const qty   = t.quantity || 1;
      prodMap[title].revenue += price * qty;
      prodMap[title].count   += qty;
    }
  }

  const isRev  = state.topProdMode === 'revenue';
  const sorted = Object.entries(prodMap)
    .map(([title, v]) => ({ title, ...v }))
    .sort((a, b) => isRev ? b.revenue - a.revenue : b.count - a.count)
    .slice(0, 8);

  if (!sorted.length) {
    wrap.innerHTML = `<div style="font-family:'DM Mono',monospace;font-size:0.7rem;color:var(--muted2)">No product data found.</div>`;
    return;
  }

  const maxVal = sorted[0][isRev ? 'revenue' : 'count'] || 1;
  sub.textContent = `top ${sorted.length} of ${Object.keys(prodMap).length} products`;

  wrap.innerHTML = sorted.map((p, i) => {
    const val    = isRev ? p.revenue : p.count;
    const barPct = (val / maxVal * 100).toFixed(1);
    const valStr = isRev ? fmtMoney(p.revenue) : `${p.count} sold`;
    const subStr = isRev ? `${p.count} units` : fmtMoney(p.revenue);
    return `<div class="top-prod-row">
      <div>
        <div class="top-prod-name" title="${escHtml(p.title)}">${escHtml(p.title)}</div>
        <div class="top-prod-sub">${subStr}</div>
      </div>
      <div class="top-prod-bar-track">
        <div class="top-prod-bar-fill" style="width:0%;background:${PALETTE[i % PALETTE.length]}" data-target="${barPct}"></div>
      </div>
      <div>
        <div class="top-prod-val">${valStr}</div>
      </div>
    </div>`;
  }).join('');

  animateBars(wrap, '.top-prod-bar-fill');
}

function animateBars(root, selector) {
  requestAnimationFrame(() => {
    root.querySelectorAll(selector).forEach(el => { el.style.width = el.dataset.target + '%'; });
  });
}

const CHART_MODES = { rev: 'revChartMode', dow: 'dowChartMode', top: 'topProdMode' };
const CHART_RENDER = { rev: renderRevChart, dow: renderDowChart, top: renderTopProducts };

/** Handle a Revenue/Orders toggle click for chart 'rev' | 'dow' | 'top'. */
export function setChartMode(chart, mode, btn) {
  state[CHART_MODES[chart]] = mode;
  setToggleActive(btn);
  CHART_RENDER[chart]();
}

/** Main entry — render all order charts. Called after orders load and after full details load. */
export function renderOrderCharts() {
  const wrap = $('order-charts-wrap');
  if (!state.allOrders.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  // Give the DOM a tick to paint before reading clientWidth
  requestAnimationFrame(() => {
    renderRevChart();
    renderDowChart();
    renderTopProducts();
  });
}

// ─── FEE BREAKDOWN CHART ────────────────────────────────────────────────────
const DONUT_STROKE = 22;

/**
 * Merge a { ledger_type: cents } tally into chart rows by FEE_GROUPS label
 * (so types sharing a label, like listing + LISTING_FEE, become one row);
 * unknown types go to "Other". Sorted by amount desc.
 */
export function groupFees(tally) {
  const byLabel = new Map();
  for (const [key, cents] of Object.entries(tally)) {
    const g = FEE_GROUPS.find(g => g.key === key) || { label: 'Other', color: FEE_OTHER_COLOR };
    const row = byLabel.get(g.label) || { label: g.label, color: g.color, cents: 0 };
    row.cents += cents;
    byLabel.set(g.label, row);
  }
  return [...byLabel.values()].sort((a, b) => b.cents - a.cents);
}

export function renderFeeChart(entries) {
  const panel = $('fee-chart-panel');

  // Tally absolute fee amounts by type key
  const tally = {};
  let totalFeesCents = 0;

  for (const e of entries) {
    if (categoriseEntry(e) !== 'fee') continue;
    const key   = ledgerType(e) || 'other';
    const cents = Math.abs(e.amount); // store as positive
    tally[key] = (tally[key] || 0) + cents;
    totalFeesCents += cents;
  }

  if (totalFeesCents === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  const rows = groupFees(tally);

  const total = totalFeesCents;
  $('fee-chart-total').textContent = fmtMoney(total / 100);
  $('fee-donut-center-val').textContent = fmtMoney(total / 100);

  // ── Draw donut ──
  const svg = $('fee-donut-svg');
  const cx = 80, cy = 80, r = 62;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const segments = rows.map(row => {
    const frac = row.cents / total;
    const dash = frac * circumference;
    const seg  = { ...row, frac, dash, gap: circumference - dash, offset };
    offset += dash;
    return seg;
  });
  state.feeSegments = segments;

  svg.innerHTML = segments.map((seg, i) => `
    <circle
      class="donut-seg"
      data-idx="${i}"
      cx="${cx}" cy="${cy}" r="${r}"
      fill="none"
      stroke="${seg.color}"
      stroke-width="${DONUT_STROKE}"
      stroke-dasharray="${seg.dash.toFixed(3)} ${seg.gap.toFixed(3)}"
      stroke-dashoffset="${-seg.offset.toFixed(3)}"
      style="cursor:pointer;transition:stroke-width 0.18s,opacity 0.18s"
    />
  `).join('') + `<circle cx="${cx}" cy="${cy}" r="${r - DONUT_STROKE/2 - 2}" fill="var(--offwhite)"/>`;

  // ── Draw bar rows ──
  const barRows  = $('fee-bars-wrap');
  const maxCents = rows[0].cents;
  barRows.innerHTML = rows.map((row, i) => {
    const pct    = (row.cents / total * 100).toFixed(1);
    const barPct = (row.cents / maxCents * 100).toFixed(1);
    return `
      <div class="fee-bar-row" data-idx="${i}">
        <div class="fee-bar-label" title="${escHtml(row.label)}">${escHtml(row.label)}</div>
        <div class="fee-bar-track">
          <div class="fee-bar-fill" style="width:0%;background:${row.color}"
               data-target="${barPct}"></div>
        </div>
        <div>
          <div class="fee-bar-val">${fmtMoney(row.cents / 100)}</div>
          <div class="fee-bar-pct">${pct}%</div>
        </div>
      </div>`;
  }).join('');

  animateBars(barRows, '.fee-bar-fill');
}

/** Cross-highlight donut segment + bar row idx (null clears). */
export function highlightFee(idx) {
  const segs = state.feeSegments;
  $('fee-donut-svg').querySelectorAll('.donut-seg').forEach((el, i) => {
    el.style.strokeWidth = i === idx ? (DONUT_STROKE + 6) : DONUT_STROKE;
    el.style.opacity     = idx === null || i === idx ? '1' : '0.35';
  });
  $('fee-bars-wrap').querySelectorAll('.fee-bar-row').forEach((el, i) => {
    el.classList.toggle('highlighted', i === idx);
  });

  const tooltip   = $('fee-donut-tooltip');
  const centerVal = $('fee-donut-center-val');
  const centerLbl = $('fee-donut-center-lbl');
  if (idx !== null && segs[idx]) {
    const s = segs[idx];
    centerVal.textContent = fmtMoney(s.cents / 100);
    centerLbl.textContent = s.label;
    tooltip.textContent   = `${s.label}: ${(s.frac * 100).toFixed(1)}%`;
    tooltip.classList.add('visible');
  } else {
    const total = segs.reduce((s, r) => s + r.cents, 0);
    centerVal.textContent = fmtMoney(total / 100);
    centerLbl.textContent = 'total fees';
    tooltip.classList.remove('visible');
  }
}
