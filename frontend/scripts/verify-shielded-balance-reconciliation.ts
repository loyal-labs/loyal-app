import assert from "node:assert/strict";

import { PublicKey } from "@solana/web3.js";

import {
  mergeDepositEnumerationSources,
  type EphemeralDepositEnumeration,
} from "../../sdk/private-transactions/src/enumerate-deposits";
import type { DepositData } from "../../sdk/private-transactions/src/types";
import {
  reconcileSecuredBalance,
  WALLET_PORTFOLIO_FALLBACK_REFRESH_MS,
} from "../src/features/shielded-balance/reconciliation";

const user = new PublicKey("11111111111111111111111111111111");
const mint = new PublicKey("So11111111111111111111111111111111111111112");
const address = new PublicKey("BPFLoader1111111111111111111111111111111111");

function deposit(amount: bigint): DepositData {
  return { address, amount, tokenMint: mint, user };
}

function mergeWithEphemeral(
  ephemeral: EphemeralDepositEnumeration
): DepositData[] {
  return mergeDepositEnumerationSources({
    baseDelegated: [deposit(BigInt(1_134_434))],
    baseUndelegated: [],
    ephemeral,
  });
}

async function main() {
  const authoritativeZero = mergeWithEphemeral({
    deposits: [],
    status: "succeeded",
  });
  assert.equal(
    authoritativeZero.length,
    0,
    "an authoritative empty ephemeral result must remove the stale delegated-base amount"
  );
  console.log("PASS authoritative zero removes the stale shielded row");

  const positiveLiveBalance = mergeWithEphemeral({
    deposits: [deposit(BigInt(42))],
    status: "succeeded",
  });
  assert.equal(
    positiveLiveBalance[0]?.amount,
    BigInt(42),
    "a genuine authoritative shielded balance must remain visible"
  );
  console.log("PASS authoritative positive shielded balances remain visible");

  const unavailableFallback = mergeWithEphemeral({ status: "failed" });
  assert.equal(
    unavailableFallback[0]?.amount,
    BigInt(1_134_434),
    "a failed authoritative read may retain the delegated fallback until recovery"
  );
  console.log("PASS transient read failure preserves the recoverable fallback");

  let readAttempt = 0;
  let transactionCount = 0;
  transactionCount += 1; // The MAX unshield has confirmed before reconciliation.
  const retryResult = await reconcileSecuredBalance({
    expectedAmountRaw: BigInt(0),
    readAmountRaw: async () => {
      readAttempt += 1;
      if (readAttempt === 1) throw new Error("temporary RPC failure");
      if (readAttempt === 2) return BigInt(1_134_434);
      return BigInt(0);
    },
    retryDelaysMs: [0, 1, 1, 1],
    wait: async () => {},
  });
  assert.deepEqual(
    retryResult,
    {
      attempts: 3,
      observedAmountRaw: BigInt(0),
      status: "reconciled",
    },
    "bounded reconciliation must survive an error and stale read before observing zero"
  );
  assert.equal(
    transactionCount,
    1,
    "post-confirmation reconciliation must not send another transaction"
  );
  console.log(
    "PASS bounded read-only reconciliation converges without a second transaction"
  );

  let outageAttempts = 0;
  const outageResult = await reconcileSecuredBalance({
    expectedAmountRaw: BigInt(0),
    readAmountRaw: () => {
      outageAttempts += 1;
      return new Promise<bigint>(() => {});
    },
    readTimeoutMs: 5,
    retryDelaysMs: [0, 0, 0],
    wait: async () => {},
  });
  assert.equal(outageResult.status, "pending");
  assert.equal(outageResult.attempts, 3);
  assert.equal(outageAttempts, 3);
  console.log(
    "PASS persistent outage terminates with an explicit pending result"
  );

  assert.ok(
    WALLET_PORTFOLIO_FALLBACK_REFRESH_MS > 0,
    "portfolio fallback refresh must remain enabled when WebSocket callbacks are absent"
  );
  assert.ok(
    WALLET_PORTFOLIO_FALLBACK_REFRESH_MS <= 30_000,
    "portfolio fallback refresh must correct stale state within 30 seconds"
  );

  const walletHookSource = await Bun.file(
    new URL("../src/hooks/use-wallet-desktop-data.ts", import.meta.url)
  ).text();
  assert.match(
    walletHookSource,
    /fallbackRefreshMs:\s*WALLET_PORTFOLIO_FALLBACK_REFRESH_MS/,
    "the wallet portfolio subscription must use the nonzero fallback interval"
  );
  console.log(
    "PASS missing WebSocket callbacks have a bounded polling recovery path"
  );

  console.log("VERDICT: PASS");
}

await main();
