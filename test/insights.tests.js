// Unit tests for the Insights calculations (js/insights.js) and the chart
// primitives' escaping — run via test/finance.test.html in a browser.
import { axisLabelShown, drawBarChart, drawHeatmap, drawLineChart, hourLabel } from '../js/charts.js';
import {
  adSpend, aovBreakdown, backlog, basketStats, customerStats, discountedOrders, discountStats, feeBreakdown, feeRateSeries, fulfilment, geography, grossBreakdown, orderStatusCounts,
  heatmapMatrix, listingStats, payoutStats, productKey, productNames, refundedOrders, refundStats, revenueComposition, reviewStats,
  shippingPnL, topProducts, unshippedOrders, variationStats,
} from '../js/insights.js';
import { computeLedgerTotals } from '../js/finance.js';
import { bucketOptions, bucketRange, bucketStart, chooseBucket, countBuckets, markPartialBuckets, pickBucket } from '../js/util.js';

function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

const usd = dollars => ({ amount: Math.round(dollars * 100), divisor: 100, currency_code: 'USD' });
const at  = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime() / 1000;
const le  = (ledger_type, amount, ts = at(2026, 3, 10), extra = {}) => ({ ledger_type, amount, created_timestamp: ts, ...extra });
const order = (fields = {}) => ({ create_timestamp: at(2026, 3, 10), grandtotal: usd(10), ...fields });

export const tests = [
  ['bucketStart: local day / Monday week / month', () => {
    eq(bucketStart(at(2026, 3, 10, 23), 'day').key, '2026-03-10', 'day');
    eq(bucketStart(at(2026, 3, 15), 'week').key, '2026-03-09', 'Sunday belongs to the week starting Monday 9th');
    eq(bucketStart(at(2026, 3, 16), 'week').key, '2026-03-16', 'Monday starts a new week');
    eq(bucketStart(at(2026, 3, 31), 'month').key, '2026-03-01', 'month');
  }],
  ['bucketRange: every day / week / month between two times, inclusive', () => {
    eq(bucketRange(at(2026, 3, 9, 23), at(2026, 3, 12, 1), 'day').map(b => b.key), ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12']);
    eq(bucketRange(at(2026, 3, 11), at(2026, 3, 30), 'week').map(b => b.key), ['2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
    eq(bucketRange(at(2026, 1, 31), at(2026, 4, 1), 'month').map(b => b.key), ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    // Across the spring DST change (US: Mar 8 2026), local days stay one per date
    eq(bucketRange(at(2026, 3, 7), at(2026, 3, 9), 'day').map(b => b.key), ['2026-03-07', '2026-03-08', '2026-03-09']);
    eq(bucketRange(at(2026, 3, 9), at(2026, 3, 9), 'day').length, 1, 'same day');
    eq(bucketRange(null, at(2026, 3, 9), 'day'), [], 'missing end');
    eq(bucketRange(at(2026, 3, 9), at(2026, 3, 1), 'day'), [], 'reversed');
  }],
  ['year buckets: Jan 1 start, the year as label', () => {
    eq(bucketStart(at(2026, 7, 4), 'year').key, '2026-01-01');
    eq(bucketRange(at(2024, 12, 31), at(2026, 1, 1), 'year').map(b => b.label), ['2024', '2025', '2026']);
    eq([bucketStart(at(2026, 3, 11), 'week').tip, bucketStart(at(2026, 3, 11), 'month').tip], ['Week of Mar 9, 2026', 'March 2026'], 'tooltips say what a bucket is');
  }],
  ['countBuckets agrees with bucketRange without building the buckets', () => {
    const spans = [[at(2026, 3, 9, 23), at(2026, 3, 12, 1)], [at(2025, 12, 28), at(2026, 1, 4)], [at(2026, 3, 1), at(2026, 3, 31)],
      [at(2024, 2, 29), at(2026, 10, 9)], [at(2026, 3, 8), at(2026, 3, 9)], [at(2026, 3, 9), at(2026, 3, 9)], [at(2026, 10, 25, 1), at(2026, 11, 2, 23)]];
    for (const [from, to] of spans) for (const size of ['day', 'week', 'month', 'year'])
      eq(countBuckets(from, to, size), bucketRange(from, to, size).length, `${size} ${new Date(from * 1000).toDateString()} – ${new Date(to * 1000).toDateString()}`);
    eq(countBuckets(null, at(2026, 3, 9), 'day'), 0, 'missing end');
  }],
  ['bucketOptions: 2 to 370 buckets; chooseBucket keeps a pick only while it suits', () => {
    const ok = (from, to) => bucketOptions(from, to).filter(o => o.ok).map(o => o.size);
    eq(ok(at(2026, 10, 3), at(2026, 10, 9)), ['day', 'week'], '7 days: one month, one year');
    eq(ok(at(2025, 10, 10), at(2026, 10, 9)), ['day', 'week', 'month', 'year'], '12 months');
    eq(ok(at(2022, 1, 1), at(2026, 10, 9)), ['week', 'month', 'year'], 'years of days are too many');
    const opts = bucketOptions(at(2026, 10, 3), at(2026, 10, 9));
    eq([chooseBucket('week', opts, 'day'), chooseBucket('year', opts, 'day'), chooseBucket(null, opts, 'day')], ['week', 'day', 'day']);
  }],
  ['markPartialBuckets notes when the period covers only part of an edge bucket', () => {
    const from = at(2026, 7, 11, 0), to = at(2026, 10, 9, 18);
    const months = markPartialBuckets(bucketRange(from, to, 'month'), from, to, 'month').map(b => b.tip);
    eq([months[0], months[1], months.at(-1)], ['July 2026 (Jul 11–31 only)', 'August 2026', 'October 2026 (Oct 1–9 only)']);
    const whole = bucketRange(at(2026, 3, 1, 0), at(2026, 4, 30, 23), 'month');
    eq(markPartialBuckets(whole, at(2026, 3, 1, 0), new Date(2026, 4, 1).getTime() / 1000 - 1, 'month').map(b => b.tip), ['March 2026', 'April 2026'], 'whole months stay as they are');
    eq(markPartialBuckets(bucketRange(from, to, 'day'), from, to, 'day')[0].tip.includes('only'), false, 'days are left alone');
    eq(markPartialBuckets(bucketRange(at(2026, 7, 12, 0), at(2026, 7, 14), 'week'), at(2026, 7, 12, 0), at(2026, 7, 14), 'week')[0].tip, 'Week of Jul 6, 2026 (Jul 12 only)', 'one day');
  }],
  ['pickBucket: day up to 35 days, week up to 180, then month', () => {
    eq(pickBucket(0, 35 * 86400), 'day');
    eq(pickBucket(0, 36 * 86400), 'week');
    eq(pickBucket(0, 181 * 86400), 'month');
  }],
  ['feeRateSeries: per-bucket rates, pass-throughs ignored, empty buckets null', () => {
    const s = feeRateSeries([
      le('PAYMENT_GROSS', 10800, at(2026, 3, 10)), // includes 800 of tax
      le('transaction', -650, at(2026, 3, 10)),
      le('sales_tax', -800, at(2026, 3, 10)),
      le('DISBURSE2', -5000, at(2026, 3, 11)),
      le('prolist', -100, at(2026, 3, 17)), // next week: fees but no sales
    ], { bucket: 'week' });
    eq(s.map(r => [r.grossCents, r.feesCents, r.netCents]), [[10000, 650, 9350], [0, 100, -100]]);
    eq(s[0].feeRate, 0.065, 'fee rate');
    eq(s[0].margin, 0.935, 'margin');
    eq(s[1].feeRate, null, 'no gross → null rate');
  }],
  ['feeRateSeries: exclude drops postage; refunds adjust both sides', () => {
    const entries = [
      le('PAYMENT_GROSS', 10000), le('shipping_labels', -500), le('transaction', -650),
      le('REFUND_GROSS', -2000), le('transaction_refund', 130),
    ];
    eq(feeRateSeries(entries, { bucket: 'month' })[0].feesCents, 1020, 'all fees');
    const excl = feeRateSeries(entries, { bucket: 'month', exclude: new Set(['shipping_labels']) })[0];
    eq([excl.grossCents, excl.feesCents], [8000, 520], 'excluding postage');
    eq(feeRateSeries([], { bucket: 'week' }), [], 'empty');
  }],
  ['feeRateSeries: weeks without entries are kept, across the whole span', () => {
    const s = feeRateSeries([le('PAYMENT_GROSS', 10000, at(2026, 3, 10)), le('transaction', -650, at(2026, 3, 24))],
      { bucket: 'week', from: at(2026, 3, 2), to: at(2026, 4, 1) });
    eq(s.map(r => r.label), ['Mar 2', 'Mar 9', 'Mar 16', 'Mar 23', 'Mar 30'], 'every week of the span');
    eq(s.map(r => r.grossCents), [0, 10000, 0, 0, 0]);
    eq(s.map(r => r.feeRate), [null, 0, null, null, null], 'no sales → no rate (a gap, not 0%)');
    eq(s[3].feesCents, 650, 'fees in a week without sales still count');
  }],
  ['feeBreakdown: fee groups with charges and credits, summing to Total Fees', () => {
    const entries = [
      le('PAYMENT_GROSS', 10000), le('transaction', -650), le('transaction', -100), le('transaction_refund', 200),
      le('listing', -20), le('LISTING_FEE', -20), le('shipping_labels', -840), le('mystery_fee', -5),
      le('REFUND_GROSS', -3000), le('sales_tax', -800), le('DISBURSE2', -5000),
    ];
    const f = feeBreakdown(entries);
    eq(f.rows.map(r => [r.label, r.chargedCents, r.creditedCents, r.cents]),
      [['Shipping Labels', 840, 0, 840], ['Transaction Fees', 750, 200, 550], ['Listing Fees', 40, 0, 40], ['Other', 5, 0, 5]]);
    eq([f.chargedCents, f.creditedCents, f.totalCents], [1635, 200, 1435]);
    eq(f.totalCents, -computeLedgerTotals(entries).feesCents, 'sums to Total Fees');
    eq(feeBreakdown([]), { rows: [], totalCents: 0, chargedCents: 0, creditedCents: 0 });
  }],
  ['grossBreakdown: payments less tax passed on and refunds, summing to Total Gross', () => {
    const entries = [
      le('PAYMENT_GROSS', 10800), le('sales_tax', -800), le('PAYMENT_GROSS', 5530), le('sales_tax', -400), le('buyer_fee', -30),
      le('REFUND_GROSS', -5400), le('sales_tax_refund', 400), le('transaction', -650), le('transaction_refund', 200), le('DISBURSE2', -9000),
    ];
    const g = grossBreakdown(entries);
    eq([g.paidCents, g.sales, g.taxCents, g.deliveryCents, g.refundCents, g.refunds, g.taxBackCents], [16330, 2, -1200, -30, -5400, 1, 400]);
    eq(g.grossCents, computeLedgerTotals(entries).grossCents, 'sums to Total Gross');
    eq(grossBreakdown([]).grossCents, 0);
    eq(g.grossCents - feeBreakdown(entries).totalCents, computeLedgerTotals(entries).netCents, 'gross less the fee groups is Net Earnings');
  }],
  ['orderStatusCounts: statuses in working order, counts summing to the orders', () => {
    const orders = [
      order({ status: 'Completed' }), order({ status: 'Paid' }), order({ status: 'completed' }), order({ status: 'Cancelled' }),
      order({ status: 'Fully Refunded' }), order({ status: 'Weird' }), order({ was_shipped: true }), order({ status: 'Canceled' }),
    ];
    const rows = orderStatusCounts(orders);
    eq(rows.map(r => [r.status, r.count]), [['paid', 1], ['completed', 2], ['shipped', 1], ['fully refunded', 1], ['canceled', 2], ['weird', 1]]);
    eq(rows.reduce((s, r) => s + r.count, 0), orders.length, 'counts sum to the orders');
    eq(rows[0].sales, 10, 'sales per status (grand total less tax)');
    eq(orderStatusCounts([]), []);
  }],
  ['aovBreakdown: parts of the average order sum to Avg. Order Value', () => {
    const a = aovBreakdown([
      order({ subtotal: usd(20), total_shipping_cost: usd(5), discount_amt: usd(2) }),
      order({ subtotal: usd(10), total_shipping_cost: usd(5), gift_wrap_price: usd(3) }),
      order({ subtotal: usd(40), total_shipping_cost: usd(0) }),
      order({ grandtotal: usd(10.80), total_tax_cost: usd(0.80) }), // no subtotal
    ]);
    eq(a.avgCents, 2325, '(25 + 18 + 40 + 10) / 4');
    eq(a.parts, { items: 1750, shipping: 250, giftWrap: 75, other: 250 });
    eq(Object.values(a.parts).reduce((s, c) => s + c, 0), a.avgCents, 'parts sum to the average');
    eq([a.discountCents, a.medianCents, a.minCents, a.maxCents], [50, 2150, 1000, 4000]);
    eq(aovBreakdown([order({ subtotal: usd(9) })]).medianCents, 900, 'one order');
    // 10.0033 + 1.0033 round to 10.00 + 1.00, but the average 11.0067 rounds to 11.01: the largest part takes the cent
    const r = aovBreakdown([[10, 1], [10, 1], [10.01, 1.01]].map(([i, sh]) => order({ subtotal: usd(i), total_shipping_cost: usd(sh) })));
    eq([r.avgCents, r.parts.items, r.parts.shipping], [1101, 1001, 100]);
    eq(aovBreakdown([]), null);
  }],
  ['adSpend: nets ad refunds and counts Offsite Ads sales once each', () => {
    const a = adSpend([
      le('PAYMENT_GROSS', 20000),
      le('prolist', -150), le('prolist', -250),
      le('offsite_ads_fee', -900, undefined, { reference_id: 11 }),
      le('offsite_ads_fee', -300, undefined, { reference_id: 12 }),
      le('offsite_ads_fee_refund', 300, undefined, { reference_id: 12 }),
      le('transaction', -1300),
    ]);
    eq(a.rows.map(r => [r.label, r.cents]), [['Etsy Ads', 400], ['Offsite Ads', 900]]);
    eq(a.totalCents, 1300);
    eq(a.share, 0.065);
    eq(a.offsiteSales, 2);
    eq(adSpend([]).share, null, 'no gross');
  }],
  ['shippingPnL: clips orders to the ledger span; label refunds reduce cost', () => {
    const orders = [
      order({ create_timestamp: at(2026, 3, 10), total_shipping_cost: usd(5) }),
      order({ create_timestamp: at(2026, 3, 12), total_shipping_cost: usd(7.5) }),
      order({ create_timestamp: at(2025, 1, 1),  total_shipping_cost: usd(99) }), // outside the span
    ];
    const s = shippingPnL(orders, [le('shipping_labels', -450), le('shipping_labels', -450), le('shipping_label_refund', 450)],
      { from: at(2026, 3, 1), to: at(2026, 3, 31) });
    eq(s, { chargedCents: 1250, labelsCents: 450, diffCents: 800, labelCount: 2 });
    eq(shippingPnL(orders, [], null).labelCount, 0, 'no labels');
  }],
  ['payoutStats: totals payouts and takes the latest balance', () => {
    const p = payoutStats([
      le('DISBURSE2', -20000, at(2026, 3, 1), { balance: 500 }),
      le('DISBURSE', -10000, at(2026, 3, 8), { balance: 900 }),
      le('PAYMENT_GROSS', 3000, at(2026, 3, 9), { balance: 3900, sequence_number: 1 }),
      le('transaction', -195, at(2026, 3, 9), { balance: 3705, sequence_number: 2 }),
    ]);
    eq([p.count, p.totalCents, p.avgCents, p.balanceCents], [2, 30000, 15000, 3705]);
    eq(p.lastPayoutTs, at(2026, 3, 8));
    eq(payoutStats([]).balanceCents, null, 'empty');
    // A payout that bounced back and was sent again counts once
    const b = payoutStats([le('DISBURSE2', -25000), le('ADYENBALANCE_REVERSAL', 25000), le('DISBURSE2', -25000)]);
    eq([b.count, b.totalCents], [1, 25000], 'bounced payout');
  }],
  ['revenueComposition: parts add up to gross, with a residual', () => {
    const c = revenueComposition([
      order({ total_price: usd(40), discount_amt: usd(4), total_shipping_cost: usd(5), total_tax_cost: usd(2.88), gift_wrap_price: usd(3), grandtotal: usd(46.88) }),
      // no total_price: falls back to line items; 1.00 of VAT the parts don't cover
      order({ transactions: [{ price: usd(10), quantity: 2 }], total_shipping_cost: usd(0), grandtotal: usd(21) }),
    ]);
    eq(c, { items: 60, discounts: 4, shipping: 5, tax: 2.88, giftWrap: 3, other: 1, grand: 67.88 });
  }],
  ['customerStats: repeat buyers, revenue share, missing IDs', () => {
    const c = customerStats([
      order({ buyer_user_id: 1, name: 'Ann', grandtotal: usd(30) }),
      order({ buyer_user_id: 1, name: 'Ann', grandtotal: usd(20) }),
      order({ buyer_user_id: 2, name: 'Bo',  grandtotal: usd(25) }),
      order({ buyer_user_id: 3, grandtotal: usd(25) }),
      order({ grandtotal: usd(99) }), // no buyer ID
    ]);
    eq([c.buyers, c.repeatBuyers, c.noId], [3, 1, 1]);
    eq(c.repeatRate, 1 / 3);
    eq(c.repeatRevenueShare, 0.5);
    eq(c.ordersPerBuyer, 4 / 3);
    eq(c.top.map(b => [b.id, b.orders, b.revenue]), [[1, 2, 50], [2, 1, 25], [3, 1, 25]]);
    eq(customerStats([]).repeatRate, null, 'empty');
  }],
  ['geography: countries vs US states; unknowns counted separately', () => {
    const orders = [
      order({ country_iso: 'US', state: 'OR', grandtotal: usd(10) }),
      order({ country_iso: 'us', state: 'OR', grandtotal: usd(10) }),
      order({ country_iso: 'US', grandtotal: usd(5) }),            // US, no state
      order({ country_iso: 'GB', grandtotal: usd(50) }),
      order({ grandtotal: usd(5) }),                                // no address
    ];
    const byCountry = geography(orders, 'country');
    eq(byCountry.rows.map(r => [r.key, r.orders, r.revenue]), [['GB', 1, 50], ['US', 3, 25]]);
    eq([byCountry.known, byCountry.unknown], [4, 1]);
    const byState = geography(orders, 'us-state');
    eq(byState.rows.map(r => [r.key, r.orders]), [['OR', 2]]);
    eq([byState.known, byState.unknown], [2, 1], 'only US orders count');
  }],
  ['chart primitives escape labels instead of injecting HTML', () => {
    const payload = '<img src=x onerror="window.__xssTest=1">';
    for (const draw of [drawBarChart, drawLineChart]) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      draw(svg, document.createElement('div'), [{ label: payload, v: 1 }, { label: 'b', v: 2 }], 'v', String, '#000');
      eq(svg.querySelector('img'), null, draw.name);
      eq(svg.textContent.includes(payload), true, `${draw.name} shows the text`);
    }
  }],
  ['chart primitives keep a slot for null values instead of skipping them', () => {
    const data = [{ label: 'a', v: 1 }, { label: 'b', v: null }, { label: 'c', v: 2 }, { label: 'd', v: 3 }];
    const bars = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    drawBarChart(bars, document.createElement('div'), data, 'v', String, '#000');
    eq(bars.querySelectorAll('.chart-bar').length, 4, 'one bar slot per point');
    eq(bars.querySelectorAll('.chart-bar')[1].getAttribute('fill'), 'var(--border2)', 'null drawn as a faint stub');
    eq([...bars.querySelectorAll('.chart-hit')].map(h => h.dataset.i), ['0', '1', '2', '3'], 'every bar, the stub too, gets a full-height hover column');
    eq(bars.querySelectorAll('.chart-val').length, 0, 'no value labels unless asked');
    drawBarChart(bars, document.createElement('div'), data, 'v', v => `${v} ★`, '#000', null, { values: true });
    eq([...bars.querySelectorAll('.chart-val')].map(t => t.textContent), ['1 ★', '2 ★', '3 ★'], 'values: a label per bar, none for the null');
    drawBarChart(bars, document.createElement('div'), data, 'v', v => `${v} ★`, '#000', null, { values: v => v.toFixed(1) });
    eq([...bars.querySelectorAll('.chart-val')].map(t => t.textContent), ['1.0', '2.0', '3.0'], 'values can take a shorter formatter');
    drawBarChart(bars, document.createElement('div'), data, 'v', String, '#000', null, { values: v => v === 3 ? 'x'.repeat(40) : 'ok' });
    eq(bars.querySelectorAll('.chart-val').length, 0, 'one label too wide for its bar: no labels at all');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    drawLineChart(line, document.createElement('div'), data, 'v', String, '#000');
    const dots = [...line.querySelectorAll('.chart-dot')];
    eq(dots.filter(d => d.getAttribute('fill') === '#000').map(d => d.dataset.i), ['0', '2', '3'], 'points keep their positions');
    const gap = dots.find(d => d.dataset.i === '1');
    eq([gap?.getAttribute('fill'), gap?.getAttribute('cy')], ['none', '112.0'], 'the null gets a faint hover target on the baseline, so its tooltip can say why');
    eq(line.querySelectorAll('path[stroke]').length, 2, 'the line breaks at the null');
    const panel = document.createElement('div');
    panel.className = 'ochart-panel';
    panel.innerHTML = '<div class="ochart-title">Revenue Over Time</div><div class="ochart-subtitle">$10 in sales · by day</div>';
    panel.appendChild(line);
    drawLineChart(line, document.createElement('div'), data, 'v', String, '#000');
    eq([line.getAttribute('role'), line.getAttribute('aria-label')], ['img', 'Revenue Over Time: $10 in sales · by day'], 'a chart is named after its panel for screen readers');
    eq([...line.querySelectorAll('.chart-hit')].map(h => h.dataset.i), ['0', '1', '2', '3'], 'every point, the null too, gets a full-height hover column');
  }],
  ['axisLabelShown drops a label that would run into the last one', () => {
    const weeks = Array.from({ length: 14 }, (_, i) => `Sep ${i + 10}`);
    const shown = sp => weeks.map((l, i) => axisLabelShown(i, weeks, sp) ? i : null).filter(i => i !== null);
    eq(shown(21), [0, 2, 4, 6, 8, 10, 13], '14 narrow bars: the label next to the last is dropped');
    eq(shown(60), [0, 2, 4, 6, 8, 10, 12, 13], 'with room for both, both stay');
    const days = Array.from({ length: 30 }, (_, i) => `Oct ${i + 1}`);
    eq(axisLabelShown(24, days, 30), true, 'five steps from the end on a wide chart is plenty of room');
  }],
  ['productNames: current listing title, else the newest title it sold under', () => {
    const sale = (ts, listing_id, title) => ({ create_timestamp: ts, transactions: [{ listing_id, title }] });
    const orders = [sale(at(2026, 3, 20), 1, 'Ring'), sale(at(2026, 3, 1), 1, 'Name Ring'), sale(at(2026, 3, 5), 2, 'Print')];
    const sold = productNames(orders);
    eq(sold('1'), { name: 'Ring', otherNames: ['Name Ring'] }, 'newest sale wins, whatever the order of the list');
    eq(productNames([...orders].reverse())('1').name, 'Ring', 'list order does not matter');
    eq(productNames(orders, [{ listing_id: 1, title: 'Ring — Sterling' }])('1'), { name: 'Ring — Sterling', otherNames: ['Ring', 'Name Ring'] }, 'current listing title');
    eq(sold('99'), { name: null, otherNames: [] }, 'unknown listing');
    eq(productKey({ listing_id: 7 }), productKey({ listing_id: '7' }), 'numeric and string ids match');
  }],
  ['topProducts: a renamed listing is one product; same title on two listings stays two', () => {
    const tx = (listing_id, title, dollars, quantity = 1) => ({ listing_id, title, price: usd(dollars), quantity });
    const orders = [
      { create_timestamp: at(2026, 3, 1),  transactions: [tx(1, 'Name Ring', 100), tx(2, 'Print', 20, 3)] },
      { create_timestamp: at(2026, 3, 20), transactions: [tx(1, 'Ring', 100, 2), tx(3, 'Print', 30)] },
      { create_timestamp: at(2026, 3, 21), transactions: [{ title: 'No id', price: usd(5) }] },
    ];
    const t = topProducts(orders);
    eq(t.rows.map(p => [p.key, p.name, p.units, p.revenue]), [['1', 'Ring', 3, 300], ['2', 'Print', 3, 60], ['3', 'Print', 1, 30], ['title:No id', 'No id', 1, 5]]);
    eq(t.rows[0].otherNames, ['Name Ring']);
    eq(t.total, 4);
    eq(topProducts(orders, { by: 'units', limit: 2 }).rows.map(p => p.key), ['1', '2'], 'by units, limited');
  }],
  ['variationStats: groups by listing, drops personalization, folds extra combos into Other', () => {
    const tx = (listing_id, title, quantity, ...values) => ({ listing_id, title, quantity, variations: [
      ...values.map((v, i) => ({ formatted_name: i ? 'Metal' : 'Size', formatted_value: v })),
      { formatted_name: 'Personalization', formatted_value: 'Ava', question_id: 1 },
    ] });
    const v = variationStats([
      { transactions: [tx(1, 'Ring', 2, '7', 'Gold'), tx(1, 'Ring (renamed)', 1, '7', 'Gold'), tx(1, 'Ring', 1, '8', 'Silver')] },
      { transactions: [tx(2, 'Print', 1, 'A4'), { listing_id: 3, title: 'Plain', quantity: 5, variations: [] }] },
    ]);
    eq(v.map(p => [p.key, p.units]), [['1', 4], ['2', 1]], 'by units; listings without variations skipped');
    eq(v[0].otherNames.length, 1, 'the renamed listing is still one product');
    eq(v[0].combos, [{ label: '7 · Gold', units: 3 }, { label: '8 · Silver', units: 1 }]);
    eq(v[0].dims, 'Size · Metal');
    const many = variationStats([{ transactions: ['a', 'b', 'c'].map(x => tx(9, 'T', 1, x)) }], { maxCombos: 2 });
    eq(many[0].combos.map(c => c.label), ['a', 'b', 'Other']);
  }],
  ['basketStats: 5+ bin and nice value bands from the 95th percentile', () => {
    const o = (units, total) => ({ grandtotal: usd(total), transactions: [{ quantity: units }] });
    const b = basketStats([o(1, 10), o(1, 20), o(2, 30), o(7, 40), o(3, 55), { grandtotal: usd(60) }]);
    eq(b.unitBins.map(x => x.count), [2, 1, 1, 0, 1]);
    eq([b.avgUnits, b.multiShare], [14 / 5, 3 / 5], 'orders without line items left out');
    eq(b.step, 10);
    eq(b.valueBins.map(x => [x.min, x.max, x.count]), [[0, 10, 0], [10, 20, 1], [20, 30, 1], [30, 40, 1], [40, 50, 1], [50, null, 2]]);
    eq(basketStats([]).avgUnits, null, 'empty');
  }],
  ['discountStats: share, total, and average order with vs without', () => {
    const d = discountStats([
      order({ discount_amt: usd(5), grandtotal: usd(45) }),
      order({ discount_amt: usd(0), grandtotal: usd(60) }),
      order({ grandtotal: usd(40) }),
    ]);
    eq([d.discounted, d.totalDiscount, d.aovWith, d.aovWithout], [1, 5, 45, 50]);
    eq(d.share, 1 / 3);
    const orders = [
      order({ discount_amt: usd(2.1), total_price: usd(21), create_timestamp: at(2026, 3, 1) }),
      order({ discount_amt: usd(0) }),
      order({ discount_amt: usd(3.35), create_timestamp: at(2026, 3, 9) }),
    ];
    const list = discountedOrders(orders);
    eq(list.map(x => [x.discountCents, x.itemsCents]), [[335, null], [210, 2100]], 'newest first');
    eq(list.reduce((s, x) => s + x.discountCents, 0) / 100, discountStats(orders).totalDiscount, 'sums to Discounts Given');
  }],
  ['fulfilment: shipments first, transaction fallback; digital, canceled and unshipped left out', () => {
    const paid = at(2026, 3, 10, 9);
    const tx = (extra = {}) => ({ paid_timestamp: paid, expected_ship_date: at(2026, 3, 12, 0), ...extra });
    const f = fulfilment([
      order({ transactions: [tx()], shipments: [{ shipment_notification_timestamp: at(2026, 3, 11, 9) }] }), // 1 day, on time
      order({ transactions: [tx({ shipped_timestamp: at(2026, 3, 12, 22) })] }),                             // 2.5 days, still on time that day
      order({ transactions: [tx()], shipments: [{ shipment_notification_timestamp: at(2026, 3, 17, 9) }] }), // 7 days, late
      order({ transactions: [tx({ is_digital: true, shipped_timestamp: paid })] }),
      order({ status: 'Canceled', transactions: [tx()] }),
      order({ transactions: [tx()] }),
    ]);
    eq(f.shipped, 3);
    eq(f.medianDays.toFixed(3), '2.542');
    eq(f.bins.map(b => b.count), [0, 1, 1, 0, 0, 1, 0, 0]);
    eq(f.onTimeRate, 2 / 3);
    eq(fulfilment([]).medianDays, null, 'empty');
  }],
  ['backlog: unshipped physical orders by age; overdue after the expected day ends', () => {
    const now = at(2026, 3, 20, 12);
    const o = (paidDay, extra = {}) => order({
      is_shipped: false,
      transactions: [{ paid_timestamp: at(2026, 3, paidDay, 12), expected_ship_date: at(2026, 3, paidDay + 3, 0) }],
      ...extra,
    });
    const b = backlog([
      o(20),                             // today
      o(17),                             // 3 days old, due by the end of today
      o(10),                             // 10 days old, overdue
      o(10, { status: 'canceled' }),     // never ships
      o(10, { is_shipped: true }),
      o(10, { is_shipped: undefined }),  // unknown: skipped
    ], now);
    eq([b.count, b.overdue, b.oldestDays], [3, 1, 10]);
    eq(b.bins.map(x => x.count), [1, 1, 0, 1]);
    const list = unshippedOrders([o(17), o(20), o(10), o(10, { status: 'canceled' })], now);
    eq(list.map(u => [Math.round(u.ageDays), u.overdue]), [[10, true], [3, false], [0, false]], 'the same orders, oldest first');
  }],
  ['refundStats: statuses in any case, plus refunds on other orders', () => {
    const r = refundStats([
      order({ status: 'Canceled', refunds: [{ amount: usd(20) }] }),
      order({ status: 'fully refunded', refunds: [{ amount: usd(15) }] }),
      order({ status: 'Partially Refunded', refunds: [{ amount: usd(5) }] }),
      order({ status: 'completed', refunds: [{ amount: usd(2.5) }] }),
      order({ status: 'paid' }),
    ]);
    eq([r.canceled, r.fullyRefunded, r.partiallyRefunded, r.affected, r.refundedAmount], [1, 1, 1, 4, 42.5]);
    eq(r.rate, 0.8);
    const list = refundedOrders([
      order({ status: 'completed', refunds: [{ amount: usd(2.5), reason: 'damaged' }, { amount: usd(1), reason: 'damaged' }], create_timestamp: at(2026, 3, 2) }),
      order({ status: 'Cancelled', create_timestamp: at(2026, 3, 5) }),
      order({ status: 'paid' }),
    ]);
    eq(list.map(x => [x.kind, x.refundedCents, x.reasons]), [['canceled', 0, []], [null, 350, ['damaged']]], 'newest first; reasons once each');
  }],
  ['heatmapMatrix: local weekday × hour, with the busiest cell', () => {
    const m = heatmapMatrix([
      order({ create_timestamp: at(2026, 3, 10, 23) }),
      order({ create_timestamp: at(2026, 3, 10, 23), grandtotal: usd(5) }),
      order({ create_timestamp: at(2026, 3, 15, 0) }),
    ]);
    eq(m.counts[2][23], 2, 'Tuesday 11pm');
    eq(m.counts[0][0], 1, 'Sunday midnight');
    eq(m.revenue[2][23], 15);
    eq(m.peak, { day: 2, hour: 23, count: 2 });
  }],
  ['drawHeatmap draws 7 × 24 cells; hourLabel uses 12-hour times', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    grid[1][5] = 3;
    drawHeatmap(svg, document.createElement('div'), grid, grid, '#000', String);
    eq(svg.querySelectorAll('rect[data-w]').length, 168);
    eq([0, 1, 11, 12, 13, 23].map(hourLabel), ['12a', '1a', '11a', '12p', '1p', '11p']);
  }],
  ['listingStats: joins sales by listing, flags, lifetime rates, sold-but-unlisted', () => {
    const L = listingStats([
      { listing_id: 1, title: 'Ring',  state: 'active',   quantity: 2,  views: 1000, num_favorers: 50, price: usd(76) },
      { listing_id: 2, title: 'Mug',   state: 'active',   quantity: 10, views: 0,    num_favorers: 5 },
      { listing_id: 3, title: 'Print', state: 'sold_out', quantity: 0,  views: 400,  num_favorers: 10 },
    ], [
      { transactions: [{ listing_id: 1, quantity: 2, price: usd(76) }, { listing_id: 3, quantity: 1, price: usd(20) }] },
      { transactions: [{ listing_id: 9, quantity: 3, price: usd(10) }] }, // listing 9 isn't listed any more
    ]);
    eq(L.rows.map(r => [r.id, r.units, r.revenue]), [[1, 2, 152], [3, 1, 20], [2, 0, 0]], 'sorted by revenue');
    eq(L.rows.map(r => [r.noSales, r.lowStock, r.soldOut]), [[false, true, false], [false, false, true], [true, false, false]]);
    eq([L.rows[0].favPer100Views.toFixed(1), L.rows[0].salesPer100Views.toFixed(2)], ['5.0', '0.20']);
    eq([L.rows[2].views, L.rows[2].favPer100Views], [null, null], 'views 0 = not counted yet');
    eq([L.active, L.soldOut, L.noSales, L.lowStock], [2, 1, 1, 1]);
    eq(L.favPer100Views.toFixed(2), (60 / 1400 * 100).toFixed(2), 'only listings with views count');
    eq(L.gone, { listings: 1, units: 3, revenue: 30 });
  }],
  ['reviewStats: ratings in the period; coverage counts later reviews of its items', () => {
    const rev = (rating, day, extra = {}) => ({ rating, created_timestamp: at(2026, 3, day), ...extra });
    const r = reviewStats([
      rev(5, 5,  { transaction_id: 11, listing_id: 1 }),
      rev(4, 12, { transaction_id: 12, listing_id: 1 }),
      rev(2, 20, { transaction_id: 13, listing_id: 1, review: 'Late' }),
      rev(5, 28, { transaction_id: 21, listing_id: 2 }),
      rev(5, 2,  { transaction_id: 99, listing_id: 2 }),                                  // before the period
      { rating: 3, created_timestamp: at(2026, 4, 10), transaction_id: 14, listing_id: 3 }, // after it, but for one of its items
      rev(0, 15),                                                                         // not a valid rating
    ], [
      { transactions: [{ transaction_id: 11 }, { transaction_id: 12 }, { transaction_id: 13 }, { transaction_id: 14 }] },
      { transactions: [{ transaction_id: 15 }, { transaction_id: 16 }, { transaction_id: 21 }, {}] },
    ], { from: at(2026, 3, 3, 0), to: at(2026, 3, 31, 23) });
    eq([r.count, r.avg], [4, 4]);
    eq(r.stars.map(s => s.count), [2, 1, 0, 1, 0], '5★ to 1★');
    eq(r.monthly.map(m => [m.label, m.count, m.avg]), [['Mar 2026', 4, 4]]);
    const gap = reviewStats([rev(5, 5), { rating: 3, created_timestamp: at(2026, 5, 2) }], [], { from: at(2026, 3, 1, 0), to: at(2026, 5, 31, 23) });
    eq(gap.monthly.map(m => [m.label, m.count, m.avg]), [['Mar 2026', 1, 5], ['Apr 2026', 0, null], ['May 2026', 1, 3]], 'months without reviews are kept, with no average');
    eq(r.byListing, [{ id: 1, count: 3, avg: 11 / 3 }], 'listings with 3+ reviews only');
    eq(r.low.map(x => x.review), ['Late']);
    eq([r.items, r.itemsReviewed, r.coverage], [7, 5, 5 / 7]);
  }],
];
