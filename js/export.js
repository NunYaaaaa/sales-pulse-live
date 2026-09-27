// ─── EXPORTS ───────────────────────────────────────────────────────────────
import { LEDGER_LABEL } from './config.js';
import { categoriseEntry, computeLedgerTotals } from './finance.js';
import { bestPaymentAmount, hasRefund } from './render.js';
import { state } from './state.js';
import { getStatus, money } from './util.js';

function toCSV(rows) {
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function download(filename, content, type) {
  const a = document.createElement('a');
  a.href  = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename; a.click();
}

export function exportCSV() {
  const headers = ['Receipt ID','Date','Buyer','Items','Payment Method','Status','Gross (USD)','Shipping','Tax','Discount','Processing Fee (USD)','Net after proc. fee (USD)','Refunded'];
  const rows = state.allOrders.map(o => {
    const pay = state.detailCache[o.receipt_id]?.payment;
    return [
      o.receipt_id || '',
      o.create_timestamp ? new Date(o.create_timestamp * 1000).toISOString().slice(0, 10) : '',
      o.name || o.buyer_user_id || '',
      o.transaction_count || (o.transactions?.length) || '',
      o.payment_method || '',
      getStatus(o),
      money(o.grandtotal).toFixed(2),
      money(o.total_shipping_cost).toFixed(2),
      money(o.total_tax_cost).toFixed(2),
      money(o.discount_amt).toFixed(2),
      pay ? Math.abs(bestPaymentAmount(pay, 'fees')).toFixed(2) : '',
      pay ? bestPaymentAmount(pay, 'net').toFixed(2) : '',
      hasRefund(pay) ? 'Yes' : 'No',
    ];
  });
  download('orders_export.csv', toCSV([headers, ...rows]), 'text/csv');
}

export function exportJSON() {
  const data = state.allOrders.map(o => {
    const d   = state.detailCache[o.receipt_id];
    const pay = d?.payment;
    return {
      receipt_id:         o.receipt_id,
      date:               o.create_timestamp ? new Date(o.create_timestamp * 1000).toISOString() : null,
      buyer:              o.name || o.buyer_user_id || null,
      item_count:         o.transaction_count || (o.transactions?.length) || null,
      payment_method:     o.payment_method || null,
      status:             getStatus(o),
      is_gift:            o.is_gift || false,
      gift_message:       o.gift_message || null,
      ship_to:            [o.city, o.state, o.country_iso].filter(Boolean).join(', ') || null,
      gross_usd:          money(o.grandtotal),
      shipping_usd:       money(o.total_shipping_cost),
      tax_usd:            money(o.total_tax_cost),
      discount_usd:       money(o.discount_amt),
      processing_fee_usd: pay ? Math.abs(bestPaymentAmount(pay, 'fees')) : null,
      net_after_proc_fee: pay ? bestPaymentAmount(pay, 'net') : null,
      refunded:           hasRefund(pay),
      pay_status:         pay?.status || null,
      line_items: (d?.transactions || []).map(t => ({
        title:    t.title || null,
        sku:      t.sku || null,
        quantity: t.quantity || 1,
        price:    t.price ? money(t.price) : null,
      })),
    };
  });
  download('orders_export.json', JSON.stringify(data, null, 2), 'application/json');
}

function sortedLedger() {
  const entries = state.ledgerEntries || [];
  if (!entries.length) { alert('No ledger data to export. Load full details first.'); return null; }
  return [...entries].sort((a, b) => b.created_timestamp - a.created_timestamp);
}

export function exportFinancesCSV() {
  const sorted = sortedLedger();
  if (!sorted) return;
  const headers = ['Date','Category','Type','Description','Reference Type','Reference ID','Amount (USD)','Running Balance (USD)'];
  const rows = sorted.map(e => [
    new Date(e.created_timestamp * 1000).toISOString().slice(0, 10),
    categoriseEntry(e),
    e.ledger_type || e.type || '',
    LEDGER_LABEL[e.ledger_type || e.type] || e.description || e.ledger_type || e.type || '',
    e.reference_type || '',
    e.reference_id || '',
    (e.amount / 100).toFixed(2),
    (e.balance / 100).toFixed(2),
  ]);
  download('finances_export.csv', toCSV([headers, ...rows]), 'text/csv');
}

export function exportFinancesJSON() {
  const sorted = sortedLedger();
  if (!sorted) return;
  const { grossCents, feesCents, netCents } = computeLedgerTotals(sorted);
  const data = {
    summary: {
      gross_usd: grossCents / 100,
      fees_usd:  Math.abs(feesCents / 100),
      net_usd:   netCents / 100,
    },
    entries: sorted.map(e => ({
      date:           new Date(e.created_timestamp * 1000).toISOString(),
      category:       categoriseEntry(e),
      type:           e.ledger_type || e.type || null,
      description:    LEDGER_LABEL[e.ledger_type || e.type] || e.description || null,
      reference_type: e.reference_type || null,
      reference_id:   e.reference_id || null,
      amount_usd:     e.amount / 100,
      balance_usd:    e.balance / 100,
    })),
  };
  download('finances_export.json', JSON.stringify(data, null, 2), 'application/json');
}
