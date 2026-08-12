/**
 * Verifies that the restructured `getAutodepositTimeSeries` query is both
 * equivalent to and faster than the version it replaces (ASK-1971).
 *
 * Both variants are extracted from source rather than pasted here, so the
 * script always measures what actually ships:
 *   - candidate: the working tree copy of rebalance-data.ts
 *   - baseline:  the same file at --baseline-ref (default origin/main)
 *
 * Equivalence is checked inside a single REPEATABLE READ transaction, so both
 * variants observe one snapshot and one now() — the ranges are relative to
 * now() and the underlying tables are written continuously, so comparing
 * across transactions would flake.
 *
 * Usage:
 *   NEON_DATABASE_URL=postgres://... bun scripts/verify-autodeposit-timeseries-query.ts
 *   ... --runs 7 --baseline-ref origin/main --min-speedup 2
 */

const ROOT = new URL("../", import.meta.url);
const SOURCE_PATH =
  "apps/admin/src/app/(admin)/earn/rebalance/rebalance-data.ts";
const FUNCTION_NAME = "getAutodepositTimeSeries";

type Variant = "baseline" | "candidate";

type Args = {
  baselineRef: string;
  minSpeedup: number;
  runs: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baselineRef: "origin/main",
    minSpeedup: 2,
    runs: 5,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (flag === "--baseline-ref" && value) {
      args.baselineRef = value;
      index += 1;
    } else if (flag === "--runs" && value) {
      args.runs = Number.parseInt(value, 10);
      index += 1;
    } else if (flag === "--min-speedup" && value) {
      args.minSpeedup = Number.parseFloat(value);
      index += 1;
    } else if (flag === "--help" || flag === "-h") {
      console.log(
        "Usage: NEON_DATABASE_URL=... bun scripts/verify-autodeposit-timeseries-query.ts " +
          "[--runs N] [--baseline-ref REF] [--min-speedup X]"
      );
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.runs) || args.runs < 1) {
    throw new Error("--runs must be a positive integer.");
  }
  if (!Number.isFinite(args.minSpeedup) || args.minSpeedup <= 0) {
    throw new Error("--min-speedup must be a positive number.");
  }

  return args;
}

/**
 * Pulls the single template literal out of the named query function. The query
 * is a plain literal with no ${} interpolation, so a backtick scan is enough;
 * we assert that explicitly rather than assuming it.
 */
function extractQuery(source: string, origin: string): string {
  const functionIndex = source.indexOf(
    `export async function ${FUNCTION_NAME}(`
  );
  if (functionIndex === -1) {
    throw new Error(`Could not find ${FUNCTION_NAME} in ${origin}.`);
  }

  const openIndex = source.indexOf("`", functionIndex);
  if (openIndex === -1) {
    throw new Error(`Could not find opening backtick for ${origin}.`);
  }

  const closeIndex = source.indexOf("`", openIndex + 1);
  if (closeIndex === -1) {
    throw new Error(`Could not find closing backtick for ${origin}.`);
  }

  const query = source.slice(openIndex + 1, closeIndex);
  if (query.includes("${")) {
    throw new Error(
      `Query in ${origin} contains interpolation; this extractor only handles ` +
        "static literals."
    );
  }
  if (!query.includes("balance_sweep_lot_claims")) {
    throw new Error(
      `Extracted query from ${origin} does not look like the autodeposit ` +
        "time series query."
    );
  }

  return query.trim();
}

function pgEnv(): Record<string, string> {
  const databaseUrl = process.env.NEON_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "NEON_DATABASE_URL is required (the yield-optimization Neon database)."
    );
  }

  const parsed = new URL(databaseUrl);
  return {
    ...process.env,
    PGDATABASE: parsed.pathname.replace(/^\//, ""),
    PGHOST: parsed.hostname,
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGPORT: parsed.port || "5432",
    PGSSLMODE: parsed.searchParams.get("sslmode") ?? "require",
    PGUSER: decodeURIComponent(parsed.username),
  } as Record<string, string>;
}

async function runPsql(script: string): Promise<string> {
  const proc = Bun.spawn(["psql", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|"], {
    env: pgEnv(),
    stderr: "pipe",
    stdin: new TextEncoder().encode(script),
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`psql exited ${exitCode}: ${stderr.trim()}`);
  }

  return stdout;
}

async function gitShow(ref: string, path: string): Promise<string> {
  const proc = Bun.spawn(["git", "show", `${ref}:${path}`], {
    cwd: new URL(ROOT).pathname,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`git show ${ref}:${path} failed: ${stderr.trim()}`);
  }

  return stdout;
}

/**
 * Runs both variants against one snapshot and one now(), so any difference in
 * output is a real semantic difference rather than concurrent writes.
 */
async function compareResults(
  baseline: string,
  candidate: string
): Promise<{
  baselineRows: string[];
  candidateRows: string[];
  equal: boolean;
}> {
  const output = await runPsql(
    [
      "BEGIN ISOLATION LEVEL REPEATABLE READ;",
      "\\echo :::BASELINE:::",
      `${baseline};`,
      "\\echo :::CANDIDATE:::",
      `${candidate};`,
      "COMMIT;",
    ].join("\n")
  );

  const baselineMarker = output.indexOf(":::BASELINE:::");
  const candidateMarker = output.indexOf(":::CANDIDATE:::");
  if (baselineMarker === -1 || candidateMarker === -1) {
    throw new Error("Could not locate result markers in psql output.");
  }

  // psql echoes transaction command tags (BEGIN/COMMIT) on stdout alongside
  // the tuples; they are not result rows.
  const commandTags = new Set(["BEGIN", "COMMIT", "ROLLBACK"]);
  const toRows = (chunk: string) =>
    chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 && !line.startsWith(":::") && !commandTags.has(line)
      );

  const baselineRows = toRows(
    output.slice(baselineMarker + ":::BASELINE:::".length, candidateMarker)
  );
  const candidateRows = toRows(
    output.slice(candidateMarker + ":::CANDIDATE:::".length)
  );

  const equal =
    baselineRows.length === candidateRows.length &&
    baselineRows.every((row, index) => row === candidateRows[index]);

  return { baselineRows, candidateRows, equal };
}

/**
 * Server-side execution time via EXPLAIN ANALYZE, which isolates query cost
 * from network latency to Neon. TIMING OFF keeps per-node instrumentation from
 * inflating the total.
 */
async function measureOnce(query: string): Promise<number> {
  const output = await runPsql(
    `EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON, FORMAT JSON) ${query};`
  );

  const parsed = JSON.parse(output.trim()) as Array<{
    "Execution Time": number;
    "Planning Time": number;
  }>;
  const plan = parsed[0];
  if (!plan || typeof plan["Execution Time"] !== "number") {
    throw new Error("Could not read Execution Time from EXPLAIN output.");
  }

  return plan["Execution Time"] + (plan["Planning Time"] ?? 0);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const candidateSource = await Bun.file(new URL(SOURCE_PATH, ROOT)).text();
  const baselineSource = await gitShow(args.baselineRef, SOURCE_PATH);

  const candidate = extractQuery(candidateSource, "working tree");
  const baseline = extractQuery(baselineSource, args.baselineRef);

  console.log(`Baseline ref : ${args.baselineRef}`);
  console.log(`Runs         : ${args.runs} per variant (alternating)`);
  console.log(`Min speedup  : ${args.minSpeedup}x\n`);

  if (baseline === candidate) {
    console.error(
      `FAIL: the query is byte-identical to ${args.baselineRef}; ` +
        "there is nothing to verify."
    );
    process.exit(1);
  }

  // Warm the cache once per variant so the first measured run of whichever
  // variant happens to go first is not penalised for cold buffers.
  await measureOnce(baseline);
  await measureOnce(candidate);

  const timings: Record<Variant, number[]> = { baseline: [], candidate: [] };
  for (let run = 0; run < args.runs; run += 1) {
    // Alternate order each iteration so neither variant systematically
    // benefits from the other having just warmed shared buffers.
    const order: Variant[] =
      run % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];

    for (const variant of order) {
      const elapsed = await measureOnce(
        variant === "baseline" ? baseline : candidate
      );
      timings[variant].push(elapsed);
      console.log(`  run ${run + 1} ${variant.padEnd(9)} ${formatMs(elapsed)}`);
    }
  }

  const baselineMedian = median(timings.baseline);
  const candidateMedian = median(timings.candidate);
  const speedup = baselineMedian / candidateMedian;

  console.log("\nEquivalence (single REPEATABLE READ snapshot)");
  const { baselineRows, candidateRows, equal } = await compareResults(
    baseline,
    candidate
  );
  console.log(
    `  baseline rows : ${baselineRows.length}\n` +
      `  candidate rows: ${candidateRows.length}\n` +
      `  identical     : ${equal ? "yes" : "NO"}`
  );

  if (!equal) {
    const limit = Math.max(baselineRows.length, candidateRows.length);
    for (let index = 0; index < limit; index += 1) {
      if (baselineRows[index] !== candidateRows[index]) {
        console.error(
          `\n  first difference at row ${index}:\n` +
            `    baseline : ${baselineRows[index] ?? "<missing>"}\n` +
            `    candidate: ${candidateRows[index] ?? "<missing>"}`
        );
        break;
      }
    }
  }

  console.log("\nTiming (planning + execution, server side)");
  for (const variant of ["baseline", "candidate"] as Variant[]) {
    const values = timings[variant];
    console.log(
      `  ${variant.padEnd(9)} median ${formatMs(median(values))}  ` +
        `min ${formatMs(Math.min(...values))}  ` +
        `max ${formatMs(Math.max(...values))}`
    );
  }
  console.log(`  speedup   ${speedup.toFixed(2)}x`);

  const fastEnough = speedup >= args.minSpeedup;
  console.log(
    `\n${equal && fastEnough ? "PASS" : "FAIL"}: ` +
      `equivalent=${equal}, speedup=${speedup.toFixed(2)}x ` +
      `(required >= ${args.minSpeedup}x)`
  );

  process.exit(equal && fastEnough ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
