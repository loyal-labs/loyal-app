import "server-only";

import { getOptionalEnv } from "@/lib/core/config/shared";

export type WalletPushPayload = {
  title: string;
  body: string;
};

// Bridge to the app deployment's wallet push sender. Expo push tokens are
// registered per wallet against the app backend (`push_tokens` table), so the
// earn backend delivers pushes by calling its authenticated send endpoint
// instead of reaching into the app database.
// ponytail: reuses the existing `/api/push-tokens/debug-send` route as the
// send endpoint; promote it to a non-debug path if this grows beyond earn.
//
// Configuration (both required, pushes are disabled when unset):
// - MOBILE_PUSH_API_BASE_URL: app deployment origin
// - MOBILE_PUSH_API_SECRET: must match the app's PUSH_DEBUG_SECRET
//
// Best-effort by design: never throws, so confirm routes and webhooks can
// await it without wrapping.
export async function sendWalletPush(
  walletAddress: string,
  payload: WalletPushPayload
): Promise<void> {
  const baseUrl = getOptionalEnv(process.env, "MOBILE_PUSH_API_BASE_URL");
  const secret = getOptionalEnv(process.env, "MOBILE_PUSH_API_SECRET");
  if (!baseUrl || !secret) {
    return;
  }

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/api/push-tokens/debug-send`,
      {
        body: JSON.stringify({
          body: payload.body,
          title: payload.title,
          walletPublicKey: walletAddress,
        }),
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      }
    );
    // 404 = no devices registered for this wallet (web-only user); expected.
    if (!response.ok && response.status !== 404) {
      console.warn("[wallet-push] push send rejected", {
        status: response.status,
        walletAddress,
      });
    }
  } catch (error) {
    console.warn("[wallet-push] push send failed", {
      errorMessage: error instanceof Error ? error.message : "Unknown error.",
      walletAddress,
    });
  }
}

function formatUsdcAmountRaw(amountRaw: bigint): string {
  const usd = Number(amountRaw) / 1_000_000;
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

// Copy comes from ASK-1651 — keep in sync with the ticket.

export function autodepositEnabledPush(): WalletPushPayload {
  return {
    body: "Your idle USDC will be moved to Earn automatically, roughly once an hour.",
    title: "Auto-deposit is on.",
  };
}

export function autodepositSweepScheduledPush(
  amountRaw: bigint | null
): WalletPushPayload {
  const amount =
    amountRaw !== null && amountRaw > BigInt(0)
      ? formatUsdcAmountRaw(amountRaw)
      : "USDC";
  return {
    body: "Heading to yield in ~1 hour. Adjust autodeposit limits if you need it liquid.",
    title: `${amount} about to move to EARN.`,
  };
}

export function autodepositSweepExecutedPush(
  amountRaw: bigint | null
): WalletPushPayload {
  const amount =
    amountRaw !== null && amountRaw > BigInt(0)
      ? formatUsdcAmountRaw(amountRaw)
      : "USDC";
  return {
    body: "Now earning USDC yield.",
    title: `${amount} moved to EARN.`,
  };
}

export function quest1DonePush(): WalletPushPayload {
  return {
    body: "Now flip on auto-deposit for Quest 2 — your USDC starts earning.",
    title: "Quest 1 done. ✅",
  };
}
