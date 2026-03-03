/**
 * Wallet Service
 * Business logic for wallet-as-a-service API
 */

import {
  CreateWalletInput,
  CreateWalletResult,
  WatchedWallet,
  NETWORK_TO_HD_CHAIN,
  VALID_CRYPTO_NETWORKS,
} from './types';
import * as walletRepository from './wallet.repository';
import { getHDWalletService } from '../payment-engine/hd-wallet';
import { incrementUsage } from './usage.service';

export class WalletServiceError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400) {
    super(message);
    this.name = 'WalletServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Validate crypto/network combination
 */
function validateCryptoNetwork(crypto: string, network: string): void {
  const validNetworks = VALID_CRYPTO_NETWORKS[crypto.toUpperCase()];

  if (!validNetworks) {
    throw new WalletServiceError(
      `Unsupported cryptocurrency: ${crypto}`,
      'INVALID_CRYPTO',
      400
    );
  }

  if (!validNetworks.includes(network.toLowerCase())) {
    throw new WalletServiceError(
      `${crypto} is not supported on ${network}`,
      'INVALID_NETWORK',
      400
    );
  }
}

/**
 * Create a new watched wallet address
 */
export async function createWallet(
  apiKeyId: number,
  input: CreateWalletInput
): Promise<CreateWalletResult> {
  const crypto = input.crypto.toUpperCase();
  const network = input.network.toLowerCase();

  // Validate crypto/network combination
  validateCryptoNetwork(crypto, network);

  // Get HD wallet service
  const hdWallet = getHDWalletService();
  if (!hdWallet?.isEnabled()) {
    throw new WalletServiceError(
      'HD wallet service is not available',
      'HD_WALLET_UNAVAILABLE',
      503
    );
  }

  // Derive new address
  const derivation = await hdWallet.deriveNextAddress(network as any);

  // Calculate expiration
  let expiresAt: Date | undefined;
  if (input.expiresInMinutes) {
    expiresAt = new Date(Date.now() + input.expiresInMinutes * 60 * 1000);
  }

  // Save to database
  const wallet = await walletRepository.createWallet({
    apiKeyId,
    address: derivation.address,
    network,
    crypto,
    derivationIndex: derivation.derivationIndex,
    hdChain: derivation.chain,
    metadata: input.metadata,
    expiresAt,
  });

  // Track usage
  await incrementUsage(apiKeyId, 'wallets_created');

  return {
    id: wallet.id,
    address: wallet.address,
    network: wallet.network,
    crypto: wallet.crypto,
    status: wallet.status,
    createdAt: wallet.createdAt,
    expiresAt: wallet.expiresAt,
    metadata: wallet.metadata,
  };
}

/**
 * Get a wallet by ID
 */
export async function getWallet(
  walletId: string,
  apiKeyId: number
): Promise<WatchedWallet> {
  const wallet = await walletRepository.getWalletById(walletId);

  if (!wallet) {
    throw new WalletServiceError(
      `Wallet not found: ${walletId}`,
      'WALLET_NOT_FOUND',
      404
    );
  }

  // Verify ownership
  if (wallet.apiKeyId !== apiKeyId) {
    throw new WalletServiceError(
      `Wallet not found: ${walletId}`,
      'WALLET_NOT_FOUND',
      404
    );
  }

  return wallet;
}

/**
 * List wallets for an API key
 */
export async function listWallets(
  apiKeyId: number,
  options: {
    status?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<WatchedWallet[]> {
  return walletRepository.listWalletsByApiKey(apiKeyId, {
    status: options.status as any,
    limit: options.limit,
    offset: options.offset,
  });
}

/**
 * Get wallet by address (for watcher integration)
 */
export async function getWalletByAddress(
  address: string,
  network: string
): Promise<WatchedWallet | null> {
  return walletRepository.getWalletByAddress(address, network);
}

/**
 * Mark deposit detected on a wallet
 */
export async function markDepositDetected(
  walletId: string,
  txHash: string,
  amount: number
): Promise<WatchedWallet | null> {
  const wallet = await walletRepository.updateWalletDeposit(walletId, {
    status: 'deposit_detected',
    txHash,
    amount,
    confirmations: 0,
    detectedAt: new Date(),
  });

  if (wallet) {
    await incrementUsage(wallet.apiKeyId, 'deposits_detected');
  }

  return wallet;
}

/**
 * Update confirmation count
 */
export async function updateConfirmations(
  walletId: string,
  confirmations: number
): Promise<WatchedWallet | null> {
  return walletRepository.updateWalletDeposit(walletId, {
    status: 'deposit_detected',
    confirmations,
  });
}

/**
 * Mark deposit as confirmed
 */
export async function markDepositConfirmed(
  walletId: string,
  confirmations: number
): Promise<WatchedWallet | null> {
  const wallet = await walletRepository.updateWalletDeposit(walletId, {
    status: 'confirmed',
    confirmations,
    confirmedAt: new Date(),
  });

  if (wallet) {
    await incrementUsage(wallet.apiKeyId, 'deposits_confirmed');
  }

  return wallet;
}

/**
 * Mark wallet as swept
 */
export async function markSwept(
  walletId: string,
  sweepTxHash: string
): Promise<WatchedWallet | null> {
  const wallet = await walletRepository.updateWalletSweep(walletId, sweepTxHash);

  if (wallet) {
    await incrementUsage(wallet.apiKeyId, 'sweeps_completed');
  }

  return wallet;
}

/**
 * Get all wallets being watched (for watcher service)
 */
export async function getWatchingWallets(): Promise<WatchedWallet[]> {
  return walletRepository.getWatchingWallets();
}

/**
 * Expire old wallets
 */
export async function expireOldWallets(): Promise<number> {
  return walletRepository.expireOldWallets();
}
