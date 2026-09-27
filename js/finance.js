// ─── FINANCE CALCULATIONS ──────────────────────────────────────────────────
// Pure functions — no DOM, no state. Covered by test/finance.test.html.
import { LEDGER_TAXONOMY } from './config.js';

/**
 * The Etsy API uses 'ledger_type' as the field name.
 * 'type' and 'description' are kept as fallbacks for forward-compat.
 */
export function ledgerType(e) {
  return e.ledger_type || e.type || e.description || '';
}

/**
 * Categorise a single ledger entry using the taxonomy.
 *
 * Rules (applied in order):
 *  1. Pass-throughs (sales_tax, DISBURSE, DISBURSE2, deposit) → 'passthrough'
 *  2. Explicit refund types → 'refund'
 *  3. Explicit fee types with negative amount → 'fee'
 *  4. Explicit revenue types with positive amount → 'revenue'
 *  5. Any other positive amount → 'revenue'
 *  6. Any other negative amount → 'fee'
 */
export function categoriseEntry(e) {
  const t   = ledgerType(e);
  const amt = e.amount; // in cents, may be negative

  if (LEDGER_TAXONOMY.passthrough.has(t)) return 'passthrough';
  if (LEDGER_TAXONOMY.refunds.has(t))     return 'refund';
  if (LEDGER_TAXONOMY.fees.has(t) && amt < 0) return 'fee';
  if (LEDGER_TAXONOMY.revenue.has(t) && amt > 0) return 'revenue';
  // Fallback by sign
  if (amt > 0) return 'revenue';
  if (amt < 0) return 'fee';
  return 'passthrough'; // zero-value entries
}

/**
 * Compute totals from ledger entries.
 * Returns { grossCents, feesCents, netCents, refundGrossCents, refundFeesCents }
 *
 * Etsy's refund entries are *negative* debits on the revenue side (the buyer
 * gets money back) and *positive* credits on the fee side (Etsy partially
 * refunds fees). We treat both correctly by always adding the raw amount.
 */
export function computeLedgerTotals(entries) {
  let grossCents = 0, feesCents = 0, refundGrossCents = 0, refundFeesCents = 0;

  for (const e of entries) {
    const cat = categoriseEntry(e);
    const amt = e.amount;

    if (cat === 'revenue')     { grossCents += amt; }
    else if (cat === 'fee')    { feesCents  += amt; } // amt is negative → increases total fee magnitude
    else if (cat === 'refund') {
      // Refund entries can be either negative (buyer refund reducing gross)
      // or positive (fee partial-refund crediting fees back).
      if (amt < 0) { refundGrossCents += amt; } // reduces gross
      else         { refundFeesCents  += amt; } // reduces fee burden
    }
    // passthroughs: skip
  }

  // Merge refund adjustments into the main buckets
  const adjGrossCents = grossCents + refundGrossCents;     // net revenue after refunds
  const adjFeesCents  = feesCents  + refundFeesCents;      // net fees after refund credits (still negative)
  const netCents      = adjGrossCents + adjFeesCents;      // fees are negative, so this subtracts them

  return { grossCents: adjGrossCents, feesCents: adjFeesCents, netCents, refundGrossCents, refundFeesCents };
}
