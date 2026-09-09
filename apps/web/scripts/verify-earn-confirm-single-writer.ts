#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const webRoot = resolve(repoRoot, "apps/web");
const apiRoot = "src/app/api/smart-accounts";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a path`);
  return value;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// Deployment/API boundary guard, not a substitute for behavioral or chain tests.
const retired = [
  "position/reconcile",
  "deposits/prepare",
  "deposits/confirm",
  "withdrawals/prepare",
  "withdrawals/confirm",
  "withdrawals/cleanup/prepare",
  "withdrawals/cleanup/confirm",
  "policies/prepare",
  "policies/confirm",
  "autodeposit/setup/prepare",
  "autodeposit/setup/confirm",
  "autodeposit/close/prepare",
  "autodeposit/close/confirm",
  "policy-refunds/prepare",
];
for (const route of retired) {
  assert(
    !existsSync(
      resolve(webRoot, apiRoot, "yield-optimization", route, "route.ts")
    ),
    `Retired web transaction route is exposed: ${route}`
  );
}
for (const route of [
  "deposit/prepare",
  "deposit/confirm",
  "withdraw/prepare",
  "withdraw/confirm",
  "withdraw/cleanup/prepare-context",
  "withdraw/cleanup/confirm",
  "autodeposit/setup/prepare",
  "autodeposit/setup/confirm",
  "autodeposit/close/prepare",
  "autodeposit/close/confirm",
]) {
  assert(
    existsSync(resolve(webRoot, apiRoot, "mobile/earn", route, "route.ts")),
    `Installed-mobile compatibility route is missing: ${route}`
  );
}
const readRoutes = [
  "yield-optimization/position",
  "yield-optimization/earn-state",
  "mobile/earn/state",
  "mobile/earn/holdings",
  "mobile/earn/deposit/prepare-context",
  "mobile/earn/transactions",
  "earn-transactions",
];
for (const route of readRoutes) {
  const source = readFileSync(
    resolve(webRoot, apiRoot, route, "route.ts"),
    "utf8"
  );
  assert(
    !/findReconciledActiveYieldPositionForVault|syncConfirmedRebalanceHoldingEventsForVault|reconcileEarnVaultPosition/.test(
      source
    ),
    `Supported read route imports legacy projection repair: ${route}`
  );
}
console.info(
  "PASS: retired web routes, retained installed-mobile compatibility, supported read boundary"
);

// Separate processes isolate existing module mocks. These protect ownership,
// confirmation/no-write behavior, full-exit zero proof, and RPC slot fences.
for (const file of [
  "earn-confirm-single-writer.server.test.ts",
  "earn-withdraw-confirm.server.test.ts",
  "earn-withdraw-confirm.test.ts",
  "earn-full-exit-zero-proof.server.test.ts",
  "earn-rpc-holdings.client.test.ts",
]) {
  const result = spawnSync(
    "bun",
    ["test", `src/lib/yield-optimization/${file}`],
    {
      cwd: webRoot,
      stdio: "inherit",
    }
  );
  assert(result.status === 0, `Behavioral verification failed: ${file}`);
}

for (const verifier of [
  "verify-earn-read-recovery.cjs",
  "verify-earn-mobile-realtime.cjs",
  "verify-earn-prepare-signer.cjs",
]) {
  const result = spawnSync("node", [resolve(repoRoot, "scripts", verifier)], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  assert(
    result.status === 0,
    `Inert money-state/replay verification failed: ${verifier}`
  );
}

if (process.argv.includes("--cross-repo-e2e")) {
  const routingRoot = resolve(
    option("--routing-root") ?? resolve(repoRoot, "../loyal-yield-routing")
  );
  const appRoot = resolve(option("--client-app-root") ?? repoRoot);
  const script = resolve(appRoot, "scripts/verify-earn-local-e2e.sh");
  assert(existsSync(script), `App-owned verifier missing: ${script}`);
  const result = spawnSync(
    "bash",
    [script, "--routing-root", routingRoot, "--suite", "earn-client"],
    {
      cwd: appRoot,
      stdio: "inherit",
    }
  );
  assert(
    result.status === 0,
    "Isolated SDK/chain/projection Earn verification failed"
  );
  console.info(
    "PASS: isolated SDK/chain/projection fixture (not native UI or market execution)"
  );
}
console.info(
  "PASS: Earn ownership/compatibility verification; see docs/workers/earn-client-release.md for full release gates"
);
