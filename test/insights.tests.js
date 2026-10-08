// Unit tests for the Insights calculations (js/insights.js) and the chart
// primitives' escaping — run via test/finance.test.html in a browser.
import { drawBarChart, drawLineChart } from '../js/charts.js';
import { adSpend, customerStats, feeRateSeries, geography, payoutStats, revenueComposition, shippingPnL } from '../js/insights.js';
import { bucketStart, pickBucket } from '../js/util.js';

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
  ['pickBucket: day up to 35 days, week up to 180, then month', () => {
    eq(pickBucket(0, 35 * 86400), 'day');
    eq(pickBucket(0, 36 * 86400), 'week');
    eq(pickBucket(0, 181 * 86400), 'month');
  }],
  ['feeRateSeries: per-bucket rates, pass-throughs ignored, empty buckets null', () => {
    const s = feeRateSeries([
      le('PAYMENT_GROSS', 10000, at(2026, 3, 10)),
      le('transaction', -650, at(2026, 3, 10)),
      le('sales_tax', 800, at(2026, 3, 10)),
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
];
