import { NextResponse } from "next/server";
import {
  LoyalCluster,
  getKaminoUsdcEarnTargetForCluster,
} from "@loyal/actions";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  findYieldPositionHistoryEvents,
  type UserYieldPositionHistoryEventRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_VAULT_INDEX = 1;
const SOLANA_ENV_ENV_NAME = "NEXT_PUBLIC_SOLANA_ENV";
const MAIN_USDC_LABEL = "Main USDC";
const EARN_VAULT_LABEL = "Earn vault";
const MAIN_USDC_ICON = "/agents/Agent-01.svg";
const EARN_VAULT_ICON = null;

function resolveConfiguredCluster(): LoyalCluster {
  const solanaEnv = resolveSolanaEnv(process.env[SOLANA_ENV_ENV_NAME]);
  return solanaEnv === "devnet"
    ? LoyalCluster.Devnet
    : LoyalCluster.MainnetBeta;
}

function formatExactUsdcAmount(rawAmount: bigint): string {
  const sign = rawAmount < BigInt(0) ? "-" : "";
  const absolute = rawAmount < BigInt(0) ? -rawAmount : rawAmount;
  const whole = absolute / BigInt(1_000_000);
  const fraction = (absolute % BigInt(1_000_000)).toString().padStart(6, "0");

  return `${sign}${whole.toString()}.${fraction} USDC`;
}

function formatDisplayUsdcAmount(
  rawAmount: bigint,
  direction: "in" | "out"
): string {
  const sign = direction === "in" ? "+" : "-";
  const absolute = rawAmount < BigInt(0) ? -rawAmount : rawAmount;
  const whole = absolute / BigInt(1_000_000);
  const remainder = absolute % BigInt(1_000_000);
  const cents = remainder / BigInt(10_000);

  if (absolute > BigInt(0) && whole === BigInt(0) && cents === BigInt(0)) {
    return `${sign}<0.01 USDC`;
  }

  if (remainder === BigInt(0)) {
    return `${sign}${whole.toString()} USDC`;
  }

  const fraction = cents.toString().padStart(2, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}.${fraction} USDC`;
}

function formatDateGroup(date: Date): string {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    hour12: true,
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function serializeEvent(event: UserYieldPositionHistoryEventRecord) {
  const kind = event.type === "deposit" ? "deposit" : "withdraw";
  const direction = kind === "deposit" ? "out" : "in";

  return {
    amount: formatDisplayUsdcAmount(event.amountRaw, direction),
    confirmedSlot: event.confirmedSlot.toString(),
    dateGroup: formatDateGroup(event.confirmedAt),
    destination: {
      icon: kind === "deposit" ? EARN_VAULT_ICON : MAIN_USDC_ICON,
      label: kind === "deposit" ? EARN_VAULT_LABEL : MAIN_USDC_LABEL,
    },
    id: event.signature,
    kind,
    rawAmount: formatExactUsdcAmount(event.amountRaw),
    signature: event.signature,
    source: {
      icon: kind === "deposit" ? MAIN_USDC_ICON : EARN_VAULT_ICON,
      label: kind === "deposit" ? MAIN_USDC_LABEL : EARN_VAULT_LABEL,
    },
    timestamp: formatTimestamp(event.confirmedAt),
  };
}

export async function GET(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return NextResponse.json(
      {
        error: {
          code: "unauthenticated",
          message: "No active auth session.",
        },
      },
      { status: 401 }
    );
  }

  const cluster = resolveConfiguredCluster();
  const earnTarget = getKaminoUsdcEarnTargetForCluster(cluster);

  try {
    const events = await findYieldPositionHistoryEvents({
      cluster,
      settings: principal.settingsPda,
      targetReserve: earnTarget.reserve.toBase58(),
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: principal.walletAddress,
    });

    return NextResponse.json({
      transactions: events.map(serializeEvent),
    });
  } catch (error) {
    console.warn("[earn-transactions] failed to load Earn history", error);
    return NextResponse.json(
      {
        error: {
          code: "earn_transactions_unavailable",
          message: "Earn transactions are unavailable.",
        },
      },
      { status: 503 }
    );
  }
}
