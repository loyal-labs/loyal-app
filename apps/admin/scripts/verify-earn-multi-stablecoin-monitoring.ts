import {
  deriveStablecoinHealthWarnings,
  EARN_STABLECOIN_DESCRIPTORS,
} from "../src/lib/earn/stablecoin-monitor.shared";
import {
  summarizeSafeReserveEligibilityByMint,
  type SafeReserveApyStatusRow,
} from "../src/lib/kamino/timescale-reserve-monitor.shared";

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

function statusRow(
  liquidityMint: string,
  status: SafeReserveApyStatusRow["status"],
  supplyApyPercent: number | null = null
): SafeReserveApyStatusRow {
  return {
    average24hApyPercent: null,
    average7dApyPercent: null,
    latestObservedAt:
      status === "no-current-row" ? null : "2026-08-14T00:00:00.000Z",
    liquidityMint,
    market: `market-${status}`,
    marketName: `Market ${status}`,
    reserve: `reserve-${liquidityMint}-${status}`,
    status,
    supplyApyPercent,
    symbol: null,
    totalSupplyUsdEstimate: null,
  };
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

const cashDescriptor = EARN_STABLECOIN_DESCRIPTORS.find(
  ({ symbol }) => String(symbol) === "CASH"
);
const usdcDescriptor = EARN_STABLECOIN_DESCRIPTORS.find(
  ({ symbol }) => String(symbol) === "USDC"
);
const usdtDescriptor = EARN_STABLECOIN_DESCRIPTORS.find(
  ({ symbol }) => String(symbol) === "USDT"
);
if (!(cashDescriptor && usdcDescriptor && usdtDescriptor)) {
  throw new Error("Canonical CASH, USDC, or USDT mint is unavailable.");
}
const cashMint = cashDescriptor.mint;
const usdcMint = usdcDescriptor.mint;
const usdtMint = usdtDescriptor.mint;

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

const ineligibleWarnings = deriveStablecoinHealthWarnings({
  eligibleReserveCount: 0,
  eligibilityReason: "2 without a fresh verified row",
  symbol: cashDescriptor.symbol,
});
const healthyWarnings = deriveStablecoinHealthWarnings({
  eligibleReserveCount: 1,
  eligibilityReason: "1 eligible Safe reserve",
  symbol: usdcDescriptor.symbol,
});
check(
  "warnings use observed eligibility only",
  ineligibleWarnings.length === 1 &&
    ineligibleWarnings[0]?.code === "no_eligible_reserve" &&
    ineligibleWarnings[0]?.message.includes("without a fresh verified row") &&
    healthyWarnings.length === 0,
  `ineligible=${ineligibleWarnings
    .map(({ code }) => code)
    .join(",")}; healthy=${healthyWarnings.length}`
);

const eligibilityFixture = summarizeSafeReserveEligibilityByMint({
  stablecoins: EARN_STABLECOIN_DESCRIPTORS,
  statuses: [
    statusRow(cashMint, "no-current-row"),
    statusRow(usdcMint, "eligible", 4.25),
    statusRow(usdcMint, "eligible", 5.75),
    statusRow(usdtMint, "below-liquidity"),
    statusRow(usdtMint, "apy-out-of-range"),
  ],
});
const cashEligibility = eligibilityFixture.find(
  ({ liquidityMint }) => liquidityMint === cashMint
);
const usdcEligibility = eligibilityFixture.find(
  ({ liquidityMint }) => liquidityMint === usdcMint
);
const usdsEligibility = eligibilityFixture.find(
  ({ symbol }) => symbol === "USDS"
);
check(
  "explicit per-mint eligibility reasons",
  cashEligibility?.status === "no-current-row" &&
    cashEligibility.reason.includes("without a fresh verified row") &&
    usdcEligibility?.eligibleReserveCount === 2 &&
    usdcEligibility.bestSupplyApyPercent === 5.75 &&
    usdsEligibility?.status === "no-supported-reserve" &&
    usdsEligibility.reason === "No supported Safe reserve",
  JSON.stringify({ cashEligibility, usdcEligibility, usdsEligibility })
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
const currentStatusLoaderUses =
  reserveSource.match(/loadCurrentReserveStatuses\(/g)?.length ?? 0;
check(
  "single database-clock eligibility implementation",
  reserveSource.includes("VERIFIED_RESERVE_MAX_AGE_MS = 240 * 1000") &&
    reserveSource.includes("kamino.latest_verified_reserve_updates") &&
    reserveSource.includes("now() - make_interval") &&
    reserveSource.includes("updates.verified_at <= now()") &&
    reserveSource.includes("summarizeSafeReserveEligibilityByMint") &&
    currentStatusLoaderUses >= 3 &&
    !reserveSource.includes("verifiedUntil") &&
    !reserveSource.includes("VerifiedReserveMintSummarySqlRow"),
  `shared current status loader uses=${currentStatusLoaderUses}`
);

const earnPageSource = await read("src/app/(admin)/earn/page.tsx");
const monitoringSource = await read(
  "src/app/(admin)/earn/earn-stablecoin-monitoring.ts"
);
const sharedHealthSource = await read(
  "src/lib/earn/stablecoin-monitor.shared.ts"
);
const removedWarningPattern =
  /telemetry_unavailable|projection_mismatch|cycle_stale|reconciliation_(?:adoption|failed)/;
check(
  "observed-only health matrix",
  earnPageSource.includes("Stablecoin health") &&
    earnPageSource.includes("StablecoinFilter") &&
    earnPageSource.includes("Eligible / best APY") &&
    earnPageSource.includes("30d in / out") &&
    earnPageSource.includes("Latest rebalance") &&
    earnPageSource.includes("row.eligibilityReason") &&
    !earnPageSource.includes("App rollout") &&
    !monitoringSource.includes("appRollout") &&
    !monitoringSource.includes('CycleHealth = "unknown"') &&
    !monitoringSource.includes('ReconciliationHealth = "unknown"') &&
    !removedWarningPattern.test(sharedHealthSource),
  "health UI must show observed data without rollout or synthetic telemetry"
);

const rolloutFile = Bun.file(
  new URL("src/lib/earn/stablecoin-rollout.server.ts", ADMIN_ROOT)
);
const appConfigRoute = Bun.file(
  new URL("apps/web/src/app/api/earn/config/route.ts", REPO_ROOT)
);
check(
  "obsolete rollout plumbing removed",
  !(await rolloutFile.exists()) &&
    !(await appConfigRoute.exists()) &&
    !sharedHealthSource.includes("RolloutState") &&
    !sharedHealthSource.includes("parseStablecoinSymbols"),
  "no admin-to-web rollout fetch, endpoint, parser, or state remains"
);
check(
  "projection delta is diagnostic only",
  earnPageSource.includes("Pointer delta") &&
    !sharedHealthSource.includes("projectionDeltaRaw") &&
    !sharedHealthSource.includes("projection_mismatch"),
  "pointer delta stays visible but nonzero alone is not an alarm"
);

const rebalanceClientSource = await read(
  "src/app/(admin)/earn/rebalance/rebalance-monitor-client.tsx"
);
check(
  "single-mint chart default and unique labels",
  rebalanceClientSource.includes('useState("USDC")') &&
    rebalanceClientSource.includes('<SelectItem value="all">') &&
    reserveSource.includes("`${symbol} · ${market} · ${reserve}`"),
  "chart must default to USDC while preserving deliberate All and unique series identity"
);

const rebalanceDataSource = await read(
  "src/app/(admin)/earn/rebalance/rebalance-data.ts"
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
