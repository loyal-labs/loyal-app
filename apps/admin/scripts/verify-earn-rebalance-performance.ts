import { EARN_STABLECOIN_DESCRIPTORS } from "../src/lib/earn/stablecoin-monitor.shared";
import {
  buildRebalancePerformancePoints,
  parseRebalancePerformanceMint,
  summarizeRebalanceOpportunities,
  summarizeRebalancePerformance,
} from "../src/lib/earn/rebalance-performance.shared";

type Check = {
  detail: string;
  name: string;
  passed: boolean;
};

const checks: Check[] = [];

function check(name: string, passed: boolean, detail: string) {
  checks.push({ detail, name, passed });
}

const usdcMint = EARN_STABLECOIN_DESCRIPTORS.find(
  ({ symbol }) => symbol === "USDC"
)?.mint;
if (!usdcMint) {
  throw new Error("Canonical USDC mint is unavailable.");
}

const points = buildRebalancePerformancePoints({
  apyRows: [
    {
      bucketStartedAt: "2026-08-17T00:00:00.000Z",
      reserve: "reserve-a",
      supplyApyPercent: 4,
    },
    {
      bucketStartedAt: "2026-08-17T00:00:00.000Z",
      reserve: "reserve-b",
      supplyApyPercent: 8,
    },
    {
      bucketStartedAt: "2026-08-17T00:05:00.000Z",
      reserve: "reserve-a",
      supplyApyPercent: 9,
    },
    {
      bucketStartedAt: "2026-08-17T00:05:00.000Z",
      reserve: "reserve-b",
      supplyApyPercent: 5,
    },
    {
      bucketStartedAt: "2026-08-17T00:10:00.000Z",
      reserve: "reserve-a",
      supplyApyPercent: null,
    },
    {
      bucketStartedAt: "2026-08-17T00:15:00.000Z",
      reserve: "reserve-b",
      supplyApyPercent: 7,
    },
    {
      bucketStartedAt: "2026-08-17T00:15:00.000Z",
      reserve: "reserve-a",
      supplyApyPercent: 7,
    },
  ],
  bucketDurationMs: 5 * 60 * 1000,
  confirmedRebalances: [
    {
      confirmedAt: "2026-08-17T00:06:00.000Z",
      id: "decision-1",
    },
    {
      confirmedAt: "2026-08-17T00:07:00.000Z",
      id: "decision-1",
    },
  ],
  fleetAumRows: [
    {
      aumRaw: BigInt(75),
      bucketStartedAt: "2026-08-17T00:00:00.000Z",
      reserve: "reserve-a",
    },
    {
      aumRaw: BigInt(25),
      bucketStartedAt: "2026-08-17T00:00:00.000Z",
      reserve: "reserve-b",
    },
    {
      aumRaw: BigInt(10),
      bucketStartedAt: "2026-08-17T00:05:00.000Z",
      reserve: "reserve-a",
    },
    {
      aumRaw: BigInt(30),
      bucketStartedAt: "2026-08-17T00:05:00.000Z",
      reserve: "reserve-b",
    },
    {
      aumRaw: BigInt(60),
      bucketStartedAt: "2026-08-17T00:10:00.000Z",
      reserve: "reserve-a",
    },
  ],
});

check(
  "fleet-weighted APY uses reserve AUM",
  points[0]?.fleetWeightedApyPercent === 5 &&
    points[1]?.fleetWeightedApyPercent === 6,
  JSON.stringify(points)
);
check(
  "best-reserve share uses known fleet AUM",
  points[0]?.bestReserve === "reserve-b" &&
    points[0]?.fleetShareInBestReservePercent === 25 &&
    points[1]?.bestReserve === "reserve-a" &&
    points[1]?.fleetShareInBestReservePercent === 25,
  JSON.stringify(points)
);
check(
  "confirmed markers are bucketed once",
  points[0]?.confirmedRebalanceCount === 0 &&
    points[1]?.confirmedRebalanceCount === 1,
  JSON.stringify(points)
);
check(
  "missing usable APY stays unavailable",
  points[2]?.bestObservedApyPercent === null &&
    points[2]?.fleetWeightedApyPercent === null &&
    points[2]?.fleetShareInBestReservePercent === null,
  JSON.stringify(points)
);
check(
  "best reserve ties are deterministic and no-AUM buckets stay unavailable",
  points[3]?.bestReserve === "reserve-a" &&
    points[3]?.bestObservedApyPercent === 7 &&
    points[3]?.knownFleetAumRaw === "0" &&
    points[3]?.fleetWeightedApyPercent === null &&
    points[3]?.fleetShareInBestReservePercent === null,
  JSON.stringify(points)
);

const performance = summarizeRebalancePerformance(points);
check(
  "AUM-time excludes unknown APY coverage",
  performance.aumTimeInBestReservePercent === 25 &&
    performance.knownAumTimeRaw === "42000000" &&
    performance.totalAumTimeRaw === "60000000" &&
    performance.coveragePercent === 70,
  JSON.stringify(performance)
);

const opportunities = summarizeRebalanceOpportunities([
  { opportunityId: "confirmed", outcome: "pending" },
  { opportunityId: "confirmed", outcome: "confirmed" },
  { opportunityId: "confirmed", outcome: "confirmed" },
  { opportunityId: "failed", outcome: "failed" },
  { opportunityId: "failed", outcome: "pending" },
  { opportunityId: "pending", outcome: "pending" },
]);
check(
  "opportunity outcomes are distinct and mutually exclusive",
  opportunities.qualified === 3 &&
    opportunities.confirmed === 1 &&
    opportunities.failed === 1 &&
    opportunities.pending === 1 &&
    opportunities.confirmed + opportunities.failed + opportunities.pending ===
      opportunities.qualified,
  JSON.stringify(opportunities)
);

check(
  "canonical mint validation rejects aggregate and unknown values",
  parseRebalancePerformanceMint(usdcMint) === usdcMint &&
    parseRebalancePerformanceMint("all") === null &&
    parseRebalancePerformanceMint("unknown") === null &&
    parseRebalancePerformanceMint(null) === null,
  "only a canonical mint address may pass"
);

for (const result of checks) {
  console.log(
    `${result.passed ? "PASS" : "FAIL"}: ${result.name}${
      result.passed ? "" : ` - ${result.detail}`
    }`
  );
}

if (checks.some(({ passed }) => !passed)) {
  console.log("VERDICT: FAIL");
  process.exit(1);
}

console.log("VERDICT: PASS");
