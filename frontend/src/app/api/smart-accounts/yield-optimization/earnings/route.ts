import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  TimescaleReserveClient,
  getTimescaleReserveDatabaseUrl,
} from "@/lib/kamino/timescale-reserve-client.server";
import {
  EARNINGS_RANGE_IDS,
  calculateEarnEarnings,
  isEarningsRangeId,
  type EarningsRangeId,
} from "@/lib/yield-optimization/earnings-calculator.server";
import type { EarnEarningsRangeSetResponse } from "@/lib/yield-optimization/earnings.shared";
import {
  findReconciledActiveYieldPositionForVault,
  findYieldPositionEvents,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_VAULT_INDEX = 1;

class MissingTimescaleDatabaseUrlError extends Error {
  constructor() {
    super("missing_timescale_database_url");
    this.name = "MissingTimescaleDatabaseUrlError";
  }
}

function resolveConfiguredCluster() {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  return resolveLoyalClusterForSolanaEnv(solanaEnv);
}

function getRangeFromRequest(request: Request): EarningsRangeId | null {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range");
  if (range === null) {
    return null;
  }

  if (!isEarningsRangeId(range)) {
    throw new Error("invalid_range");
  }

  return range;
}

function getFirstDepositAt(
  events: Awaited<ReturnType<typeof findYieldPositionEvents>>
): Date | null {
  return events.find((event) => event.type === "deposit")?.confirmedAt ?? null;
}

async function loadReserveApySamples(args: {
  end: Date;
  reserve: string;
  start: Date;
}) {
  const databaseUrl = getTimescaleReserveDatabaseUrl();
  if (!databaseUrl) {
    throw new MissingTimescaleDatabaseUrlError();
  }

  const client = new TimescaleReserveClient({ databaseUrl, maxConnections: 1 });
  try {
    return await client.getReserveApyHistorySamples(args);
  } finally {
    await client.close().catch((error) => {
      console.warn("[earnings] failed to close Timescale client", error);
    });
  }
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

  let range: EarningsRangeId | null;
  try {
    range = getRangeFromRequest(request);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_range",
          message: "Range must be one of 7D, 30D, 1Y, or ALL.",
        },
      },
      { status: 400 }
    );
  }

  const timezone = "UTC";
  const now = new Date();
  const cluster = resolveConfiguredCluster();

  try {
    const position = await findReconciledActiveYieldPositionForVault({
      cluster,
      settings: principal.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: principal.walletAddress,
    });
    const events = position
      ? await findYieldPositionEvents({
          cluster,
          initialReserve: position.initialReserve,
          settings: principal.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          vaultPubkey: position.vaultPubkey,
          walletAddress: principal.walletAddress,
        })
      : [];
    const firstDepositAt = getFirstDepositAt(events);
    const apySamples =
      firstDepositAt === null || !position
        ? []
        : await loadReserveApySamples({
            end: now,
            reserve: position.currentReserve,
            start: firstDepositAt,
          });

    if (range) {
      return NextResponse.json(
        calculateEarnEarnings({
          apySamples,
          events,
          now,
          range,
          timezone,
        })
      );
    }

    const ranges = Object.fromEntries(
      EARNINGS_RANGE_IDS.map((rangeId) => [
        rangeId,
        calculateEarnEarnings({
          apySamples,
          events,
          now,
          range: rangeId,
          timezone,
        }),
      ])
    ) as EarnEarningsRangeSetResponse["ranges"];

    return NextResponse.json({
      generatedAt: now.toISOString(),
      ranges,
    } satisfies EarnEarningsRangeSetResponse);
  } catch (error) {
    if (error instanceof MissingTimescaleDatabaseUrlError) {
      console.warn("[earnings] failed to load Earn earnings", error);
      return NextResponse.json(
        {
          error: {
            code: "earnings_timescale_unconfigured",
            message: "Earn earnings require Timescale configuration.",
          },
        },
        { status: 503 }
      );
    }

    console.warn("[earnings] failed to load Earn earnings", error);
    return NextResponse.json(
      {
        error: {
          code: "earnings_unavailable",
          message: "Earn earnings are unavailable.",
        },
      },
      { status: 503 }
    );
  }
}
