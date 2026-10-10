// ─── CHARTS (pure SVG, no libraries) ───────────────────────────────────────
import { FEE_GROUPS, FEE_OTHER_COLOR, FEE_REFUND_OF, PALETTE } from './config.js';
import { categoriseEntry, ledgerType } from './finance.js';
import { topProducts } from './insights.js';
import { lineItems, state } from './state.js';
import { bucketOptions, bucketRange, bucketStart, chooseBucket, escHtml, fmtMoney, fmtMoneyWhole, markPartialBuckets, orderSales, pickBucket, weekdayCounts } from './util.js';

const $ = id => document.getElementById(id);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Group orders by local calendar period.
 * Returns array of { label, ts (unix), revenue, count } sorted by ts, with a
 * zero bucket for every period without orders between span.from and span.to
 * (default: the first and last order).
 * bucketSize: 'day' | 'week' | 'month' | 'year'
 */
export function bucketOrders(orders, bucketSize, span = {}) {
  const ts   = orders.map(o => o.create_timestamp);
  const from = span.from ?? (ts.length ? Math.min(...ts) : null);
  const to   = span.to   ?? (ts.length ? Math.max(...ts) : null);
  const map  = {};
  for (const b of bucketRange(from, to, bucketSize)) map[b.key] = { label: b.label, tip: b.tip, ts: b.ts, revenue:0, count:0 };
  for (const o of orders) {
    const b = bucketStart(o.create_timestamp, bucketSize);
    map[b.key] ??= { label: b.label, tip: b.tip, ts: b.ts, revenue:0, count:0 };
    map[b.key].revenue += orderSales(o);
    map[b.key].count++;
  }
  return Object.values(map).sort((a, b) => a.ts - b.ts);
}

/**
 * The period the order charts cover: the filter's start (or the oldest order)
 * up to the filter's end or now, whichever is earlier.
 */
function chartSpan(orders) {
  const now = Math.floor(Date.now() / 1000);
  return {
    from: state.filterFrom ?? Math.min(...orders.map(o => o.create_timestamp)),
    to:   Math.min(state.filterTo ?? now, now),
  };
}

/**
 * Whether point i gets an x-axis label: about five evenly spaced, plus the
 * last. A regular label that would run into the last one (spacing = px between
 * points; 8px monospace is about 4.8px a character) is left out.
 */
export function axisLabelShown(i, labels, spacing) {
  const n = labels.length, step = Math.max(1, Math.floor(n / 5));
  if (i === n - 1) return true;
  if (i % step) return false;
  const halfWidths = (String(labels[i]).length + String(labels[n - 1]).length) * 2.4;
  return (n - 1 - i) * spacing >= halfWidths + 6;
}

/**
 * Draw a smooth line + area chart into an SVG element. A null value (e.g. a
 * rate for a period with nothing to divide by) keeps its place on the axis
 * and breaks the line there.
 * tooltipHtml(d) overrides the default tooltip; it must escape any API text itself.
 */
export function drawLineChart(svgEl, tooltipEl, data, valueKey, fmtFn, color, tooltipHtml = null) {
  const W = svgEl.clientWidth || 400;
  const H = 140;
  const PAD = { top:12, right:12, bottom:28, left:8 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top  - PAD.bottom;

  if (!data.length) { svgEl.innerHTML = ''; return; }

  const vals = data.map(d => d[valueKey]).filter(v => v != null);
  const vMin = 0;
  const vMax = Math.max(0, ...vals) * 1.12 || 1;
  const xStep = data.length > 1 ? iW / (data.length - 1) : iW;

  const xOf = i  => PAD.left + i * xStep;
  const yOf = v  => PAD.top + iH - ((v - vMin) / (vMax - vMin)) * iH;

  // Runs of consecutive points with a value; each gets its own line and area
  const points = data.map((d, i) => d[valueKey] == null ? null : [xOf(i), yOf(d[valueKey]), i]);
  const runs = [];
  for (const p of points) {
    if (!p) { if (runs.at(-1)?.length) runs.push([]); continue; }
    if (!runs.length) runs.push([]);
    runs.at(-1).push(p);
  }
  // Smooth path via cubic bezier
  const smooth = run => run.slice(1).reduce((path, [x1, y1], k) => {
    const [x0, y0] = run[k], cpX = (x0 + x1) / 2;
    return path + ` C ${cpX.toFixed(1)} ${y0.toFixed(1)}, ${cpX.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }, `M ${run[0][0].toFixed(1)} ${run[0][1].toFixed(1)}`);
  const lines = runs.filter(r => r.length).map(smooth);
  const areas = runs.filter(r => r.length > 1).map(run => smooth(run)
    + ` L ${run.at(-1)[0].toFixed(1)} ${(PAD.top+iH).toFixed(1)}`
    + ` L ${run[0][0].toFixed(1)} ${(PAD.top+iH).toFixed(1)} Z`);

  // X-axis labels — show ~5 evenly spaced
  const axis = data.map(d => d.label);
  const xLabels = data.map((d, i) => {
    if (!axisLabelShown(i, axis, xStep)) return '';
    return `<text x="${xOf(i).toFixed(1)}" y="${H - 4}" text-anchor="middle"
      font-family="monospace" font-size="8" fill="var(--muted2)">${escHtml(d.label)}</text>`;
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
    ${areas.map(a => `<path d="${a}" fill="url(#${uid})"/>`).join('')}
    ${lines.map(l => `<path d="${l}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${xLabels}
    ${points.filter(Boolean).map(([x, y, i]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"
      fill="${color}" stroke="var(--offwhite)" stroke-width="1.5"
      class="chart-dot" data-i="${i}" style="cursor:pointer"/>`).join('')}
    ${points.map((p, i) => p ? '' : `<circle cx="${xOf(i).toFixed(1)}" cy="${(PAD.top + iH).toFixed(1)}" r="3"
      fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="1.5" pointer-events="all"
      class="chart-dot" data-i="${i}" style="cursor:pointer"/>`).join('')}
  `;

  svgEl.querySelectorAll('.chart-dot').forEach(dot => {
    dot.addEventListener('mouseenter', () => {
      const d = data[parseInt(dot.dataset.i)];
      tooltipEl.innerHTML = tooltipHtml ? tooltipHtml(d) : `<strong>${escHtml(d.tip ?? d.label)}</strong><br>${fmtFn(d[valueKey])}`;
      tooltipEl.classList.add('visible');
      positionTooltip(tooltipEl, svgEl, parseFloat(dot.getAttribute('cx')), parseFloat(dot.getAttribute('cy')));
    });
    dot.addEventListener('mouseleave', () => tooltipEl.classList.remove('visible'));
  });
}

/**
 * Draw a vertical bar chart. A null value keeps its slot, drawn as a faint
 * baseline stub, so periods with nothing to show aren't skipped.
 * tooltipHtml(d) overrides the default tooltip; it must escape any API text itself.
 * values: print each bar's value above it (true: with fmtFn, or a shorter formatter),
 * where the bar is wide enough for the text.
 */
export function drawBarChart(svgEl, tooltipEl, data, valueKey, fmtFn, color, tooltipHtml = null, { values = false } = {}) {
  const W = svgEl.clientWidth || 400;
  const H = 140;
  const PAD = { top:12, right:8, bottom:28, left:8 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top  - PAD.bottom;

  if (!data.length) { svgEl.innerHTML = ''; return; }

  const vals = data.map(d => d[valueKey]).filter(v => v != null);
  const vMax = Math.max(0, ...vals) * 1.12 || 1;
  const n    = data.length;
  const gap  = Math.max(2, iW / n * 0.15);
  const barW = (iW - gap * (n - 1)) / n;

  const xOf = i => PAD.left + i * (barW + gap);
  const hOf = v => (v / vMax) * iH;

  // X labels — show ~5
  const axis = data.map(d => d.label);
  // Value labels go on every bar or on none, so a chart never looks half-labelled
  const valFmt = typeof values === 'function' ? values : fmtFn;
  let valTexts = values ? data.map(d => d[valueKey] == null ? '' : String(valFmt(d[valueKey]))) : [];
  if (valTexts.some(t => t.length * 5 > barW + gap)) valTexts = [];

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.innerHTML = data.map((d, i) => {
    const none = d[valueKey] == null;
    const v = none ? 0 : d[valueKey];
    const x = xOf(i), h = Math.max(hOf(v), none ? 2 : 1), y = PAD.top + iH - h;
    const lbl = axisLabelShown(i, axis, barW + gap)
      ? `<text x="${(x + barW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" font-family="monospace" font-size="8" fill="var(--muted2)">${escHtml(d.label)}</text>`
      : '';
    const val = valTexts[i]
      ? `<text x="${(x + barW/2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-family="monospace" font-size="8" fill="var(--muted)" pointer-events="none" class="chart-val">${escHtml(valTexts[i])}</text>`
      : '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}"
        rx="${none ? 1 : 3}" fill="${none ? 'var(--border2)' : color}" opacity="0.85" class="chart-bar" data-i="${i}" style="cursor:pointer;transition:opacity 0.15s"/>
      ${val}${lbl}`;
  }).join('');

  svgEl.querySelectorAll('.chart-bar').forEach(bar => {
    bar.addEventListener('mouseenter', () => {
      const d = data[parseInt(bar.dataset.i)];
      tooltipEl.innerHTML = tooltipHtml ? tooltipHtml(d) : `<strong>${escHtml(d.tip ?? d.label)}</strong><br>${fmtFn(d[valueKey])}`;
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

export const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/** 0 → "12a", 13 → "1p". */
export const hourLabel = h => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;

/**
 * Draw a weekday × hour grid (rows Sun–Sat, columns 0–23). counts[w][h] sets
 * each cell's shade; the tooltip also shows revenue[w][h] through fmtFn.
 */
export function drawHeatmap(svgEl, tooltipEl, counts, revenue, color, fmtFn) {
  const W = svgEl.clientWidth || 400;
  const LEFT = 30, TOP = 4, ROW = 16, GAP = 2, BOTTOM = 18;
  const H = TOP + 7 * ROW + BOTTOM;
  const cellW = (W - LEFT) / 24;
  const max = Math.max(1, ...counts.flat());

  let out = '';
  for (let w = 0; w < 7; w++) {
    const y = TOP + w * ROW;
    out += `<text x="${LEFT - 6}" y="${y + ROW / 2 + 3}" text-anchor="end" font-family="monospace" font-size="8" fill="var(--muted2)">${DAY_NAMES[w]}</text>`;
    for (let h = 0; h < 24; h++) {
      const c = counts[w][h];
      out += `<rect x="${(LEFT + h * cellW + GAP / 2).toFixed(1)}" y="${y + GAP / 2}" width="${Math.max(1, cellW - GAP).toFixed(1)}" height="${ROW - GAP}" rx="2"
        fill="${c ? color : 'var(--paper)'}" opacity="${c ? (0.15 + 0.85 * c / max).toFixed(2) : 1}" data-w="${w}" data-h="${h}"/>`;
    }
  }
  for (let h = 0; h < 24; h += 3) {
    out += `<text x="${(LEFT + h * cellW + cellW / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-family="monospace" font-size="8" fill="var(--muted2)">${hourLabel(h)}</text>`;
  }

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgEl.style.height = `${H}px`;
  svgEl.innerHTML = out;

  // One handler on the svg (assigned, not added, so redraws don't stack them)
  svgEl.onmouseover = ev => {
    const cell = ev.target.closest('rect[data-w]');
    if (!cell) return;
    const w = +cell.dataset.w, h = +cell.dataset.h, c = counts[w][h];
    tooltipEl.innerHTML = `<strong>${DAY_NAMES[w]} ${hourLabel(h)}–${hourLabel((h + 1) % 24)}</strong><br>${c} order${c === 1 ? '' : 's'}${c ? `<br>${fmtFn(revenue[w][h])}` : ''}`;
    tooltipEl.classList.add('visible');
    positionTooltip(tooltipEl, svgEl, parseFloat(cell.getAttribute('x')) + cellW / 2, parseFloat(cell.getAttribute('y')));
  };
  svgEl.onmouseleave = () => tooltipEl.classList.remove('visible');
}

/** Toggle the active button within one chart's toggle group. */
/**
 * Show which bucket size a time chart is drawn by in its Day/Week/Month/Year
 * switch, and disable the sizes that don't suit the period (see bucketOptions).
 */
export function syncBucketToggle(el, options, current) {
  for (const btn of el.querySelectorAll('.ochart-toggle-btn')) {
    const o = options.find(x => x.size === btn.dataset.mode);
    btn.classList.toggle('active', btn.dataset.mode === current);
    btn.disabled = !o?.ok;
    btn.title = !o || o.ok ? '' : o.count < 2 ? `The period is within one ${o.size}` : `Too many ${o.size}s to show; pick a shorter period`;
  }
}

export function setToggleActive(btn) {
  btn.closest('.ochart-toggle').querySelectorAll('.ochart-toggle-btn').forEach(b => {
    b.classList.toggle('active', b === btn);
  });
}

const NO_ORDERS = 'No orders in this period';

// ── Revenue / Orders over time ───────────────────────────────────────────────
export function renderRevChart() {
  const svgEl = $('rev-chart-svg');
  const tipEl = $('rev-tooltip');
  const subEl = $('rev-chart-sub');
  const orders = state.allOrders;
  if (!orders.length) { svgEl.innerHTML = ''; subEl.textContent = NO_ORDERS; return; }

  // Every day/week/month/year of the period, so quiet ones show as zero instead of being skipped
  const span    = chartSpan(orders);
  const options = bucketOptions(span.from, span.to);
  const bucket  = chooseBucket(state.revBucket, options, pickBucket(span.from, span.to));
  syncBucketToggle($('rev-bucket'), options, bucket);
  const data   = markPartialBuckets(bucketOrders(orders, bucket, span), span.from, span.to, bucket);
  const isRev  = state.revChartMode === 'revenue';
  const total  = orders.reduce((s, o) => s + (isRev ? orderSales(o) : 1), 0);
  subEl.textContent = isRev
    ? `${fmtMoney(total)} in sales before refunds, excl. tax · by ${bucket}`
    : `${total} orders · by ${bucket}`;

  const color = isRev ? '#d4622a' : '#3a7d4c';
  const fmtFn = isRev ? fmtMoney : v => `${v} orders`;
  const key   = isRev ? 'revenue' : 'count';

  // Use line for many points, bar for few
  if (data.length > 14) drawLineChart(svgEl, tipEl, data, key, fmtFn, color);
  else                  drawBarChart(svgEl,  tipEl, data, key, fmtFn, color, null, { values: isRev ? fmtMoneyWhole : String });
}

// ── Day of week chart ────────────────────────────────────────────────────────
export function renderDowChart() {
  const svgEl = $('dow-chart-svg');
  const tipEl = $('dow-tooltip');
  const subEl = $('dow-chart-sub');
  if (!state.allOrders.length) { svgEl.innerHTML = ''; subEl.textContent = NO_ORDERS; return; }

  const tally = Array(7).fill(0).map(() => ({ revenue:0, count:0 }));

  for (const o of state.allOrders) {
    const dow = new Date(o.create_timestamp * 1000).getDay();
    tally[dow].revenue += orderSales(o);
    tally[dow].count++;
  }

  // Average over every occurrence of that weekday in the period, including days without sales
  const { from, to } = chartSpan(state.allOrders);
  const days = weekdayCounts(from, to);

  const isRev = state.dowChartMode === 'revenue';
  const data = DAY_NAMES.map((label, i) => {
    const occ = days[i] || 1;
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
    : `<strong>${d.label}</strong><br>Avg: ${d.count.toFixed(1)} orders<br>Total: ${d.rawCnt}`,
    { values: isRev ? fmtMoneyWhole : v => v.toFixed(1) });
}

// ── Top products ─────────────────────────────────────────────────────────────
export function renderTopProducts() {
  const wrap = $('top-prod-rows');
  const sub  = $('top-prods-sub');
  if (!state.allOrders.length) { wrap.innerHTML = `<div class="ins-empty">${NO_ORDERS}.</div>`; sub.textContent = '—'; return; }

  // Need line items for every order, not just the rows the user has expanded
  if (!state.allOrders.every(lineItems)) {
    wrap.innerHTML = `<div class="ins-empty">${state.detailsLoaded ? 'Some line items could not be loaded.' : 'Loading product breakdown…'}</div>`;
    return;
  }

  // Grouped by listing, so a renamed listing stays one product
  const isRev  = state.topProdMode === 'revenue';
  const orders = state.allOrders.map(o => o.transactions ? o : { ...o, transactions: lineItems(o) });
  const { rows: sorted, total } = topProducts(orders, { by: isRev ? 'revenue' : 'units', listings: state.listings });

  if (!sorted.length) {
    wrap.innerHTML = `<div class="ins-empty">No product data found.</div>`;
    return;
  }

  const maxVal = sorted[0][isRev ? 'revenue' : 'units'] || 1;
  sub.textContent = `top ${sorted.length} of ${total} products`;

  wrap.innerHTML = sorted.map((p, i) => {
    const val    = isRev ? p.revenue : p.units;
    const barPct = (val / maxVal * 100).toFixed(1);
    const valStr = isRev ? fmtMoney(p.revenue) : `${p.units} sold`;
    const subStr = isRev ? `${p.units} units` : fmtMoney(p.revenue);
    const name   = escHtml(p.name);
    const hover  = escHtml(p.otherNames.length ? `${p.name}\nAlso sold as: ${p.otherNames.join('; ')}` : p.name);
    return `<div class="top-prod-row">
      <div>
        <div class="top-prod-name" title="${hover}">${name}</div>
        <div class="top-prod-sub">${subStr}${p.otherNames.length ? ` · <span title="${hover}">renamed</span>` : ''}</div>
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

export function animateBars(root, selector) {
  requestAnimationFrame(() => {
    root.querySelectorAll(selector).forEach(el => { el.style.width = el.dataset.target + '%'; });
  });
}

const CHART_MODES = { rev: 'revChartMode', dow: 'dowChartMode', top: 'topProdMode', revBucket: 'revBucket' };
const CHART_RENDER = { rev: renderRevChart, dow: renderDowChart, top: renderTopProducts, revBucket: renderRevChart };

/** Handle a Revenue/Orders toggle click for chart 'rev' | 'dow' | 'top'. */
export function setChartMode(chart, mode, btn) {
  state[CHART_MODES[chart]] = mode;
  setToggleActive(btn);
  CHART_RENDER[chart]();
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

/**
 * Fee cost by ledger type in positive cents, net of fee-refund credits
 * (each credit is taken off the fee it reverses, per FEE_REFUND_OF), so the
 * values sum to the Total Fees figure from computeLedgerTotals.
 */
export function feeTally(entries) {
  const tally = {};
  for (const e of entries) {
    const cat = categoriseEntry(e);
    let key;
    if (cat === 'fee') key = ledgerType(e) || 'other';
    else if (cat === 'refund' && e.amount > 0) key = FEE_REFUND_OF[ledgerType(e)] || 'other';
    else continue;
    tally[key] = (tally[key] || 0) - e.amount; // fees are negative, credits positive
  }
  return tally;
}

let feeTotalCents = 0; // total shown in the donut centre when nothing is highlighted

export function renderFeeChart(entries) {
  const panel = $('fee-chart-panel');

  const tally = feeTally(entries);
  const total = Object.values(tally).reduce((s, c) => s + c, 0);
  if (total <= 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  feeTotalCents = total;

  // A group can net below zero if its refunds outweigh its fees in the period
  const rows = groupFees(tally).filter(r => r.cents > 0);

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
    centerVal.textContent = fmtMoney(feeTotalCents / 100);
    centerLbl.textContent = 'total fees';
    tooltip.classList.remove('visible');
  }
}
