// Fake Etsy API for test/mock.html. Intercepts fetch() calls to the Worker
// and serves deterministic receipts, transactions, payments and ledger entries.
import { WORKER_BASE } from '../js/config.js';

const SHOP_ID = 999;
const DAY = 86400;
const PRODUCTS = [
  ['Wall Art Print', 2400], ['Custom Ring', 12800], ['Dried Flower Bunch', 2900],
  ['Wax Seal Stamp Set', 4400], ['Linen Pillowcase', 3800],
];

// Small seeded PRNG so every load produces the same data
let seed = 42;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const usd = cents => ({ amount: cents, divisor: 100, currency_code: 'USD' });

function buildData() {
  const now = Math.floor(Date.now() / 1000);
  const receipts = [], ledger = [];
  let entryId = 1, balance = 0;
  const addLedger = (ts, ledger_type, amount, reference_type, reference_id) => {
    balance += amount;
    ledger.push({ entry_id: entryId++, ledger_type, amount, balance, created_timestamp: ts, reference_type, reference_id: String(reference_id) });
  };

  for (let i = 0; i < 400; i++) {
    const ts = now - Math.floor(rand() * 400 * DAY);
    const rid = 100000 + i;
    const n = 1 + Math.floor(rand() * 2);
    const transactions = Array.from({ length: n }, () => {
      const [title, price] = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
      return { title, price: usd(price), quantity: 1 + Math.floor(rand() * 2), sku: `SKU-${price}` };
    });
    const subtotal = transactions.reduce((s, t) => s + t.price.amount * t.quantity, 0);
    const shipping = 500, tax = Math.round(subtotal * 0.08);
    receipts.push({
      receipt_id: rid, create_timestamp: ts, name: i === 0 ? '<b>Bold</b> "Buyer"' : `Buyer ${i}`,
      city: i === 0 ? '"><img src=x onerror="window.__xss=1">' : 'Portland', state: 'OR', country_iso: 'US',
      status: rand() > 0.3 ? 'Completed' : 'Paid', was_paid: true, was_shipped: true,
      payment_method: 'cc', is_gift: false, message_from_buyer: i === 1 ? '=HYPERLINK("http://evil")' : '',
      subtotal: usd(subtotal), total_shipping_cost: usd(shipping), total_tax_cost: usd(tax),
      discount_amt: usd(0), grandtotal: usd(subtotal + shipping + tax),
      transaction_count: n, transactions,
    });
    addLedger(ts, 'PAYMENT_GROSS', subtotal + shipping, 'receipt', rid);
    addLedger(ts, 'sales_tax', tax, 'receipt', rid);
    addLedger(ts, 'transaction', -Math.round(subtotal * 0.065), 'transaction', rid);
    addLedger(ts, 'PAYMENT_PROCESSING_FEE', -Math.round((subtotal + shipping) * 0.03 + 25), 'payment', rid);
    addLedger(ts, 'listing', -20, 'listing', rid);
    if (i % 5 === 0) addLedger(ts, 'LISTING_FEE', -20, 'listing', rid);
    if (i % 3 === 0) addLedger(ts, 'shipping_labels', -450, 'shipping_label', rid);
    if (i % 40 === 0) addLedger(ts + 3600, 'sales_tax_refund', -tax, 'receipt', rid);
  }
  for (let d = 0; d < 400; d += 7) addLedger(now - d * DAY, 'DISBURSE2', -20000, 'disbursement', d);
  receipts.sort((a, b) => b.create_timestamp - a.create_timestamp);
  return { receipts, ledger };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function installMockApi({ latencyMs = 5 } = {}) {
  const { receipts, ledger } = buildData();
  const realFetch = window.fetch.bind(window);
  window.mockStats = { requests: 0, byPath: {} };

  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.href.startsWith(WORKER_BASE)) return realFetch(input, init);

    window.mockStats.requests++;
    const key = url.pathname.replace(/\d+/g, ':id');
    window.mockStats.byPath[key] = (window.mockStats.byPath[key] || 0) + 1;
    await new Promise(r => setTimeout(r, latencyMs));

    const q = url.searchParams, p = url.pathname;

    // Simulate an expired access token: any token containing "expired" gets 401
    const auth = (init?.headers || {})['Authorization'] || '';
    if (p !== '/token' && auth.includes('expired')) return json({ error: 'invalid_token' }, 401);
    const limit  = +(q.get('limit') || 25), offset = +(q.get('offset') || 0);
    const min = +(q.get('min_created') || 0), max = +(q.get('max_created') || Infinity);
    const inRange = ts => ts >= min && ts <= max;
    let m;

    if (p === '/token') {
      const body = new URLSearchParams(init?.body || '');
      return json({ access_token: '12345.fresh' + Date.now(), refresh_token: '12345.refresh', expires_in: 3600, token_type: 'Bearer', grant_type: body.get('grant_type') });
    }
    if (/^\/application\/users\/\d+\/shops$/.test(p)) {
      return json({ shop_id: SHOP_ID, shop_name: 'MockShop', currency_code: window.mockCurrency || 'USD' });
    }
    if (/^\/application\/shops\/\d+\/receipts$/.test(p)) {
      const all = receipts.filter(r => inRange(r.create_timestamp));
      return json({ count: all.length, results: all.slice(offset, offset + limit) });
    }
    if ((m = p.match(/^\/application\/shops\/\d+\/receipts\/(\d+)\/transactions$/))) {
      const r = receipts.find(r => r.receipt_id === +m[1]);
      return r ? json({ count: r.transactions.length, results: r.transactions }) : json({ error: 'not found' }, 404);
    }
    if ((m = p.match(/^\/application\/shops\/\d+\/receipts\/(\d+)\/payments$/))) {
      const r = receipts.find(r => r.receipt_id === +m[1]);
      if (!r || r.receipt_id % 7 === 0) return json({ error: 'not found' }, 404);
      const gross = r.grandtotal.amount, fees = Math.round(gross * 0.03 + 25);
      return json({ count: 1, results: [{ status: 'settled', amount_gross: usd(gross), amount_fees: usd(fees), amount_net: usd(gross - fees) }] });
    }
    if (/^\/application\/shops\/\d+\/payment-account\/ledger-entries$/.test(p)) {
      const all = ledger.filter(e => inRange(e.created_timestamp));
      return json({ count: all.length, results: all.slice(offset, offset + limit) });
    }
    return json({ error: `mock: no route for ${p}` }, 404);
  };
}
