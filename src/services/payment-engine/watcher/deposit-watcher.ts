/**
 * Deposit Watcher Service
 *
 * On-demand blockchain monitoring - only watches addresses with active sessions.
 * Starts polling when a wallet is assigned, stops when deposit is confirmed or session expires.
 */

import { EventEmitter } from 'events';
import { sessionManager } from '../session';
import { Network, CryptoCurrency } from '../types';
import {
  WatcherConfig,
  WatchedSession,
  WatchableChain,
  WatcherEvent,
  ChainTransaction,
  AmountMatchResult,
  TransactionValidationResult,
  NETWORK_TO_WATCHABLE_CHAIN,
  REQUIRED_CONFIRMATIONS,
  DUST_THRESHOLDS,
  VERIFIED_TOKENS,
} from './types';
import {
  ChainAdapter,
  BitcoinAdapter,
  EthereumAdapter,
  BscAdapter,
  TronAdapter,
} from './adapters';
import { getProcessedTxStore } from './state';

// =============================================================================
// TYPES
// =============================================================================

interface ActiveWatch {
  session: WatchedSession;
  timer: NodeJS.Timeout;
  lastCheck: Date;
}

// =============================================================================
// DEPOSIT WATCHER
// =============================================================================

/**
 * DepositWatcher monitors blockchain addresses on-demand.
 *
 * Instead of continuously polling all chains, it:
 * 1. Starts watching when a session is created (wallet assigned)
 * 2. Polls only the specific address at chain-appropriate intervals
 * 3. Stops watching when deposit is confirmed or session expires
 */
export class DepositWatcher extends EventEmitter {
  private readonly config: WatcherConfig;
  private readonly adapters: Map<WatchableChain, ChainAdapter> = new Map();
  private readonly activeWatches: Map<string, ActiveWatch> = new Map(); // sessionId -> watch
  private isRunning: boolean = false;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: WatcherConfig) {
    super();
    this.config = config;
    this.initializeAdapters();
  }

  /**
   * Initialize chain adapters based on configuration.
   */
  private initializeAdapters(): void {
    if (this.config.chains.bitcoin.enabled) {
      this.adapters.set('bitcoin', new BitcoinAdapter(this.config.chains.bitcoin));
    }
    if (this.config.chains.ethereum.enabled && this.config.chains.ethereum.apiKey) {
      this.adapters.set('ethereum', new EthereumAdapter(this.config.chains.ethereum));
    }
    if (this.config.chains.bsc.enabled && this.config.chains.bsc.apiKey) {
      this.adapters.set('bsc', new BscAdapter(this.config.chains.bsc));
    }
    if (this.config.chains.tron.enabled) {
      this.adapters.set('tron', new TronAdapter(this.config.chains.tron));
    }
  }

  /**
   * Start the watcher service.
   * This just enables watching - actual polling starts when watchSession() is called.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[DepositWatcher] Already running');
      return;
    }

    this.isRunning = true;
    this.emitEvent({ type: 'watcher_started', timestamp: new Date() });

    console.log(
      `[DepositWatcher] Started with chains: ${Array.from(this.adapters.keys()).join(', ')}`
    );
    console.log('[DepositWatcher] Waiting for sessions to watch...');

    // Start cleanup timer to remove expired sessions
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredWatches();
    }, 60000); // Check every minute
  }

  /**
   * Stop the watcher service.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Stop all active watches
    for (const [sessionId, watch] of this.activeWatches) {
      clearInterval(watch.timer);
      console.log(`[DepositWatcher] Stopped watching session ${sessionId.slice(0, 8)}...`);
    }
    this.activeWatches.clear();

    this.emitEvent({ type: 'watcher_stopped', timestamp: new Date() });
    console.log('[DepositWatcher] Stopped');
  }

  /**
   * Start watching a session for deposits.
   * Called when a wallet is assigned to a payment session.
   */
  watchSession(session: WatchedSession): void {
    if (!this.isRunning) {
      console.warn('[DepositWatcher] Cannot watch session - watcher not running');
      return;
    }

    // Check if already watching
    if (this.activeWatches.has(session.id)) {
      console.warn(`[DepositWatcher] Already watching session ${session.id.slice(0, 8)}...`);
      return;
    }

    const chain = session.chain;
    const adapter = this.adapters.get(chain);

    if (!adapter) {
      console.warn(`[DepositWatcher] No adapter for chain ${chain}, cannot watch session`);
      return;
    }

    const interval = this.config.chains[chain].pollingIntervalMs;

    console.log(
      `[DepositWatcher] Watching session ${session.id.slice(0, 8)}... ` +
        `(${session.cryptoCurrency} on ${chain}, polling every ${interval}ms)`
    );

    // Start polling for this session
    const timer = setInterval(() => {
      this.checkSession(session.id).catch((err) => {
        console.error(`[DepositWatcher] Error checking session ${session.id.slice(0, 8)}:`, err.message);
      });
    }, interval);

    // Do an immediate check
    this.checkSession(session.id).catch((err) => {
      console.error(`[DepositWatcher] Error checking session ${session.id.slice(0, 8)}:`, err.message);
    });

    this.activeWatches.set(session.id, {
      session,
      timer,
      lastCheck: new Date(),
    });
  }

  /**
   * Start watching a session by providing minimal info.
   * This is the main entry point called from session manager.
   */
  watch(params: {
    sessionId: string;
    depositAddress: string;
    network: Network;
    cryptoCurrency: CryptoCurrency;
    expectedAmount: number;
    walletId: number;
    expiresAt: Date;
  }): void {
    const chain = NETWORK_TO_WATCHABLE_CHAIN[params.network];

    const session: WatchedSession = {
      id: params.sessionId,
      depositAddress: params.depositAddress,
      network: params.network,
      chain,
      cryptoCurrency: params.cryptoCurrency,
      expectedAmount: params.expectedAmount,
      walletId: params.walletId,
      status: 'pending',
      expiresAt: params.expiresAt,
    };

    this.watchSession(session);
  }

  /**
   * Stop watching a session.
   * Called when deposit is confirmed, session expires, or is cancelled.
   */
  unwatchSession(sessionId: string): void {
    const watch = this.activeWatches.get(sessionId);
    if (!watch) return;

    clearInterval(watch.timer);
    this.activeWatches.delete(sessionId);

    console.log(`[DepositWatcher] Stopped watching session ${sessionId.slice(0, 8)}...`);
  }

  /**
   * Check a specific session for deposits.
   */
  private async checkSession(sessionId: string): Promise<void> {
    const watch = this.activeWatches.get(sessionId);
    if (!watch) return;

    const { session } = watch;
    watch.lastCheck = new Date();

    // Check if session has expired
    if (new Date() > session.expiresAt) {
      this.emitEvent({
        type: 'session_expired',
        chain: session.chain,
        sessionId: session.id,
        timestamp: new Date(),
      });
      this.unwatchSession(sessionId);
      return;
    }

    const adapter = this.adapters.get(session.chain);
    if (!adapter) return;

    const txStore = getProcessedTxStore();

    try {
      if (session.status === 'pending') {
        // Look for new deposits
        await this.checkForDeposit(session, adapter);
      } else if (session.status === 'confirming' && session.txHash) {
        // Track confirmations
        await this.checkConfirmations(session, adapter);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emitEvent({
        type: 'api_error',
        chain: session.chain,
        sessionId: session.id,
        details: { error: errorMessage },
        timestamp: new Date(),
      });
    }
  }

  /**
   * Check for new deposits to a pending session.
   */
  private async checkForDeposit(
    session: WatchedSession,
    adapter: ChainAdapter
  ): Promise<void> {
    const txStore = getProcessedTxStore();
    const tokenAddress = this.getTokenAddress(session.network, session.cryptoCurrency);

    const transactions = await adapter.getTransactions(session.depositAddress, {
      tokenAddress,
      limit: 10,
    });

    for (const tx of transactions) {
      // Skip if already processed
      if (await txStore.isProcessed(tx.txHash, 'mark_deposit')) {
        continue;
      }

      // Validate transaction
      const validation = this.validateTransaction(tx, session);
      if (!validation.valid) {
        await this.handleInvalidTransaction(tx, session, validation);
        continue;
      }

      // Check amount match
      const amountMatch = this.checkAmountMatch(tx.amountDecimal, session.expectedAmount);

      if (amountMatch === 'underpaid') {
        const event: WatcherEvent = {
          type: 'underpaid_deposit',
          chain: session.chain,
          sessionId: session.id,
          txHash: tx.txHash,
          details: {
            expected: session.expectedAmount,
            received: tx.amountDecimal,
            shortfall: session.expectedAmount - tx.amountDecimal,
          },
          timestamp: new Date(),
        };
        this.emitEvent(event);
        await txStore.logFraudEvent(event);
        continue;
      }

      // Deposit detected!
      try {
        await sessionManager.markDeposit(session.id, tx.txHash, tx.amountDecimal);

        await txStore.markProcessed({
          txHash: tx.txHash,
          sessionId: session.id,
          chain: session.chain,
          action: 'mark_deposit',
          processedAt: new Date(),
        });

        // Update session state for confirmation tracking
        const watch = this.activeWatches.get(session.id);
        if (watch) {
          watch.session = {
            ...session,
            status: 'confirming',
            txHash: tx.txHash,
          };
        }

        this.emitEvent({
          type: 'deposit_detected',
          chain: session.chain,
          sessionId: session.id,
          txHash: tx.txHash,
          details: {
            expected: session.expectedAmount,
            received: tx.amountDecimal,
            amountMatch,
            confirmations: tx.confirmations,
            isRbfEnabled: tx.isRbfEnabled,
          },
          timestamp: new Date(),
        });

        console.log(
          `[DepositWatcher] Deposit detected for session ${session.id.slice(0, 8)}...: ` +
            `${tx.amountDecimal} ${session.cryptoCurrency}`
        );

        return; // Found a match, stop checking
      } catch (error) {
        console.error(`[DepositWatcher] Error marking deposit:`, error);
      }
    }
  }

  /**
   * Check confirmations for a confirming session.
   */
  private async checkConfirmations(
    session: WatchedSession,
    adapter: ChainAdapter
  ): Promise<void> {
    if (!session.txHash) return;

    const txStore = getProcessedTxStore();

    // Skip if already confirmed
    if (await txStore.isProcessed(session.txHash, 'confirm_deposit')) {
      this.unwatchSession(session.id);
      return;
    }

    const tx = await adapter.getTransaction(session.txHash);

    if (!tx) {
      // Transaction not found - possible reorg
      const event: WatcherEvent = {
        type: 'reorg_detected',
        chain: session.chain,
        sessionId: session.id,
        txHash: session.txHash,
        timestamp: new Date(),
      };
      this.emitEvent(event);
      await txStore.logFraudEvent(event);
      console.warn(
        `[DepositWatcher] Possible reorg: TX ${session.txHash.slice(0, 12)}... not found`
      );
      return;
    }

    // Check for RBF replacement (Bitcoin)
    if (tx.replacedByTxHash) {
      const event: WatcherEvent = {
        type: 'rbf_replacement',
        chain: session.chain,
        sessionId: session.id,
        txHash: session.txHash,
        details: { replacedBy: tx.replacedByTxHash },
        timestamp: new Date(),
      };
      this.emitEvent(event);
      await txStore.logFraudEvent(event);
      return;
    }

    const requiredConfirmations = REQUIRED_CONFIRMATIONS[session.chain];
    // Require more confirmations for RBF-enabled Bitcoin transactions
    const effectiveRequired =
      session.chain === 'bitcoin' && tx.isRbfEnabled
        ? Math.max(requiredConfirmations, 3)
        : requiredConfirmations;

    if (tx.confirmations >= effectiveRequired) {
      // Confirmed!
      try {
        await sessionManager.confirmDeposit(session.id, tx.confirmations);

        await txStore.markProcessed({
          txHash: tx.txHash,
          sessionId: session.id,
          chain: session.chain,
          action: 'confirm_deposit',
          confirmations: tx.confirmations,
          processedAt: new Date(),
        });

        this.emitEvent({
          type: 'deposit_confirmed',
          chain: session.chain,
          sessionId: session.id,
          txHash: tx.txHash,
          details: {
            confirmations: tx.confirmations,
            required: effectiveRequired,
          },
          timestamp: new Date(),
        });

        console.log(
          `[DepositWatcher] Deposit confirmed for session ${session.id.slice(0, 8)}...: ` +
            `${tx.confirmations} confirmations`
        );

        // Stop watching this session
        this.unwatchSession(session.id);
      } catch (error) {
        console.error(`[DepositWatcher] Error confirming deposit:`, error);
      }
    }
  }

  /**
   * Handle invalid transaction (log security events).
   */
  private async handleInvalidTransaction(
    tx: ChainTransaction,
    session: WatchedSession,
    validation: TransactionValidationResult
  ): Promise<void> {
    const txStore = getProcessedTxStore();

    if (validation.reason === 'unverified_token_contract') {
      const event: WatcherEvent = {
        type: 'fake_token_attempt',
        chain: session.chain,
        sessionId: session.id,
        txHash: tx.txHash,
        details: {
          expectedToken: this.getTokenAddress(session.network, session.cryptoCurrency),
          receivedToken: tx.tokenAddress,
        },
        timestamp: new Date(),
      };
      this.emitEvent(event);
      await txStore.logFraudEvent(event);
    } else if (validation.reason === 'dust_amount') {
      this.emitEvent({
        type: 'dust_deposit_ignored',
        chain: session.chain,
        sessionId: session.id,
        txHash: tx.txHash,
        details: { amount: tx.amountDecimal },
        timestamp: new Date(),
      });
    }
  }

  /**
   * Clean up expired watches.
   */
  private cleanupExpiredWatches(): void {
    const now = new Date();

    for (const [sessionId, watch] of this.activeWatches) {
      if (now > watch.session.expiresAt) {
        this.emitEvent({
          type: 'session_expired',
          chain: watch.session.chain,
          sessionId,
          timestamp: now,
        });
        this.unwatchSession(sessionId);
      }
    }
  }

  /**
   * Validate a transaction before processing.
   */
  private validateTransaction(
    tx: ChainTransaction,
    session: WatchedSession
  ): TransactionValidationResult {
    // 1. Must have at least 1 confirmation (no zero-conf)
    if (tx.confirmations < 1) {
      return { valid: false, reason: 'zero_confirmation' };
    }

    // 2. Check dust threshold
    const dustThreshold = DUST_THRESHOLDS[session.chain];
    if (tx.amountDecimal < dustThreshold) {
      return { valid: false, reason: 'dust_amount' };
    }

    // 3. Verify token contract address (for token transfers)
    if (tx.tokenAddress) {
      const expectedToken = this.getTokenAddress(session.network, session.cryptoCurrency);
      if (!expectedToken || tx.tokenAddress.toLowerCase() !== expectedToken.toLowerCase()) {
        return { valid: false, reason: 'unverified_token_contract' };
      }
    }

    // 4. Check for RBF with insufficient confirmations (Bitcoin only)
    if (session.chain === 'bitcoin' && tx.isRbfEnabled && tx.confirmations < 3) {
      return { valid: false, reason: 'rbf_insufficient_confirmations' };
    }

    return { valid: true };
  }

  /**
   * Check if received amount matches expected amount within tolerance.
   */
  private checkAmountMatch(received: number, expected: number): AmountMatchResult {
    const tolerance = this.config.amountTolerance;
    const diff = received - expected;
    const percentDiff = Math.abs(diff) / expected;

    if (diff === 0) return 'exact';
    if (diff > 0) return 'overpaid';
    if (percentDiff <= tolerance) return 'within_tolerance';
    return 'underpaid';
  }

  /**
   * Get token contract address for token transfers.
   */
  private getTokenAddress(network: Network, crypto: CryptoCurrency): string | undefined {
    if (crypto !== 'USDT') return undefined;
    const chain = NETWORK_TO_WATCHABLE_CHAIN[network];
    return VERIFIED_TOKENS[chain]?.[crypto];
  }

  /**
   * Emit a watcher event.
   */
  private emitEvent(event: WatcherEvent): void {
    this.emit('watcher_event', event);
  }

  /**
   * Check if watcher is running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get enabled chains.
   */
  getEnabledChains(): WatchableChain[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get number of active watches.
   */
  getActiveWatchCount(): number {
    return this.activeWatches.size;
  }

  /**
   * Get active session IDs being watched.
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.activeWatches.keys());
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let watcherInstance: DepositWatcher | null = null;

/**
 * Create or get the deposit watcher instance.
 */
export function createDepositWatcher(config: WatcherConfig): DepositWatcher {
  if (watcherInstance) {
    return watcherInstance;
  }
  watcherInstance = new DepositWatcher(config);
  return watcherInstance;
}

/**
 * Get the existing watcher instance.
 */
export function getDepositWatcher(): DepositWatcher | null {
  return watcherInstance;
}

/**
 * Stop and clear the watcher instance.
 */
export async function stopDepositWatcher(): Promise<void> {
  if (watcherInstance) {
    await watcherInstance.stop();
    watcherInstance = null;
  }
}
