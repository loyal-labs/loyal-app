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
import * as shieldedBalanceReconciliation from "../src/features/shielded-balance/reconciliation";
import {
  createLatestPortfolioRequestGuard,
  reconcileSecuredBalance,
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

  let readAttempt = 0;
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
  assert.deepEqual(retryResult, {
    attempts: 3,
    observedAmountRaw: BigInt(0),
    status: "reconciled",
  });

  const hungStartedAt = Date.now();
  const hungResult = await reconcileSecuredBalance({
    expectedAmountRaw: BigInt(0),
    readAmountRaw: () => new Promise<bigint>(() => {}),
    readTimeoutMs: 5,
    retryDelaysMs: [0, 0, 0],
    wait: async () => {},
  });
  assert.equal(hungResult.status, "pending");
  assert.equal(hungResult.attempts, 3);
  assert.ok(
    Date.now() - hungStartedAt < 100,
    "hung reconciliation reads must not hold the confirmed MAX flow open"
  );
  console.log(
    "PASS MAX reconciliation retries reads and terminates outages within a bounded read budget"
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

  type RefreshCommitContext = {
    isCurrent: () => boolean;
  };
  let visibleUsdcBalance = "before-refresh";
  let refreshInvocation = 0;
  let timedOutRefreshContext: RefreshCommitContext | null = null;
  const lateRefreshValue = deferred<string>();
  const lateRefreshCompleted = deferred<void>();
  const guardedRefresh = async function () {
    const context = arguments[0] as RefreshCommitContext | undefined;
    assert.ok(
      context,
      "post-action refreshes must receive a commit guard from production orchestration"
    );

    refreshInvocation += 1;
    if (refreshInvocation === 1) {
      timedOutRefreshContext = context;
      const nextBalance = await lateRefreshValue.promise;
      if (context.isCurrent()) {
        visibleUsdcBalance = nextBalance;
      }
      lateRefreshCompleted.resolve(undefined);
      return;
    }

    if (context.isCurrent()) {
      visibleUsdcBalance = "fresh-after-recovery";
    }
  };

  const timedOutGuardedRefresh = await settlePostActionRefresh({
    refresh: guardedRefresh,
    timeoutMs: 5,
  });
  assert.equal(
    timedOutGuardedRefresh.status,
    "timed_out",
    "the first guarded refresh must reach the bounded timeout"
  );
  const completedTimedOutRefreshContext =
    timedOutRefreshContext as RefreshCommitContext | null;
  assert.ok(completedTimedOutRefreshContext);
  assert.equal(
    completedTimedOutRefreshContext.isCurrent(),
    false,
    "a timed-out refresh must be unable to commit before recovery starts"
  );

  const guardedRecovery = await recoverPostActionRefresh({
    refresh: guardedRefresh,
    retryDelaysMs: [0],
    refreshTimeoutMs: 50,
    wait: async () => {},
  });
  assert.deepEqual(
    guardedRecovery.map((result) => result.status),
    ["completed"]
  );
  assert.equal(visibleUsdcBalance, "fresh-after-recovery");
  lateRefreshValue.resolve("stale-from-timed-out-refresh");
  await lateRefreshCompleted.promise;
  assert.equal(
    visibleUsdcBalance,
    "fresh-after-recovery",
    "a late timed-out refresh must not overwrite the recovery result"
  );
  assert.equal(refreshInvocation, 2);
  console.log(
    "PASS timed-out post-action refreshes cannot overwrite MAX recovery"
  );

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

  type SettleLatestPortfolioRequest = (args: {
    requestGuard: ReturnType<typeof createLatestPortfolioRequestGuard>;
    requestId: number;
    isScopeCurrent: () => boolean;
    commit?: () => void;
    setLoading: (isLoading: boolean) => void;
  }) => boolean;
  const settleLatestPortfolioRequest = (
    shieldedBalanceReconciliation as typeof shieldedBalanceReconciliation & {
      settleLatestPortfolioRequest?: SettleLatestPortfolioRequest;
    }
  ).settleLatestPortfolioRequest;
  assert.equal(
    typeof settleLatestPortfolioRequest,
    "function",
    "the live wallet hook needs an executable latest-request settlement boundary"
  );

  let simulatedIsLoading = true;
  let simulatedSnapshot = "empty";
  const setSimulatedLoading = (nextIsLoading: boolean) => {
    simulatedIsLoading = nextIsLoading;
  };
  assert.equal(
    settleLatestPortfolioRequest?.({
      requestGuard,
      requestId: olderRequest,
      isScopeCurrent: () => true,
      commit: () => {
        simulatedSnapshot = "stale-initial";
      },
      setLoading: setSimulatedLoading,
    }),
    false
  );
  assert.equal(simulatedSnapshot, "empty");
  assert.equal(
    simulatedIsLoading,
    true,
    "a superseded initial request must not mutate snapshot or loading state"
  );
  assert.equal(
    settleLatestPortfolioRequest?.({
      requestGuard,
      requestId: forcedRequest,
      isScopeCurrent: () => true,
      commit: () => {
        simulatedSnapshot = "fresh-forced";
      },
      setLoading: setSimulatedLoading,
    }),
    true
  );
  assert.equal(simulatedSnapshot, "fresh-forced");
  assert.equal(
    simulatedIsLoading,
    false,
    "the current forced snapshot must terminate uncached-wallet loading"
  );

  simulatedIsLoading = true;
  const failedForcedRequest = requestGuard.begin();
  assert.equal(
    settleLatestPortfolioRequest?.({
      requestGuard,
      requestId: failedForcedRequest,
      isScopeCurrent: () => true,
      setLoading: setSimulatedLoading,
    }),
    true
  );
  assert.equal(
    simulatedIsLoading,
    false,
    "a failed current forced request must not leave the wallet loading forever"
  );
  console.log(
    "PASS superseding portfolio outcomes preserve latest state and settle loading"
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

  console.log("VERDICT: PASS");
}

await main();
