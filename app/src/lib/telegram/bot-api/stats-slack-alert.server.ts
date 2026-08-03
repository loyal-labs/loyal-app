import "server-only";

import { serverEnv } from "@/lib/core/config/server";

const ZERO = BigInt(0);
const ONE_HUNDRED = BigInt(100);
const TWO = BigInt(2);
const USDC_RAW_PER_USDC = BigInt(1_000_000);
const USDC_RAW_PER_CENT = BigInt(10_000);
const AUM_ALERT_THRESHOLD_RAW = BigInt(5_000) * USDC_RAW_PER_USDC;
const SLACK_REQUEST_TIMEOUT_MS = 5_000;
const SLACK_REQUEST_ATTEMPTS = 2;

export type LoyalStatsAumAlert = {
  currentAumRaw: bigint;
  deltaRaw: bigint;
  direction: "decreased" | "increased";
  text: string;
};

export type LoyalStatsAumAlertDelivery =
  | { status: "below_threshold" }
  | { alert: LoyalStatsAumAlert; status: "failed" }
  | { alert: LoyalStatsAumAlert; status: "not_configured" }
  | { alert: LoyalStatsAumAlert; status: "sent" };

function formatUsdcRaw(raw: bigint): string {
  const isNegative = raw < ZERO;
  const absoluteRaw = isNegative ? -raw : raw;
  const roundedCents =
    (absoluteRaw + USDC_RAW_PER_CENT / TWO) / USDC_RAW_PER_CENT;
  const wholeDollars = roundedCents / ONE_HUNDRED;
  const cents = (roundedCents % ONE_HUNDRED).toString().padStart(2, "0");
  const formattedDollars = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(wholeDollars);

  return `${isNegative ? "-" : ""}$${formattedDollars}.${cents}`;
}

export function createLoyalStatsAumAlert(
  previousAumRaw: bigint,
  currentAumRaw: bigint
): LoyalStatsAumAlert | null {
  const deltaRaw = currentAumRaw - previousAumRaw;
  const absoluteDeltaRaw = deltaRaw < ZERO ? -deltaRaw : deltaRaw;

  if (absoluteDeltaRaw < AUM_ALERT_THRESHOLD_RAW) {
    return null;
  }

  const direction = deltaRaw < ZERO ? "decreased" : "increased";
  const icon = deltaRaw < ZERO ? "📉" : "📈";

  return {
    currentAumRaw,
    deltaRaw,
    direction,
    text: `${icon} Earn AUM ${direction} by ${formatUsdcRaw(
      absoluteDeltaRaw
    )}\nCurrent Earn AUM: ${formatUsdcRaw(currentAumRaw)}`,
  };
}

export async function sendLoyalStatsAumAlert(
  previousAumRaw: bigint,
  currentAumRaw: bigint
): Promise<LoyalStatsAumAlertDelivery> {
  const alert = createLoyalStatsAumAlert(previousAumRaw, currentAumRaw);
  if (!alert) {
    return { status: "below_threshold" };
  }

  const webhookUrl = serverEnv.slackStatsWebhookUrl;
  if (!webhookUrl) {
    return { alert, status: "not_configured" };
  }

  for (let attempt = 1; attempt <= SLACK_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(webhookUrl, {
        body: JSON.stringify({ text: alert.text }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(SLACK_REQUEST_TIMEOUT_MS),
      });

      if (response.ok) {
        return { alert, status: "sent" };
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      if (!isRetryable) {
        return { alert, status: "failed" };
      }
    } catch {
      // Retry transient network failures within this cron invocation.
    }
  }

  return { alert, status: "failed" };
}
