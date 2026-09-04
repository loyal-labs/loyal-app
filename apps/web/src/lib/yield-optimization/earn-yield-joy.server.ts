import "server-only";

import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import {
  appUsers,
  appUserSmartAccounts,
  earnYieldPushState,
} from "@loyal-labs/db-core/schema";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { and, desc, eq, inArray } from "drizzle-orm";

import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getDatabase } from "@/lib/core/database";
import {
  firstYieldPush,
  loyalAnniversaryPush,
  sendWalletPush,
  totalEarnedMilestonePush,
  yieldDigestPush,
  type WalletPushPayload,
} from "@/lib/push-notifications/wallet-push.server";

import {
  EarnEarningsUnavailableError,
  readEarnEarningsRangeSet,
} from "./earnings-read-service.server";
import {
  selectEarnJoyPush,
  type EarnJoyPush,
  type EarnJoyState,
} from "./earn-yield-joy.shared";

// Daily driver for the Earn "joy" pushes (ASK-2091). Earnings are read through
// the same service the app reads, so a push can never claim a number the Earn
// screen would not show.
const EARN_VAULT_INDEX = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const WALLET_CONCURRENCY = 5;
// Leaves headroom under the route's 300s ceiling for the final state writes.
const DEFAULT_TIME_BUDGET_MS = 240_000;

export type EarnYieldJoyOutcome = {
  campaign?: string;
  amountUsd?: number;
  status: "pushed" | "seeded" | "quiet" | "unavailable" | "error";
  wallet: string;
};

export type EarnYieldJoySummary = {
  candidates: number;
  dryRun: boolean;
  errors: number;
  processed: number;
  pushed: EarnYieldJoyOutcome[];
  quiet: number;
  seeded: number;
  truncated: boolean;
  unavailable: number;
};

type Candidate = {
  createdAt: Date;
  settingsPda: string;
  walletAddress: string;
};

function joyPushPayload(push: EarnJoyPush): WalletPushPayload {
  switch (push.type) {
    case "first":
      return firstYieldPush(push.amountUsd);
    case "milestone":
      return totalEarnedMilestonePush(push.amountUsd);
    case "anniversary":
      return loyalAnniversaryPush(push.months ?? 6, push.amountUsd);
    case "digest":
      return yieldDigestPush(push.amountUsd);
  }
}

async function listCandidates(solanaEnv: SolanaEnv): Promise<Candidate[]> {
  const rows = await getDatabase()
    .select({
      createdAt: appUsers.createdAt,
      settingsPda: appUserSmartAccounts.settingsPda,
      walletAddress: appUsers.subjectAddress,
    })
    .from(appUserSmartAccounts)
    .innerJoin(appUsers, eq(appUserSmartAccounts.userId, appUsers.id))
    .where(
      and(
        eq(appUserSmartAccounts.state, "ready"),
        eq(appUserSmartAccounts.solanaEnv, solanaEnv)
      )
    )
    .orderBy(desc(appUserSmartAccounts.updatedAt));

  return rows.filter(
    (row): row is Candidate =>
      Boolean(row.settingsPda) && Boolean(row.walletAddress)
  );
}

async function loadStates(
  wallets: string[]
): Promise<Map<string, EarnJoyState>> {
  const states = new Map<string, EarnJoyState>();
  if (wallets.length === 0) {
    return states;
  }
  const rows = await getDatabase()
    .select({
      lastPushedAt: earnYieldPushState.lastPushedAt,
      lastPushedEarnedUsd: earnYieldPushState.lastPushedEarnedUsd,
      sentCampaigns: earnYieldPushState.sentCampaigns,
      walletPublicKey: earnYieldPushState.walletPublicKey,
    })
    .from(earnYieldPushState)
    .where(inArray(earnYieldPushState.walletPublicKey, wallets));

  for (const row of rows) {
    states.set(row.walletPublicKey, {
      lastPushedAt: row.lastPushedAt,
      lastPushedEarnedUsd: Number(row.lastPushedEarnedUsd),
      sentCampaigns: row.sentCampaigns ?? [],
    });
  }
  return states;
}

async function saveState(args: {
  campaigns: string[];
  lastPushedAt: Date | null;
  lifetimeEarnedUsd: number;
  walletAddress: string;
}): Promise<void> {
  const values = {
    lastPushedAt: args.lastPushedAt,
    lastPushedEarnedUsd: args.lifetimeEarnedUsd.toFixed(6),
    sentCampaigns: args.campaigns,
    updatedAt: new Date(),
    walletPublicKey: args.walletAddress,
  };
  await getDatabase()
    .insert(earnYieldPushState)
    .values(values)
    .onConflictDoUpdate({
      set: {
        lastPushedAt: values.lastPushedAt,
        lastPushedEarnedUsd: values.lastPushedEarnedUsd,
        sentCampaigns: values.sentCampaigns,
        updatedAt: values.updatedAt,
      },
      target: earnYieldPushState.walletPublicKey,
    });
}

async function readLifetimeEarnedUsd(args: {
  cluster: string;
  settings: string;
  walletAddress: string;
}): Promise<number | null> {
  try {
    const earnings = await readEarnEarningsRangeSet({
      cluster: args.cluster,
      settings: args.settings,
      timezone: null,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: args.walletAddress,
    });
    return earnings.ranges.ALL.lifetimeEarnedUsd;
  } catch (error) {
    if (error instanceof EarnEarningsUnavailableError) {
      return null;
    }
    throw error;
  }
}

async function processCandidate(args: {
  candidate: Candidate;
  cluster: string;
  dryRun: boolean;
  now: Date;
  state: EarnJoyState | null;
}): Promise<EarnYieldJoyOutcome> {
  const { candidate } = args;
  const lifetimeEarnedUsd = await readLifetimeEarnedUsd({
    cluster: args.cluster,
    settings: candidate.settingsPda,
    walletAddress: candidate.walletAddress,
  });
  if (lifetimeEarnedUsd === null) {
    return { status: "unavailable", wallet: candidate.walletAddress };
  }

  const decision = selectEarnJoyPush({
    accountAgeDays:
      (args.now.getTime() - candidate.createdAt.getTime()) / DAY_MS,
    lifetimeEarnedUsd,
    now: args.now,
    state: args.state,
  });

  if (decision.kind === "none") {
    return { status: "quiet", wallet: candidate.walletAddress };
  }

  if (decision.kind === "seed") {
    if (!args.dryRun) {
      await saveState({
        campaigns: decision.campaigns,
        lastPushedAt: args.now,
        lifetimeEarnedUsd,
        walletAddress: candidate.walletAddress,
      });
    }
    return { status: "seeded", wallet: candidate.walletAddress };
  }

  if (!args.dryRun) {
    await sendWalletPush(
      candidate.walletAddress,
      joyPushPayload(decision.push)
    );
    // The digest reports what changed since the user was last told a number,
    // so every push — not just a digest — rebases the baseline.
    await saveState({
      campaigns:
        decision.push.type === "digest"
          ? args.state?.sentCampaigns ?? []
          : [...(args.state?.sentCampaigns ?? []), decision.push.campaign],
      lastPushedAt: args.now,
      lifetimeEarnedUsd,
      walletAddress: candidate.walletAddress,
    });
  }

  return {
    amountUsd: decision.push.amountUsd,
    campaign: decision.push.campaign,
    status: "pushed",
    wallet: candidate.walletAddress,
  };
}

export async function runEarnYieldJoy(
  options: { dryRun?: boolean; timeBudgetMs?: number } = {}
): Promise<EarnYieldJoySummary> {
  const dryRun = options.dryRun ?? false;
  const deadline =
    Date.now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const now = new Date();
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);

  const candidates = await listCandidates(solanaEnv);
  const states = await loadStates(
    candidates.map((candidate) => candidate.walletAddress)
  );

  const summary: EarnYieldJoySummary = {
    candidates: candidates.length,
    dryRun,
    errors: 0,
    processed: 0,
    pushed: [],
    quiet: 0,
    seeded: 0,
    truncated: false,
    unavailable: 0,
  };

  const queue = [...candidates];
  while (queue.length > 0) {
    if (Date.now() > deadline) {
      summary.truncated = true;
      break;
    }
    const chunk = queue.splice(0, WALLET_CONCURRENCY);
    const outcomes = await Promise.all(
      chunk.map(async (candidate) => {
        try {
          return await processCandidate({
            candidate,
            cluster,
            dryRun,
            now,
            state: states.get(candidate.walletAddress) ?? null,
          });
        } catch (error) {
          console.warn("[earn-yield-joy] wallet failed", {
            errorMessage:
              error instanceof Error ? error.message : "Unknown error.",
            wallet: candidate.walletAddress,
          });
          return {
            status: "error" as const,
            wallet: candidate.walletAddress,
          };
        }
      })
    );

    for (const outcome of outcomes) {
      summary.processed += 1;
      switch (outcome.status) {
        case "pushed":
          summary.pushed.push(outcome);
          break;
        case "seeded":
          summary.seeded += 1;
          break;
        case "quiet":
          summary.quiet += 1;
          break;
        case "unavailable":
          summary.unavailable += 1;
          break;
        case "error":
          summary.errors += 1;
          break;
      }
    }
  }

  return summary;
}
