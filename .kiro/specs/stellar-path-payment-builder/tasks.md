# Implementation Plan: Stellar Path Payment Builder

## Overview

Implement `packages/sdk/src/pathPayment.ts` as a standalone module following the same patterns as `feeBumping.ts`, `claimableBalance.ts`, and `trustline.ts`. The module exports `PathPaymentBuilder`, `createPathPaymentBuilder`, error classes, and all related types. Tests live in `packages/sdk/src/__tests__/pathPayment.test.ts` and `pathPayment.property.test.ts`.

## Tasks

- [ ] 1. Set up types, error classes, and module scaffold
  - Create `packages/sdk/src/pathPayment.ts` with all exported interfaces and types (`StellarAsset`, `PathPaymentMode`, `PathPaymentConfig`, `PathFindParams`, `BuiltPathPayment`, `PathPaymentResult`)
  - Implement the error class hierarchy: `PathPaymentError`, `PathPaymentValidationError`, `PathPaymentPathError`, `PathPaymentSubmitError`
  - Add a stub `PathPaymentBuilder` class and `createPathPaymentBuilder` factory with no-op method bodies so the module compiles
  - Export all public symbols from `packages/sdk/src/index.ts`
  - _Requirements: 1.1, 2.1_

- [ ] 2. Implement input validation
  - [ ] 2.1 Implement `build()` pre-flight validation
    - Validate that `sourceAccount` and `destinationAccount` are valid Stellar G-addresses (use `stellar-sdk` `StrKey.isValidEd25519PublicKey`)
    - Validate that `amount` is a positive numeric string; throw `PathPaymentValidationError` with message `"Amount must be a positive number, got: <value>"` otherwise
    - Validate that source and destination assets differ; throw `PathPaymentValidationError` with message `"Source and destination assets must differ"` otherwise
    - Validate all required fields are set; throw `PathPaymentValidationError` with message `"<field> is required"` for each missing field
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 2.2 Write property test for non-positive amount rejection (Property 5)
    - **Property 5: Non-positive amounts are rejected**
    - **Validates: Requirements 2.1, 2.2**
    - Use `fast-check` with `fc.oneof(fc.constant("0"), fc.constant("-1"), fc.float({ max: 0 }).map(String))` as the amount generator
    - Tag: `// Feature: stellar-path-payment-builder, Property 5: Non-positive amounts are rejected`

  - [ ]* 2.3 Write property test for invalid account address rejection (Property 7)
    - **Property 7: Invalid account addresses are rejected**
    - **Validates: Requirements 2.4**
    - Use `fast-check` with `fc.string()` filtered to exclude valid G-addresses
    - Tag: `// Feature: stellar-path-payment-builder, Property 7: Invalid account addresses are rejected`

  - [ ]* 2.4 Write property test for identical source/destination asset rejection (Property 6)
    - **Property 6: Identical source and destination assets are rejected**
    - **Validates: Requirements 2.3**
    - Tag: `// Feature: stellar-path-payment-builder, Property 6: Identical source and destination assets are rejected`

- [ ] 3. Implement `HorizonPathFinder` (internal)
  - Implement the internal `HorizonPathFinder` class (not exported) with `findStrictSendPaths` and `findStrictReceivePaths` methods
  - Each method calls the Horizon `/paths/strict-send` or `/paths/strict-receive` endpoint via `stellar-sdk` `Server` (dynamic import)
  - Return `StellarAsset[][]` from the response; throw `PathPaymentPathError` with message `"No payment paths found from <src> to <dest>"` when the response is empty
  - _Requirements: 1.5_

  - [ ]* 3.1 Write property test for auto path-discovery invocation (Property 4)
    - **Property 4: Auto path-discovery is invoked when no path is provided**
    - **Validates: Requirements 1.5**
    - Mock the Horizon server; assert `findStrictSendPaths` / `findStrictReceivePaths` is called when no explicit path is set
    - Tag: `// Feature: stellar-path-payment-builder, Property 4: Auto path-discovery is invoked when no path is provided`

- [ ] 4. Implement slippage tolerance and `build()`
  - [ ] 4.1 Implement slippage calculation
    - For `strict-send`: `boundAmount = amount * (1 - bps/10000)` rounded to 7 decimal places (minimum destination)
    - For `strict-receive`: `boundAmount = amount * (1 + bps/10000)` rounded to 7 decimal places (maximum source)
    - Default slippage is 0 bps when `setSlippageTolerance` is not called
    - _Requirements: 3.1_

  - [ ]* 4.2 Write property test for slippage bound calculation (Property 8)
    - **Property 8: Slippage tolerance correctly bounds the amount**
    - **Validates: Requirements 3.1**
    - Use `fast-check` with `fc.tuple(fc.float({ min: 0.0000001 }).map(String), fc.integer({ min: 0, max: 10000 }))` for `(amount, bps)`
    - Tag: `// Feature: stellar-path-payment-builder, Property 8: Slippage tolerance correctly bounds the amount`

  - [ ] 4.3 Implement `build()` — strict-send path
    - When mode is `strict-send`: resolve path (explicit or via `HorizonPathFinder`), apply slippage, construct `PathPaymentStrictSend` operation via `stellar-sdk` `Operation.pathPaymentStrictSend`, build transaction with `TransactionBuilder`, return `BuiltPathPayment` with `transactionXdr`, `path`, `boundAmount`, `fee`
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 4.1, 4.2_

  - [ ]* 4.4 Write property test for strict-send exact source amount (Property 1)
    - **Property 1: Strict-send operation uses exact source amount**
    - **Validates: Requirements 1.2**
    - Decode the returned XDR and assert `sendAmount` equals the configured source amount
    - Tag: `// Feature: stellar-path-payment-builder, Property 1: Strict-send operation uses exact source amount`

  - [ ] 4.5 Implement `build()` — strict-receive path
    - When mode is `strict-receive`: resolve path, apply slippage, construct `PathPaymentStrictReceive` operation via `Operation.pathPaymentStrictReceive`, build transaction, return `BuiltPathPayment`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 4.1, 4.2_

  - [ ]* 4.6 Write property test for strict-receive exact destination amount (Property 2)
    - **Property 2: Strict-receive operation uses exact destination amount**
    - **Validates: Requirements 1.3**
    - Decode the returned XDR and assert `destAmount` equals the configured destination amount
    - Tag: `// Feature: stellar-path-payment-builder, Property 2: Strict-receive operation uses exact destination amount`

  - [ ]* 4.7 Write property test for explicit path preservation (Property 3)
    - **Property 3: Explicit path is preserved in the operation**
    - **Validates: Requirements 1.4**
    - Use `fast-check` to generate arrays of `StellarAsset`; decode XDR and assert path matches input order
    - Tag: `// Feature: stellar-path-payment-builder, Property 3: Explicit path is preserved in the operation`

  - [ ]* 4.8 Write property test for transaction metadata (Property 9)
    - **Property 9: Transaction metadata is applied correctly**
    - **Validates: Requirements 4.1, 4.2**
    - Use `fast-check` with `fc.tuple(fc.nat(), fc.nat())` for `(fee, timeout)`; decode XDR and assert values match
    - Tag: `// Feature: stellar-path-payment-builder, Property 9: Transaction metadata is applied correctly`

- [ ] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement `submit` and `submitWithProvider`
  - [ ] 6.1 Implement `submit(signerSecret: string)`
    - Call `build()`, sign the transaction with the provided secret key via `stellar-sdk` `Keypair.fromSecret`, submit via `Server.submitTransaction`, return `PathPaymentResult` with `success: true`, `transactionHash`, `ledger`, `destinationAmount`, and `built`
    - On Horizon error, catch and return `PathPaymentResult` with `success: false` and `error` set to the Horizon error detail; throw `PathPaymentSubmitError` for unexpected errors
    - _Requirements: 5.1, 5.2_

  - [ ] 6.2 Implement `submitWithProvider(provider: SignatureProvider)`
    - Call `build()`, pass the XDR to `provider.sign()`, submit the signed XDR, return `PathPaymentResult`
    - Import `SignatureProvider` from `packages/sdk/src/signature-providers/interfaces.ts`
    - _Requirements: 5.3_

  - [ ]* 6.3 Write property test for successful submission result shape (Property 10)
    - **Property 10: Successful submission returns hash and ledger**
    - **Validates: Requirements 5.1**
    - Mock `Server.submitTransaction` to return a success response; assert `success: true` and non-empty `transactionHash`
    - Tag: `// Feature: stellar-path-payment-builder, Property 10: Successful submission returns hash and ledger`

  - [ ]* 6.4 Write property test for failed submission result shape (Property 11)
    - **Property 11: Failed submission returns structured error**
    - **Validates: Requirements 5.2**
    - Mock `Server.submitTransaction` to throw a Horizon error; assert `success: false` and non-empty `error`
    - Tag: `// Feature: stellar-path-payment-builder, Property 11: Failed submission returns structured error`

- [ ] 7. Write unit tests
  - [ ]* 7.1 Write unit tests in `packages/sdk/src/__tests__/pathPayment.test.ts`
    - Test XLM→USDC strict-send build: verify operation type, sendAmount, path in decoded XDR
    - Test USDC→BTC strict-receive build: verify operation type, destAmount
    - Test Horizon path-finding URL construction (mock `Server`)
    - Test edge cases: empty explicit path array, maximum slippage (10000 bps), memo encoding, missing required fields
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 3.1, 4.1, 4.2_

- [ ] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests require `fast-check` as a dev dependency: `npm install --save-dev fast-check` in `packages/sdk`
- Each property test file should be `packages/sdk/src/__tests__/pathPayment.property.test.ts`
- All properties (1–11) from the design document must be covered by property-based tests
- The module must use dynamic import of `stellar-sdk` consistent with `feeBumping.ts` and `trustline.ts`
