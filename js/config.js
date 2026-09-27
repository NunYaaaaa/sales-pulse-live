// ─── CONFIG ────────────────────────────────────────────────────────────────
export const ETSY_AUTH_URL  = 'https://www.etsy.com/oauth/connect';
export const WORKER_BASE    = 'https://sales-pulse-live.ammon-wendel.workers.dev';
export const ETSY_TOKEN_URL = `${WORKER_BASE}/token`;
export const ETSY_API_BASE  = WORKER_BASE;
export const SCOPES         = 'transactions_r listings_r shops_r';
export const PAGE_SIZE      = 25;

// ─── LEDGER TAXONOMY ───────────────────────────────────────────────────────
// How each ledger entry type should be categorised for financial reporting.
// Source: Etsy Open API v3 GitHub discussions + observed real data.
export const LEDGER_TAXONOMY = {
  // ── REVENUE: positive credits that represent actual sales ──
  revenue: new Set([
    'PAYMENT_GROSS',   // explicit gross sale marker used by some shops
    'sale',            // generic sale credit
    'transaction',     // sometimes used as a sale credit (positive amount)
  ]),
  // ── FEES: costs Etsy charges the seller ──
  fees: new Set([
    'PAYMENT_PROCESSING_FEE',    // card processing fee
    'transaction',               // transaction fee (negative amount — 6.5% of sale)
    'transaction_quantity',      // per-quantity transaction fee
    'shipping_transaction',      // shipping transaction fee
    'shipping_labels',           // postage purchased through Etsy
    'offsite_ads_fee',           // Offsite Ads fee
    'prolist',                   // Promoted Listings / Etsy Ads
    'listing',                   // listing fee ($0.20)
    'LISTING_FEE',
    'renew_sold_auto',            // auto-renew on sale
    'renew_sold',
    'renew_expired',
    'listing_private',
    'auto_renew_expired',
    'marketing',                 // other marketing fees
    'gift_wrap_fees',
  ]),
  // ── REFUNDS: reduce gross; Etsy also partially refunds fees ──
  refunds: new Set([
    'REFUND',
    'REFUND_GROSS',
    'REFUND_PROCESSING_FEE',
    'transaction_refund',
    'transaction_quantity_refund',
    'listing_refund',
    'shipping_transaction_refund',
    'offsite_ads_fee_refund',
    'renew_sold_auto_refund',
    'listing_private_refund',
    'shipping_label_refund',
    'sales_tax_refund',
  ]),
  // ── PASS-THROUGHS: excluded from both gross and fees ──
  passthrough: new Set([
    'sales_tax',    // collected on behalf of tax authority — not your money
    'DISBURSE',     // payout to your bank — just a fund movement
    'DISBURSE2',
    'deposit',
  ]),
};

// Human-readable labels for every known ledger type
export const LEDGER_LABEL = {
  'PAYMENT_GROSS':              'Payment received',
  'PAYMENT_PROCESSING_FEE':    'Card processing fee',
  'transaction':                'Transaction fee / sale',
  'transaction_quantity':       'Per-qty transaction fee',
  'shipping_transaction':       'Shipping transaction fee',
  'shipping_labels':            'Shipping label cost',
  'offsite_ads_fee':            'Offsite Ads fee',
  'offsite_ads_fee_refund':     'Offsite Ads fee refund',
  'prolist':                    'Etsy Ads (Promoted Listing)',
  'listing':                    'Listing fee',
  'LISTING_FEE':                'Listing fee',
  'renew_sold_auto':            'Auto-renew on sale',
  'renew_sold':                 'Renewal on sale',
  'renew_expired':              'Renewal (expired listing)',
  'listing_private':            'Private listing fee',
  'auto_renew_expired':         'Auto-renew (expired)',
  'marketing':                  'Marketing fee',
  'gift_wrap_fees':             'Gift wrap fee',
  'sales_tax':                  'Sales tax collected',
  'REFUND':                     'Refund',
  'REFUND_GROSS':               'Refund (buyer)',
  'REFUND_PROCESSING_FEE':      'Processing fee refund',
  'buyer_fee':                  'Buyer fee',
  'sales_tax_refund':           'Sales tax refund',
  'transaction_refund':         'Transaction fee refund',
  'transaction_quantity_refund':'Qty transaction fee refund',
  'listing_refund':             'Listing fee refund',
  'shipping_transaction_refund':'Shipping txn fee refund',
  'renew_sold_auto_refund':     'Auto-renew fee refund',
  'listing_private_refund':     'Private listing fee refund',
  'shipping_label_refund':      'Shipping label refund',
  'DISBURSE':                   'Payout to bank',
  'DISBURSE2':                  'Payout to bank',
  'deposit':                    'Deposit',
  'sale':                       'Sale',
};

export const FEE_GROUPS = [
  { key:'shipping_labels',       label:'Shipping Labels',    color:'#d4622a' },
  { key:'prolist',               label:'Etsy Ads',           color:'#5a3d9e' },
  { key:'transaction',           label:'Transaction Fees',   color:'#3a7d4c' },
  { key:'PAYMENT_PROCESSING_FEE',label:'Processing Fees',    color:'#b8860b' },
  { key:'shipping_transaction',  label:'Shipping Txn Fees',  color:'#2563eb' },
  { key:'renew_sold_auto',       label:'Listing Renewals',   color:'#db2777' },
  { key:'offsite_ads_fee',       label:'Offsite Ads',        color:'#0891b2' },
  { key:'listing',               label:'Listing Fees',       color:'#65a30d' },
  { key:'LISTING_FEE',           label:'Listing Fees',       color:'#65a30d' },
  { key:'marketing',             label:'Marketing',          color:'#7c3aed' },
  { key:'gift_wrap_fees',        label:'Gift Wrap',          color:'#be185d' },
  { key:'buyer_fee',             label:'Buyer Fees',         color:'#92400e' },
  { key:'auto_renew_expired',    label:'Expired Renewals',   color:'#6b7280' },
];
export const FEE_OTHER_COLOR = '#a89e90';

// Shared categorical palette for order charts and top-products bars
export const PALETTE = ['#d4622a','#3a7d4c','#5a3d9e','#b8860b','#2563eb','#db2777','#0891b2','#65a30d'];
