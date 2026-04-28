import * as StellarSdk from "@stellar/stellar-sdk";
import { performance } from "perf_hooks";

const ITERATIONS = 1000;

function benchmarkSigning() {
  const keypair = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(keypair.publicKey(), "1");
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: StellarSdk.Keypair.random().publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "1",
      })
    )
    .setTimeout(30)
    .build();

  console.log("Benchmarking transaction signing...");

  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    transaction.sign(keypair);
  }
  const end = performance.now();

  const avgTime = (end - start) / ITERATIONS;
  console.log(
    `Signed ${ITERATIONS} transactions in ${(end - start).toFixed(2)}ms`
  );
  console.log(`Average signing time: ${avgTime.toFixed(4)}ms per transaction`);
}

function benchmarkXdrParsing() {
  const keypair = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(keypair.publicKey(), "1");
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: StellarSdk.Keypair.random().publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "1",
      })
    )
    .setTimeout(30)
    .build();

  const xdr = transaction.toXDR();

  console.log("Benchmarking XDR parsing...");

  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    StellarSdk.TransactionBuilder.fromXDR(xdr, StellarSdk.Networks.TESTNET);
  }
  const end = performance.now();

  const avgTime = (end - start) / ITERATIONS;
  console.log(
    `Parsed ${ITERATIONS} XDR strings in ${(end - start).toFixed(2)}ms`
  );
  console.log(`Average parsing time: ${avgTime.toFixed(4)}ms per XDR`);
}

benchmarkSigning();
console.log();
benchmarkXdrParsing();
