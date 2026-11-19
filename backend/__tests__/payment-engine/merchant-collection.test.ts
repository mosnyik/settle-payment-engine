import { describe, expect, it } from 'vitest';
import {
  isValidBitcoinAddress,
  isValidEvmAddress,
  isValidTronAddress,
  isValidAddressForChain,
  walletChainForNetwork,
} from '../../src/utils/address-validation';
import {
  parseCollectionModes,
  resolveCollectionTarget,
  validateMerchantCollectionConfig,
} from '../../src/services/payment-engine/collection';
import { MerchantWalletNotConfiguredError } from '../../src/services/payment-engine/errors';

const BTC = {
  segwit: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
  segwitTypo: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdr',
  taproot: 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297',
  legacy: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  legacyTypo: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb',
  p2sh: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
  testnet: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
};
const EVM = {
  checksummed: '0x742D35cc6634c0532925A3b844bc9e7595F3ea42',
  lowercase: '0x742d35cc6634c0532925a3b844bc9e7595f3ea42',
  badChecksum: '0x742d35cc6634c0532925A3b844bc9e7595F3ea42', // one letter's case flipped
  short: '0x742d35cc6634c0532925a3b844bc9e7595f3ea4',
  zero: '0x0000000000000000000000000000000000000000',
};
const TRON = {
  valid: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  typo: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u',
  hexForm: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
};

describe('address validation', () => {
  it('accepts every mainnet Bitcoin address type', () => {
    for (const a of [BTC.segwit, BTC.taproot, BTC.legacy, BTC.p2sh]) {
      expect(isValidBitcoinAddress(a), a).toBe(true);
    }
  });

  it('rejects Bitcoin typos (checksum), testnet and padded input', () => {
    expect(isValidBitcoinAddress(BTC.segwitTypo)).toBe(false);
    expect(isValidBitcoinAddress(BTC.legacyTypo)).toBe(false);
    expect(isValidBitcoinAddress(BTC.testnet)).toBe(false);
    expect(isValidBitcoinAddress(` ${BTC.segwit}`)).toBe(false);
    expect(isValidBitcoinAddress('')).toBe(false);
  });

  it('accepts EVM addresses in checksummed or lowercase form', () => {
    expect(isValidEvmAddress(EVM.checksummed)).toBe(true);
    expect(isValidEvmAddress(EVM.lowercase)).toBe(true);
  });

  it('rejects a bad EIP-55 checksum, wrong length and the zero address', () => {
    expect(isValidEvmAddress(EVM.badChecksum)).toBe(false);
    expect(isValidEvmAddress(EVM.short)).toBe(false);
    expect(isValidEvmAddress(EVM.zero)).toBe(false);
  });

  it('accepts a Tron base58 address and rejects typos and the hex form', () => {
    expect(isValidTronAddress(TRON.valid)).toBe(true);
    expect(isValidTronAddress(TRON.typo)).toBe(false);
    expect(isValidTronAddress(TRON.hexForm)).toBe(false);
  });

  it('rejects an address from the wrong chain', () => {
    expect(isValidAddressForChain('bitcoin', TRON.valid)).toBe(false);
    expect(isValidAddressForChain('bitcoin', EVM.lowercase)).toBe(false);
    expect(isValidAddressForChain('tron', BTC.legacy)).toBe(false);
    expect(isValidAddressForChain('tron', EVM.checksummed)).toBe(false);
    expect(isValidAddressForChain('ethereum', TRON.valid)).toBe(false);
  });

  it('maps networks to their wallet family', () => {
    expect(walletChainForNetwork('bitcoin')).toBe('bitcoin');
    expect(walletChainForNetwork('trc20')).toBe('tron');
    for (const n of ['ethereum', 'erc20', 'bsc', 'bep20'] as const) {
      expect(walletChainForNetwork(n)).toBe('ethereum');
    }
  });
});

describe('parseCollectionModes', () => {
  it('handles mysql2 returning JSON as a string or an object', () => {
    expect(parseCollectionModes('{"BTC":"merchant"}')).toEqual({ BTC: 'merchant' });
    expect(parseCollectionModes({ BTC: 'merchant' })).toEqual({ BTC: 'merchant' });
  });

  it('drops unknown assets and modes, and tolerates junk', () => {
    expect(parseCollectionModes({ BTC: 'merchant', DOGE: 'merchant', ETH: 'other' })).toEqual({ BTC: 'merchant' });
    expect(parseCollectionModes('not json')).toEqual({});
    expect(parseCollectionModes(null)).toEqual({});
  });
});

describe('validateMerchantCollectionConfig', () => {
  const noWallets = { bitcoin: null, ethereum: null, tron: null };

  it('accepts BTC in merchant mode with a valid BTC wallet and WhatsApp number', () => {
    expect(validateMerchantCollectionConfig({
      collectionModes: { BTC: 'merchant' },
      wallets: { ...noWallets, bitcoin: BTC.segwit },
      whatsappPhone: '+2348012345678',
    })).toEqual([]);
  });

  it('rejects an invalid wallet for its chain even when no asset uses it', () => {
    const problems = validateMerchantCollectionConfig({
      collectionModes: {},
      wallets: { bitcoin: TRON.valid, ethereum: EVM.badChecksum, tron: TRON.typo },
      whatsappPhone: null,
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/parentWalletBitcoin/);
    expect(problems[1]).toMatch(/parentWalletEthereum/);
    expect(problems[2]).toMatch(/parentWalletTron/);
  });

  it('requires a wallet on a chain the asset can be received on', () => {
    const problems = validateMerchantCollectionConfig({
      collectionModes: { BTC: 'merchant', BNB: 'merchant' },
      wallets: { ...noWallets, tron: TRON.valid },
      whatsappPhone: '+2348012345678',
    });
    expect(problems).toEqual([
      'collectionModes.BTC: merchant mode needs a valid parentWalletBitcoin',
      'collectionModes.BNB: merchant mode needs a valid parentWalletEthereum',
    ]);
  });

  it('accepts USDT in merchant mode with either a Tron or an EVM wallet', () => {
    for (const wallets of [{ ...noWallets, tron: TRON.valid }, { ...noWallets, ethereum: EVM.lowercase }]) {
      expect(validateMerchantCollectionConfig({
        collectionModes: { USDT: 'merchant' },
        wallets,
        whatsappPhone: '+2348012345678',
      })).toEqual([]);
    }
  });

  it('requires a WhatsApp number with country code once any asset is merchant', () => {
    const base = { collectionModes: { BTC: 'merchant' as const }, wallets: { ...noWallets, bitcoin: BTC.segwit } };
    expect(validateMerchantCollectionConfig({ ...base, whatsappPhone: null })[0]).toMatch(/whatsappPhone: required/);
    expect(validateMerchantCollectionConfig({ ...base, whatsappPhone: '08012345678' })[0]).toMatch(/country code/);
  });

  it('does not need a WhatsApp number when everything is HD', () => {
    expect(validateMerchantCollectionConfig({
      collectionModes: { BTC: 'hd' },
      wallets: { ...noWallets, bitcoin: BTC.segwit },
      whatsappPhone: null,
    })).toEqual([]);
  });
});

describe('resolveCollectionTarget', () => {
  const key = {
    collectionModes: { BTC: 'merchant' as const, USDT: 'merchant' as const },
    parentWalletBitcoin: BTC.segwit,
    parentWalletEthereum: null,
    parentWalletTron: TRON.valid,
  };

  it('returns the merchant wallet for a merchant-mode asset', () => {
    expect(resolveCollectionTarget(key, 'BTC', 'bitcoin')).toEqual({ mode: 'merchant', address: BTC.segwit, chain: 'bitcoin' });
    expect(resolveCollectionTarget(key, 'USDT', 'trc20')).toEqual({ mode: 'merchant', address: TRON.valid, chain: 'tron' });
  });

  it('uses HD for assets not in merchant mode, and when there is no API key', () => {
    expect(resolveCollectionTarget(key, 'ETH', 'ethereum')).toEqual({ mode: 'hd' });
    expect(resolveCollectionTarget(null, 'BTC', 'bitcoin')).toEqual({ mode: 'hd' });
  });

  it('throws (never falls back to HD) when the network has no merchant wallet', () => {
    expect(() => resolveCollectionTarget(key, 'USDT', 'bep20')).toThrow(MerchantWalletNotConfiguredError);
  });

  it('throws when the stored wallet is not a valid address', () => {
    expect(() => resolveCollectionTarget({ ...key, parentWalletBitcoin: BTC.segwitTypo }, 'BTC', 'bitcoin'))
      .toThrow(/not a valid address/);
  });
});
