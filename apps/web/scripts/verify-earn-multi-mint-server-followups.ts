#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dir, "../../..");
const appTests = [
  "apps/web/src/lib/kamino/timescale-reserve-client.server.test.ts",
  "apps/web/src/lib/yield-optimization/earn-withdraw-confirm.server.test.ts",
  "apps/web/src/lib/yield-optimization/earn-deposit-reconcile.server.test.ts",
  "apps/web/src/lib/yield-optimization/earn-full-exit-zero-proof.server.test.ts",
] as const;
const packageTest = "packages/smart-account-vaults/src/client.test.ts";
const requiredTests = [...appTests, packageTest] as const;

const failures: string[] = [];
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  const suffix = detail ? ` -> ${detail}` : "";
  console.log(`  FAIL ${name}${suffix}`);
  failures.push(`${name}${suffix}`);
}

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

console.log("ASK-2105 multi-mint server verifier\n");

for (const testFile of requiredTests) {
  check(
    `required behavioral test exists: ${testFile}`,
    existsSync(resolve(repoRoot, testFile))
  );
}

const reserveSource = source(
  "apps/web/src/lib/kamino/timescale-reserve-client.server.ts"
);
const eligibleReserveMethod = reserveSource.slice(
  reserveSource.lastIndexOf("async getCurrentEligibleSafeReserves")
);
check(
  "reserve picker consumes verified current state",
  reserveSource.includes("latestVerifiedReserveUpdates") &&
    reserveSource.includes("verifiedAt")
);
check(
  "reserve freshness matches the routing hard-expiry contract",
  reserveSource.includes("VERIFIED_RESERVE_MAX_AGE_MS = 240 * 1000") &&
    eligibleReserveMethod.includes(
      "lte(latestVerifiedReserveUpdates.verifiedAt, now)"
    )
);
check(
  "reserve picker no longer gates on transient stale bit",
  !eligibleReserveMethod.includes("reserveLastUpdateStale")
);

const withdrawSource = source(
  "apps/web/src/lib/yield-optimization/earn-withdraw-confirm.server.ts"
);
check(
  "withdraw canonicalization branches on source type",
  withdrawSource.includes('sourceType === "idle"') &&
    withdrawSource.includes('sourceType === "reserve"')
);
check(
  "withdraw confirmation does not re-run current Safe routing eligibility",
  !withdrawSource.includes("assertSafeEarnReserveMetadata")
);

const reconcileSource = source(
  "apps/web/src/lib/yield-optimization/earn-deposit-reconcile.server.ts"
);
check(
  "deposit recovery is not restricted to USDC",
  !reconcileSource.includes("getKaminoUsdcEarnTargetForCluster") &&
    !reconcileSource.includes("targetHolding.liquidityMint !== usdcMint")
);
check(
  "deposit recovery does not choose the largest current holding",
  !reconcileSource.includes("sortedReserveHoldings[0]")
);

const vaultSource = source("packages/smart-account-vaults/src/client.ts");
check(
  "vault inventory reads both token programs",
  /getTokenAccountsByOwner[\s\S]*TOKEN_PROGRAM_ID[\s\S]*TOKEN_2022_PROGRAM_ID/.test(
    vaultSource
  )
);

if (failures.length === 0) {
  const appResult = spawnSync("bun", ["test", ...appTests], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  check("focused web behavioral suite passes", appResult.status === 0);
  const packageResult = spawnSync(
    "bun",
    ["test", packageTest, "-t", "multi-program Earn cleanup"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit",
    }
  );
  check(
    "focused smart-account cleanup suite passes",
    packageResult.status === 0
  );
}

console.log(`\n${checks - failures.length}/${checks} checks passed.`);
if (failures.length > 0) {
  console.error("\nVERDICT: FAIL");
  process.exitCode = 1;
} else {
  console.log("\nVERDICT: PASS (local required checks; live evidence pending)");
}
