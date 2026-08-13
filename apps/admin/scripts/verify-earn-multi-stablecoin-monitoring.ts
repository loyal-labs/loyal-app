import {
  deriveStablecoinHealthWarnings,
  EARN_STABLECOIN_DESCRIPTORS,
} from "../src/lib/earn/stablecoin-monitor.shared";

type Check = {
  detail: string;
  name: string;
  passed: boolean;
};

const ADMIN_ROOT = new URL("../", import.meta.url);
const REPO_ROOT = new URL("../../../", import.meta.url);
const checks: Check[] = [];

function check(name: string, passed: boolean, detail: string) {
  checks.push({ detail, name, passed });
}

function attributeReserveHoldingsByMint(args: {
  positions: readonly { id: string; depositMint: string }[];
  reserves: readonly { amountRaw: bigint; liquidityMint: string }[];
}) {
  return args.positions.map((position) => ({
    amountRaw: args.reserves
      .filter((reserve) => reserve.liquidityMint === position.depositMint)
      .reduce((total, reserve) => total + reserve.amountRaw, BigInt(0)),
    positionId: position.id,
  }));
}

async function read(relativePath: string, root = ADMIN_ROOT) {
  return Bun.file(new URL(relativePath, root)).text();
}

const expectedSymbols = ["CASH", "USDG", "PYUSD", "USDC", "USDT", "USDS"];
const actualSymbols = EARN_STABLECOIN_DESCRIPTORS.map(({ symbol }) => symbol);
check(
  "canonical six-mint universe",
  JSON.stringify(actualSymbols) === JSON.stringify(expectedSymbols) &&
    new Set(EARN_STABLECOIN_DESCRIPTORS.map(({ mint }) => mint)).size === 6,
  `expected ${expectedSymbols.join(", ")}; received ${actualSymbols.join(", ")}`
);

const cashMint = EARN_STABLECOIN_DESCRIPTORS.find(
  ({ symbol }) => symbol === "CASH"
)?.mint;
const usdtMint = EARN_STABLECOIN_DESCRIPTORS.find(
  ({ symbol }) => symbol === "USDT"
)?.mint;
if (!(cashMint && usdtMint)) {
  throw new Error("Canonical CASH or USDT mint is unavailable.");
}

const attributed = attributeReserveHoldingsByMint({
  positions: [
    { depositMint: cashMint, id: "cash-position" },
    { depositMint: usdtMint, id: "usdt-position" },
  ],
  reserves: [
    { amountRaw: BigInt(100), liquidityMint: cashMint },
    { amountRaw: BigInt(250), liquidityMint: usdtMint },
  ],
});
check(
  "adversarial two-mint attribution",
  attributed[0]?.amountRaw === BigInt(100) &&
    attributed[1]?.amountRaw === BigInt(250) &&
    attributed.reduce((sum, row) => sum + row.amountRaw, BigInt(0)) ===
      BigInt(350),
  `received ${attributed
    .map(({ amountRaw }) => amountRaw.toString())
    .join(", ")}`
);

const warningCodes = new Set(
  deriveStablecoinHealthWarnings({
    appRollout: "enabled",
    cycleHealth: "stale",
    eligibleReserveCount: 0,
    projectionDeltaRaw: BigInt(1),
    reconciliationHealth: "failed",
    symbol: actualSymbols[0],
  }).map(({ code }) => code)
);
check(
  "deterministic invariant warnings",
  [
    "cycle_stale",
    "no_eligible_reserve",
    "projection_mismatch",
    "reconciliation_failed",
  ].every((code) => warningCodes.has(code as never)) &&
    !warningCodes.has("no_profitable_opportunity" as never),
  `received ${[...warningCodes].join(", ")}`
);

const adoptionWarnings = deriveStablecoinHealthWarnings({
  appRollout: "enabled",
  cycleHealth: "healthy",
  eligibleReserveCount: 1,
  projectionDeltaRaw: BigInt(0),
  reconciliationHealth: "adoption",
  symbol: actualSymbols[0],
});
check(
  "reconciliation adoption is distinct",
  adoptionWarnings.some(({ code }) => code === "reconciliation_adoption"),
  adoptionWarnings.map(({ code }) => code).join(", ")
);

const earnDataSource = await read("src/app/(admin)/earn/earn-data.ts");
check(
  "mint-safe reserve SQL join",
  earnDataSource.includes("AND reserve.liquidity_mint = active.deposit_mint"),
  "reserve holdings must join on vault_id and liquidity_mint"
);
check(
  "confirmed flow and positions carry mint",
  earnDataSource.includes("deposit.deposit_mint AS liquidity_mint") &&
    earnDataSource.includes("withdrawal.liquidity_mint") &&
    earnDataSource.includes("depositMint: row.deposit_mint") &&
    earnDataSource.includes("stablecoins = EARN_STABLECOIN_DESCRIPTORS.map"),
  "deposit, withdrawal, position, and per-mint summary propagation"
);

const reserveSource = await read(
  "src/lib/kamino/timescale-reserve-client.server.ts"
);
const classifyBody = reserveSource.slice(
  reserveSource.indexOf("function classifyCandidate"),
  reserveSource.indexOf("function compareStrings")
);
check(
  "verified reserve eligibility contract",
  reserveSource.includes("VERIFIED_RESERVE_MAX_AGE_MS = 240 * 1000") &&
    reserveSource.includes("kamino.latest_verified_reserve_updates") &&
    reserveSource.includes("updates.verified_at >=") &&
    reserveSource.includes("EARN_STABLECOIN_DESCRIPTORS.map") &&
    !classifyBody.includes("reserveLastUpdateStale") &&
    !reserveSource.includes("USDC_LIQUIDITY_MINT"),
  "eligibility must use the six-mint verified view and 240-second age"
);

const earnPageSource = await read("src/app/(admin)/earn/page.tsx");
check(
  "operator health matrix and filters",
  earnPageSource.includes("Stablecoin health") &&
    earnPageSource.includes("StablecoinFilter") &&
    earnPageSource.includes("Eligible / best APY") &&
    earnPageSource.includes("30d in / out") &&
    earnPageSource.includes("Latest rebalance") &&
    earnPageSource.includes("Warnings"),
  "Earn UI must expose the six-row operator matrix and mint filter"
);

const rolloutSource = await read("src/lib/earn/stablecoin-rollout.server.ts");
const adminConfigSource = await read("src/lib/core/config/server.ts");
const appConfigRoute = await read(
  "apps/web/src/app/api/earn/config/route.ts",
  REPO_ROOT
);
check(
  "canonical router universe and authoritative app rollout",
  rolloutSource.includes("/api/earn/config") &&
    appConfigRoute.includes("getPublicEnv().earnEnabledStablecoins") &&
    !adminConfigSource.includes("EARN_ROUTER_ENABLED_STABLE_MINTS") &&
    !rolloutSource.includes("routerEnabled") &&
    !rolloutSource.includes("routerSource") &&
    !earnPageSource.includes("Router "),
  "router monitoring uses the canonical six-mint registry without duplicate rollout configuration"
);

const rebalanceDataSource = await read(
  "src/app/(admin)/earn/rebalance/rebalance-data.ts"
);
const rebalanceClientSource = await read(
  "src/app/(admin)/earn/rebalance/rebalance-monitor-client.tsx"
);
const executedSource = await read(
  "src/app/(admin)/earn/rebalance/executed-earn-rebalances-chart.tsx"
);
const latencyDataSource = await read(
  "src/app/(admin)/metrics/earn-rebalance-latency-data.ts"
);
const latencyClientSource = await read(
  "src/app/(admin)/metrics/earn-rebalance-latency.tsx"
);
check(
  "rebalance mint propagation",
  (rebalanceDataSource.match(/liquidity_mint/g)?.length ?? 0) >= 12 &&
    rebalanceClientSource.includes("row.liquidityMint") &&
    executedSource.includes("point.liquidityMint") &&
    latencyDataSource.includes("valid.liquidity_mint") &&
    latencyClientSource.includes("point.liquidityMint"),
  "routes, decisions, audit, executions, and latency must render liquidity mint"
);

const misleadingLabelPattern = /format(?:Compact)?Usdc|Idle USDC|\} USDC`/;
check(
  "honest cross-mint labels",
  !misleadingLabelPattern.test(earnPageSource) &&
    !misleadingLabelPattern.test(rebalanceClientSource) &&
    !misleadingLabelPattern.test(executedSource) &&
    earnPageSource.includes("nominal USD"),
  "cross-mint values must not be labelled USDC"
);

for (const result of checks) {
  console.log(`${result.passed ? "PASS" : "FAIL"}: ${result.name}`);
  if (!result.passed) {
    console.log(`  ${result.detail}`);
  }
}

const failed = checks.filter(({ passed }) => !passed);
console.log(
  failed.length === 0
    ? `OVERALL PASS (${checks.length}/${checks.length})`
    : `OVERALL FAIL (${checks.length - failed.length}/${checks.length})`
);

if (failed.length > 0) {
  process.exit(1);
}
