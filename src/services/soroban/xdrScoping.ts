/**
 * Task 4: Optimized XDR Scoping for Contract Storage
 *
 * Minimizes DataEntry key/value sizes to reduce Soroban resource fees.
 * Uses bit-packing and compact structural types for multi-asset vault data.
 */

import * as StellarSdk from "@stellar/stellar-sdk";

// ─── Compact Key Builders ────────────────────────────────────────────────────

/**
 * Supported vault asset identifiers — stored as a 1-byte enum to minimize key size.
 * Add new assets here; max 255 entries.
 */
export enum AssetId {
  XLM = 0,
  USDC = 1,
  USDT = 2,
  BTC = 3,
  ETH = 4,
}

/**
 * Vault entry types — 1-byte discriminant packed into the storage key.
 */
export enum VaultEntryType {
  BALANCE = 0,
  LOCK = 1,
  ALLOWANCE = 2,
  NONCE = 3,
}

/**
 * Build a compact ScVal key for vault storage.
 * Format: Map { "t": entryType, "a": assetId, "u": userId }
 * This is significantly smaller than string keys like "vault_balance_USDC_user123".
 */
export function buildVaultKey(
  entryType: VaultEntryType,
  assetId: AssetId,
  userId: string
): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvMap([
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("t"),
      val: StellarSdk.xdr.ScVal.scvU32(entryType),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("a"),
      val: StellarSdk.xdr.ScVal.scvU32(assetId),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("u"),
      val: StellarSdk.xdr.ScVal.scvBytes(Buffer.from(userId, "utf8")),
    }),
  ]);
}

/**
 * Build a compact ScVal key for a bridge lock entry.
 * Format: Map { "t": LOCK, "id": lockId (u64) }
 */
export function buildLockKey(lockId: bigint): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvMap([
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("t"),
      val: StellarSdk.xdr.ScVal.scvU32(VaultEntryType.LOCK),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("id"),
      val: StellarSdk.nativeToScVal(lockId, { type: "u64" }),
    }),
  ]);
}

// ─── Compact Value Builders ──────────────────────────────────────────────────

/**
 * Bit-packed vault balance value.
 * Packs: amount (i128) + asset (u8) + timestamp (u32) into a compact ScVal map.
 * Avoids storing redundant string labels in the value.
 */
export interface PackedVaultBalance {
  amount: bigint;
  assetId: AssetId;
  updatedAt: number; // unix seconds (u32 — valid until year 2106)
}

export function packVaultBalance(
  balance: PackedVaultBalance
): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvMap([
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("v"),
      val: StellarSdk.nativeToScVal(balance.amount, { type: "i128" }),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("a"),
      val: StellarSdk.xdr.ScVal.scvU32(balance.assetId),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("ts"),
      val: StellarSdk.xdr.ScVal.scvU32(balance.updatedAt),
    }),
  ]);
}

export function unpackVaultBalance(
  scVal: StellarSdk.xdr.ScVal
): PackedVaultBalance {
  const native = StellarSdk.scValToNative(scVal) as Record<string, unknown>;
  return {
    amount: BigInt(String(native["v"] ?? 0)),
    assetId: Number(native["a"] ?? 0) as AssetId,
    updatedAt: Number(native["ts"] ?? 0),
  };
}

/**
 * Compact bridge lock value.
 * Packs: amount, asset, expiry, status into minimal fields.
 */
export type LockStatus = 0 | 1 | 2; // 0=active, 1=claimed, 2=expired

export interface PackedBridgeLock {
  amount: bigint;
  assetId: AssetId;
  expiryLedger: number;
  status: LockStatus;
}

export function packBridgeLock(lock: PackedBridgeLock): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvMap([
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("v"),
      val: StellarSdk.nativeToScVal(lock.amount, { type: "i128" }),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("a"),
      val: StellarSdk.xdr.ScVal.scvU32(lock.assetId),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("e"),
      val: StellarSdk.xdr.ScVal.scvU32(lock.expiryLedger),
    }),
    new StellarSdk.xdr.ScMapEntry({
      key: StellarSdk.xdr.ScVal.scvSymbol("s"),
      val: StellarSdk.xdr.ScVal.scvU32(lock.status),
    }),
  ]);
}

export function unpackBridgeLock(
  scVal: StellarSdk.xdr.ScVal
): PackedBridgeLock {
  const native = StellarSdk.scValToNative(scVal) as Record<string, unknown>;
  return {
    amount: BigInt(String(native["v"] ?? 0)),
    assetId: Number(native["a"] ?? 0) as AssetId,
    expiryLedger: Number(native["e"] ?? 0),
    status: Number(native["s"] ?? 0) as LockStatus,
  };
}

// ─── Size Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate the XDR byte size of a ScVal.
 * Useful for pre-flight resource fee estimation.
 */
export function estimateScValSize(scVal: StellarSdk.xdr.ScVal): number {
  return scVal.toXDR().length;
}

/**
 * Compare key sizes between compact and verbose approaches.
 * Useful for auditing storage efficiency.
 */
export function auditKeySize(
  entryType: VaultEntryType,
  assetId: AssetId,
  userId: string
): { compactBytes: number; verboseBytes: number; savingPercent: number } {
  const compact = buildVaultKey(entryType, assetId, userId);
  const verbose = StellarSdk.nativeToScVal(
    `vault_${VaultEntryType[entryType].toLowerCase()}_${AssetId[assetId]}_${userId}`
  );

  const compactBytes = estimateScValSize(compact);
  const verboseBytes = estimateScValSize(verbose);
  const savingPercent = Math.round(
    ((verboseBytes - compactBytes) / verboseBytes) * 100
  );

  return { compactBytes, verboseBytes, savingPercent };
}
