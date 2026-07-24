import assert from "node:assert/strict";

import type { ShieldFlowExecutionResult } from "@loyal-labs/private-transactions";
import { PublicKey } from "@solana/web3.js";

import {
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
} from "../src/lib/wallet/portfolio-refresh-state";

const TEST_KEY = new PublicKey("11111111111111111111111111111111");

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

async function verifyInterruptedAttemptsFailClosed(): Promise<void> {
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
}

async function verifyMaxRetryUsesLiveDeposit(): Promise<void> {
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

function verifyPortfolioFailureRetainsConfirmedState(): void {
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

await verifyInterruptedAttemptsFailClosed();
console.log("PASS Required 1: interrupted attempts fail closed");

await verifyMaxRetryUsesLiveDeposit();
console.log("PASS Required 2: MAX retry uses authoritative live deposit state");

verifyPortfolioFailureRetainsConfirmedState();
console.log(
  "PASS Required 3: failed refresh retains confirmed portfolio state"
);

await verifyDeterministicErrorsStayFailures();
console.log(
  "PASS Required 4: deterministic transaction errors remain failures"
);

console.log("PASS focused ASK-1865 verifier");
