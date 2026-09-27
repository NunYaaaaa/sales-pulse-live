// Unit tests for the pure helpers — run via test/finance.test.html in a browser.
import { bucketOrders, groupFees } from '../js/charts.js';
import { csvCell } from '../js/export.js';
import { categoriseEntry, computeLedgerTotals } from '../js/finance.js';
import { dateStrToTs, escHtml, localDateKey } from '../js/util.js';

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
  ['payouts and sales tax are pass-through', () => {
    for (const t of ['DISBURSE', 'DISBURSE2', 'deposit', 'sales_tax', 'sales_tax_refund']) {
      eq(categoriseEntry(entry(t, -5000)), 'passthrough', t);
      eq(categoriseEntry(entry(t, 5000)), 'passthrough', t);
    }
  }],
  ['refund types are refunds regardless of sign', () => {
    eq(categoriseEntry(entry('REFUND_GROSS', -3322)), 'refund');
    eq(categoriseEntry(entry('transaction_refund', 65)), 'refund');
  }],
  ['unknown types fall back to sign; zero is pass-through', () => {
    eq(categoriseEntry(entry('mystery', 10)), 'revenue');
    eq(categoriseEntry(entry('mystery', -10)), 'fee');
    eq(categoriseEntry(entry('mystery', 0)), 'passthrough');
  }],
  ['ledger_type wins over type/description fallbacks', () => {
    eq(categoriseEntry({ ledger_type: 'DISBURSE2', type: 'sale', amount: -100 }), 'passthrough');
    eq(categoriseEntry({ description: 'sales_tax', amount: 50 }), 'passthrough');
  }],
  ['computeLedgerTotals: sale, fees, payout, tax', () => {
    const t = computeLedgerTotals([
      entry('PAYMENT_GROSS', 10000),
      entry('transaction', -650),
      entry('PAYMENT_PROCESSING_FEE', -325),
      entry('sales_tax', 800),
      entry('DISBURSE2', -9000),
    ]);
    eq(t.grossCents, 10000, 'gross');
    eq(t.feesCents, -975, 'fees');
    eq(t.netCents, 9025, 'net');
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
    eq(computeLedgerTotals([]), { grossCents: 0, feesCents: 0, netCents: 0, refundGrossCents: 0, refundFeesCents: 0 });
  }],
  ['groupFees merges listing + LISTING_FEE and sums to the total', () => {
    const rows = groupFees({ listing: 20, LISTING_FEE: 20, transaction: 100, mystery_fee: 5, renew_sold: 5 });
    eq(rows.map(r => [r.label, r.cents]), [['Transaction Fees', 100], ['Listing Fees', 40], ['Other', 10]]);
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
