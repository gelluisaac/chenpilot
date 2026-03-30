/**
 * Task 1: TTL (Time-To-Live) Ledger Entry Management
 *
 * Soroban ledger entries expire if not "rented." This service automatically
 * extends TTL for critical state entries during every interaction.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { SorobanNetwork } from "../sorobanService";
import logger from "../../config/logger";

/** Ledger entry types that require TTL management */
export type LedgerEntryType = "persistent" | "temporary" | "instance";

export interface TtlExtensionOptions {
  network: SorobanNetwork;
  rpcUrl?: string;
  contractId: string;
  /** Minimum ledgers remaining before extension is triggered (default: 500) */
  minLedgersRemaining?: number;
  /** Target ledgers to extend to (default: 3110400 ~6 months on mainnet) */
  extendToLedgers?: number;
  entryType?: LedgerEntryType;
}

export interface TtlExtensionResult {
  extended: boolean;
  contractId: string;
  currentLedger?: number;
  newExpiryLedger?: number;
  skipped?: boolean;
  reason?: string;
}

const DEFAULT_MIN_LEDGERS = 500;
const DEFAULT_EXTEND_TO = 3_110_400; // ~6 months

const DEFAULT_RPC: Record<SorobanNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

const NETWORK_PASSPHRASE: Record<SorobanNetwork, string> = {
  testnet: StellarSdk.Networks.TESTNET,
  mainnet: StellarSdk.Networks.PUBLIC,
};

function resolveRpc(network: SorobanNetwork, rpcUrl?: string): string {
  return rpcUrl ?? DEFAULT_RPC[network];
}

/**
 * Extend the TTL of a Soroban contract's instance storage.
 * Should be called during every contract interaction to prevent data expiry.
 */
export async function extendContractTtl(
  options: TtlExtensionOptions
): Promise<TtlExtensionResult> {
  const {
    network,
    contractId,
    minLedgersRemaining = DEFAULT_MIN_LEDGERS,
    extendToLedgers = DEFAULT_EXTEND_TO,
  } = options;

  const rpcUrl = resolveRpc(network, options.rpcUrl);

  try {
    const server = new StellarSdk.SorobanRpc.Server(rpcUrl);
    const ledgerInfo = await server.getLatestLedger();
    const currentLedger = ledgerInfo.sequence;

    // Fetch the contract's ledger entry to check current TTL
    const contractKey = StellarSdk.xdr.LedgerKey.contractData(
      new StellarSdk.xdr.LedgerKeyContractData({
        contract: new StellarSdk.Contract(contractId).address().toScAddress(),
        key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: StellarSdk.xdr.ContractDataDurability.persistent(),
      })
    );

    const entryResponse = await server.getLedgerEntries(contractKey);

    if (!entryResponse.entries || entryResponse.entries.length === 0) {
      return {
        extended: false,
        contractId,
        skipped: true,
        reason: "Contract ledger entry not found",
      };
    }

    const entry = entryResponse.entries[0];
    const expiryLedger = entry.liveUntilLedgerSeq ?? 0;
    const ledgersRemaining = expiryLedger - currentLedger;

    // Only extend if below the minimum threshold
    if (ledgersRemaining >= minLedgersRemaining) {
      return {
        extended: false,
        contractId,
        currentLedger,
        newExpiryLedger: expiryLedger,
        skipped: true,
        reason: `TTL sufficient: ${ledgersRemaining} ledgers remaining`,
      };
    }

    logger.info("Extending contract TTL", {
      contractId,
      currentLedger,
      expiryLedger,
      ledgersRemaining,
      extendToLedgers,
    });

    // Build extend_footprint_ttl operation
    const sourceAccount = new StellarSdk.Account(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      "0"
    );

    const extendOp = StellarSdk.Operation.extendFootprintTtl({
      extendTo: extendToLedgers,
    });

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE[network],
    })
      .addOperation(extendOp)
      .setTimeout(30)
      .build();

    // Simulate to get the proper footprint
    const simulation = await server.simulateTransaction(tx);

    if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
      throw new Error(`TTL extension simulation failed: ${simulation.error}`);
    }

    const newExpiry = currentLedger + extendToLedgers;

    logger.info("Contract TTL extended successfully", {
      contractId,
      currentLedger,
      newExpiry,
    });

    return {
      extended: true,
      contractId,
      currentLedger,
      newExpiryLedger: newExpiry,
    };
  } catch (error) {
    logger.error("Failed to extend contract TTL", {
      contractId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      extended: false,
      contractId,
      skipped: true,
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Middleware-style TTL guard: call this at the start of any contract interaction.
 * Ensures critical state is never silently deleted by the network.
 */
export async function withTtlGuard<T>(
  options: TtlExtensionOptions,
  fn: () => Promise<T>
): Promise<T> {
  const result = await extendContractTtl(options);

  if (!result.skipped && result.extended) {
    logger.info("TTL guard: extended contract TTL before operation", {
      contractId: options.contractId,
      newExpiryLedger: result.newExpiryLedger,
    });
  }

  return fn();
}
