/**
 * Deposit Matching
 *
 * Decides which on-chain transaction belongs to which payment session.
 * Deposit addresses can be reused across sessions (session-owner wallets,
 * legacy pool), so "latest transaction to the address" is not proof that
 * this session was paid. A transaction is only eligible for a session if:
 *   - it landed inside the session's payment window, and
 *   - no other session has already claimed it.
 * Among eligible transactions, the one closest to the expected amount wins.
 */

import { AmountMatchResult, ChainTransaction } from './types';

/** Allowance for clock drift between our server and block timestamps. */
export const PAYMENT_WINDOW_SKEW_MS = 2 * 60 * 1000;

export function checkAmountMatch(
  received: number,
  expected: number,
  tolerance: number
): AmountMatchResult {
  const diff = received - expected;
  const percentDiff = Math.abs(diff) / expected;

  if (diff === 0) return 'exact';
  if (diff > 0) return 'overpaid';
  if (percentDiff <= tolerance) return 'within_tolerance';
  return 'underpaid';
}

/**
 * True if the tx was mined after the session's deposit address was handed out.
 * Unmined txs (blockTime null) are recent by definition.
 */
export function isWithinPaymentWindow(
  tx: ChainTransaction,
  watchFrom: Date,
  skewMs: number = PAYMENT_WINDOW_SKEW_MS
): boolean {
  if (tx.blockTime === null || tx.blockTime === undefined) return true;
  return tx.blockTime * 1000 >= watchFrom.getTime() - skewMs;
}

/**
 * Order candidates best-first for a session expecting `expected`:
 * acceptable amounts (exact / within tolerance / overpaid) before underpaid,
 * then closest to the expected amount, then earliest.
 */
export function rankDepositCandidates(
  candidates: ChainTransaction[],
  expected: number,
  tolerance: number
): ChainTransaction[] {
  const isAcceptable = (tx: ChainTransaction) =>
    checkAmountMatch(tx.amountDecimal, expected, tolerance) !== 'underpaid';

  return [...candidates].sort((a, b) => {
    const acceptableDiff = Number(isAcceptable(b)) - Number(isAcceptable(a));
    if (acceptableDiff !== 0) return acceptableDiff;

    const distanceDiff =
      Math.abs(a.amountDecimal - expected) - Math.abs(b.amountDecimal - expected);
    if (distanceDiff !== 0) return distanceDiff;

    return (a.blockTime ?? Infinity) - (b.blockTime ?? Infinity);
  });
}
