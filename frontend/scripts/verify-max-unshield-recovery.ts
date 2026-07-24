import assert from "node:assert/strict";

import type { ShieldFlowExecutionResult } from "@loyal-labs/private-transactions";
import { type Connection, PublicKey } from "@solana/web3.js";

import { createSolanaWalletDataClient } from "../../packages/solana-wallet/src/client";
import type {
  ActivityProvider,
  AssetProvider,
} from "../../packages/solana-wallet/src/types";
import { DELEGATION_PROGRAM_ID } from "../../sdk/private-transactions/src/constants";
import { enumerateDepositsByUser } from "../../sdk/private-transactions/src/enumerate-deposits";
import { runShieldAttemptWithOptionalAccounting } from "../src/lib/solana/shield-recovery";
import {
  isRetryableUnshieldError,
  readDepositAmountFailClosed,
  runConfirmedUnshieldAttempt,
  UnshieldAttemptError,
  type UnshieldAttemptStage,
} from "../src/lib/solana/unshield-recovery";
import {
  createPortfolioRefreshState,
  getPortfolioBalanceDisplay,
  getPortfolioFreshness,
  markPortfolioRefreshFailed,
  markPortfolioRefreshSucceeded,
  shouldRenderPortfolioEmptyState,
} from "../src/lib/wallet/portfolio-refresh-state";

const TEST_KEY = new PublicKey("11111111111111111111111111111111");
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function createExecutionResult(
  signatures: ShieldFlowExecutionResult["signatures"],
  amount = BigInt(1_134_434)
): ShieldFlowExecutionResult {
  return {
    amount,
    kind: "unshield",
    payer: TEST_KEY,
    signatures,
    tokenMint: TEST_KEY,
    user: TEST_KEY,
  };
}

async function expectAttemptFailure(
  operation: () => Promise<unknown>,
  expectedStage: UnshieldAttemptStage
): Promise<UnshieldAttemptError> {
  try {
    await operation();
  } catch (error) {
    assert.ok(error instanceof UnshieldAttemptError);
    assert.equal(error.stage, expectedStage);
    return error;
  }

  throw new Error(`Expected unshield failure at ${expectedStage}`);
}

function createEnumerationConnection(args: {
  rejectDelegated?: boolean;
  rejectProgram?: boolean;
}): Connection {
  return {
    commitment: "confirmed",
    getProgramAccounts: async (programId: PublicKey) => {
      const isDelegatedRead = programId.equals(DELEGATION_PROGRAM_ID);
      if (
        (isDelegatedRead && args.rejectDelegated) ||
        (!isDelegatedRead && args.rejectProgram)
      ) {
        throw new TypeError("Failed to fetch configured deposit source");
      }
      return [];
    },
  } as unknown as Connection;
}

async function verifyIncompleteSecureBalanceReadsFailClosed(): Promise<void> {
  const allSourcesAvailable = createEnumerationConnection({});

  assert.deepEqual(
    await enumerateDepositsByUser({
      user: TEST_KEY,
      baseConnection: allSourcesAvailable,
      ephemeralConnection: allSourcesAvailable,
    }),
    []
  );

  await assert.rejects(
    enumerateDepositsByUser({
      user: TEST_KEY,
      baseConnection: createEnumerationConnection({ rejectProgram: true }),
      ephemeralConnection: allSourcesAvailable,
    }),
    /could not enumerate complete private deposits/i
  );
  await assert.rejects(
    enumerateDepositsByUser({
      user: TEST_KEY,
      baseConnection: createEnumerationConnection({ rejectDelegated: true }),
      ephemeralConnection: allSourcesAvailable,
    }),
    /could not enumerate complete private deposits/i
  );
  await assert.rejects(
    enumerateDepositsByUser({
      user: TEST_KEY,
      baseConnection: allSourcesAvailable,
      ephemeralConnection: createEnumerationConnection({
        rejectProgram: true,
      }),
    }),
    /could not enumerate complete private deposits/i
  );

  const assetProvider: AssetProvider = {
    getBalance: async () => 0,
    getAssetSnapshot: async () => ({
      owner: TEST_KEY.toBase58(),
      nativeBalanceLamports: 0,
      fetchedAt: Date.now(),
      assets: [
        {
          asset: {
            mint: USDC_MINT,
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
            imageUrl: null,
            isNative: false,
          },
          balance: 0.000_038,
          priceUsd: 1,
          valueUsd: 0.000_038,
        },
      ],
    }),
    subscribeAssetChanges: async () => async () => undefined,
  };
  const activityProvider: ActivityProvider = {
    getActivity: async () => ({ activities: [] }),
    subscribeActivity: async () => async () => undefined,
  };
  let secureBalanceRaw: bigint | null = null;
  let secureBalanceReads = 0;
  const client = createSolanaWalletDataClient({
    env: "devnet",
    assetProvider,
    activityProvider,
    secureBalanceProvider: async () => {
      secureBalanceReads += 1;
      if (secureBalanceRaw === null) {
        throw new TypeError("Secure balance RPC unavailable");
      }
      return new Map([[USDC_MINT, secureBalanceRaw]]);
    },
  });

  await assert.rejects(
    client.getPortfolio(TEST_KEY),
    /secure balance rpc unavailable/i
  );

  secureBalanceRaw = BigInt(1_134_434);
  const confirmed = await client.getPortfolio(TEST_KEY);
  assert.equal(
    confirmed.positions.find(({ asset }) => asset.mint === USDC_MINT)
      ?.securedBalance,
    1.134_434
  );

  secureBalanceRaw = null;
  await assert.rejects(
    client.getPortfolio(TEST_KEY, { forceRefresh: true }),
    /secure balance rpc unavailable/i
  );
  const retained = await client.getPortfolio(TEST_KEY);
  assert.equal(retained, confirmed);

  secureBalanceRaw = BigInt(1_130_000);
  const refreshed = await client.getPortfolio(TEST_KEY, {
    forceRefresh: true,
  });
  assert.equal(
    refreshed.positions.find(({ asset }) => asset.mint === USDC_MINT)
      ?.securedBalance,
    1.13
  );
  assert.equal(secureBalanceReads, 4);
}

async function verifyShieldAccountingReadIsBestEffort(): Promise<void> {
  let buildCalls = 0;
  let executeCalls = 0;
  let accountingWarnings = 0;
  const result = await runShieldAttemptWithOptionalAccounting({
    readAccountingBaseline: async () => {
      throw new TypeError("Failed to fetch accounting baseline");
    },
    buildPlan: async () => {
      buildCalls += 1;
      return { amount: BigInt(1_000_000) };
    },
    executePlan: async (plan) => {
      executeCalls += 1;
      return { confirmed: true, plan };
    },
    onAccountingReadError: () => {
      accountingWarnings += 1;
    },
  });

  assert.equal(result.accountingBaseline, null);
  assert.equal(result.executionResult.confirmed, true);
  assert.equal(buildCalls, 1);
  assert.equal(executeCalls, 1);
  assert.equal(accountingWarnings, 1);

  await assert.rejects(
    runShieldAttemptWithOptionalAccounting({
      readAccountingBaseline: async () => {
        throw new TypeError("Failed to fetch accounting baseline");
      },
      buildPlan: async () => ({ amount: BigInt(1_000_000) }),
      executePlan: async () => {
        throw new Error("Shield confirmation failed");
      },
    }),
    /shield confirmation failed/i
  );
}

function verifyRetryClassification(): void {
  const nestedFetchError = new UnshieldAttemptError(
    "execute-plan",
    "Could not execute the unshield transaction",
    new TypeError("Failed to fetch")
  );
  assert.equal(isRetryableUnshieldError(nestedFetchError), true);
  assert.equal(
    isRetryableUnshieldError(
      new Error("WebSocket connection closed before submission")
    ),
    true
  );
  for (const transientMessage of [
    "Blocked by CORS policy",
    "ERR_SOCKET_NOT_CONNECTED",
    "Request TimeoutError",
    "RPC transport unavailable",
    "HTTP 503 Service Unavailable",
  ]) {
    assert.equal(
      isRetryableUnshieldError(new Error(transientMessage)),
      true,
      transientMessage
    );
  }
  assert.equal(
    isRetryableUnshieldError(new Error("User rejected the request")),
    false
  );
  assert.equal(
    isRetryableUnshieldError(
      new Error("Transaction simulation failed: custom program error: 0x1771")
    ),
    false
  );
  assert.equal(
    isRetryableUnshieldError(new Error("Invalid connection account owner")),
    false
  );
}

async function verifyOriginalMaxUnshieldInvariants(): Promise<void> {
  await assert.rejects(
    readDepositAmountFailClosed({
      readEphemeral: async () => null,
      readBase: async () => {
        throw new TypeError("Failed to fetch");
      },
    }),
    /failed to fetch/i
  );

  await expectAttemptFailure(
    () =>
      runConfirmedUnshieldAttempt({
        resolveAmount: async () => {
          throw new TypeError("Failed to fetch");
        },
        buildPlan: async (amount) => ({ amount }),
        executePlan: async () => createExecutionResult([]),
      }),
    "read-deposit"
  );

  await expectAttemptFailure(
    () =>
      runConfirmedUnshieldAttempt({
        resolveAmount: async () => BigInt(1_134_434),
        buildPlan: async (amount) => ({ amount }),
        executePlan: async () => {
          throw new Error("WebSocket connection closed before submission");
        },
      }),
    "execute-plan"
  );

  await expectAttemptFailure(
    () =>
      runConfirmedUnshieldAttempt({
        resolveAmount: async () => BigInt(1_134_434),
        buildPlan: async (amount) => ({ amount }),
        executePlan: async () =>
          createExecutionResult([
            {
              cluster: "ephemeral",
              index: 0,
              label: "unshield:undelegate",
              signature: "ephemeral-signature",
            },
          ]),
      }),
    "confirm-base"
  );

  const success = await runConfirmedUnshieldAttempt({
    resolveAmount: async () => BigInt(1_134_434),
    buildPlan: async (amount) => ({ amount }),
    executePlan: async ({ amount }) =>
      createExecutionResult(
        [
          {
            cluster: "ephemeral",
            index: 0,
            label: "unshield:undelegate",
            signature: "ephemeral-signature",
          },
          {
            cluster: "base",
            index: 1,
            label: "unshield",
            signature: "confirmed-base-signature",
          },
        ],
        amount
      ),
  });
  assert.equal(success.signature, "confirmed-base-signature");

  let liveDepositRaw = BigInt(1_134_434);
  let shouldInterrupt = true;
  let confirmedBaseDecreases = 0;
  let depositReads = 0;
  const plannedAmounts: bigint[] = [];

  const attempt = () =>
    runConfirmedUnshieldAttempt({
      resolveAmount: async () => {
        depositReads += 1;
        return liveDepositRaw;
      },
      buildPlan: async (amount) => {
        plannedAmounts.push(amount);
        return { amount };
      },
      executePlan: async ({ amount }) => {
        if (shouldInterrupt) {
          shouldInterrupt = false;
          throw new TypeError("Failed to fetch");
        }

        assert.equal(amount, liveDepositRaw);
        liveDepositRaw = BigInt(0);
        confirmedBaseDecreases += 1;
        return createExecutionResult(
          [
            {
              cluster: "base",
              index: 0,
              label: "unshield",
              signature: "retry-confirmed-base-signature",
            },
          ],
          amount
        );
      },
    });

  await expectAttemptFailure(attempt, "execute-plan");
  liveDepositRaw = BigInt(1_130_000);

  const retry = await attempt();
  assert.equal(retry.amount, BigInt(1_130_000));
  assert.equal(retry.signature, "retry-confirmed-base-signature");
  assert.deepEqual(plannedAmounts, [BigInt(1_134_434), BigInt(1_130_000)]);
  assert.equal(depositReads, 2);
  assert.equal(confirmedBaseDecreases, 1);
  assert.equal(liveDepositRaw, BigInt(0));
}

function verifyUnavailablePortfolioPresentation(): void {
  const confirmedSnapshot = {
    publicUsdcRaw: "38",
    shieldedUsdcSharesRaw: "1134434",
  };
  const current = createPortfolioRefreshState(confirmedSnapshot);
  const failed = markPortfolioRefreshFailed(
    current,
    new TypeError("Failed to fetch")
  );

  assert.equal(failed.snapshot, confirmedSnapshot);
  assert.equal(getPortfolioFreshness(failed, false), "stale");
  assert.match(failed.error ?? "", /failed to fetch/i);

  const unavailable = markPortfolioRefreshFailed(
    createPortfolioRefreshState<typeof confirmedSnapshot>(),
    new TypeError("Failed to fetch")
  );
  assert.equal(unavailable.snapshot, null);
  assert.equal(getPortfolioFreshness(unavailable, false), "unavailable");
  assert.deepEqual(
    getPortfolioBalanceDisplay("unavailable", {
      balanceFraction: ".00",
      balanceWhole: "$0",
    }),
    { balanceFraction: "", balanceWhole: "$—" }
  );
  assert.deepEqual(
    getPortfolioBalanceDisplay("stale", {
      balanceFraction: ".23",
      balanceWhole: "$1",
    }),
    { balanceFraction: ".23", balanceWhole: "$1" }
  );
  assert.equal(shouldRenderPortfolioEmptyState("unavailable"), false);
  assert.equal(shouldRenderPortfolioEmptyState("stale"), true);
  assert.equal(shouldRenderPortfolioEmptyState("current"), true);

  const refreshed = markPortfolioRefreshSucceeded({
    publicUsdcRaw: "1172338",
    shieldedUsdcSharesRaw: "0",
  });
  assert.equal(getPortfolioFreshness(refreshed, false), "current");
  assert.equal(refreshed.error, null);
}

async function verifyDeterministicErrorsStayFailures(): Promise<void> {
  const programError = new Error(
    "Transaction simulation failed: custom program error: 0x1771"
  );
  const failure = await expectAttemptFailure(
    () =>
      runConfirmedUnshieldAttempt({
        resolveAmount: async () => BigInt(1_134_434),
        buildPlan: async (amount) => ({ amount }),
        executePlan: async () => {
          throw programError;
        },
      }),
    "execute-plan"
  );

  assert.equal(failure.cause, programError);
  assert.match(failure.message, /custom program error: 0x1771/i);
}

await verifyIncompleteSecureBalanceReadsFailClosed();
console.log("PASS Required 1: incomplete secure-balance reads fail closed");

await verifyShieldAccountingReadIsBestEffort();
console.log("PASS Required 2: shield accounting pre-read is best-effort");

verifyRetryClassification();
await verifyDeterministicErrorsStayFailures();
console.log("PASS Required 3: only transient connection errors are retryable");

verifyUnavailablePortfolioPresentation();
console.log(
  "PASS Required 4: unavailable balances are not presented as an empty wallet"
);

await verifyOriginalMaxUnshieldInvariants();
console.log("PASS Required 5: original MAX-unshield invariants remain intact");

console.log("PASS focused ASK-1865 verifier");
