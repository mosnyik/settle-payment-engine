/**
 * Deposit Matching Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkAmountMatch,
  isWithinPaymentWindow,
  rankDepositCandidates,
} from '@/services/payment-engine/watcher/deposit-matching';
import { ProcessedTxStore } from '@/services/payment-engine/watcher/state/processed-tx-store';
import type { ChainTransaction } from '@/services/payment-engine/watcher/types';

const mysqlMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('@/lib/mysql', () => ({
  default: mysqlMock,
}));

const TOLERANCE = 0.02;

function trxTx(txHash: string, amount: number, minedAt: Date | null): ChainTransaction {
  return {
    txHash,
    from: 'TSender',
    to: 'TDeposit',
    amount: String(Math.round(amount * 1_000_000)),
    amountDecimal: amount,
    confirmations: 5,
    blockNumber: 100,
    blockTime: minedAt ? Math.floor(minedAt.getTime() / 1000) : null,
    isConfirmed: false,
    status: 'confirmed',
  };
}

describe('checkAmountMatch', () => {
  it('classifies amounts against the expected value', () => {
    expect(checkAmountMatch(22.94275, 22.94275, TOLERANCE)).toBe('exact');
    expect(checkAmountMatch(23, 22.94275, TOLERANCE)).toBe('overpaid');
    expect(checkAmountMatch(22.6, 22.94275, TOLERANCE)).toBe('within_tolerance');
    expect(checkAmountMatch(21.79669, 22.94275, TOLERANCE)).toBe('underpaid');
  });
});

describe('isWithinPaymentWindow', () => {
  const watchFrom = new Date('2026-10-09T10:00:00Z');

  it('rejects txs mined before the session got its address', () => {
    expect(isWithinPaymentWindow(trxTx('old', 10, new Date('2026-10-09T09:50:00Z')), watchFrom)).toBe(false);
  });

  it('accepts txs mined after the window opened, allowing for clock skew', () => {
    expect(isWithinPaymentWindow(trxTx('new', 10, new Date('2026-10-09T10:05:00Z')), watchFrom)).toBe(true);
    expect(isWithinPaymentWindow(trxTx('skew', 10, new Date('2026-10-09T09:59:00Z')), watchFrom)).toBe(true);
  });

  it('accepts unmined txs', () => {
    expect(isWithinPaymentWindow(trxTx('mempool', 10, null), watchFrom)).toBe(true);
  });
});

describe('rankDepositCandidates', () => {
  it('prefers the tx matching the expected amount over the most recent one', () => {
    // Explorer order: newest first. Session B expects 22.94275.
    const newestOther = trxTx('other', 21.79669, new Date('2026-10-09T10:06:00Z'));
    const sessionB = trxTx('b', 22.94275, new Date('2026-10-09T10:05:00Z'));

    const ranked = rankDepositCandidates([newestOther, sessionB], 22.94275, TOLERANCE);

    expect(ranked[0].txHash).toBe('b');
  });

  it('still falls back to an underpaid tx when nothing better exists', () => {
    const underpaid = trxTx('under', 21.79669, new Date('2026-10-09T10:05:00Z'));

    const ranked = rankDepositCandidates([underpaid], 22.94275, TOLERANCE);

    expect(ranked.map((tx) => tx.txHash)).toEqual(['under']);
  });

  it('breaks amount ties by earliest tx', () => {
    const later = trxTx('later', 10, new Date('2026-10-09T10:06:00Z'));
    const earlier = trxTx('earlier', 10, new Date('2026-10-09T10:05:00Z'));

    const ranked = rankDepositCandidates([later, earlier], 10, TOLERANCE);

    expect(ranked[0].txHash).toBe('earlier');
  });
});

describe('ProcessedTxStore.claimDeposit', () => {
  let store: ProcessedTxStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new ProcessedTxStore();
  });

  it('claims an unclaimed tx', async () => {
    mysqlMock.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(store.claimDeposit('tx_a', 'session_a', 'tron')).resolves.toBe(true);
  });

  it('refuses a tx already claimed by another session', async () => {
    mysqlMock.query
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }))
      .mockResolvedValueOnce([[{
        tx_hash: 'tx_a', session_id: 'session_a', chain: 'tron',
        action: 'mark_deposit', confirmations: null, processed_at: new Date(),
      }]]);

    await expect(store.claimDeposit('tx_a', 'session_b', 'tron')).resolves.toBe(false);
  });

  it('is idempotent for the session that already owns the tx', async () => {
    mysqlMock.query
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }))
      .mockResolvedValueOnce([[{
        tx_hash: 'tx_a', session_id: 'session_a', chain: 'tron',
        action: 'mark_deposit', confirmations: null, processed_at: new Date(),
      }]]);

    await expect(store.claimDeposit('tx_a', 'session_a', 'tron')).resolves.toBe(true);
  });

  it('rethrows non-duplicate database errors', async () => {
    mysqlMock.query.mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'ECONNREFUSED' }));

    await expect(store.claimDeposit('tx_a', 'session_a', 'tron')).rejects.toThrow('down');
  });
});
