// Unit tests for the pure helpers — run via test/finance.test.html in a browser.
import { bucketOrders, feeTally, groupFees } from '../js/charts.js';
import { csvCell } from '../js/export.js';
import { categoriseEntry, computeLedgerTotals } from '../js/finance.js';
import { dateStrToTs, escHtml, localDateKey, orderSales, weekdayCounts } from '../js/util.js';

function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

const entry = (ledger_type, amount) => ({ ledger_type, amount });

export const tests = [
  ['sale credit is revenue', () => {
    eq(categoriseEntry(entry('PAYMENT_GROSS', 5000)), 'revenue');
    eq(categoriseEntry(entry('sale', 1200)), 'revenue');
  }],
  ["'transaction' is revenue when positive, fee when negative", () => {
    eq(categoriseEntry(entry('transaction', 1000)), 'revenue');
    eq(categoriseEntry(entry('transaction', -65)), 'fee');
  }],
  ['known fee types are fees', () => {
    for (const t of ['PAYMENT_PROCESSING_FEE', 'shipping_labels', 'prolist', 'listing', 'offsite_ads_fee']) {
      eq(categoriseEntry(entry(t, -100)), 'fee', t);
    }
  }],
  ['payouts are pass-through; sales tax and buyer fees are collected for others', () => {
    for (const t of ['DISBURSE', 'DISBURSE2', 'deposit']) {
      eq(categoriseEntry(entry(t, -5000)), 'passthrough', t);
      eq(categoriseEntry(entry(t, 5000)), 'passthrough', t);
    }
    for (const t of ['sales_tax', 'sales_tax_refund', 'buyer_fee']) {
      eq(categoriseEntry(entry(t, -5000)), 'collected', t);
      eq(categoriseEntry(entry(t, 5000)), 'collected', t);
    }
  }],
  ['bounced payouts and card top-ups are pass-throughs, not income', () => {
    for (const t of ['ADYENBALANCE_REVERSAL', 'RECOUP', 'billing_payment']) eq(categoriseEntry(entry(t, 500)), 'passthrough', t);
    // A payout bounced and was re-sent; Etsy charged the card to clear a negative balance
    const t = computeLedgerTotals([
      entry('PAYMENT_GROSS', 30000), entry('transaction', -1950),
      entry('DISBURSE2', -29236), entry('ADYENBALANCE_REVERSAL', 29236), entry('DISBURSE2', -29236),
      entry('shipping_labels', -1678), entry('RECOUP', 1678),
    ]);
    eq([t.grossCents, t.feesCents, t.netCents], [30000, -3628, 26372]);
  }],
  ['Share & Save and unknown credits reduce fees instead of counting as sales', () => {
    eq(categoriseEntry(entry('SELLER_DRIVEN_TRAFFIC_CREDIT', 116)), 'refund');
    eq(categoriseEntry(entry('SOME_NEW_CREDIT', 50)), 'refund');
    eq(categoriseEntry(entry('mystery_refund', 50)), 'refund');
    const entries = [entry('PAYMENT_GROSS', 3131), entry('sales_tax', -232), entry('transaction', -154), entry('SELLER_DRIVEN_TRAFFIC_CREDIT', 116)];
    const t = computeLedgerTotals(entries);
    eq([t.grossCents, t.feesCents, t.netCents], [2899, -38, 2861]);
    eq(feeTally(entries), { transaction: 38 });
  }],
  ['USPS label adjustment credit is a refund that reduces fees', () => {
    eq(categoriseEntry(entry('shipping_label_usps_adjustment_credit', 102)), 'refund');
    const t = computeLedgerTotals([entry('PAYMENT_GROSS', 5000), entry('shipping_labels', -840), entry('shipping_label_usps_adjustment_credit', 102)]);
    eq([t.grossCents, t.feesCents, t.netCents], [5000, -738, 4262]);
  }],
  ['refund types are refunds regardless of sign', () => {
    eq(categoriseEntry(entry('REFUND_GROSS', -3322)), 'refund');
    eq(categoriseEntry(entry('transaction_refund', 65)), 'refund');
  }],
  ['unknown types fall back to sign (credits reduce fees, never count as sales); zero is pass-through', () => {
    eq(categoriseEntry(entry('mystery', 10)), 'refund');
    eq(categoriseEntry(entry('mystery', -10)), 'fee');
    eq(categoriseEntry(entry('mystery', 0)), 'passthrough');
  }],
  ['ledger_type wins over type/description fallbacks', () => {
    eq(categoriseEntry({ ledger_type: 'DISBURSE2', type: 'sale', amount: -100 }), 'passthrough');
    eq(categoriseEntry({ description: 'sales_tax', amount: -50 }), 'collected');
  }],
  ['computeLedgerTotals: sale incl. tax, tax debit, fees, payout', () => {
    // Etsy records the sale with the buyer's tax, then debits the tax
    const t = computeLedgerTotals([
      entry('PAYMENT_GROSS', 10800),
      entry('sales_tax', -800),
      entry('transaction', -650),
      entry('PAYMENT_PROCESSING_FEE', -325),
      entry('DISBURSE2', -9000),
    ]);
    eq(t.grossCents, 10000, 'gross excludes tax');
    eq(t.feesCents, -975, 'fees');
    eq(t.netCents, 9025, 'net');
    eq(t.collectedCents, -800, 'tax');
  }],
  ['computeLedgerTotals: buyer fee is in the sale and taken back out, not a seller fee', () => {
    const t = computeLedgerTotals([entry('PAYMENT_GROSS', 2611), entry('sales_tax', -189), entry('buyer_fee', -31), entry('transaction', -120)]);
    eq([t.grossCents, t.feesCents, t.netCents], [2391, -120, 2271]);
  }],
  ['computeLedgerTotals: full refund with tax; net equals the non-payout balance change', () => {
    const entries = [
      entry('PAYMENT_GROSS', 10800), entry('sales_tax', -800), entry('transaction', -650),
      entry('REFUND_GROSS', -10800), entry('sales_tax_refund', 800), entry('transaction_refund', 650),
      entry('prolist', -120), entry('DISBURSE2', -500),
    ];
    const t = computeLedgerTotals(entries);
    eq([t.grossCents, t.feesCents, t.netCents], [0, -120, -120]);
    const nonPayout = entries.filter(e => e.ledger_type !== 'DISBURSE2').reduce((s, e) => s + e.amount, 0);
    eq(t.netCents, nonPayout, 'net = balance change excluding payouts');
  }],
  ['computeLedgerTotals: refund reduces gross, fee refund reduces fees', () => {
    const t = computeLedgerTotals([
      entry('PAYMENT_GROSS', 10000),
      entry('transaction', -650),
      entry('REFUND_GROSS', -3000),
      entry('transaction_refund', 195),
    ]);
    eq(t.grossCents, 7000, 'gross');
    eq(t.feesCents, -455, 'fees');
    eq(t.netCents, 6545, 'net');
    eq(t.refundGrossCents, -3000, 'refundGross');
    eq(t.refundFeesCents, 195, 'refundFees');
  }],
  ['computeLedgerTotals: empty input', () => {
    eq(computeLedgerTotals([]), { grossCents: 0, feesCents: 0, netCents: 0, refundGrossCents: 0, refundFeesCents: 0, collectedCents: 0 });
  }],
  ['groupFees merges listing + LISTING_FEE and sums to the total', () => {
    const rows = groupFees({ listing: 20, LISTING_FEE: 20, transaction: 100, mystery_fee: 5, other_mystery: 5 });
    eq(rows.map(r => [r.label, r.cents]), [['Transaction Fees', 100], ['Listing Fees', 40], ['Other', 10]]);
    const more = groupFees({ transaction: 100, transaction_quantity: 20, listing_private: 20, renew_sold_auto: 20, renew_sold: 20 });
    eq(more.map(r => [r.label, r.cents]), [['Transaction Fees', 120], ['Listing Renewals', 40], ['Listing Fees', 20]]);
  }],
  ['feeTally nets fee refunds against their fee and matches Total Fees', () => {
    const entries = [
      entry('PAYMENT_GROSS', 10000), entry('transaction', -650), entry('transaction_refund', 200),
      entry('shipping_labels', -840), entry('shipping_label_usps_adjustment_credit', 102),
      entry('REFUND_GROSS', -3000), entry('mystery_credit_refund', 0), entry('sales_tax', -800),
    ];
    const tally = feeTally(entries);
    eq(tally, { transaction: 450, shipping_labels: 738 });
    eq(Object.values(tally).reduce((s, c) => s + c, 0), -computeLedgerTotals(entries).feesCents, 'sums to Total Fees');
  }],
  ['orderSales leaves out sales tax and delivery fees', () => {
    const usd = amount => ({ amount, divisor: 100 });
    // Real Colorado order: 18.50 items + 5.39 shipping + 1.89 tax + 0.31 delivery fee = 26.09
    eq(orderSales({ subtotal: usd(1850), total_shipping_cost: usd(539), total_tax_cost: usd(189), grandtotal: usd(2609) }), 23.89);
    eq(orderSales({ subtotal: usd(1000), total_shipping_cost: usd(500), gift_wrap_price: usd(300), grandtotal: usd(1900) }), 18);
    eq(orderSales({ grandtotal: usd(1080), total_tax_cost: usd(80) }), 10, 'no subtotal: grand total less tax');
  }],
  ['weekdayCounts counts every calendar day in the range, inclusive', () => {
    const ts = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime() / 1000;
    // Sun 1 Mar 2026 .. Sat 14 Mar 2026: two of each weekday
    eq(weekdayCounts(ts(2026, 3, 1, 0), ts(2026, 3, 14, 23)), [2, 2, 2, 2, 2, 2, 2]);
    // Mon 9 Mar .. Wed 11 Mar, times of day don't matter
    eq(weekdayCounts(ts(2026, 3, 9, 23), ts(2026, 3, 11, 1)), [0, 1, 1, 1, 0, 0, 0]);
  }],
  ['dateStrToTs uses local-day boundaries', () => {
    const from = dateStrToTs('2026-03-10'), to = dateStrToTs('2026-03-10', true);
    eq(localDateKey(new Date(from * 1000)), '2026-03-10', 'from');
    eq(localDateKey(new Date(to * 1000)), '2026-03-10', 'to');
    eq(to - from, 86399, 'span');
    eq(dateStrToTs(''), null);
  }],
  ['bucketOrders groups by local day/week/month', () => {
    const at = (y, m, d, h) => ({ create_timestamp: new Date(y, m - 1, d, h).getTime() / 1000, grandtotal: { amount: 1000, divisor: 100 } });
    // 23:00 and 00:00 local are different days, whatever the UTC date
    const orders = [at(2026, 3, 9, 23), at(2026, 3, 10, 0), at(2026, 3, 10, 12), at(2026, 3, 16, 9)];
    eq(bucketOrders(orders, 'day').map(b => b.count), [1, 2, 1], 'day');
    eq(bucketOrders(orders, 'week').map(b => b.count), [3, 1], 'week (Mon 9th, Mon 16th)');
    eq(bucketOrders(orders, 'month').map(b => [b.count, b.revenue]), [[4, 40]], 'month');
  }],
  ['escHtml escapes attribute-breaking quotes', () => {
    eq(escHtml(`"><img src=x onerror='a'>&`), '&quot;&gt;&lt;img src=x onerror=&#39;a&#39;&gt;&amp;');
    eq(escHtml(null), '');
    eq(escHtml(0), '0');
  }],
  ['csvCell neutralises formulas but keeps negative numbers', () => {
    eq(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    eq(csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
    eq(csvCell('-6.50'), '"-6.50"');
    eq(csvCell(-3), '"-3"');
    eq(csvCell('Buyer'), '"Buyer"');
    eq(csvCell(null), '""');
  }],
];
