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
  type ReserveApySample,
  type YieldPositionPathEvent,
} from "@/lib/yield-optimization/earnings-calculator.server";
import type { EarnEarningsRangeSetResponse } from "@/lib/yield-optimization/earnings.shared";
import {
  findYieldPositionHistoryEventsForVault,
  type UserYieldPositionHistoryEventRecord,
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
        ...reserveSamples.map((sample) => ({
          ...sample,
          reserve,
        }))
      );
    }
    return samples;
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
    const pathEvents = (
      await findYieldPositionHistoryEventsForVault({
        cluster,
        settings: principal.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        walletAddress: principal.walletAddress,
      })
    ).map(toYieldPositionPathEvent);
    const firstDepositAt = getFirstDepositAt(pathEvents);
    const apySamples =
      firstDepositAt === null
        ? []
        : await loadReserveApySamplesForPath({
            end: now,
            pathEvents,
            start: firstDepositAt,
          });

    if (range) {
      return NextResponse.json(
        calculateEarnEarnings({
          apySamples,
          events: [],
          now,
          pathEvents,
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
          events: [],
          now,
          pathEvents,
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
