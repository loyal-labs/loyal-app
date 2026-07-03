import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";

import {
  quest1DonePush,
  sendWalletPush,
} from "@/lib/push-notifications/wallet-push.server";
import { findWalletAddressesWithBalanceSweepsSince } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import {
  getYieldOptimizationClient,
  solanaWeekQuestCompletions,
} from "@/lib/yield-optimization/yield-neon-client.server";

import {
  reportQuestCompletion,
  type QuestCompletionMetadata,
  type QuestCompletionResult,
  type QuestKind,
} from "./quest-completion-reporter";

/**
 * DB-backed orchestration around the stateless quest-completion reporter.
 *
 * Every qualifying event (manual Earn deposit; autodeposit sweep) is recorded in
 * `loyal_yield.solana_week_quest_completions` keyed by (wallet, quest_kind) and
 * then reported to Solana. The local row is:
 *   - the idempotency guard (a 'reported' row never re-hits Solana),
 *   - the retry state for the reconciliation cron,
 *   - the data source for in-app quest progress (no per-view Solana GET).
 *
 * Solana stays authoritative for badge earned/locked and claim state; this table
 * only mirrors "the user did the action + our reporting status".
 */

type CompletionRow = typeof solanaWeekQuestCompletions.$inferSelect;

export type RecordAndReportStatus =
  | "reported"
  | "pending"
  | "failed"
  | "skipped";

function db() {
  return getYieldOptimizationClient().db;
}

async function findCompletionRow(
  walletId: string,
  kind: QuestKind
): Promise<CompletionRow | null> {
  const [row] = await db()
    .select()
    .from(solanaWeekQuestCompletions)
    .where(
      and(
        eq(solanaWeekQuestCompletions.walletAddress, walletId),
        eq(solanaWeekQuestCompletions.questKind, kind)
      )
    )
    .limit(1);
  return row ?? null;
}

// Insert a pending row (idempotent) and return the current row.
async function ensureCompletionRow(
  walletId: string,
  kind: QuestKind,
  metadata: QuestCompletionMetadata | undefined
): Promise<CompletionRow> {
  await db()
    .insert(solanaWeekQuestCompletions)
    .values({
      walletAddress: walletId,
      questKind: kind,
      status: "pending",
      metadata: metadata ?? null,
    })
    .onConflictDoNothing({
      target: [
        solanaWeekQuestCompletions.walletAddress,
        solanaWeekQuestCompletions.questKind,
      ],
    });

  const row = await findCompletionRow(walletId, kind);
  if (!row) {
    throw new Error("Failed to persist Solana Week quest completion row.");
  }
  return row;
}

// Apply a report result to a row and normalize the outcome.
async function applyReportResult(
  rowId: bigint,
  result: QuestCompletionResult
): Promise<RecordAndReportStatus> {
  const now = new Date();
  const base = {
    attempts: sql`${solanaWeekQuestCompletions.attempts} + 1`,
    updatedAt: now,
  };

  switch (result.status) {
    case "completed":
    case "already_completed":
      await db()
        .update(solanaWeekQuestCompletions)
        .set({
          ...base,
          status: "reported",
          solanaStatus: result.status,
          reportedAt: now,
          lastErrorCode: null,
          lastErrorMessage: null,
        })
        .where(eq(solanaWeekQuestCompletions.id, rowId));
      return "reported";
    case "permanent_error":
      await db()
        .update(solanaWeekQuestCompletions)
        .set({
          ...base,
          status: "failed",
          lastErrorCode: result.error,
          lastErrorMessage: result.message,
        })
        .where(eq(solanaWeekQuestCompletions.id, rowId));
      return "failed";
    case "disabled":
    case "skipped":
      // Not configured / guard tripped — leave pending for the reconciler.
      await db()
        .update(solanaWeekQuestCompletions)
        .set({ ...base, status: "pending", lastErrorCode: result.reason })
        .where(eq(solanaWeekQuestCompletions.id, rowId));
      return "pending";
    case "retryable_error":
      await db()
        .update(solanaWeekQuestCompletions)
        .set({ ...base, status: "pending", lastErrorCode: result.error })
        .where(eq(solanaWeekQuestCompletions.id, rowId));
      return "pending";
  }
}

/**
 * Records the quest completion locally (idempotent) and reports it to Solana
 * unless already reported. Returns the normalized local status.
 */
export async function recordAndReportQuestCompletion(args: {
  walletId: string;
  kind: QuestKind;
  metadata?: QuestCompletionMetadata;
}): Promise<RecordAndReportStatus> {
  const walletId = args.walletId.trim();
  if (!walletId) {
    return "skipped";
  }

  const row = await ensureCompletionRow(walletId, args.kind, args.metadata);
  if (row.status === "reported") {
    return "reported";
  }

  const result = await reportQuestCompletion({
    kind: args.kind,
    walletId,
    metadata: args.metadata,
  });
  const status = await applyReportResult(row.id, result);
  // Quest 1 push (ASK-1651 P2): fires at most once — the row transitions to
  // 'reported' a single time, and already-reported rows return above. Quest 2
  // gets no push here; the P1 "$X moved to EARN" push lands at that same
  // moment from the sweep notify.
  if (status === "reported" && args.kind === "earn_deposit") {
    await sendWalletPush(walletId, quest1DonePush());
  }
  return status;
}

async function reportBestEffort(
  kind: QuestKind,
  walletId: string,
  metadata: QuestCompletionMetadata | undefined
): Promise<void> {
  try {
    const status = await recordAndReportQuestCompletion({
      kind,
      walletId,
      metadata,
    });
    if (status === "failed") {
      console.error("[solana-week] quest completion permanently failed", {
        kind,
        walletId,
      });
    }
  } catch (error) {
    // Best-effort: never break the calling flow on a reporting/DB failure.
    console.error("[solana-week] quest completion threw", {
      kind,
      walletId,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage:
        error instanceof Error ? error.message : "Unknown reporting error.",
    });
  }
}

/**
 * Minimum qualifying deposit for Quest 1: $5 USDC (6 decimals). Deposits below
 * this don't earn the badge, so we neither create a completion row nor report.
 */
export const MIN_EARN_DEPOSIT_QUEST_USDC_RAW = BigInt(5_000_000);

/**
 * Best-effort Quest 1 (connect wallet + Earn deposit of at least $5). A deposit
 * under the threshold is not a qualifying action and is a no-op. Never throws.
 */
export function reportEarnDepositQuestCompletion(
  walletId: string,
  depositedUsdcRaw: bigint,
  metadata?: QuestCompletionMetadata
): Promise<void> {
  if (depositedUsdcRaw < MIN_EARN_DEPOSIT_QUEST_USDC_RAW) {
    return Promise.resolve();
  }
  return reportBestEffort("earn_deposit", walletId, metadata);
}

/** Best-effort Quest 2 (first Earn deposit via autodeposit). Never throws. */
export function reportFirstAutodepositSweepQuestCompletion(
  walletId: string,
  metadata?: QuestCompletionMetadata
): Promise<void> {
  return reportBestEffort("first_autodeposit_sweep", walletId, metadata);
}

export type ReconcileSummary = {
  retriedRows: number;
  backfilledWallets: number;
  reported: number;
  stillPending: number;
  failed: number;
};

const RETRY_BATCH_LIMIT = 500;

/**
 * Reconciliation backstop for the cron: (1) retry every row not yet reported,
 * (2) backfill autodeposit sweeps that never produced a row (e.g. a missed
 * real-time worker notify) within `sweepLookbackMs`. Idempotent throughout —
 * already-reported wallets short-circuit without a Solana call.
 */
export async function reconcileQuestCompletions(args: {
  sweepLookbackMs: number;
}): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    retriedRows: 0,
    backfilledWallets: 0,
    reported: 0,
    stillPending: 0,
    failed: 0,
  };

  const tally = (status: RecordAndReportStatus) => {
    if (status === "reported") {
      summary.reported += 1;
    } else if (status === "failed") {
      summary.failed += 1;
    } else if (status === "pending") {
      summary.stillPending += 1;
    }
  };

  // (1) Retry rows that aren't reported yet.
  const pendingRows = await db()
    .select()
    .from(solanaWeekQuestCompletions)
    .where(ne(solanaWeekQuestCompletions.status, "reported"))
    .limit(RETRY_BATCH_LIMIT);

  for (const row of pendingRows) {
    summary.retriedRows += 1;
    try {
      const result = await reportQuestCompletion({
        kind: row.questKind as QuestKind,
        walletId: row.walletAddress,
        metadata: row.metadata ?? undefined,
      });
      tally(await applyReportResult(row.id, result));
    } catch (error) {
      summary.stillPending += 1;
      console.error("[solana-week] reconcile retry threw", {
        rowId: row.id.toString(),
        errorMessage:
          error instanceof Error ? error.message : "Unknown retry error.",
      });
    }
  }

  // (2) Backfill autodeposit sweeps lacking a completion row (idempotent).
  const since = new Date(Date.now() - args.sweepLookbackMs);
  const sweptWallets = await findWalletAddressesWithBalanceSweepsSince(since);
  for (const wallet of sweptWallets) {
    summary.backfilledWallets += 1;
    try {
      tally(
        await recordAndReportQuestCompletion({
          kind: "first_autodeposit_sweep",
          walletId: wallet,
          metadata: { source: "cron:reconcile-backfill" },
        })
      );
    } catch (error) {
      summary.stillPending += 1;
      console.error("[solana-week] reconcile backfill threw", {
        wallet,
        errorMessage:
          error instanceof Error ? error.message : "Unknown backfill error.",
      });
    }
  }

  return summary;
}

const QUEST_KINDS: QuestKind[] = ["earn_deposit", "first_autodeposit_sweep"];

export type QuestProgressStatus =
  | "reported"
  | "pending"
  | "failed"
  | "not_started";

export type QuestProgressItem = {
  kind: QuestKind;
  status: QuestProgressStatus;
  solanaStatus: string | null;
  reportedAt: string | null;
  attempts: number;
};

// Persisted rows are only ever pending/reported/failed (see applyReportResult);
// anything unexpected collapses to "pending" so the UI never shows a raw value.
function normalizeRowStatus(status: string): QuestProgressStatus {
  return status === "reported" || status === "failed" ? status : "pending";
}

/**
 * Read-only quest progress for one wallet, for the in-app quest page. Returns
 * one item per quest kind ("not_started" when no row exists yet). Solana stays
 * authoritative for badge earned/locked and claim state; this only mirrors "the
 * wallet did the action + our local reporting status".
 */
export async function getQuestProgress(
  walletId: string
): Promise<QuestProgressItem[]> {
  const wallet = walletId.trim();
  const rowByKind = new Map<QuestKind, CompletionRow>();
  if (wallet) {
    const rows = await db()
      .select()
      .from(solanaWeekQuestCompletions)
      .where(eq(solanaWeekQuestCompletions.walletAddress, wallet));
    for (const row of rows) {
      if (
        row.questKind === "earn_deposit" ||
        row.questKind === "first_autodeposit_sweep"
      ) {
        rowByKind.set(row.questKind, row);
      }
    }
  }

  return QUEST_KINDS.map((kind) => {
    const row = rowByKind.get(kind);
    if (!row) {
      return {
        kind,
        status: "not_started" as const,
        solanaStatus: null,
        reportedAt: null,
        attempts: 0,
      };
    }
    return {
      kind,
      status: normalizeRowStatus(row.status),
      solanaStatus: row.solanaStatus,
      reportedAt: row.reportedAt ? row.reportedAt.toISOString() : null,
      attempts: row.attempts,
    };
  });
}
