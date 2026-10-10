// ─── STATE ─────────────────────────────────────────────────────────────────
// Single mutable store shared by every module.
export const state = {
  allOrders:     [],
  ledgerEntries: null,  // array once full details are loaded
  currentPage:   1,
  ledgerPage:    1,
  detailsLoaded: false, // ledger + every order's line items are in
  expandedRow:   null,
  activeTab:     'overview', // a key of TABS in tabs.js
  shop:          null,     // the Etsy shop object (counts, reviews, currency)
  ledgerSpan:    null,     // { from, to } the ledger covers (the period, or back to the oldest order)

  // Fetched when the Products or Customers tab is opened. Listings don't
  // depend on the date range, so they're kept across ranges for LISTINGS_TTL_MS.
  listings:       null,    // active + sold-out listings
  listingsAt:     0,
  listingsStatus: null,    // { loading, done, total } | { error } | null
  reviews:        null,    // reviews since the period started (see reviewsCache)
  reviewsStatus:  null,

  // Per-receipt caches, kept across date-range changes (a receipt's
  // details don't depend on the range it was fetched for).
  lineItems: {},        // receipt_id -> transactions (only for receipts that came without them)
  payments:  {},        // receipt_id -> payment | null (null = paid outside Etsy Payments)

  // Date filter — unix timestamps (seconds). null = no bound.
  filterFrom: null,     // inclusive lower bound
  filterTo:   null,     // inclusive upper bound (end of day)

  // Chart toggle modes: 'revenue' | 'orders'
  revChartMode: 'revenue',
  dowChartMode: 'revenue',
  topProdMode:  'revenue',
  insFeeMode:   'all',     // 'all' | 'excl-postage'
  insGeoMode:   'country', // 'country' | 'us-state'

  feeSegments: [],      // last-drawn donut segments, for cross-highlighting
};

/** Line items for an order: embedded in the receipt, or fetched separately. */
export function lineItems(o) {
  return o.transactions ?? state.lineItems[o.receipt_id] ?? null;
}

// ─── RANGE CACHE ─────────────────────────────────────────────────────────────
// Orders + ledger per date range, so flipping back to a range is instant.
const RANGE_TTL_MS = 5 * 60 * 1000;
const rangeCache = new Map();
const rangeKey = () => `${state.filterFrom}|${state.filterTo}`;

export function cacheCurrentRange() {
  rangeCache.set(rangeKey(), { orders: state.allOrders, ledger: state.ledgerEntries, ledgerSpan: state.ledgerSpan, at: Date.now() });
}
export function cachedRange() {
  const hit = rangeCache.get(rangeKey());
  return hit && Date.now() - hit.at < RANGE_TTL_MS ? hit : null;
}

// Reviews per period start, for the same TTL (they're fetched up to "now").
const reviewsCache = new Map();
export function cacheReviews(reviews) {
  reviewsCache.set(String(state.filterFrom), { reviews, at: Date.now() });
}
export function cachedReviews() {
  const hit = reviewsCache.get(String(state.filterFrom));
  return hit && Date.now() - hit.at < RANGE_TTL_MS ? hit.reviews : null;
}

/** Reset the data shown for the current range. */
export function clearRangeData() {
  state.allOrders     = [];
  state.reviews       = null;
  state.reviewsStatus = null;
  state.ledgerEntries = null;
  state.ledgerSpan    = null;
  state.detailsLoaded = false;
  state.currentPage   = 1;
  state.ledgerPage    = 1;
  state.expandedRow   = null;
}

/** Forget everything fetched (disconnect). */
export function clearData() {
  clearRangeData();
  state.lineItems = {};
  state.payments  = {};
  state.shop      = null;
  state.listings  = null;
  state.listingsAt     = 0;
  state.listingsStatus = null;
  rangeCache.clear();
  reviewsCache.clear();
}
