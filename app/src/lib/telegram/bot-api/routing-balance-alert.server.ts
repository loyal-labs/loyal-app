import "server-only";

import { serverEnv } from "@/lib/core/config/server";

const ZERO = BigInt(0);
const LAMPORTS_PER_SOL = BigInt(1_000_000_000);

/** Keys at or above this balance are healthy and never alert. */
export const ROUTING_BALANCE_THRESHOLD_LAMPORTS = LAMPORTS_PER_SOL;
/** Once below the threshold, every further step down re-alerts. */
export const ROUTING_BALANCE_STEP_LAMPORTS = LAMPORTS_PER_SOL / BigInt(10);

const BALANCE_DECIMALS = 4;
const SLACK_REQUEST_TIMEOUT_MS = 5_000;
const SLACK_REQUEST_ATTEMPTS = 2;

/**
 * Last Slack-alerted 0.1 SOL bucket per routing key public key. Persisted in the
 * singleton `loyal_stats_snapshots` row rather than a dedicated table.
 */
export type RoutingBalanceAlertState = Record<string, number>;

export type RoutingKeyBalance = {
  lamports: bigint;
  publicKey: string;
};

export type RoutingBalanceAlert = {
  bucket: number;
  lamports: bigint;
  publicKey: string;
  text: string;
};

export type RoutingBalanceAlertDelivery =
  | { alert: RoutingBalanceAlert; status: "failed" }
  | { alert: RoutingBalanceAlert; status: "not_configured" }
  | { alert: RoutingBalanceAlert; status: "sent" };

export type RoutingBalanceEvaluation = {
  alerts: RoutingBalanceAlert[];
  /** State with recoveries cleared; pending alert buckets are not applied yet. */
  state: RoutingBalanceAlertState;
};

export type RoutingBalanceWatchdogResult = {
  deliveries: RoutingBalanceAlertDelivery[];
  nextState: RoutingBalanceAlertState;
  stateChanged: boolean;
};

/** Truncates rather than rounds so a low balance is never overstated. */
export function formatSolLamports(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL)
    .toString()
    .padStart(9, "0")
    .slice(0, BALANCE_DECIMALS);

  return `${whole.toString()}.${fraction}`;
}

export function shortenPublicKey(publicKey: string): string {
  if (publicKey.length <= 9) {
    return publicKey;
  }

  return `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
}

export function toRoutingBalanceBucket(lamports: bigint): number {
  const clamped = lamports < ZERO ? ZERO : lamports;
  return Number(clamped / ROUTING_BALANCE_STEP_LAMPORTS);
}

function buildMentionSuffix(): string {
  const mentions = serverEnv.slackAlertMentionUserIds
    .map((userId) => `<@${userId}>`)
    .join(" ");

  return mentions.length > 0 ? ` ${mentions}` : "";
}

function buildAlertText(balance: RoutingKeyBalance): string {
  return `🪫 Routing key \`${shortenPublicKey(
    balance.publicKey
  )}\` is low: ${formatSolLamports(
    balance.lamports
  )} SOL — top me up${buildMentionSuffix()}`;
}

/**
 * Decides which keys need a Slack post. A key alerts on its first drop below the
 * threshold and again on every lower 0.1 SOL bucket; recovering above the
 * threshold clears its state so the next drop alerts from the top again.
 *
 * Balances that could not be read are simply absent from `balances`, and their
 * previous state is carried over untouched.
 */
export function evaluateRoutingBalances(
  balances: RoutingKeyBalance[],
  previousState: RoutingBalanceAlertState
): RoutingBalanceEvaluation {
  const state: RoutingBalanceAlertState = { ...previousState };
  const alerts: RoutingBalanceAlert[] = [];

  for (const balance of balances) {
    if (balance.lamports >= ROUTING_BALANCE_THRESHOLD_LAMPORTS) {
      delete state[balance.publicKey];
      continue;
    }

    const bucket = toRoutingBalanceBucket(balance.lamports);
    const lastAlertedBucket = previousState[balance.publicKey];
    if (lastAlertedBucket !== undefined && bucket >= lastAlertedBucket) {
      continue;
    }

    alerts.push({
      bucket,
      lamports: balance.lamports,
      publicKey: balance.publicKey,
      text: buildAlertText(balance),
    });
  }

  return { alerts, state };
}

async function postToSlack(text: string): Promise<"failed" | "sent"> {
  const webhookUrl = serverEnv.slackStatsWebhookUrl;
  if (!webhookUrl) {
    return "failed";
  }

  for (let attempt = 1; attempt <= SLACK_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(webhookUrl, {
        body: JSON.stringify({ text }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        return "sent";
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      if (!isRetryable) {
        return "failed";
      }
    } catch {
      // Retry transient network failures within this cron invocation.
    }
  }

  return "failed";
}

/**
 * Evaluates the balances, posts the resulting alerts, and returns the state to
 * persist. A key only advances its last-alerted bucket once Slack accepted the
 * post, so a failed delivery is retried on the next tick.
 */
export async function runRoutingBalanceWatchdog(
  balances: RoutingKeyBalance[],
  previousState: RoutingBalanceAlertState
): Promise<RoutingBalanceWatchdogResult> {
  const { alerts, state } = evaluateRoutingBalances(balances, previousState);
  const nextState: RoutingBalanceAlertState = { ...state };
  const deliveries: RoutingBalanceAlertDelivery[] = [];
  const isConfigured = Boolean(serverEnv.slackStatsWebhookUrl);

  for (const alert of alerts) {
    if (!isConfigured) {
      deliveries.push({ alert, status: "not_configured" });
      continue;
    }

    const status = await postToSlack(alert.text);
    if (status === "sent") {
      nextState[alert.publicKey] = alert.bucket;
    }
    deliveries.push({ alert, status });
  }

  return {
    deliveries,
    nextState,
    stateChanged: !isSameState(previousState, nextState),
  };
}

function isSameState(
  left: RoutingBalanceAlertState,
  right: RoutingBalanceAlertState
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
}
