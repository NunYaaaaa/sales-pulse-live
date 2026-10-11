// ─── FINANCE CALCULATIONS ──────────────────────────────────────────────────
// Pure functions — no DOM, no state. Covered by test/finance.test.html.
import { FEE_REFUND_OF, LEDGER_TAXONOMY, PAYOUT_REVERSALS, PAYOUT_TYPES } from './config.js';

/**
 * The Etsy API uses 'ledger_type' as the field name.
 * 'type' and 'description' are kept as fallbacks for forward-compat.
 */
export function ledgerType(e) {
  return e.ledger_type || e.type || e.description || '';
}

/**
 * Sort ledger entries newest first. Entries made in the same second (a sale
 * and its tax and fees) go by Etsy's sequence_number, which only grows, so
 * each running balance follows from the row below it; without one they keep
 * the order Etsy sent them in (sort is stable), which a real export showed
 * to be right.
 */
export function newestFirst(a, b) {
  return b.created_timestamp - a.created_timestamp
    || (b.sequence_number ?? 0) - (a.sequence_number ?? 0);
}

/**
 * Categorise a single ledger entry using the taxonomy.
 *
 * Rules (applied in order):
 *  1. Pass-throughs (DISBURSE, DISBURSE2, deposit) → 'passthrough'
 *  2. Collected for others (sales_tax, sales_tax_refund, buyer_fee) → 'collected'
 *  3. Explicit refund types → 'refund'
 *  4. Explicit fee types with negative amount → 'fee'
 *  5. Explicit revenue types with positive amount → 'revenue'
 *  6. Any other positive amount → 'refund' (a fee credit: sales always arrive as PAYMENT_GROSS)
 *  7. Any other negative amount → 'fee'
 */
export function categoriseEntry(e) {
  const t   = ledgerType(e);
  const amt = e.amount; // in cents, may be negative

  if (LEDGER_TAXONOMY.passthrough.has(t)) return 'passthrough';
  if (LEDGER_TAXONOMY.collected.has(t))   return 'collected';
  if (LEDGER_TAXONOMY.refunds.has(t))     return 'refund';
  if (LEDGER_TAXONOMY.fees.has(t) && amt < 0) return 'fee';
  if (LEDGER_TAXONOMY.revenue.has(t) && amt > 0) return 'revenue';
  // Fallback by sign. Sales always arrive as PAYMENT_GROSS, so an unknown
  // credit is money back on fees, never a sale.
  if (amt > 0) return 'refund';
  if (amt < 0) return 'fee';
  return 'passthrough'; // zero-value entries
}

/**
 * Which total a refund-type entry belongs to: 'gross' (money back to a
 * buyer, off Net Sales) or 'fees' (a fee credited back). Etsy can reverse
 * either: a credit for a known fee (FEE_REFUND_OF) stays on the fee side and
 * a buyer refund (REFUND_GROSS) on the sales side whatever its sign, so a
 * Share & Save credit taken back after a refund is a fee again, not a cut in
 * sales. Anything else goes by sign: an unknown credit is money back on fees.
 */
export function refundSide(e) {
  const t = ledgerType(e);
  if (FEE_REFUND_OF[t]) return 'fees';
  if (t === 'REFUND_GROSS') return 'gross';
  return e.amount < 0 ? 'gross' : 'fees';
}

/**
 * What an entry is, in the words the ledger table's badges and the ledger
 * CSV use: 'sale', 'fee', 'fee credit', 'refund', 'sales tax', 'delivery
 * fee', 'payout' (to the bank, or one the bank returned, as Paid out counts
 * them) or 'transfer' (any other move between the bank and the Etsy balance).
 */
export function entryKind(e) {
  const t = ledgerType(e);
  switch (categoriseEntry(e)) {
    case 'revenue':   return 'sale';
    case 'fee':       return 'fee';
    case 'refund':    return refundSide(e) === 'fees' ? 'fee credit' : 'refund';
    case 'collected': return t === 'buyer_fee' ? 'delivery fee' : 'sales tax';
    default:          return PAYOUT_TYPES.has(t) || PAYOUT_REVERSALS.has(t) ? 'payout' : 'transfer';
  }
}

/**
 * Compute totals from ledger entries.
 * Returns { grossCents, feesCents, netCents, refundGrossCents, refundFeesCents, collectedCents }
 *
 * Sales are recorded including the sales tax and buyer fee the buyer paid,
 * and Etsy then takes them back out, so those entries are added to gross by
 * their sign: gross and net exclude them, and net equals the balance change
 * from everything except payouts.
 *
 * Etsy's refund entries are debits on the revenue side (the buyer gets
 * money back) and credits on the fee side (Etsy partially refunds fees);
 * refundSide says which, and the raw amount is added there, so a reversal
 * (the opposite sign) takes its entry back out of the same total.
 */
export function computeLedgerTotals(entries) {
  let grossCents = 0, feesCents = 0, refundGrossCents = 0, refundFeesCents = 0, collectedCents = 0;

  for (const e of entries) {
    const cat = categoriseEntry(e);
    const amt = e.amount;

    if (cat === 'revenue')     { grossCents += amt; }
    else if (cat === 'fee')    { feesCents  += amt; } // amt is negative → increases total fee magnitude
    else if (cat === 'collected') { collectedCents += amt; } // tax / buyer-fee debits (negative), tax refund credits (positive)
    else if (cat === 'refund') {
      if (refundSide(e) === 'gross') refundGrossCents += amt; // a buyer refund reduces gross
      else                           refundFeesCents  += amt; // a fee credit reduces fees
    }
    // passthroughs: skip
  }

  // Merge refund adjustments into the main buckets
  const adjGrossCents = grossCents + refundGrossCents + collectedCents; // net revenue after refunds, excl. tax and buyer fees
  const adjFeesCents  = feesCents  + refundFeesCents;      // net fees after refund credits (still negative)
  const netCents      = adjGrossCents + adjFeesCents;      // fees are negative, so this subtracts them

  return { grossCents: adjGrossCents, feesCents: adjFeesCents, netCents, refundGrossCents, refundFeesCents, collectedCents };
}
