// Decision layer for the automated Earn "joy" pushes (ASK-2091). Pure so the
// cadence can be reasoned about (and tested) without a database, an RPC or a
// push token.

export const EARN_JOY_MILESTONES_USD = [10, 100, 1000] as const;

export const EARN_JOY_ANNIVERSARIES = [
  { campaign: "yield-one-year", days: 365, months: 12 },
  { campaign: "yield-six-months", days: 183, months: 6 },
] as const;

export const FIRST_YIELD_CAMPAIGN = "yield-first";

/** Below a cent there is nothing to report: "+$0.00" is worse than silence. */
export const EARN_JOY_MIN_REPORTABLE_USD = 0.01;

/** An anniversary push needs an amount worth showing. */
export const ANNIVERSARY_MIN_EARNED_USD = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How much a wallet must have earned since its last push before it is worth
 * sending another one.
 *
 * The bar decays with silence instead of being fixed per user, which is what
 * makes one rule fit every size of position. At ~5% APY a $10k position clears
 * $1 in a day and hears daily; $1k clears it in a week; $100 needs the relaxed
 * $0.10 bar and lands about every eight days; $10 only ever clears a cent, so
 * it gets a monthly note; and a dust position never clears anything and stays
 * quiet forever. No cohorts, no per-user configuration, no "whale" flag.
 */
export function earnDigestThresholdUsd(daysSinceLastPush: number): number {
  if (daysSinceLastPush >= 30) {
    return EARN_JOY_MIN_REPORTABLE_USD;
  }
  if (daysSinceLastPush >= 7) {
    return 0.1;
  }
  return 1;
}

export type EarnJoyState = {
  lastPushedEarnedUsd: number;
  lastPushedAt: Date | null;
  sentCampaigns: string[];
};

export type EarnJoyInput = {
  accountAgeDays: number;
  lifetimeEarnedUsd: number;
  now: Date;
  /** Null the first time this wallet is seen by the cron. */
  state: EarnJoyState | null;
};

export type EarnJoyPush = {
  amountUsd: number;
  campaign: string;
  months?: number;
  type: "anniversary" | "digest" | "first" | "milestone";
};

export type EarnJoyDecision =
  /** First sighting: adopt the wallet's current standing without pushing. */
  | { kind: "seed"; campaigns: string[] }
  | { kind: "push"; push: EarnJoyPush }
  | { kind: "none" };

/**
 * One-time campaigns a wallet already qualifies for right now.
 *
 * Only the highest milestone and anniversary count: a wallet sitting at $150
 * has passed $10 and $100, and telling it about $10 is a worse push than
 * telling it nothing.
 */
export function qualifiedEarnJoyCampaigns(input: {
  accountAgeDays: number;
  lifetimeEarnedUsd: number;
}): string[] {
  const campaigns: string[] = [];
  if (input.lifetimeEarnedUsd >= EARN_JOY_MIN_REPORTABLE_USD) {
    campaigns.push(FIRST_YIELD_CAMPAIGN);
  }
  const milestone = [...EARN_JOY_MILESTONES_USD]
    .reverse()
    .find((value) => input.lifetimeEarnedUsd >= value);
  if (milestone !== undefined) {
    campaigns.push(`yield-total-${milestone}`);
  }
  if (input.lifetimeEarnedUsd >= ANNIVERSARY_MIN_EARNED_USD) {
    const anniversary = EARN_JOY_ANNIVERSARIES.find(
      (entry) => input.accountAgeDays >= entry.days
    );
    if (anniversary) {
      campaigns.push(anniversary.campaign);
    }
  }
  return campaigns;
}

/**
 * At most one push per wallet per run, in the order of how much the moment
 * means: a first yield beats a milestone, a milestone beats an anniversary,
 * and anything beats the routine digest. Three pushes in one morning is how a
 * channel gets muted.
 */
export function selectEarnJoyPush(input: EarnJoyInput): EarnJoyDecision {
  const qualified = qualifiedEarnJoyCampaigns(input);

  // A wallet the cron has never seen may already be months and dollars in.
  // Adopting its standing silently is what keeps a deploy from turning into a
  // broadcast of backdated milestones.
  if (!input.state) {
    return { kind: "seed", campaigns: qualified };
  }

  const sent = new Set(input.state.sentCampaigns);
  const pending = qualified.filter((campaign) => !sent.has(campaign));

  if (pending.includes(FIRST_YIELD_CAMPAIGN)) {
    return {
      kind: "push",
      push: {
        amountUsd: input.lifetimeEarnedUsd,
        campaign: FIRST_YIELD_CAMPAIGN,
        type: "first",
      },
    };
  }

  const milestone = [...EARN_JOY_MILESTONES_USD]
    .reverse()
    .find((value) => pending.includes(`yield-total-${value}`));
  if (milestone !== undefined) {
    return {
      kind: "push",
      push: {
        amountUsd: milestone,
        campaign: `yield-total-${milestone}`,
        type: "milestone",
      },
    };
  }

  const anniversary = EARN_JOY_ANNIVERSARIES.find((entry) =>
    pending.includes(entry.campaign)
  );
  if (anniversary) {
    return {
      kind: "push",
      push: {
        amountUsd: input.lifetimeEarnedUsd,
        campaign: anniversary.campaign,
        months: anniversary.months,
        type: "anniversary",
      },
    };
  }

  const earnedSinceLastPush =
    input.lifetimeEarnedUsd - input.state.lastPushedEarnedUsd;
  const daysSinceLastPush = input.state.lastPushedAt
    ? (input.now.getTime() - input.state.lastPushedAt.getTime()) / DAY_MS
    : Number.POSITIVE_INFINITY;
  if (
    earnedSinceLastPush >= EARN_JOY_MIN_REPORTABLE_USD &&
    earnedSinceLastPush >= earnDigestThresholdUsd(daysSinceLastPush)
  ) {
    return {
      kind: "push",
      push: {
        amountUsd: earnedSinceLastPush,
        campaign: "yield-digest",
        type: "digest",
      },
    };
  }

  return { kind: "none" };
}
