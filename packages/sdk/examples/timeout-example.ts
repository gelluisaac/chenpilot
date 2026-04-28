/**
 * Example: Using request timeouts with the SDK
 */

import { HorizonClient, checkNetworkHealth, getNetworkStatus } from "../src";

async function main() {
  // Example 1: HorizonClient with global timeout
  const client = new HorizonClient({
    baseUrl: "https://horizon-testnet.stellar.org",
    timeout: 5000, // 5 second timeout for all requests
  });

  try {
    const offers = await client.getAccountOffers(
      "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    );
    console.log(`Found ${offers.records.length} offers`);
  } catch (error) {
    console.error("Request timed out or failed:", error);
  }

  // Example 2: Network status check with timeout
  try {
    const health = await checkNetworkHealth({
      network: "testnet",
      timeout: 3000, // 3 second timeout
    });
    console.log("Network healthy:", health.isHealthy);
    console.log("Response time:", health.responseTimeMs, "ms");
  } catch (error) {
    console.error("Health check timed out:", error);
  }

  // Example 3: Full network status with timeout
  try {
    const status = await getNetworkStatus({
      network: "mainnet",
      timeout: 10000, // 10 second timeout
    });
    console.log("Protocol version:", status.protocol.version);
    console.log("Latest ledger:", status.health.latestLedger);
  } catch (error) {
    console.error("Status check timed out:", error);
  }
}

main();
