/**
 * HD Wallet Service
 *
 * Hierarchical Deterministic wallet service for deriving unique deposit addresses.
 * Uses atomic index increment for thread-safe derivation.
 */

import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { decryptAES256 } from '../../../utils/crypto';
import { getDerivation } from './derivation';
import {
  HDChain,
  DerivationResult,
  HDWalletConfig,
  DerivedAddress,
  KeyMaterial,
  NETWORK_TO_HD_CHAIN,
  DERIVATION_PATHS,
} from './types';
import { Network } from '../types';

// =============================================================================
// ERROR CLASSES
// =============================================================================

export class HDWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HDWalletError';
  }
}

export class HDWalletNotInitializedError extends HDWalletError {
  constructor() {
    super('HD Wallet not initialized. Check HD_WALLET_ENABLED and seed configuration.');
  }
}

export class InvalidSeedError extends HDWalletError {
  constructor(reason: string) {
    super(`Invalid seed phrase: ${reason}`);
  }
}

// =============================================================================
// SERVICE
// =============================================================================

export class HDWalletService {
  private seed: Uint8Array | null = null;
  private hotWalletAddresses: Map<HDChain, string> = new Map();
  private isInitialized: boolean = false;

  /**
   * Initialize the HD Wallet service.
   *
   * @param seedEncrypted - AES-256 encrypted seed phrase
   * @param seedEncryptionKey - 32-byte hex encryption key
   * @param hotWallets - Hot wallet addresses per chain
   */
  async initialize(
    seedEncrypted: string,
    seedEncryptionKey: string,
    hotWallets: { bitcoin: string; ethereum: string; tron: string }
  ): Promise<void> {
    if (this.isInitialized) {
      console.warn('[HDWallet] Already initialized');
      return;
    }

    // Decrypt seed phrase
    let mnemonic: string;
    try {
      mnemonic = decryptAES256(seedEncrypted, seedEncryptionKey);
    } catch (error) {
      throw new InvalidSeedError('Failed to decrypt seed phrase');
    }

    // Validate mnemonic
    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new InvalidSeedError('Invalid BIP39 mnemonic');
    }

    // Convert mnemonic to seed
    this.seed = mnemonicToSeedSync(mnemonic);

    // Store hot wallet addresses
    this.hotWalletAddresses.set('bitcoin', hotWallets.bitcoin);
    this.hotWalletAddresses.set('ethereum', hotWallets.ethereum);
    this.hotWalletAddresses.set('tron', hotWallets.tron);

    // Initialize database config if needed
    await this.ensureConfigExists();

    this.isInitialized = true;
    console.log('[HDWallet] Initialized successfully');
  }

  /**
   * Derive the next address for a given network.
   * Uses atomic index increment for thread safety.
   *
   * @param network - Network to derive address for
   * @returns Derivation result with address and index
   */
  async deriveNextAddress(network: Network): Promise<DerivationResult> {
    this.ensureInitialized();

    const chain = NETWORK_TO_HD_CHAIN[network];
    const pool = (await import('../../../lib/mysql')).default;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Atomically get and increment index
      const [rows] = await connection.query(
        `SELECT next_index FROM hd_wallet_config WHERE chain = ? FOR UPDATE`,
        [chain]
      ) as [any[], any];

      if (!rows || rows.length === 0) {
        throw new HDWalletError(`No HD config found for chain: ${chain}`);
      }

      const derivationIndex = Number(rows[0].next_index);

      // Increment index
      await connection.query(
        `UPDATE hd_wallet_config SET next_index = next_index + 1 WHERE chain = ?`,
        [chain]
      );

      await connection.commit();

      // Derive address outside transaction
      const derivation = getDerivation(chain);
      const keyMaterial = derivation.derive(this.seed!, derivationIndex);
      const derivationPath = derivation.getDerivationPath(derivationIndex);

      // Record derived address for audit
      await this.recordDerivedAddress(chain, derivationIndex, keyMaterial.address);

      return {
        address: keyMaterial.address,
        derivationIndex,
        chain,
        derivationPath,
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get private key for a derived address.
   * Used by sweeper to sign transactions.
   *
   * @param chain - HD chain
   * @param derivationIndex - Address derivation index
   * @returns Private key as hex string
   */
  getPrivateKey(chain: HDChain, derivationIndex: number): string {
    this.ensureInitialized();

    const derivation = getDerivation(chain);
    const keyMaterial = derivation.derive(this.seed!, derivationIndex);

    return keyMaterial.privateKey;
  }

  /**
   * Get the hot wallet address for a chain.
   *
   * @param chain - HD chain
   * @returns Hot wallet address
   */
  getHotWalletAddress(chain: HDChain): string {
    const address = this.hotWalletAddresses.get(chain);
    if (!address) {
      throw new HDWalletError(`No hot wallet configured for chain: ${chain}`);
    }
    return address;
  }

  /**
   * Derive address at a specific index (for verification).
   *
   * @param chain - HD chain
   * @param index - Derivation index
   * @returns Key material
   */
  deriveAtIndex(chain: HDChain, index: number): KeyMaterial {
    this.ensureInitialized();

    const derivation = getDerivation(chain);
    return derivation.derive(this.seed!, index);
  }

  /**
   * Link a derived address to a session.
   *
   * @param address - Derived address
   * @param sessionId - Session ID
   */
  async linkAddressToSession(address: string, sessionId: string): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;

    await pool.query(
      `UPDATE derived_addresses SET session_id = ? WHERE address = ?`,
      [sessionId, address]
    );
  }

  /**
   * Get derived address info by address.
   *
   * @param address - Address to look up
   * @returns Derived address record or null
   */
  async getAddressInfo(address: string): Promise<DerivedAddress | null> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT * FROM derived_addresses WHERE address = ?`,
      [address]
    ) as [any[], any];

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      chain: row.chain,
      derivationIndex: Number(row.derivation_index),
      address: row.address,
      sessionId: row.session_id,
      derivedAt: new Date(row.derived_at),
      sweptAt: row.swept_at ? new Date(row.swept_at) : null,
      sweepTxHash: row.sweep_tx_hash,
    };
  }

  /**
   * Mark an address as swept.
   *
   * @param address - Address that was swept
   * @param txHash - Sweep transaction hash
   */
  async markAddressSwept(address: string, txHash: string): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;

    await pool.query(
      `UPDATE derived_addresses SET swept_at = NOW(), sweep_tx_hash = ? WHERE address = ?`,
      [txHash, address]
    );
  }

  /**
   * Check if service is enabled and initialized.
   */
  isEnabled(): boolean {
    return this.isInitialized;
  }

  /**
   * Get current derivation index for a chain.
   *
   * @param chain - HD chain
   * @returns Current next index
   */
  async getCurrentIndex(chain: HDChain): Promise<number> {
    const pool = (await import('../../../lib/mysql')).default;

    const [rows] = await pool.query(
      `SELECT next_index FROM hd_wallet_config WHERE chain = ?`,
      [chain]
    ) as [any[], any];

    if (!rows || rows.length === 0) {
      return 0;
    }

    return Number(rows[0].next_index);
  }

  /**
   * Ensure the service is initialized.
   */
  private ensureInitialized(): void {
    if (!this.isInitialized || !this.seed) {
      throw new HDWalletNotInitializedError();
    }
  }

  /**
   * Ensure HD wallet config exists in database.
   */
  private async ensureConfigExists(): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;

    const chains: HDChain[] = ['bitcoin', 'ethereum', 'tron'];

    for (const chain of chains) {
      const [rows] = await pool.query(
        `SELECT id FROM hd_wallet_config WHERE chain = ?`,
        [chain]
      ) as [any[], any];

      if (!rows || rows.length === 0) {
        await pool.query(
          `INSERT INTO hd_wallet_config (chain, derivation_path_base, next_index, hot_wallet_address)
           VALUES (?, ?, 0, ?)`,
          [chain, DERIVATION_PATHS[chain], this.hotWalletAddresses.get(chain) || '']
        );
      } else {
        // Update hot wallet address if changed
        const hotWallet = this.hotWalletAddresses.get(chain);
        if (hotWallet) {
          await pool.query(
            `UPDATE hd_wallet_config SET hot_wallet_address = ? WHERE chain = ?`,
            [hotWallet, chain]
          );
        }
      }
    }
  }

  /**
   * Record a derived address for audit trail.
   */
  private async recordDerivedAddress(
    chain: HDChain,
    derivationIndex: number,
    address: string
  ): Promise<void> {
    const pool = (await import('../../../lib/mysql')).default;

    await pool.query(
      `INSERT INTO derived_addresses (chain, derivation_index, address)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE address = address`,
      [chain, derivationIndex, address]
    );
  }

  /**
   * Cleanup - clear sensitive data from memory.
   */
  destroy(): void {
    if (this.seed) {
      // Zero out seed
      this.seed.fill(0);
      this.seed = null;
    }
    this.hotWalletAddresses.clear();
    this.isInitialized = false;
    console.log('[HDWallet] Destroyed');
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let hdWalletInstance: HDWalletService | null = null;

/**
 * Get or create the HD wallet service instance.
 */
export function getHDWalletService(): HDWalletService | null {
  return hdWalletInstance;
}

/**
 * Create and initialize the HD wallet service.
 */
export async function createHDWalletService(
  seedEncrypted: string,
  seedEncryptionKey: string,
  hotWallets: { bitcoin: string; ethereum: string; tron: string }
): Promise<HDWalletService> {
  if (hdWalletInstance) {
    return hdWalletInstance;
  }

  hdWalletInstance = new HDWalletService();
  await hdWalletInstance.initialize(seedEncrypted, seedEncryptionKey, hotWallets);

  return hdWalletInstance;
}

/**
 * Destroy the HD wallet service instance.
 */
export function destroyHDWalletService(): void {
  if (hdWalletInstance) {
    hdWalletInstance.destroy();
    hdWalletInstance = null;
  }
}
