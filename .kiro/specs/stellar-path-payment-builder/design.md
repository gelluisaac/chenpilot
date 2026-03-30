# Design Document: Stellar Path Payment Builder

## Overview

The Stellar Path Payment Builder is a high-level transaction builder module in the Chen Pilot SDK (`@chen-pilot/sdk-core`) that simplifies constructing and submitting multi-hop path payment operations on the Stellar network.

Stellar supports two path payment operation types:
- **PathPaymentStrictSend**: The sender specifies an exact source amount; the destination receives at least a minimum amount.
- **PathPaymentStrictReceive**: The destination receives an exact amount; the sender spends at most a maximum amount.

Both operations route payments through intermediate assets (the "path"), enabling cross-asset transfers without a direct order book between source and destination assets. This builder abstracts the complexity of path discovery, slippage calculation, transaction construction, signing, and submission into a clean, fluent API consistent with the rest of the SDK.

## Architecture

The builder follows the same patterns established by `feeBumping.ts`, `claimableBalance.ts`, and `trustline.ts`: a standalone module exporting a class and factory function, with all Stellar SDK interactions done via dynamic import of `stellar-sdk`.

```mermaid
flowchart TD
    A[Developer Code] -->|new PathPaymentBuilder / createPathPaymentBuilder| B[PathPaymentBuilder]
    B -->|build()| C{Path provided?}
    C -->|Yes| D[Use explicit path]
    C -->|No| E[HorizonPathFinder.findPaths]
    E -->|GET /paths/strict-send or /paths/strict-receive| F[Horizon API]
    F --> G[Selected path]
    D --> G
    G --> H[Validate inputs]
    H --> I[Apply slippage tolerance]
    I --> J[TransactionBuilder - stellar-sdk]
    J -->|addOperation PathPaymentStrictSend/Receive| K[Built Transaction XDR]
    K -->|submit| L[Horizon submitTransaction]
    L --> M[PathPaymentResult]
```

The module is self-contained and does not depend on other SDK modules, though it is compatible with the `SignatureProvider` interface for signing.

## Components and Interfaces

### `PathPaymentBuilder` (class)

The primary builder class. Constructed with a `PathPaymentConfig` and exposes a fluent API.

```typescript
class PathPaymentBuilder {
  constructor(config: PathPaymentConfig)

  // Fluent setters (each returns `this`)
  setSourceAccount(publicKey: string): this
  setSourceAsset(asset: StellarAsset): this
  setDestinationAccount(publicKey: string): this
  setDestinationAsset(asset: StellarAsset): this
  setAmount(amount: string): this          // source amount for strict-send, dest amount for strict-receive
  setPath(path: StellarAsset[]): this      // explicit intermediate assets; omit for auto-discovery
  setSlippageTolerance(bps: number): this  // basis points, e.g. 50 = 0.5%
  setFee(stroops: string): this
  setTimeout(seconds: number): this
  setMemo(memo: string): this

  // Build without submitting (returns XDR envelope string)
  build(): Promise<BuiltPathPayment>

  // Build and submit
  submit(signerSecret: string): Promise<PathPaymentResult>

  // Build and sign via SignatureProvider (optional integration)
  submitWithProvider(provider: SignatureProvider): Promise<PathPaymentResult>
}
```

### `createPathPaymentBuilder` (factory function)

```typescript
function createPathPaymentBuilder(config: PathPaymentConfig): PathPaymentBuilder
```

### `HorizonPathFinder` (internal helper)

Encapsulates Horizon path-finding API calls. Not exported publicly.

```typescript
class HorizonPathFinder {
  findStrictSendPaths(params: PathFindParams): Promise<StellarAsset[][]>
  findStrictReceivePaths(params: PathFindParams): Promise<StellarAsset[][]>
}
```

## Data Models

```typescript
/** Represents a Stellar asset (native XLM or issued asset) */
export interface StellarAsset {
  code: string;           // "XLM" for native, e.g. "USDC" for issued
  issuer?: string;        // undefined for native XLM
}

/** Payment mode determines which operation type is used */
export type PathPaymentMode = "strict-send" | "strict-receive";

/** Configuration for constructing a path payment */
export interface PathPaymentConfig {
  /** Horizon server URL. Defaults to mainnet. */
  horizonUrl?: string;
  /** "testnet" | "mainnet". Defaults to "mainnet". */
  network?: "testnet" | "mainnet";
  /** Payment mode. Defaults to "strict-send". */
  mode?: PathPaymentMode;
}

/** Parameters for path discovery */
export interface PathFindParams {
  sourceAsset: StellarAsset;
  destinationAsset: StellarAsset;
  amount: string;
  sourceAccount?: string;
  destinationAccount?: string;
}

/** A fully built (but not yet submitted) path payment */
export interface BuiltPathPayment {
  /** XDR-encoded transaction envelope */
  transactionXdr: string;
  /** The resolved payment path used */
  path: StellarAsset[];
  /** The effective min/max amount after slippage */
  boundAmount: string;
  /** Estimated fee in stroops */
  fee: string;
}

/** Result of a submitted path payment */
export interface PathPaymentResult {
  success: boolean;
  transactionHash?: string;
  /** Ledger the transaction was included in */
  ledger?: number;
  /** Actual destination amount received (from transaction result) */
  destinationAmount?: string;
  error?: string;
  /** The built transaction details */
  built: BuiltPathPayment;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Strict-send operation uses exact source amount

*For any* valid strict-send path payment configuration with a given source amount, the built transaction's `PathPaymentStrictSend` operation SHALL have a `sendAmount` equal to the specified source amount.

**Validates: Requirements 1.2**

### Property 2: Strict-receive operation uses exact destination amount

*For any* valid strict-receive path payment configuration with a given destination amount, the built transaction's `PathPaymentStrictReceive` operation SHALL have a `destAmount` equal to the specified destination amount.

**Validates: Requirements 1.3**

### Property 3: Explicit path is preserved in the operation

*For any* path payment configuration with an explicitly provided intermediate asset path, the built transaction's operation SHALL contain those exact intermediate assets in the same order.

**Validates: Requirements 1.4**

### Property 4: Auto path-discovery is invoked when no path is provided

*For any* path payment configuration where no explicit path is set, calling `build()` SHALL invoke the Horizon path-finding endpoint and use the first returned path in the built operation.

**Validates: Requirements 1.5**

### Property 5: Non-positive amounts are rejected

*For any* amount value that is zero, negative, or non-numeric, calling `build()` SHALL throw a validation error before any network call is made, and the error message SHALL identify the invalid amount.

**Validates: Requirements 2.1, 2.2**

### Property 6: Identical source and destination assets are rejected

*For any* path payment configuration where the source asset and destination asset are the same (same code and issuer), calling `build()` SHALL throw a validation error.

**Validates: Requirements 2.3**

### Property 7: Invalid account addresses are rejected

*For any* string that is not a valid Stellar public key (G-address), setting it as source or destination account and calling `build()` SHALL throw a validation error.

**Validates: Requirements 2.4**

### Property 8: Slippage tolerance correctly bounds the amount

*For any* amount `A` and slippage tolerance `S` basis points, the `boundAmount` in the built transaction SHALL equal `A * (1 - S/10000)` for strict-send (minimum destination) and `A * (1 + S/10000)` for strict-receive (maximum source), rounded to 7 decimal places.

**Validates: Requirements 3.1**

### Property 9: Transaction metadata is applied correctly

*For any* path payment configuration with a custom fee (in stroops) and timeout (in seconds), the built transaction SHALL reflect those exact values in the transaction envelope.

**Validates: Requirements 4.1, 4.2**

### Property 10: Successful submission returns hash and ledger

*For any* successfully submitted path payment, the returned `PathPaymentResult` SHALL have `success: true` and a non-empty `transactionHash` string.

**Validates: Requirements 5.1**

### Property 11: Failed submission returns structured error

*For any* path payment submission that is rejected by Horizon, the returned `PathPaymentResult` SHALL have `success: false` and a non-empty `error` string describing the failure reason.

**Validates: Requirements 5.2**

## Error Handling

All errors are surfaced as thrown `Error` instances (or a subclass `PathPaymentError`) with a descriptive `message`. The builder never swallows errors silently.

| Scenario | Error type | Message pattern |
|---|---|---|
| Invalid public key | `PathPaymentValidationError` | `"Invalid Stellar account address: <value>"` |
| Non-positive amount | `PathPaymentValidationError` | `"Amount must be a positive number, got: <value>"` |
| Same source/dest asset | `PathPaymentValidationError` | `"Source and destination assets must differ"` |
| No paths found by Horizon | `PathPaymentPathError` | `"No payment paths found from <src> to <dest>"` |
| Horizon submission failure | `PathPaymentSubmitError` | Wraps Horizon error detail |
| Missing required field | `PathPaymentValidationError` | `"<field> is required"` |

```typescript
export class PathPaymentError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "PathPaymentError";
  }
}

export class PathPaymentValidationError extends PathPaymentError {}
export class PathPaymentPathError extends PathPaymentError {}
export class PathPaymentSubmitError extends PathPaymentError {}
```

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required for comprehensive coverage.

**Unit tests** (`packages/sdk/src/__tests__/pathPayment.test.ts`):
- Specific examples: building a XLM→USDC strict-send, building a USDC→BTC strict-receive
- Integration: verifying the Horizon path-finding URL is correctly constructed
- Edge cases: empty path array, maximum slippage (100%), memo encoding

**Property-based tests** (`packages/sdk/src/__tests__/pathPayment.property.test.ts`):
- Use [fast-check](https://github.com/dubzzz/fast-check) (already available in the JS ecosystem, zero new dependencies needed if added as a dev dependency)
- Minimum 100 iterations per property
- Each test is tagged with a comment referencing the design property

Property test tag format:
```
// Feature: stellar-path-payment-builder, Property N: <property_text>
```

Example property test structure:

```typescript
import fc from "fast-check";

// Feature: stellar-path-payment-builder, Property 5: Non-positive amounts are rejected
it("rejects non-positive amounts", () => {
  fc.assert(
    fc.property(
      fc.oneof(fc.constant("0"), fc.constant("-1"), fc.float({ max: 0 }).map(String)),
      (amount) => {
        const builder = createPathPaymentBuilder({ network: "testnet" })
          .setSourceAccount(VALID_ACCOUNT)
          .setDestinationAccount(VALID_DEST)
          .setSourceAsset({ code: "XLM" })
          .setDestinationAsset({ code: "USDC", issuer: VALID_ISSUER })
          .setAmount(amount);
        return expect(builder.build()).rejects.toThrow(PathPaymentValidationError);
      }
    ),
    { numRuns: 100 }
  );
});
```

### Property-Based Testing Library

**Library**: `fast-check` (TypeScript-native, no additional runtime dependencies)

Install as dev dependency:
```
npm install --save-dev fast-check
```

Each correctness property (1–11) MUST be implemented by exactly one property-based test. Properties that involve UI or subjective criteria (none in this feature) are covered by unit tests only.
