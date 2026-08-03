import {
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/solana/constants";
import {
  executeEarnAutodepositClose,
  executeEarnAutodepositScheduledSweep,
  executeEarnAutodepositSetup,
  setEarnAutodepositActive,
  updateEarnAutodepositThreshold,
} from "@/lib/solana/earn/autodeposit";
import {
  fetchEarnAutodepositState,
  fetchEarnAutodepositSweepProgress,
  fetchEarnRefundScan,
  fetchEarnState,
  fetchEarnWithdrawSources,
  toWithdrawPrepareSource,
  type EarnAutodepositState,
  type EarnRefundPrepareRequest,
} from "@/lib/solana/earn/earn-api";
import { executeEarnDeposit } from "@/lib/solana/earn/deposit";
import { executeEarnRefund } from "@/lib/solana/earn/refund";
import { executeEarnWithdraw } from "@/lib/solana/earn/withdraw";
import { fetchTokenHoldings } from "@/lib/solana/token-holdings/fetch-token-holdings";
import type { Signer } from "@/lib/wallet/signer";
import {
  startMobileLoadingMetric,
  type MobileLoadingOperation,
} from "@/services/loading-metrics";

const DEFAULT_DEPOSIT_USD = 0.01;
const POLL_INTERVAL_MS = 1_000;
// Production workers process scheduled sweeps asynchronously and can have a
// queue ahead of a freshly requested slot. Keep the verifier bounded, but give
// the worker enough time to report an authoritative terminal state.
const STATE_TIMEOUT_MS = 600_000;

export type LoadingMetricsE2eStage =
  | "preflight.close_autodeposit"
  | "preflight.withdraw"
  | "preflight.refund"
  | "preflight.holdings"
  | "action.deposit"
  | "action.autodeposit.setup"
  | "wait.autodeposit.setup"
  | "action.autodeposit.execute_now"
  | "wait.autodeposit.execute_now"
  | "action.autodeposit.floor_update"
  | "action.autodeposit.pause"
  | "action.autodeposit.resume"
  | "cleanup.close_autodeposit"
  | "cleanup.withdraw"
  | "cleanup.refund";

type ReportStage = (stage: LoadingMetricsE2eStage) => Promise<void>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measured<T>(
  operation: Exclude<MobileLoadingOperation, "app_load">,
  run: () => Promise<T>
): Promise<T> {
  const metric = startMobileLoadingMetric(operation);
  try {
    const result = await run();
    metric.completeAfterPaint();
    await delay(50);
    return result;
  } catch (error) {
    metric.failAfterPaint();
    await delay(50);
    throw error;
  }
}

async function waitForAutodeposit(
  walletAddress: string,
  predicate: (state: EarnAutodepositState | null) => boolean
): Promise<EarnAutodepositState> {
  const deadline = Date.now() + STATE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { autodeposit } = await fetchEarnAutodepositState(walletAddress);
    if (autodeposit && predicate(autodeposit)) return autodeposit;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for the Autodeposit state transition.");
}

async function waitForAutodepositSweep(
  walletAddress: string,
  scheduledSlotId: string
): Promise<
  | { state: "completed" }
  | {
      failureCode?: string;
      state: "failed" | "released" | "canceled";
    }
> {
  const deadline = Date.now() + STATE_TIMEOUT_MS;
  let lastState = "scheduled";
  while (Date.now() < deadline) {
    const progress = await fetchEarnAutodepositSweepProgress(
      walletAddress,
      scheduledSlotId
    );
    if (progress) {
      lastState = progress.state;
      if (progress.state === "completed") return { state: "completed" };
      if (
        progress.state === "failed" ||
        progress.state === "released" ||
        progress.state === "canceled"
      ) {
        return {
          ...(progress.failureCode
            ? { failureCode: progress.failureCode }
            : {}),
          state: progress.state,
        };
      }
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for Autodeposit execute now; last state was ${lastState}.`
  );
}

async function closeAutodepositIfPresent(signer: Signer): Promise<void> {
  const walletAddress = signer.publicKey.toBase58();
  const { autodeposit } = await fetchEarnAutodepositState(walletAddress);
  if (!autodeposit?.recurringDelegation) return;
  await measured("earn.autodeposit.close", () =>
    executeEarnAutodepositClose({
      signer,
      policy: autodeposit.policyAccount,
      recurringDelegation: autodeposit.recurringDelegation as string,
    })
  );
}

async function withdrawAll(signer: Signer): Promise<void> {
  const walletAddress = signer.publicKey.toBase58();
  const { position } = await fetchEarnState(walletAddress);
  const positionRaw = BigInt(position?.currentAmountRaw ?? "0");
  if (positionRaw <= 0) return;

  const { sources } = await fetchEarnWithdrawSources(walletAddress);
  if (sources.length === 0) {
    await measured("earn.withdrawal", () =>
      executeEarnWithdraw({
        signer,
        amountUsd: Number(positionRaw) / 1e6,
        mode: "full",
        source: null,
      })
    );
    return;
  }

  for (const source of sources) {
    const amountRaw = BigInt(source.amountRaw);
    if (amountRaw <= 0) continue;
    await measured("earn.withdrawal", () =>
      executeEarnWithdraw({
        signer,
        amountUsd: Number(amountRaw) / 1e6,
        mode: "full",
        source: toWithdrawPrepareSource(source),
      })
    );
  }
}

async function refundClosedAccounts(signer: Signer): Promise<void> {
  const walletAddress = signer.publicKey.toBase58();
  const { scan } = await fetchEarnRefundScan(walletAddress);
  const requests: EarnRefundPrepareRequest[] = [
    ...(scan?.policies ?? [])
      .filter((item) => item.canRefund && (item.lamports ?? 0) > 0)
      .map((item) => ({
        kind: "policy" as const,
        policyAccount: item.account,
      })),
    ...(scan?.recurringDelegations ?? [])
      .filter((item) => item.canRefund && (item.lamports ?? 0) > 0)
      .map((item) => ({
        kind: "recurring_delegation" as const,
        recurringDelegation: item.account,
      })),
    ...(scan?.vault?.canRefund && scan.vault.totalRefundableLamports > 0
      ? [{ kind: "vault" as const }]
      : []),
  ];
  for (const request of requests) {
    await measured("earn.refund", () => executeEarnRefund({ signer, request }));
  }
}

async function runCleanupStages(
  signer: Signer,
  reportStage: ReportStage,
  stages: readonly {
    stage: LoadingMetricsE2eStage;
    run: (signer: Signer) => Promise<void>;
  }[]
): Promise<void> {
  let firstFailure: unknown;
  for (const { stage, run } of stages) {
    try {
      await reportStage(stage);
    } catch {
      // Diagnostic stage reporting must never prevent chain cleanup.
    }
    try {
      await run(signer);
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) {
    throw firstFailure;
  }
}

const PREFLIGHT_CLEANUP_STAGES = [
  {
    stage: "preflight.close_autodeposit",
    run: closeAutodepositIfPresent,
  },
  { stage: "preflight.withdraw", run: withdrawAll },
  { stage: "preflight.refund", run: refundClosedAccounts },
] as const;

const FINAL_CLEANUP_STAGES = [
  {
    stage: "cleanup.close_autodeposit",
    run: closeAutodepositIfPresent,
  },
  { stage: "cleanup.withdraw", run: withdrawAll },
  { stage: "cleanup.refund", run: refundClosedAccounts },
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown verifier failure.";
}

export async function runLoadingMetricsE2e(
  signer: Signer,
  reportStage: ReportStage
): Promise<void> {
  const walletAddress = signer.publicKey.toBase58();
  let currentStage: LoadingMetricsE2eStage = "preflight.close_autodeposit";
  const report = async (stage: LoadingMetricsE2eStage) => {
    currentStage = stage;
    await reportStage(stage);
  };

  let flowFailure: unknown;
  let flowFailureStage: LoadingMetricsE2eStage | null = null;
  try {
    // Start from a deterministic empty state. These are the same real close,
    // withdrawal, and refund paths the user reaches through the app.
    await runCleanupStages(signer, report, PREFLIGHT_CLEANUP_STAGES);

    await report("preflight.holdings");
    const holdings = await fetchTokenHoldings(walletAddress, true);
    const usdc = holdings.find(
      (holding) =>
        !holding.isSecured &&
        (holding.mint === SOLANA_USDC_MINT_MAINNET ||
          holding.mint === SOLANA_USDC_MINT_DEVNET)
    );
    const depositUsd = Number(
      process.env.EXPO_PUBLIC_E2E_DEPOSIT_USD ?? DEFAULT_DEPOSIT_USD
    );
    if (
      !usdc ||
      !Number.isFinite(depositUsd) ||
      depositUsd < DEFAULT_DEPOSIT_USD ||
      usdc.balance < depositUsd + DEFAULT_DEPOSIT_USD
    ) {
      throw new Error(
        "The verifier wallet needs enough public USDC for the E2E flow."
      );
    }

    await report("action.deposit");
    await measured("earn.deposit", () =>
      executeEarnDeposit({ signer, amountUsd: depositUsd })
    );

    const postDepositHoldings = await fetchTokenHoldings(walletAddress, true);
    const postDepositUsdc = postDepositHoldings.find(
      (holding) =>
        !holding.isSecured &&
        (holding.mint === SOLANA_USDC_MINT_MAINNET ||
          holding.mint === SOLANA_USDC_MINT_DEVNET)
    );
    if (!postDepositUsdc || postDepositUsdc.balance < DEFAULT_DEPOSIT_USD * 2) {
      throw new Error(
        "The verifier wallet has no USDC surplus for Autodeposit."
      );
    }
    const initialFloorUsd =
      Math.floor((postDepositUsdc.balance - DEFAULT_DEPOSIT_USD) * 100) / 100;

    await report("action.autodeposit.setup");
    await measured("earn.autodeposit.setup", () =>
      executeEarnAutodepositSetup({ signer, thresholdUsd: initialFloorUsd })
    );
    await report("wait.autodeposit.setup");
    let autodeposit = await waitForAutodeposit(walletAddress, (state) =>
      Boolean(state?.recurringDelegation)
    );

    const scheduled = autodeposit.scheduledSweeps?.[0];
    if (!scheduled) {
      throw new Error(
        "Autodeposit setup did not create a scheduled verification sweep."
      );
    }
    if (scheduled.executeNowAvailableAt) {
      const availableAt = Date.parse(scheduled.executeNowAvailableAt);
      if (Number.isFinite(availableAt) && availableAt > Date.now()) {
        await delay(Math.min(STATE_TIMEOUT_MS, availableAt - Date.now() + 250));
      }
    }
    await report("action.autodeposit.execute_now");
    const executeNowMetric = startMobileLoadingMetric(
      "earn.autodeposit.execute_now"
    );
    try {
      const { flow, scheduledSlotId } =
        await executeEarnAutodepositScheduledSweep({ signer });
      await report("wait.autodeposit.execute_now");
      const terminal = await waitForAutodepositSweep(
        walletAddress,
        scheduledSlotId
      );
      if (terminal.state === "completed") {
        flow.complete("state_observed", { executeNowState: "completed" });
        executeNowMetric.completeAfterPaint();
      } else {
        // This verifier proves the loading metric for both real terminal
        // outcomes. A worker failure is still a complete interaction-to-UI
        // observation; it must not prevent the remaining policy actions from
        // exercising their own metrics. Timeouts remain fatal and ambiguous.
        flow.fail("state_observed", { executeNowState: terminal.state });
        executeNowMetric.failAfterPaint();
      }
      await delay(50);
    } catch (error) {
      executeNowMetric.failAfterPaint();
      await delay(50);
      throw error;
    }

    await report("action.autodeposit.floor_update");
    autodeposit = await waitForAutodeposit(walletAddress, (state) =>
      Boolean(state?.recurringDelegation)
    );
    const updatedFloorUsd = initialFloorUsd + DEFAULT_DEPOSIT_USD;
    await measured("earn.autodeposit.floor_update", () =>
      updateEarnAutodepositThreshold({
        signer,
        thresholdUsd: updatedFloorUsd,
        policyAccount: autodeposit.policyAccount,
        recurringDelegation: autodeposit.recurringDelegation as string,
        vaultIndex: autodeposit.vaultIndex,
      })
    );
    await report("action.autodeposit.pause");
    await measured("earn.autodeposit.pause", () =>
      setEarnAutodepositActive({
        signer,
        active: false,
        policyAccount: autodeposit.policyAccount,
        recurringDelegation: autodeposit.recurringDelegation as string,
        vaultIndex: autodeposit.vaultIndex,
      })
    );
    await report("action.autodeposit.resume");
    await measured("earn.autodeposit.resume", () =>
      setEarnAutodepositActive({
        signer,
        active: true,
        policyAccount: autodeposit.policyAccount,
        recurringDelegation: autodeposit.recurringDelegation as string,
        vaultIndex: autodeposit.vaultIndex,
      })
    );
  } catch (error) {
    flowFailure = error;
    flowFailureStage = currentStage;
  }

  let cleanupFailure: unknown;
  try {
    await runCleanupStages(signer, report, FINAL_CLEANUP_STAGES);
  } catch (error) {
    cleanupFailure = error;
  }

  if (flowFailure !== undefined && cleanupFailure !== undefined) {
    throw new Error(
      `Verifier flow failed at ${flowFailureStage ?? "unknown"}: ${errorMessage(
        flowFailure
      )} Cleanup also failed: ${errorMessage(cleanupFailure)}`
    );
  }
  if (flowFailure !== undefined) {
    throw new Error(
      `Verifier flow failed at ${flowFailureStage ?? "unknown"}: ${errorMessage(
        flowFailure
      )}`
    );
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
}
