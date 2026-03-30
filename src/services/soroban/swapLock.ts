/**
 * Task 2: Race-Condition Protected Multi-Step Swap Hooks
 *
 * Implements a contract-level lock state for cross-chain swaps.
 * Prevents any other operations on locked funds until the cross-chain
 * proof is submitted or the timeout expires.
 */

import logger from "../../config/logger";

export type SwapLockStatus = "idle" | "locked" | "awaiting_proof" | "expired";

export interface SwapLock {
  lockId: string;
  userId: string;
  contractId: string;
  /** Assets and amounts locked */
  lockedFunds: Record<string, string>;
  status: SwapLockStatus;
  createdAt: number;
  expiresAt: number;
  /** Ledger sequence when lock was created */
  lockLedger?: number;
}

export interface AcquireSwapLockOptions {
  userId: string;
  contractId: string;
  lockedFunds: Record<string, string>;
  /** Lock TTL in milliseconds (default: 5 minutes) */
  ttlMs?: number;
}

export interface SwapLockResult {
  acquired: boolean;
  lock?: SwapLock;
  reason?: string;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** In-memory lock store (replace with Redis in production for distributed safety) */
const lockStore = new Map<string, SwapLock>();

function generateLockId(): string {
  return `swaplock_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function lockKey(userId: string, contractId: string): string {
  return `${userId}:${contractId}`;
}

/**
 * Acquire a swap lock for a user's funds on a specific contract.
 * Returns false if funds are already locked (race-condition protection).
 */
export function acquireSwapLock(
  options: AcquireSwapLockOptions
): SwapLockResult {
  const key = lockKey(options.userId, options.contractId);
  const now = Date.now();

  // Check for existing active lock
  const existing = lockStore.get(key);
  if (existing) {
    // Auto-expire stale locks
    if (existing.expiresAt <= now) {
      lockStore.delete(key);
      logger.warn("Expired swap lock cleared", {
        lockId: existing.lockId,
        userId: options.userId,
        contractId: options.contractId,
      });
    } else {
      logger.warn("Swap lock already held", {
        lockId: existing.lockId,
        userId: options.userId,
        status: existing.status,
        expiresIn: existing.expiresAt - now,
      });

      return {
        acquired: false,
        reason: `Funds are locked for an in-progress swap (lock: ${existing.lockId}). Submit proof or wait for timeout.`,
      };
    }
  }

  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const lock: SwapLock = {
    lockId: generateLockId(),
    userId: options.userId,
    contractId: options.contractId,
    lockedFunds: options.lockedFunds,
    status: "locked",
    createdAt: now,
    expiresAt: now + ttl,
  };

  lockStore.set(key, lock);

  logger.info("Swap lock acquired", {
    lockId: lock.lockId,
    userId: options.userId,
    contractId: options.contractId,
    lockedFunds: options.lockedFunds,
    expiresAt: new Date(lock.expiresAt).toISOString(),
  });

  return { acquired: true, lock };
}

/**
 * Advance lock to awaiting_proof state after swap is initiated.
 */
export function advanceLockToAwaitingProof(
  userId: string,
  contractId: string,
  lockId: string
): boolean {
  const key = lockKey(userId, contractId);
  const lock = lockStore.get(key);

  if (!lock || lock.lockId !== lockId) return false;
  if (lock.status !== "locked") return false;

  lock.status = "awaiting_proof";
  lockStore.set(key, lock);

  logger.info("Swap lock advanced to awaiting_proof", { lockId, userId });
  return true;
}

/**
 * Release a swap lock after proof is submitted or operation completes.
 */
export function releaseSwapLock(
  userId: string,
  contractId: string,
  lockId: string
): boolean {
  const key = lockKey(userId, contractId);
  const lock = lockStore.get(key);

  if (!lock || lock.lockId !== lockId) {
    logger.warn("Swap lock release failed: lock not found or ID mismatch", {
      lockId,
      userId,
    });
    return false;
  }

  lockStore.delete(key);

  logger.info("Swap lock released", {
    lockId,
    userId,
    contractId,
    duration: Date.now() - lock.createdAt,
  });

  return true;
}

/**
 * Check if funds are currently locked for a user/contract pair.
 */
export function getSwapLock(
  userId: string,
  contractId: string
): SwapLock | null {
  const key = lockKey(userId, contractId);
  const lock = lockStore.get(key);

  if (!lock) return null;

  // Auto-expire
  if (lock.expiresAt <= Date.now()) {
    lockStore.delete(key);
    logger.info("Expired swap lock auto-cleared on read", {
      lockId: lock.lockId,
    });
    return null;
  }

  return lock;
}

/**
 * Higher-order function: wraps a multi-step swap with lock acquisition/release.
 */
export async function withSwapLock<T>(
  options: AcquireSwapLockOptions,
  fn: (lock: SwapLock) => Promise<T>
): Promise<T> {
  const result = acquireSwapLock(options);

  if (!result.acquired || !result.lock) {
    throw new Error(result.reason ?? "Failed to acquire swap lock");
  }

  const lock = result.lock;

  try {
    advanceLockToAwaitingProof(options.userId, options.contractId, lock.lockId);
    return await fn(lock);
  } finally {
    releaseSwapLock(options.userId, options.contractId, lock.lockId);
  }
}
