// ─── EXPORTS ───────────────────────────────────────────────────────────────
import { LEDGER_LABEL } from './config.js';
import { categoriseEntry, computeLedgerTotals } from './finance.js';
import { bestPaymentAmount, refundedAmount } from './render.js';
import { ensurePayments } from './loader.js';
import { showError } from './ui.js';
import { lineItems, state } from './state.js';
import { getCurrency, getStatus, localDateKey, money, orderSales } from './util.js';

/**
 * Quote a CSV cell. Text starting with = + - @ (or tab/CR) is prefixed with '
 * so spreadsheets don't evaluate buyer-supplied strings as formulas.
 */
export function csvCell(c) {
  let s = String(c ?? '');
  const isNumber = /^-?\d+(\.\d+)?$/.test(s);
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCSV(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Fetch any missing payments first, showing progress on the export button. */
async function withPayments(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  try {
    await ensurePayments(state.allOrders, (done, total) => { btn.textContent = `${done}/${total}…`; });
    fn();
  } catch (e) {
    showError(`Export failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

export const exportCSV  = btn => withPayments(btn, ordersCSV);
export const exportJSON = btn => withPayments(btn, ordersJSON);

function ordersCSV() {
  const cur = getCurrency();
  const headers = ['Receipt ID','Date','Buyer','Items','Payment Method','Status',`Order Total (${cur})`,`Sales excl. tax (${cur})`,`Shipping (${cur})`,`Tax (${cur})`,`Discount (${cur})`,`Processing Fee (${cur})`,`Net after proc. fee (${cur})`,`Refunded (${cur})`];
  const rows = state.allOrders.map(o => {
    const pay = state.payments[o.receipt_id];
    return [
      o.receipt_id || '',
      o.create_timestamp ? localDateKey(new Date(o.create_timestamp * 1000)) : '',
      o.name || o.buyer_user_id || '',
      o.transaction_count || (o.transactions?.length) || '',
      o.payment_method || '',
      getStatus(o),
      money(o.grandtotal).toFixed(2),
      orderSales(o).toFixed(2),
      money(o.total_shipping_cost).toFixed(2),
      money(o.total_tax_cost).toFixed(2),
      money(o.discount_amt).toFixed(2),
      pay ? Math.abs(bestPaymentAmount(pay, 'fees')).toFixed(2) : '',
      pay ? bestPaymentAmount(pay, 'net').toFixed(2) : '',
      refundedAmount(o, pay).toFixed(2),
    ];
  });
  download('orders_export.csv', toCSV([headers, ...rows]), 'text/csv');
}

function ordersJSON() {
  const data = state.allOrders.map(o => {
    const pay = state.payments[o.receipt_id];
    return {
      receipt_id:         o.receipt_id,
      currency:           getCurrency(),
      date:               o.create_timestamp ? new Date(o.create_timestamp * 1000).toISOString() : null,
      buyer:              o.name || o.buyer_user_id || null,
      item_count:         o.transaction_count || (o.transactions?.length) || null,
      payment_method:     o.payment_method || null,
      status:             getStatus(o),
      is_gift:            o.is_gift || false,
      gift_message:       o.gift_message || null,
      ship_to:            [o.city, o.state, o.country_iso].filter(Boolean).join(', ') || null,
      order_total:        money(o.grandtotal),   // what the buyer paid, incl. tax
      sales_excl_tax:     Math.round(orderSales(o) * 100) / 100,
      shipping:           money(o.total_shipping_cost),
      tax:                money(o.total_tax_cost),
      discount:           money(o.discount_amt),
      processing_fee:     pay ? Math.abs(bestPaymentAmount(pay, 'fees')) : null,
      net_after_proc_fee: pay ? bestPaymentAmount(pay, 'net') : null,
      refunded:           refundedAmount(o, pay),
      pay_status:         pay?.status || null,
      line_items: (lineItems(o) || []).map(t => ({
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
  const cur = getCurrency();
  const headers = ['Date','Category','Type','Description','Reference Type','Reference ID',`Amount (${cur})`,`Running Balance (${cur})`];
  const rows = sorted.map(e => [
    localDateKey(new Date(e.created_timestamp * 1000)),
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
      currency:  getCurrency(),
      gross:     grossCents / 100,
      fees:      Math.abs(feesCents / 100),
      net:       netCents / 100,
    },
    entries: sorted.map(e => ({
      date:           new Date(e.created_timestamp * 1000).toISOString(),
      category:       categoriseEntry(e),
      type:           e.ledger_type || e.type || null,
      description:    LEDGER_LABEL[e.ledger_type || e.type] || e.description || null,
      reference_type: e.reference_type || null,
      reference_id:   e.reference_id || null,
      amount:         e.amount / 100,
      balance:        e.balance / 100,
    })),
  };
  download('finances_export.json', JSON.stringify(data, null, 2), 'application/json');
}
