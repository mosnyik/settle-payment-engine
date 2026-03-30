/**
 * Wallet Pool Service
 */

import { Network, WalletAssignment, DEFAULT_CONFIG } from '../types';
import { WalletPoolEmptyError, DatabaseError } from '../errors';

type WalletColumn = 'bitcoin' | 'evm' | 'tron';

interface WalletRow {
  id: number;
  bitcoin: string | null;
  evm: string | null;
  tron: string | null;
  bitcoin_flag: string | number | boolean;
  ethereum_flag: string | number | boolean;
  binance_flag: string | number | boolean;
  tron_flag: string | number | boolean;
  erc20_flag: string | number | boolean;
  bep20_flag: string | number | boolean;
  trc20_flag: string | number | boolean;
  bitcoin_last_assigned: Date | null;
  ethereum_last_assigned: Date | null;
  binance_last_assigned: Date | null;
  tron_last_assigned: Date | null;
  erc20_last_assigned: Date | null;
  bep20_last_assigned: Date | null;
  trc20_last_assigned: Date | null;
}

function getWalletColumn(network: Network): WalletColumn {
  switch (network) {
    case 'bitcoin':
      return 'bitcoin';
    case 'ethereum':
    case 'bsc':
    case 'polygon':
    case 'base':
    case 'erc20':
    case 'bep20':
      return 'evm';
    case 'tron':
    case 'trc20':
      return 'tron';
  }
}

function getFlagColumn(network: Network): string {
  switch (network) {
    case 'bitcoin':
      return 'bitcoin_flag';
    case 'ethereum':
      return 'ethereum_flag';
    case 'bsc':
      return 'binance_flag';
    case 'tron':
      return 'tron_flag';
    case 'erc20':
      return 'erc20_flag';
    case 'bep20':
      return 'bep20_flag';
    case 'trc20':
      return 'trc20_flag';
    case 'polygon':
      return 'ethereum_flag';
    case 'base':
      return 'ethereum_flag';
  }
}

function getLastAssignedColumn(network: Network): string {
  switch (network) {
    case 'bitcoin':
      return 'bitcoin_last_assigned';
    case 'ethereum':
    case 'polygon':
    case 'base':
      return 'ethereum_last_assigned';
    case 'bsc':
      return 'binance_last_assigned';
    case 'tron':
      return 'tron_last_assigned';
    case 'erc20':
      return 'erc20_last_assigned';
    case 'bep20':
      return 'bep20_last_assigned';
    case 'trc20':
      return 'trc20_last_assigned';
  }
}

export async function assignWallet(
  network: Network,
  sessionTtlMinutes: number = DEFAULT_CONFIG.sessionTtlMinutes
): Promise<WalletAssignment> {
  const pool = (await import('../../../lib/mysql')).default;

  const flagColumn = getFlagColumn(network);
  const walletColumn = getWalletColumn(network);
  const lastAssignedColumn = getLastAssignedColumn(network);

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT *
       FROM wallets
       WHERE TRIM(${flagColumn}) IN ('true', '1', 1, true)
         AND ${walletColumn} IS NOT NULL
       LIMIT 1
       FOR UPDATE`
    ) as [any[], any];

    if (!rows || rows.length === 0) {
      const estimatedWait = await getEstimatedWaitTime(connection, network);
      await connection.rollback();
      throw new WalletPoolEmptyError(network, estimatedWait);
    }

    const wallet = rows[0] as WalletRow;
    const address = wallet[walletColumn] as string;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionTtlMinutes * 60 * 1000);

    await connection.query(
      `UPDATE wallets
       SET ${flagColumn} = 0,
           ${lastAssignedColumn} = ?
       WHERE id = ?`,
      [now, wallet.id]
    );

    await connection.commit();

    return {
      address,
      walletId: wallet.id,
      assignedAt: now,
      expiresAt,
    };
  } catch (error) {
    await connection.rollback();

    if (error instanceof WalletPoolEmptyError) {
      throw error;
    }

    throw new DatabaseError('assignWallet', error instanceof Error ? error : undefined);
  } finally {
    connection.release();
  }
}

export async function releaseWallet(
  walletId: number,
  network: Network
): Promise<void> {
  const pool = (await import('../../../lib/mysql')).default;
  const flagColumn = getFlagColumn(network);

  try {
    await pool.query(
      `UPDATE wallets
       SET ${flagColumn} = 1
       WHERE id = ?`,
      [walletId]
    );
  } catch (error) {
    throw new DatabaseError('releaseWallet', error instanceof Error ? error : undefined);
  }
}

export async function releaseWalletByAddress(
  address: string,
  network: Network
): Promise<void> {
  const pool = (await import('../../../lib/mysql')).default;
  const flagColumn = getFlagColumn(network);
  const walletColumn = getWalletColumn(network);

  try {
    await pool.query(
      `UPDATE wallets
       SET ${flagColumn} = 1
       WHERE ${walletColumn} = ?`,
      [address]
    );
  } catch (error) {
    throw new DatabaseError('releaseWalletByAddress', error instanceof Error ? error : undefined);
  }
}

async function getEstimatedWaitTime(
  connection: any,
  network: Network
): Promise<number | undefined> {
  const lastAssignedColumn = getLastAssignedColumn(network);
  const flagColumn = getFlagColumn(network);

  const [rows] = await connection.query(
    `SELECT MIN(${lastAssignedColumn}) as oldest_assigned
     FROM wallets
     WHERE ${flagColumn} IN ('false', '0', 0, false)`
  ) as [any[], any];

  if (!rows || rows.length === 0 || !rows[0].oldest_assigned) {
    return undefined;
  }

  const oldestAssigned = new Date(rows[0].oldest_assigned);
  const expiryTime = oldestAssigned.getTime() + (DEFAULT_CONFIG.sessionTtlMinutes * 60 * 1000);
  const waitMs = expiryTime - Date.now();

  if (waitMs <= 0) {
    return 1;
  }

  return Math.ceil(waitMs / 1000);
}

export async function getPoolStatus(): Promise<Record<string, { available: number; inUse: number }>> {
  const pool = (await import('../../../lib/mysql')).default;

  const [rows] = await pool.query(`
    SELECT
      SUM(CASE WHEN bitcoin_flag IN ('true', '1', 1, true) THEN 1 ELSE 0 END) as btc_available,
      SUM(CASE WHEN bitcoin_flag IN ('false', '0', 0, false) THEN 1 ELSE 0 END) as btc_in_use,
      SUM(CASE WHEN ethereum_flag IN ('true', '1', 1, true) THEN 1 ELSE 0 END) as eth_available,
      SUM(CASE WHEN ethereum_flag IN ('false', '0', 0, false) THEN 1 ELSE 0 END) as eth_in_use,
      SUM(CASE WHEN binance_flag IN ('true', '1', 1, true) THEN 1 ELSE 0 END) as bsc_available,
      SUM(CASE WHEN binance_flag IN ('false', '0', 0, false) THEN 1 ELSE 0 END) as bsc_in_use,
      SUM(CASE WHEN tron_flag IN ('true', '1', 1, true) THEN 1 ELSE 0 END) as tron_available,
      SUM(CASE WHEN tron_flag IN ('false', '0', 0, false) THEN 1 ELSE 0 END) as tron_in_use,
      SUM(CASE WHEN erc20_flag IN ('true', '1', 1, true) THEN 1 ELSE 0 END) as erc20_available,
      SUM(CASE WHEN erc20_flag IN ('false', '0', 0, false) THEN 1 ELSE 0 END) as erc20_in_use,
      SUM(CASE WHEN bep20_flag IN ('true', '1', 1, true) THEN 1 ELSE 0 END) as bep20_available,
      SUM(CASE WHEN bep20_flag IN ('false', '0', 0, false) THEN 1 ELSE 0 END) as bep20_in_use,
      SUM(CASE WHEN trc20_flag IN ('true', '1', 1, true) THEN 1 ELSE 0 END) as trc20_available,
      SUM(CASE WHEN trc20_flag IN ('false', '0', 0, false) THEN 1 ELSE 0 END) as trc20_in_use
    FROM wallets
  `) as [any[], any];

  const data = rows[0];

  return {
    bitcoin: { available: Number(data.btc_available), inUse: Number(data.btc_in_use) },
    ethereum: { available: Number(data.eth_available), inUse: Number(data.eth_in_use) },
    bsc: { available: Number(data.bsc_available), inUse: Number(data.bsc_in_use) },
    tron: { available: Number(data.tron_available), inUse: Number(data.tron_in_use) },
    erc20: { available: Number(data.erc20_available), inUse: Number(data.erc20_in_use) },
    bep20: { available: Number(data.bep20_available), inUse: Number(data.bep20_in_use) },
    trc20: { available: Number(data.trc20_available), inUse: Number(data.trc20_in_use) },
  };
}

export async function releaseExpiredWallets(): Promise<number> {
  const pool = (await import('../../../lib/mysql')).default;
  const expiryMs = DEFAULT_CONFIG.sessionTtlMinutes * 60 * 1000;
  const cutoffTime = new Date(Date.now() - expiryMs);

  const networks = [
    { flag: 'bitcoin_flag', lastAssigned: 'bitcoin_last_assigned' },
    { flag: 'ethereum_flag', lastAssigned: 'ethereum_last_assigned' },
    { flag: 'binance_flag', lastAssigned: 'binance_last_assigned' },
    { flag: 'tron_flag', lastAssigned: 'tron_last_assigned' },
    { flag: 'erc20_flag', lastAssigned: 'erc20_last_assigned' },
    { flag: 'bep20_flag', lastAssigned: 'bep20_last_assigned' },
    { flag: 'trc20_flag', lastAssigned: 'trc20_last_assigned' },
  ];

  let totalReleased = 0;

  for (const { flag, lastAssigned } of networks) {
    const [result] = await pool.query(
      `UPDATE wallets
       SET ${flag} = 1
       WHERE ${flag} IN ('false', '0', 0, false)
         AND ${lastAssigned} IS NOT NULL
         AND ${lastAssigned} < ?`,
      [cutoffTime]
    ) as [any, any];

    totalReleased += result.affectedRows || 0;
  }

  return totalReleased;
}
