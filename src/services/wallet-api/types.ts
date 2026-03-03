/**
 * Wallet-as-a-Service Types
 */

export type WalletStatus =
  | 'watching'
  | 'deposit_detected'
  | 'confirmed'
  | 'swept'
  | 'expired';

export type WebhookEventType =
  | 'deposit.detected'
  | 'deposit.confirmed'
  | 'sweep.completed';

export interface WatchedWallet {
  id: string;
  apiKeyId: number;
  address: string;
  network: string;
  crypto: string;
  derivationIndex: number;
  hdChain: string;
  status: WalletStatus;
  txHash?: string;
  amount?: number;
  confirmations: number;
  detectedAt?: Date;
  confirmedAt?: Date;
  sweepTxHash?: string;
  sweptAt?: Date;
  webhookDepositSent: boolean;
  webhookConfirmedSent: boolean;
  webhookLastError?: string;
  webhookRetryCount: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface CreateWalletInput {
  network: string;
  crypto: string;
  metadata?: Record<string, unknown>;
  expiresInMinutes?: number;
}

export interface CreateWalletResult {
  id: string;
  address: string;
  network: string;
  crypto: string;
  status: WalletStatus;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface WebhookPayload {
  event: WebhookEventType;
  wallet_id: string;
  address: string;
  network: string;
  crypto: string;
  timestamp: string;
  tx_hash?: string;
  amount?: string;
  confirmations?: number;
  sweep_tx?: string;
  metadata?: Record<string, unknown>;
}

// Network to HD chain mapping
export const NETWORK_TO_HD_CHAIN: Record<string, string> = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  bsc: 'ethereum',  // Same derivation as Ethereum
  tron: 'tron',
  polygon: 'ethereum',
  base: 'ethereum',
  erc20: 'ethereum',
  bep20: 'ethereum',
  trc20: 'tron',
};

// Valid crypto/network combinations
export const VALID_CRYPTO_NETWORKS: Record<string, string[]> = {
  BTC: ['bitcoin'],
  ETH: ['ethereum'],
  BNB: ['bsc'],
  TRX: ['tron'],
  USDT: ['ethereum', 'erc20', 'bsc', 'bep20', 'tron', 'trc20'],
  USDC: ['ethereum', 'erc20', 'bsc', 'bep20'],
};
