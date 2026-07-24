import assert from "node:assert/strict";

import {
  createSolanaWalletDataClient,
  type ActivityProvider,
  type AssetProvider,
  type AssetSnapshot,
} from "@loyal-labs/solana-wallet";
import { PublicKey } from "@solana/web3.js";

import {
  mergeDepositEnumerationSources,
  type EphemeralDepositEnumeration,
} from "../../sdk/private-transactions/src/enumerate-deposits";
import type { DepositData } from "../../sdk/private-transactions/src/types";
import {
  createLatestPortfolioRequestGuard,
  executeMaxUnshieldWithReconciliation,
  recoverPostActionRefresh,
  settlePostActionRefresh,
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return {
    promise,
    resolve: (value) => {
      assert.ok(resolve, "deferred promise must be initialized");
      resolve(value);
    },
  };
}

function assetSnapshot(nativeBalanceLamports: number): AssetSnapshot {
  return {
    owner: user.toBase58(),
    nativeBalanceLamports,
    fetchedAt: Date.now(),
    assets: [],
  };
}

function emptyActivityProvider(): ActivityProvider {
  return {
    getActivity: async () => ({ activities: [] }),
    subscribeActivity: async () => async () => undefined,
  };
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

  const positiveLiveBalance = mergeWithEphemeral({
    deposits: [deposit(BigInt(42))],
    status: "succeeded",
  });
  assert.equal(
    positiveLiveBalance[0]?.amount,
    BigInt(42),
    "a genuine authoritative shielded balance must remain visible"
  );

  const unavailableFallback = mergeWithEphemeral({ status: "failed" });
  assert.equal(
    unavailableFallback[0]?.amount,
    BigInt(1_134_434),
    "a failed authoritative read may retain the delegated fallback until recovery"
  );
  console.log(
    "PASS authoritative zero, positive live balance, and failed-read fallback"
  );

  let transactionCount = 0;
  let readAttempt = 0;
  const retryResult = await executeMaxUnshieldWithReconciliation({
    executeTransaction: async () => {
      transactionCount += 1;
      return { signature: "confirmed-max-unshield" };
    },
    readAmountRaw: async () => {
      readAttempt += 1;
      if (readAttempt === 1) throw new Error("temporary RPC failure");
      if (readAttempt === 2) return BigInt(1_134_434);
      return BigInt(0);
    },
    retryDelaysMs: [0, 1, 1, 1],
    wait: async () => {},
  });
  assert.equal(transactionCount, 1);
  assert.deepEqual(retryResult.reconciliation, {
    attempts: 3,
    observedAmountRaw: BigInt(0),
    status: "reconciled",
  });
  assert.equal(retryResult.confirmedAmountRaw, BigInt(0));

  let hungTransactionCount = 0;
  const hungStartedAt = Date.now();
  const hungResult = await executeMaxUnshieldWithReconciliation({
    executeTransaction: async () => {
      hungTransactionCount += 1;
      return { signature: "confirmed-max-unshield-during-outage" };
    },
    readAmountRaw: () => new Promise<bigint>(() => {}),
    readTimeoutMs: 5,
    retryDelaysMs: [0, 0, 0],
    wait: async () => {},
  });
  assert.equal(hungTransactionCount, 1);
  assert.equal(hungResult.reconciliation.status, "pending");
  assert.equal(hungResult.reconciliation.attempts, 3);
  assert.equal(hungResult.confirmedAmountRaw, BigInt(0));
  assert.ok(
    Date.now() - hungStartedAt < 100,
    "hung reconciliation reads must not hold the confirmed MAX flow open"
  );
  console.log(
    "PASS production MAX orchestration retries reads, terminates outages, and sends exactly once"
  );

  const refreshStartedAt = Date.now();
  const refreshResult = await settlePostActionRefresh({
    refresh: () => new Promise<void>(() => {}),
    timeoutMs: 5,
  });
  assert.equal(refreshResult.status, "timed_out");
  assert.ok(
    Date.now() - refreshStartedAt < 100,
    "a hung post-action refresh must not leave the dialog processing indefinitely"
  );
  console.log("PASS production success refresh has a bounded terminal outcome");

  let recoveryRefreshes = 0;
  const recoveryDelays: number[] = [];
  const recoveryResults = await recoverPostActionRefresh({
    refresh: async () => {
      recoveryRefreshes += 1;
    },
    retryDelaysMs: [1, 2],
    refreshTimeoutMs: 5,
    wait: async (delayMs) => {
      recoveryDelays.push(delayMs);
    },
  });
  assert.equal(recoveryRefreshes, 2);
  assert.deepEqual(recoveryDelays, [1, 2]);
  assert.deepEqual(
    recoveryResults.map((result) => result.status),
    ["completed", "completed"]
  );
  console.log(
    "PASS MAX recovery performs finite post-action refreshes without global polling"
  );

  const requestGuard = createLatestPortfolioRequestGuard();
  const olderRequest = requestGuard.begin();
  const forcedRequest = requestGuard.begin();
  assert.equal(requestGuard.isCurrent(forcedRequest), true);
  assert.equal(
    requestGuard.isCurrent(olderRequest),
    false,
    "a request started before the forced refresh must not be allowed to commit"
  );

  const oldSnapshot = deferred<AssetSnapshot>();
  let portfolioReadCount = 0;
  const racingAssetProvider: AssetProvider = {
    getBalance: async () => 0,
    getAssetSnapshot: async () => {
      portfolioReadCount += 1;
      return portfolioReadCount === 1
        ? oldSnapshot.promise
        : assetSnapshot(2_000_000_000);
    },
    subscribeAssetChanges: async () => async () => undefined,
  };
  const racingClient = createSolanaWalletDataClient({
    env: "devnet",
    assetProvider: racingAssetProvider,
    activityProvider: emptyActivityProvider(),
  });
  const staleRequest = racingClient.getPortfolio(user);
  await Promise.resolve();
  const freshSnapshot = await racingClient.getPortfolio(user, {
    forceRefresh: true,
  });
  assert.equal(freshSnapshot.nativeBalanceLamports, 2_000_000_000);
  oldSnapshot.resolve(assetSnapshot(1_000_000_000));
  assert.equal((await staleRequest).nativeBalanceLamports, 1_000_000_000);
  assert.equal(
    (await racingClient.getPortfolio(user)).nativeBalanceLamports,
    2_000_000_000,
    "the older request must not overwrite the newer forced snapshot in cache"
  );
  assert.equal(portfolioReadCount, 2);
  console.log(
    "PASS older portfolio requests cannot overwrite newer rendered or cached state"
  );

  assert.equal(
    WALLET_PORTFOLIO_FALLBACK_REFRESH_MS,
    0,
    "healthy subscriptions must not run unconditional periodic portfolio reads"
  );
  let subscriptionPortfolioReads = 0;
  const subscriptionClient = createSolanaWalletDataClient({
    env: "devnet",
    assetProvider: {
      getBalance: async () => 0,
      getAssetSnapshot: async () => {
        subscriptionPortfolioReads += 1;
        return assetSnapshot(0);
      },
      subscribeAssetChanges: async () => async () => undefined,
    },
    activityProvider: emptyActivityProvider(),
  });
  const unsubscribe = await subscriptionClient.subscribePortfolio(
    user,
    () => {},
    {
      emitInitial: false,
      fallbackRefreshMs: WALLET_PORTFOLIO_FALLBACK_REFRESH_MS,
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  await unsubscribe();
  assert.equal(
    subscriptionPortfolioReads,
    0,
    "an idle healthy subscription must not poll the portfolio"
  );
  console.log(
    "PASS healthy subscriptions stay event-driven without unconditional polling"
  );

  const shieldHookSource = await Bun.file(
    new URL("../src/hooks/use-shield.ts", import.meta.url)
  ).text();
  assert.match(
    shieldHookSource,
    /executeMaxUnshieldWithReconciliation/,
    "useShield must delegate the real MAX transaction and reconciliation boundary to the verified orchestration"
  );
  const shieldContentSource = await Bun.file(
    new URL(
      "../src/components/wallet-sidebar/shield-content.tsx",
      import.meta.url
    )
  ).text();
  assert.match(
    shieldContentSource,
    /settlePostActionRefresh/,
    "ShieldContent must use the verified bounded refresh settlement"
  );
  assert.match(
    shieldContentSource,
    /recoverPostActionRefresh/,
    "ShieldContent must use the verified finite MAX-unshield recovery"
  );
  const walletHookSource = await Bun.file(
    new URL("../src/hooks/use-wallet-desktop-data.ts", import.meta.url)
  ).text();
  assert.match(
    walletHookSource,
    /createLatestPortfolioRequestGuard/,
    "the wallet hook must use the verified last-write-wins guard"
  );
  assert.match(
    walletHookSource,
    /fallbackRefreshMs:\s*WALLET_PORTFOLIO_FALLBACK_REFRESH_MS/,
    "the wallet subscription must use the verified event-driven fallback setting"
  );
  console.log("PASS verified production helpers are wired into the live paths");

  console.log("VERDICT: PASS");
}

await main();
