// ─── STATE ─────────────────────────────────────────────────────────────────
// Single mutable store shared by every module.
export const state = {
  allOrders:     [],
  detailCache:   {},    // receipt_id -> { transactions, payment }
  ledgerEntries: null,  // array once full details are loaded
  currentPage:   1,
  detailsLoaded: false,
  expandedRow:   null,

  // Date filter — unix timestamps (seconds). null = no bound.
  filterFrom: null,     // inclusive lower bound
  filterTo:   null,     // inclusive upper bound (end of day)

  // Chart toggle modes: 'revenue' | 'orders'
  revChartMode: 'revenue',
  dowChartMode: 'revenue',
  topProdMode:  'revenue',

  feeSegments: [],      // last-drawn donut segments, for cross-highlighting
};

/** Clear all fetched shop data (keeps filter + chart modes). */
export function clearData() {
  state.allOrders     = [];
  state.detailCache   = {};
  state.ledgerEntries = null;
  state.detailsLoaded = false;
  state.currentPage   = 1;
  state.expandedRow   = null;
}
