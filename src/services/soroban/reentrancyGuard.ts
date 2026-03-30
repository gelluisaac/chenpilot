/**
 * Task 3: Cross-Contract Reentrancy Guard (Soroban Specific)
 *
 * Soroban does not have EVM-style reentrancy by default, but cross-contract
 * calls can still create re-entrant flows. This guard tracks in-flight
 * contract executions and rejects any re-entrant call on the same
 * contract+operation pair during a deposit or withdraw cycle.
 */

import logger from "../../config/logger";

export type ContractOperation = "deposit" | "withdraw" | "swap" | "claim";

export interface ReentrancyEntry {
  contractId: string;
  operation: ContractOperation;
  callerUserId: string;
  enteredAt: number;
}

/** Active execution slots — keyed by contractId:operation */
const executionSlots = new Map<string, ReentrancyEntry>();

function slotKey(contractId: string, operation: ContractOperation): string {
  return `${contractId}:${operation}`;
}

/**
 * Enter a guarded execution slot.
 * Throws if the same contract+operation is already executing (reentrancy detected).
 */
export function enterGuard(
  contractId: string,
  operation: ContractOperation,
  callerUserId: string
): void {
  const key = slotKey(contractId, operation);

  if (executionSlots.has(key)) {
    const existing = executionSlots.get(key)!;
    logger.error("Reentrancy detected — execution blocked", {
      contractId,
      operation,
      callerUserId,
      originalCaller: existing.callerUserId,
      enteredAt: new Date(existing.enteredAt).toISOString(),
    });

    throw new Error(
      `Reentrancy guard: '${operation}' on contract ${contractId} is already executing. ` +
        `Cross-contract callback blocked to prevent fund drain.`
    );
  }

  executionSlots.set(key, {
    contractId,
    operation,
    callerUserId,
    enteredAt: Date.now(),
  });

  logger.debug("Reentrancy guard entered", {
    contractId,
    operation,
    callerUserId,
  });
}

/**
 * Exit a guarded execution slot. Must be called in a finally block.
 */
export function exitGuard(
  contractId: string,
  operation: ContractOperation
): void {
  const key = slotKey(contractId, operation);
  executionSlots.delete(key);
  logger.debug("Reentrancy guard exited", { contractId, operation });
}

/**
 * Check if a contract+operation is currently executing.
 */
export function isExecuting(
  contractId: string,
  operation: ContractOperation
): boolean {
  return executionSlots.has(slotKey(contractId, operation));
}

/**
 * Higher-order function: wraps any contract call with reentrancy protection.
 *
 * Usage:
 *   const result = await withReentrancyGuard(contractId, "deposit", userId, async () => {
 *     return await depositFunds(...);
 *   });
 */
export async function withReentrancyGuard<T>(
  contractId: string,
  operation: ContractOperation,
  callerUserId: string,
  fn: () => Promise<T>
): Promise<T> {
  enterGuard(contractId, operation, callerUserId);
  try {
    return await fn();
  } finally {
    exitGuard(contractId, operation);
  }
}
