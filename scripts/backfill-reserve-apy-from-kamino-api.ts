import { neon } from "@neondatabase/serverless";

// Backfills kamino.reserve_apy_backfill (sidecar to the worker-owned
// kamino.reserve_updates ingestion stream — we never write to that table)
// from Kamino's public reserve metrics/history REST API. Used for reserves
// the indexer never sampled (e.g. hidden reserves a position historically
// held), so the earnings coverage gate can compute instead of returning
// apy_coverage_incomplete forever. Read-path union lives in
// frontend/src/lib/kamino/timescale-reserve-client.server.ts
// (getReserveApyHistorySamplesForReserves).

const TIMESCALE_URL_ENV_NAME = "TIMESCALEDB_URL";
// Mirrors DEFAULT_MAX_SUPPLY_APY in timescale-reserve-client.server.ts —
// rows at/above this are ignored by the read path, so refuse to store them.
const MAX_SUPPLY_APY = 0.5;
const MAX_GAP_HOURS_TOLERATED = 36;

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS kamino.reserve_apy_backfill (
  reserve text NOT NULL,
  observed_at timestamptz NOT NULL,
  supply_apy double precision NOT NULL,
  market text,
  source text NOT NULL DEFAULT 'kamino_api_backfill',
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reserve, observed_at)
)`;

type ParsedArgs = {
  end: Date;
  execute: boolean;
  market: string;
  reserve: string;
  start: Date;
};

type HistoryPoint = {
  observedAt: Date;
  status: string;
  supplyApy: number;
};

function printHelpAndExit(): never {
  console.log(`Usage:
  op run --env-file=.env.1password -- sh -c 'bun run scripts/backfill-reserve-apy-from-kamino-api.ts \\
      --market <MARKET_PUBKEY> --reserve <RESERVE_PUBKEY> \\
      --start 2026-06-25T00:00:00Z --end 2026-07-10T00:00:00Z [--execute]'

Required:
  --market <PUBKEY>    Kamino lending market of the reserve.
  --reserve <PUBKEY>   Reserve to backfill.
  --start <ISO>        Window start (inclusive).
  --end <ISO>          Window end (inclusive).

Options:
  --execute            Create the sidecar table if missing and upsert rows.
                       Omit for a dry-run report.

Environment:
  ${TIMESCALE_URL_ENV_NAME}   kamino_timescale database URL (required only with --execute).
`);
  process.exit(0);
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseDateArg(value: string, flag: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${flag} is not a valid ISO timestamp: ${value}`);
  }
  return parsed;
}

function parseArgs(argv = process.argv.slice(2)): ParsedArgs {
  let execute = false;
  let market: string | null = null;
  let reserve: string | null = null;
  let start: Date | null = null;
  let end: Date | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      case "--execute":
        execute = true;
        break;
      case "--market":
        market = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--reserve":
        reserve = readFlagValue(argv, index, arg);
        index += 1;
        break;
      case "--start":
        start = parseDateArg(readFlagValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--end":
        end = parseDateArg(readFlagValue(argv, index, arg), arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!market || !reserve || !start || !end) {
    throw new Error(
      "--market, --reserve, --start and --end are all required. See --help."
    );
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error("--end must be after --start.");
  }
  return { end, execute, market, reserve, start };
}

async function fetchHistory(args: ParsedArgs): Promise<HistoryPoint[]> {
  const url =
    `https://api.kamino.finance/kamino-market/${args.market}` +
    `/reserves/${args.reserve}/metrics/history` +
    `?env=mainnet-beta&start=${args.start.toISOString()}&end=${args.end.toISOString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Kamino history API responded ${response.status} for ${url}`
    );
  }
  const body = (await response.json()) as {
    history?: {
      metrics?: { status?: unknown; supplyInterestAPY?: unknown };
      timestamp?: unknown;
    }[];
    reserve?: unknown;
  };
  if (body.reserve !== args.reserve || !Array.isArray(body.history)) {
    throw new Error("Kamino history API returned an unexpected shape.");
  }

  const points: HistoryPoint[] = [];
  for (const entry of body.history) {
    const observedAt = new Date(String(entry.timestamp));
    const supplyApy = Number(entry.metrics?.supplyInterestAPY);
    if (Number.isNaN(observedAt.getTime()) || !Number.isFinite(supplyApy)) {
      throw new Error(
        `Malformed history point: ${JSON.stringify(entry).slice(0, 200)}`
      );
    }
    if (supplyApy < 0 || supplyApy >= MAX_SUPPLY_APY) {
      throw new Error(
        `supplyInterestAPY ${supplyApy} at ${observedAt.toISOString()} is outside [0, ${MAX_SUPPLY_APY}) — refusing to store a row the read path would ignore.`
      );
    }
    points.push({
      observedAt,
      status: String(entry.metrics?.status ?? "unknown"),
      supplyApy,
    });
  }
  points.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  return points;
}

function reportGaps(points: HistoryPoint[]): number {
  let maxGapMs = 0;
  for (let index = 1; index < points.length; index += 1) {
    const gap =
      points[index]!.observedAt.getTime() -
      points[index - 1]!.observedAt.getTime();
    maxGapMs = Math.max(maxGapMs, gap);
  }
  return maxGapMs;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const points = await fetchHistory(args);
  if (points.length === 0) {
    throw new Error("Kamino history API returned zero points for the window.");
  }

  const maxGapHours = reportGaps(points) / (60 * 60 * 1000);
  const statuses = [...new Set(points.map((point) => point.status))];
  console.log(`reserve:   ${args.reserve}`);
  console.log(`market:    ${args.market}`);
  console.log(`points:    ${points.length}`);
  console.log(
    `range:     ${points[0]!.observedAt.toISOString()} → ${points.at(-1)!.observedAt.toISOString()}`
  );
  console.log(`max gap:   ${maxGapHours.toFixed(2)}h`);
  console.log(`statuses:  ${statuses.join(", ")}`);
  console.log(
    `apy range: ${Math.min(...points.map((p) => p.supplyApy))} → ${Math.max(...points.map((p) => p.supplyApy))}`
  );
  if (maxGapHours > MAX_GAP_HOURS_TOLERATED) {
    throw new Error(
      `Max gap ${maxGapHours.toFixed(2)}h exceeds the ${MAX_GAP_HOURS_TOLERATED}h coverage tolerance — the backfill would not heal the earnings gate.`
    );
  }

  if (!args.execute) {
    console.log("\nDry-run only. Re-run with --execute to write.");
    return;
  }

  const databaseUrl = process.env[TIMESCALE_URL_ENV_NAME];
  if (!databaseUrl) {
    throw new Error(`${TIMESCALE_URL_ENV_NAME} is required with --execute.`);
  }
  const sql = neon(databaseUrl);
  await sql.query(CREATE_TABLE_SQL);
  const inserted = await sql.query(
    `INSERT INTO kamino.reserve_apy_backfill (reserve, observed_at, supply_apy, market)
     SELECT $1, observed_at, supply_apy, $2
     FROM unnest($3::timestamptz[], $4::double precision[]) AS t(observed_at, supply_apy)
     ON CONFLICT (reserve, observed_at) DO NOTHING
     RETURNING observed_at`,
    [
      args.reserve,
      args.market,
      points.map((point) => point.observedAt.toISOString()),
      points.map((point) => point.supplyApy),
    ]
  );
  console.log(
    `\nInserted ${inserted.length} new rows (${points.length - inserted.length} already present).`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
