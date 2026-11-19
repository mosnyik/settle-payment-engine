/**
 * Collection mode - where a payer's crypto is collected.
 *
 * Set per merchant (API key), per asset, in api_keys.collection_modes:
 *   {"BTC": "merchant"}  -> BTC deposits go straight to the merchant's own
 *                           wallet (api_keys.parent_wallet_<chain>);
 *                           every other asset uses HD derivation.
 *
 * 'hd'       - unique derived deposit address, swept afterwards (default).
 * 'merchant' - deposit address is the merchant's wallet. No derivation, no
 *              sweep. Settlement does not pay out fiat: the merchant is sent a
 *              WhatsApp message with the recipient's and 2Settle's payouts.
 */

import type { ApiKey } from '../../../security/types';
import type { CryptoCurrency, Network } from '../types';
import { MerchantWalletNotConfiguredError } from '../errors';
import { PHONE_REGEX } from '../../../utils/phone';
import {
  WalletChain,
  WALLET_CHAIN_LABEL,
  isValidAddressForChain,
  walletChainForNetwork,
} from '../../../utils/address-validation';

export type CollectionMode = 'hd' | 'merchant';
export type CollectionModes = Partial<Record<CryptoCurrency, CollectionMode>>;

export const COLLECTION_ASSETS: readonly CryptoCurrency[] = ['BTC', 'ETH', 'BNB', 'TRX', 'USDT', 'USDC'];

/** Wallet families an asset can be received on. */
export const ASSET_WALLET_CHAINS: Record<CryptoCurrency, WalletChain[]> = {
  BTC: ['bitcoin'],
  ETH: ['ethereum'],
  BNB: ['ethereum'],
  TRX: ['tron'],
  USDT: ['tron', 'ethereum'],
  USDC: ['ethereum'],
};

export interface MerchantWallets {
  bitcoin: string | null;
  ethereum: string | null;
  tron: string | null;
}

export type CollectionTarget =
  | { mode: 'hd' }
  | { mode: 'merchant'; address: string; chain: WalletChain };

/** api_keys.collection_modes may come back from mysql2 as a string or an object. */
export function parseCollectionModes(raw: unknown): CollectionModes {
  if (!raw) return {};
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const modes: CollectionModes = {};
  for (const [asset, mode] of Object.entries(value as Record<string, unknown>)) {
    if ((COLLECTION_ASSETS as readonly string[]).includes(asset) && (mode === 'hd' || mode === 'merchant')) {
      modes[asset as CryptoCurrency] = mode;
    }
  }
  return modes;
}

export function getCollectionMode(modes: CollectionModes | null | undefined, crypto: CryptoCurrency): CollectionMode {
  return modes?.[crypto] ?? 'hd';
}

export function merchantWalletsOf(apiKey: Pick<ApiKey, 'parentWalletBitcoin' | 'parentWalletEthereum' | 'parentWalletTron'>): MerchantWallets {
  return {
    bitcoin: apiKey.parentWalletBitcoin,
    ethereum: apiKey.parentWalletEthereum,
    tron: apiKey.parentWalletTron,
  };
}

const WALLET_FIELD: Record<WalletChain, string> = {
  bitcoin: 'parentWalletBitcoin',
  ethereum: 'parentWalletEthereum',
  tron: 'parentWalletTron',
};

/**
 * Validate a merchant's wallet / collection settings as they would be after
 * an update. Returns human-readable problems; empty means valid.
 *
 * - Every wallet that is set must be a valid mainnet address for its chain.
 * - Every asset in merchant mode needs a valid wallet on at least one chain
 *   the asset can be received on.
 * - Any merchant-mode asset requires a WhatsApp number (settlement goes there).
 */
export function validateMerchantCollectionConfig(config: {
  collectionModes: CollectionModes;
  wallets: MerchantWallets;
  whatsappPhone: string | null;
}): string[] {
  const problems: string[] = [];

  for (const chain of Object.keys(WALLET_FIELD) as WalletChain[]) {
    const address = config.wallets[chain];
    if (address && !isValidAddressForChain(chain, address)) {
      problems.push(`${WALLET_FIELD[chain]}: not a valid ${WALLET_CHAIN_LABEL[chain]} address`);
    }
  }

  const merchantAssets = (Object.entries(config.collectionModes) as [CryptoCurrency, CollectionMode][])
    .filter(([, mode]) => mode === 'merchant')
    .map(([asset]) => asset);

  for (const asset of merchantAssets) {
    const chains = ASSET_WALLET_CHAINS[asset];
    const hasWallet = chains.some((chain) => {
      const address = config.wallets[chain];
      return Boolean(address) && isValidAddressForChain(chain, address!);
    });
    if (!hasWallet) {
      const fields = chains.map((c) => WALLET_FIELD[c]).join(' or ');
      problems.push(`collectionModes.${asset}: merchant mode needs a valid ${fields}`);
    }
  }

  if (merchantAssets.length > 0) {
    if (!config.whatsappPhone) {
      problems.push('whatsappPhone: required when any asset uses merchant collection');
    } else if (!PHONE_REGEX.test(config.whatsappPhone)) {
      problems.push('whatsappPhone: must include the country code, e.g. +2348012345678');
    }
  }

  return problems;
}

/**
 * Decide where a payment for (crypto, network) is collected for this API key.
 * Throws MerchantWalletNotConfiguredError when the asset is in merchant mode
 * but there is no valid wallet for the network's chain - never silently falls
 * back to HD, since the merchant expects the funds in their own wallet.
 */
export function resolveCollectionTarget(
  apiKey: Pick<ApiKey, 'collectionModes' | 'parentWalletBitcoin' | 'parentWalletEthereum' | 'parentWalletTron'> | null | undefined,
  crypto: CryptoCurrency,
  network: Network
): CollectionTarget {
  if (!apiKey || getCollectionMode(apiKey.collectionModes, crypto) !== 'merchant') {
    return { mode: 'hd' };
  }

  const chain = walletChainForNetwork(network);
  if (!ASSET_WALLET_CHAINS[crypto].includes(chain)) {
    throw new MerchantWalletNotConfiguredError(crypto, network, `${crypto} cannot be received on ${network}`);
  }

  const address = merchantWalletsOf(apiKey)[chain];
  if (!address) {
    throw new MerchantWalletNotConfiguredError(crypto, network, `no ${WALLET_CHAIN_LABEL[chain]} wallet set for this merchant`);
  }
  // Re-check at use time: catches addresses stored before validation existed
  if (!isValidAddressForChain(chain, address)) {
    throw new MerchantWalletNotConfiguredError(crypto, network, `stored ${WALLET_CHAIN_LABEL[chain]} wallet is not a valid address`);
  }

  return { mode: 'merchant', address, chain };
}

/** Load the API key and resolve the collection target. HD when there is no key. */
export async function resolveCollectionTargetForKey(
  apiKeyId: number | undefined,
  crypto: CryptoCurrency,
  network: Network
): Promise<CollectionTarget> {
  if (!apiKeyId) return { mode: 'hd' };
  const { getApiKeyById } = await import('../../../security/services/apiKey.service');
  const apiKey = await getApiKeyById(apiKeyId);
  return resolveCollectionTarget(apiKey, crypto, network);
}
