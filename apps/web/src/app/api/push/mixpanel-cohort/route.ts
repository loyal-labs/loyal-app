import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { getOptionalEnv } from "@/lib/core/config/shared";
import {
  sendWalletPush,
  type WalletPushPayload,
} from "@/lib/push-notifications/wallet-push.server";
import {
  getYieldOptimizationClient,
  pushCampaignSends,
} from "@/lib/yield-optimization/yield-neon-client.server";

// Mixpanel Custom Webhook receiver for the ASK-1651 P2/P3 push cohorts.
// Mixpanel syncs each connected cohort every ~30 minutes, POSTing
// { action: "members" | "add_members" | "remove_members",
//   parameters: { mixpanel_cohort_name, members: [{ mixpanel_distinct_id }] } }
// in batches of up to 1000 members, with optional Basic auth. The response must
// echo { action, status } (https://docs.mixpanel.com/docs/cohort-sync/webhooks).
//
// A cohort is mapped to a push campaign by naming it "push: <campaign>" in
// Mixpanel, where <campaign> is a key of CAMPAIGNS below. Every send is
// recorded in loyal_yield.push_campaign_sends BEFORE sending, so re-syncs and
// Mixpanel's re-sends after mid-sync failures never push twice.

// Copy comes from ASK-1651 — keep in sync with the ticket. The ticket's
// dynamic values ($X earned, N quests left, end date) are static for now;
// per-wallet enrichment is a follow-up.
const COHORT_PREFIX = "push: ";
const CAMPAIGNS: Record<string, WalletPushPayload> = {
  // P2 — quest funnel
  "quest-1-nudge": {
    body: "Add $5 to your account and it's done.",
    title: "You're one step from Quest 1.",
  },
  "quest-2-nudge": {
    body: "Enable auto-deposit and your USDC earns while it sits. Quest 2, done.",
    title: "One quest left.",
  },
  "seeker-summer-ending": {
    body: "Less than 48 hours left on your quests. Don't leave the rewards on the table.",
    title: "Seeker's Summer is almost over.",
  },
  // P3 — retention
  "earning-while-away": {
    body: "It's been adding up. Come take a look.",
    title: "Your USDC kept earning while you were out.",
  },
  "still-earning": {
    body: "Your USDC has been earning since you last checked in. Pick up where you left off.",
    title: "Still working for you.",
  },
};

// Mobile distinct ids are "mob:<wallet>" (set by the app's analytics client);
// only those map to registered push devices.
const MOBILE_DISTINCT_ID_PREFIX = "mob:";
const SEND_CONCURRENCY = 10;

// Batches are ≤1000 members and each send is network-bound (5s timeout in
// sendWalletPush); Mixpanel retries 5xx and the sent-log makes retries converge.
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = getOptionalEnv(process.env, "MIXPANEL_COHORT_WEBHOOK_SECRET");
  if (!secret) {
    return false;
  }
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return false;
  }
  // Mixpanel's Basic auth is username:password; only the password is checked.
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const password = decoded.slice(decoded.indexOf(":") + 1);
  const expected = Buffer.from(secret);
  const provided = Buffer.from(password);
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

function success(action: string): NextResponse {
  return NextResponse.json({ action, status: "success" });
}

function failure(action: string, code: number, message: string): NextResponse {
  // Non-transient codes (400/401) pause the sync and surface `message` in
  // Mixpanel's UI — deliberate for setup errors like a misnamed cohort.
  return NextResponse.json(
    { action, error: { code, message }, status: "failure" },
    { status: code }
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure("members", 400, "Invalid JSON body.");
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const action =
    record.action === "members" ||
    record.action === "add_members" ||
    record.action === "remove_members"
      ? record.action
      : null;
  if (!action) {
    return failure("members", 400, "Unknown action.");
  }

  if (!isAuthorized(request)) {
    return failure(action, 401, "Unauthorized.");
  }

  // Leaving a cohort never un-sends a push; membership isn't mirrored.
  if (action === "remove_members") {
    return success(action);
  }

  const parameters =
    typeof record.parameters === "object" && record.parameters !== null
      ? (record.parameters as Record<string, unknown>)
      : {};
  const cohortName =
    typeof parameters.mixpanel_cohort_name === "string"
      ? parameters.mixpanel_cohort_name
      : "";
  const campaign = cohortName.startsWith(COHORT_PREFIX)
    ? cohortName.slice(COHORT_PREFIX.length).trim()
    : null;
  const payload = campaign ? CAMPAIGNS[campaign] : undefined;
  if (!campaign || !payload) {
    return failure(
      action,
      400,
      `Cohort name must be "push: <campaign>" with a known campaign key (got "${cohortName}").`
    );
  }

  const rawMembers = Array.isArray(parameters.members)
    ? parameters.members
    : [];
  const wallets = new Set<string>();
  for (const member of rawMembers) {
    const distinctId =
      typeof member === "object" && member !== null
        ? (member as Record<string, unknown>).mixpanel_distinct_id
        : undefined;
    if (
      typeof distinctId === "string" &&
      distinctId.startsWith(MOBILE_DISTINCT_ID_PREFIX)
    ) {
      wallets.add(distinctId.slice(MOBILE_DISTINCT_ID_PREFIX.length));
    }
  }

  const rawCohortId = parameters.mixpanel_cohort_id;
  const cohortId =
    typeof rawCohortId === "string" || typeof rawCohortId === "number"
      ? String(rawCohortId)
      : null;

  const db = getYieldOptimizationClient().db;
  let sent = 0;
  let deduped = 0;
  const queue = [...wallets];
  while (queue.length > 0) {
    const chunk = queue.splice(0, SEND_CONCURRENCY);
    await Promise.all(
      chunk.map(async (walletAddress) => {
        // Insert-first sent-log: at-most-once per (wallet, campaign). If the
        // send itself fails after the insert, it is not retried — pushes are
        // best-effort.
        const inserted = await db
          .insert(pushCampaignSends)
          .values({ campaign, cohortId, walletAddress })
          .onConflictDoNothing()
          .returning({ id: pushCampaignSends.id });
        if (inserted.length === 0) {
          deduped += 1;
          return;
        }
        await sendWalletPush(walletAddress, payload);
        sent += 1;
      })
    );
  }

  console.log("[mixpanel-cohort] processed", {
    action,
    campaign,
    deduped,
    members: rawMembers.length,
    mobileWallets: wallets.size,
    sent,
  });
  return success(action);
}
