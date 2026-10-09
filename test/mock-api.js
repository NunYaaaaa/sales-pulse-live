// Fake Etsy API for test/mock.html. Intercepts fetch() calls to the Worker
// and serves deterministic receipts, transactions, payments and ledger entries.
import { WORKER_BASE } from '../js/config.js';

const SHOP_ID = 999;
const DAY = 86400;
const PRODUCTS = [
  ['Wall Art Print', 2400], ['Custom Ring', 12800], ['Dried Flower Bunch', 2900],
  ['Wax Seal Stamp Set', 4400], ['Linen Pillowcase', 3800],
];

// Small seeded PRNGs so every load produces the same data. rand() drives the
// original fields; rand2() drives fields added later, so adding them didn't
// change the original numbers.
let seed = 42;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let seed2 = 7;
const rand2 = () => (seed2 = (seed2 * 16807) % 2147483647) / 2147483647;
const pick = arr => arr[Math.floor(rand2() * arr.length)];
const usd = cents => ({ amount: cents, divisor: 100, currency_code: 'USD' });

const XSS = '"><img src=x onerror="window.__xss=1">';
const US_STATES = ['OR', 'CA', 'NY', 'TX', 'WA', 'FL', 'IL', 'CO'];
const CITY = { US: 'Portland', GB: 'Bristol', CA: 'Toronto', DE: 'Berlin', AU: 'Melbourne' };
const VARIATIONS = {
  'Wall Art Print':   [['Size', ['A4', 'A3', 'A2']]],
  'Custom Ring':      [['Ring size', ['6', '7', '8']], ['Metal', ['Silver', 'Gold']]],
  'Linen Pillowcase': [['Color', ['Natural', 'Sage', 'Rust']]],
};

function variationsFor(title) {
  const v = (VARIATIONS[title] || []).map(([name, values]) => ({ formatted_name: name, formatted_value: pick(values) }));
  if (title === 'Custom Ring') v.push({ formatted_name: 'Personalization', formatted_value: pick(['Ava', 'Leo', 'Mia']), question_id: 1 });
  return v;
}

function country(i) {
  if (i % 23 === 7) return undefined; // address not shared
  if (i === 2) return 'US';
  const r = rand2();
  return r < 0.7 ? 'US' : r < 0.8 ? 'GB' : r < 0.88 ? 'CA' : r < 0.94 ? 'DE' : 'AU';
}

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
    const baseStatus = rand() > 0.3 ? 'completed' : 'paid';

    // Money
    const itemTotal = transactions.reduce((s, t) => s + t.price.amount * t.quantity, 0);
    const discount  = rand2() < 0.15 ? Math.round(itemTotal * 0.1) : 0;
    const isGift    = rand2() < 0.06;
    const giftWrap  = isGift ? 300 : 0;
    const subtotal  = itemTotal - discount;
    const shipping = 500, tax = Math.round(subtotal * 0.08);

    // Status, refunds and shipping
    let status = baseStatus;
    if (i % 50 === 3) status = 'canceled';
    else if (i % 37 === 4) status = 'fully refunded';
    else if (i % 29 === 6) status = 'partially refunded';
    const digital   = i % 60 === 13;
    const shippedTs = ts + Math.floor(rand2() * rand2() * 9) * DAY + 3 * 3600;
    const unshipped = status === 'canceled' || now - ts < 3 * DAY || i % 150 === 9 || shippedTs > now;
    const isShipped = digital || !unshipped;
    if (!isShipped && status === 'completed') status = 'paid';
    const refundCents = status === 'partially refunded' ? Math.round(subtotal * 0.3)
      : (status === 'canceled' || status === 'fully refunded') ? subtotal + shipping + giftWrap : 0;

    const buyer = i % 97 === 5 ? undefined : 5000 + Math.floor(rand2() ** 2 * 250);
    const cc = country(i);
    transactions.forEach((t, k) => {
      Object.assign(t, {
        transaction_id: rid * 10 + k, receipt_id: rid, buyer_user_id: buyer,
        listing_id: 7000 + PRODUCTS.findIndex(([title]) => title === t.title),
        paid_timestamp: ts, shipped_timestamp: isShipped && !digital ? shippedTs : null,
        expected_ship_date: digital ? null : ts + 3 * DAY, is_digital: digital,
        variations: variationsFor(t.title),
      });
      if (i === 3 && k === 0) t.variations.push({ formatted_name: 'Note', formatted_value: XSS });
    });

    receipts.push({
      receipt_id: rid, create_timestamp: ts, buyer_user_id: buyer,
      name: i === 0 ? '<b>Bold</b> "Buyer"' : `Buyer ${buyer ?? i}`,
      city: i === 0 ? XSS : cc && CITY[cc], country_iso: cc,
      state: cc === 'US' ? (i === 2 ? XSS : pick(US_STATES)) : cc === 'CA' ? 'ON' : undefined,
      status, is_paid: true, is_shipped: isShipped, was_paid: true, was_shipped: isShipped,
      payment_method: 'cc', is_gift: isGift, gift_message: isGift ? 'Happy birthday!' : '',
      message_from_buyer: i === 1 ? '=HYPERLINK("http://evil")' : '',
      total_price: usd(itemTotal), subtotal: usd(subtotal), total_shipping_cost: usd(shipping),
      total_tax_cost: usd(tax), discount_amt: usd(discount), gift_wrap_price: usd(giftWrap),
      grandtotal: usd(subtotal + shipping + tax + giftWrap),
      transaction_count: n, transactions,
      shipments: isShipped && !digital
        ? [{ receipt_shipping_id: rid, shipment_notification_timestamp: shippedTs, carrier_name: 'USPS', tracking_code: `9400${rid}` }]
        : [],
      refunds: refundCents ? [{ amount: usd(refundCents), created_timestamp: ts + 2 * DAY, reason: 'buyer request', status: 'completed' }] : [],
    });

    // As in real ledgers: the sale includes the buyer's tax, then Etsy debits the tax
    addLedger(ts, 'PAYMENT_GROSS', subtotal + shipping + giftWrap + tax, 'receipt', rid);
    addLedger(ts, 'sales_tax', -tax, 'receipt', rid);
    addLedger(ts, 'transaction', -Math.round(subtotal * 0.065), 'transaction', rid);
    addLedger(ts, 'PAYMENT_PROCESSING_FEE', -Math.round((subtotal + shipping) * 0.03 + 25), 'payment', rid);
    addLedger(ts, 'listing', -20, 'listing', rid);
    if (i % 5 === 0) addLedger(ts, 'LISTING_FEE', -20, 'listing', rid);
    if (i % 3 === 0) addLedger(ts, 'shipping_labels', -450, 'shipping_label', rid);
    if (i % 45 === 0) addLedger(ts + DAY, 'shipping_label_refund', 450, 'shipping_label', rid);
    if (i % 45 === 21) addLedger(ts + 4 * DAY, 'shipping_label_usps_adjustment_credit', 102, 'shipping_label', rid);
    if (i % 12 === 5) addLedger(ts, 'offsite_ads_fee', -Math.round((subtotal + shipping) * 0.15), 'receipt', rid);
    if (i === 17) addLedger(ts + DAY, 'offsite_ads_fee_refund', Math.round((subtotal + shipping) * 0.15), 'receipt', rid);
    if (refundCents) {
      // A full refund returns the buyer's tax too, and Etsy credits that tax back
      const fullRefund = status !== 'partially refunded';
      addLedger(ts + 2 * DAY, 'REFUND_GROSS', -(refundCents + (fullRefund ? tax : 0)), 'receipt', rid);
      if (fullRefund) addLedger(ts + 2 * DAY, 'sales_tax_refund', tax, 'receipt', rid);
      addLedger(ts + 2 * DAY, 'transaction_refund', Math.round(refundCents * 0.065), 'transaction', rid);
    }
  }
  for (let d = 0; d < 400; d += 7) addLedger(now - d * DAY, 'DISBURSE2', -20000, 'disbursement', d);
  for (let d = 0; d < 400; d++) addLedger(now - d * DAY - 7200, 'prolist', -(80 + Math.floor(rand2() * 220)), 'shop', SHOP_ID);
  receipts.sort((a, b) => b.create_timestamp - a.create_timestamp);
  return { receipts, ledger, listings: buildListings(), reviews: buildReviews(receipts, now) };
}

// Reviews: ~40% of shipped items, 5–20 days after the order, mostly 5 stars.
// One recent 2-star review carries an XSS payload in its text.
const REVIEW_TEXT = {
  good: ['Beautiful work, arrived quickly!', 'Exactly as pictured.', 'Lovely quality, would buy again.'],
  poor: ['Took a long time to arrive.', 'Not quite what I expected.'],
};
function buildReviews(receipts, now) {
  const reviews = [];
  for (const r of receipts) { // newest first
    if (!r.is_shipped || r.status === 'canceled') continue;
    for (const t of r.transactions) {
      if (rand2() > 0.4) continue;
      const created = r.create_timestamp + (5 + Math.floor(rand2() * 15)) * DAY;
      if (created > now) continue;
      const x = rand2(), bad = reviews.length === 4;
      const rating = bad ? 2 : x < 0.75 ? 5 : x < 0.9 ? 4 : x < 0.95 ? 3 : x < 0.98 ? 2 : 1;
      reviews.push({
        shop_id: SHOP_ID, listing_id: t.listing_id, transaction_id: t.transaction_id, buyer_user_id: r.buyer_user_id,
        rating, created_timestamp: created,
        review: bad ? `Odd ${XSS}` : pick(rating >= 4 ? REVIEW_TEXT.good : REVIEW_TEXT.poor),
      });
    }
  }
  return reviews;
}

// Listings: the products above (Linen Pillowcase left out, as if deactivated,
// Wax Seal Stamp Set sold out, Custom Ring low on stock) plus ~125 that never
// sold, enough to need two pages. A few have views not counted yet (0).
function buildListings() {
  const listings = PRODUCTS.slice(0, 4).map(([title, price], idx) => ({
    listing_id: 7000 + idx, title, price: usd(price), state: idx === 3 ? 'sold_out' : 'active',
    quantity: idx === 3 ? 0 : idx === 1 ? 2 : 12 + idx, views: 2000 + Math.floor(rand2() * 8000),
    num_favorers: 80 + Math.floor(rand2() * 400),
  }));
  for (let k = 0; k < 127; k++) {
    listings.push({
      listing_id: 7100 + k, title: k === 3 ? `Bad title ${XSS}` : `Handmade item ${k + 1}`,
      price: usd(1500 + Math.floor(rand2() * 60) * 100), state: k % 60 === 59 ? 'sold_out' : 'active',
      quantity: k % 60 === 59 ? 0 : 1 + Math.floor(rand2() * 20),
      views: k % 25 === 7 ? 0 : Math.floor(rand2() * 1500), num_favorers: Math.floor(rand2() * 60),
    });
  }
  return listings;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function installMockApi({ latencyMs = 5 } = {}) {
  const { receipts, ledger, listings, reviews } = buildData();
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
      return json({
        shop_id: SHOP_ID, shop_name: 'MockShop', currency_code: window.mockCurrency || 'USD',
        num_favorers: 1843, listing_active_count: 132, digital_listing_count: 4, transaction_sold_count: 2318,
        review_count: 212, review_average: 4.83, is_vacation: false,
      });
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
    if (/^\/application\/shops\/\d+\/listings$/.test(p)) {
      const all = listings.filter(l => l.state === (q.get('state') || 'active'));
      return json({ count: all.length, results: all.slice(offset, offset + limit) });
    }
    if (/^\/application\/shops\/\d+\/reviews$/.test(p)) {
      const all = reviews.filter(r => inRange(r.created_timestamp));
      return json({ count: all.length, results: all.slice(offset, offset + limit) });
    }
    return json({ error: `mock: no route for ${p}` }, 404);
  };
}
