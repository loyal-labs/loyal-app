import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  TimescaleReserveClient,
  getTimescaleReserveDatabaseUrl,
} from "@/lib/kamino/timescale-reserve-client.server";
import {
  calculateEarnEarnings,
  type EarningsRangeId,
  type ReserveApySample,
  type YieldPositionPathEvent,
} from "@/lib/yield-optimization/earnings-calculator.server";
import {
  findYieldPositionHistoryEventsForVault,
  type UserYieldPositionHistoryEventRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Read-only mobile twin of the session `yield-optimization/earnings` route. Like
// `mobile/earn/state`, the native Earn tab reads passively with no signer held,
// so the lookup is keyed by a supplied wallet address rather than a signed
// request (returning only public, on-chain-derived earnings data). The mobile
// Earnings chart only renders the 30-day daily view, so this always computes the
// "30D" range.
//
// It MUST feed the calculator the same inputs as the session route — the full
// position PATH (every reserve the vault moved through) plus per-reserve APY
// samples — so daily earnings match the web exactly. Passing the legacy
// single-reserve `events` instead makes the calculator fall back to
// `legacyEventsToPathEvents` with one reserve's APY, which diverges (wrong
// per-day earned + principal). If the wallet has no app user / smart account
// yet, it returns the empty earnings result (zero bars) rather than creating
// anything.
const EARN_VAULT_INDEX = 1;
const EARNINGS_RANGE: EarningsRangeId = "30D";

class MissingTimescaleDatabaseUrlError extends Error {
  constructor() {
    super("missing_timescale_database_url");
    this.name = "MissingTimescaleDatabaseUrlError";
  }
}

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function resolveConfiguredCluster() {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  return resolveLoyalClusterForSolanaEnv(solanaEnv);
}

function toYieldPositionPathEvent(
  event: UserYieldPositionHistoryEventRecord
): YieldPositionPathEvent {
  return {
    amountRaw: event.amountRaw,
    confirmedAt: event.confirmedAt,
    liquidityMint: event.liquidityMint,
    market: event.market,
    principalAmountRaw: event.principalAmountRaw,
    reserve: event.reserve,
    type: event.type,
  };
}

function getFirstDepositAt(
  events: readonly YieldPositionPathEvent[]
): Date | null {
  let firstDepositAt: Date | null = null;
  for (const event of events) {
    if (event.type !== "deposit") {
      continue;
    }
    if (
      firstDepositAt === null ||
      event.confirmedAt.getTime() < firstDepositAt.getTime()
    ) {
      firstDepositAt = event.confirmedAt;
    }
  }
  return firstDepositAt;
}

async function loadReserveApySamplesForPath(args: {
  end: Date;
  pathEvents: readonly YieldPositionPathEvent[];
  start: Date;
}): Promise<ReserveApySample[]> {
  const reserves = new Set<string>();
  for (const event of args.pathEvents) {
    if (!event.reserve) {
      continue;
    }
    reserves.add(event.reserve);
  }

  if (reserves.size === 0) {
    return [];
  }

  const databaseUrl = getTimescaleReserveDatabaseUrl();
  if (!databaseUrl) {
    throw new MissingTimescaleDatabaseUrlError();
  }

  const client = new TimescaleReserveClient({ databaseUrl, maxConnections: 1 });
  try {
    const samples: ReserveApySample[] = [];
    for (const reserve of reserves) {
      const reserveSamples = await client.getReserveApyHistorySamples({
        end: args.end,
        reserve,
        start: args.start,
      });
      samples.push(
        ...reserveSamples.map((sample) => ({ ...sample, reserve }))
      );
    }
    return samples;
  } finally {
    await client.close().catch((error) => {
      console.warn(
        "[mobile-earn-earnings] failed to close Timescale client",
        error
      );
    });
  }
}

export async function GET(request: Request) {
  const walletAddress =
    new URL(request.url).searchParams.get("walletAddress")?.trim() ?? "";
  if (!walletAddress) {
    return jsonError(400, "invalid_request", "walletAddress is required.");
  }
  try {
    // Throws a 400 WalletAuthError when the address isn't a valid 32-byte key.
    decodeWalletAddress(walletAddress);
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(400, "invalid_request", "walletAddress is invalid.");
  }

  const now = new Date();
  const timezone = "UTC";
  const cluster = resolveConfiguredCluster();

  try {
    const user = await findCurrentUser({
      authMethod: "wallet",
      provider: "solana",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const account = user
      ? await findReadyCurrentUserSmartAccount({
          userId: user.id,
          walletAddress,
        })
      : null;
    const pathEvents = account
      ? (
          await findYieldPositionHistoryEventsForVault({
            cluster,
            settings: account.settingsPda,
            vaultIndex: EARN_VAULT_INDEX,
            walletAddress,
          })
        ).map(toYieldPositionPathEvent)
      : [];
    const firstDepositAt = getFirstDepositAt(pathEvents);
    const apySamples =
      firstDepositAt === null
        ? []
        : await loadReserveApySamplesForPath({
            end: now,
            pathEvents,
            start: firstDepositAt,
          });

    return NextResponse.json(
      calculateEarnEarnings({
        apySamples,
        events: [],
        now,
        pathEvents,
        range: EARNINGS_RANGE,
        timezone,
      })
    );
  } catch (error) {
    if (error instanceof MissingTimescaleDatabaseUrlError) {
      console.warn("[mobile-earn-earnings] failed to load Earn earnings", error);
      return jsonError(
        503,
        "earnings_timescale_unconfigured",
        "Earn earnings require Timescale configuration."
      );
    }

    console.error("[mobile-earn-earnings] read failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown read error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(503, "earnings_unavailable", "Earn earnings are unavailable.");
  }
}
