#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dir, "../../..");
const crossRepoE2e = process.argv.includes("--cross-repo-e2e");

function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const routingRootOption = optionValue("--routing-root");
const clientAppRootOption = optionValue("--client-app-root");
const behavioralTests = [
  "apps/web/src/lib/yield-optimization/earn-confirm-single-writer.server.test.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/confirm/route.test.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/prepare/route.test.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare/route.test.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/confirm/route.test.ts",
  "apps/web/src/lib/yield-optimization/earn-full-exit-zero-proof.server.test.ts",
] as const;
const mockIsolatedBehavioralTests = new Set([
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/prepare/route.test.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare/route.test.ts",
  "apps/web/src/lib/yield-optimization/earn-full-exit-zero-proof.server.test.ts",
]);
const changedWebTypeScriptFiles = [
  "scripts/verify-earn-confirm-single-writer.ts",
  "src/app/api/smart-accounts/mobile/earn/autodeposit/close/confirm/route.ts",
  "src/app/api/smart-accounts/mobile/earn/autodeposit/setup/confirm/route.ts",
  "src/app/api/smart-accounts/mobile/earn/deposit/confirm/route.ts",
  "src/app/api/smart-accounts/mobile/earn/withdraw/cleanup/confirm/route.ts",
  "src/app/api/smart-accounts/mobile/earn/withdraw/cleanup/prepare-context/route.ts",
  "src/app/api/smart-accounts/mobile/earn/withdraw/confirm/route.ts",
  "src/app/api/smart-accounts/mobile/earn/withdraw/prepare-context/route.ts",
  "src/app/api/smart-accounts/yield-optimization/autodeposit/close/confirm/route.ts",
  "src/app/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/route.ts",
  "src/app/api/smart-accounts/yield-optimization/deposits/confirm/route.ts",
  "src/app/api/smart-accounts/yield-optimization/policies/confirm/route.ts",
  "src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/confirm/route.test.ts",
  "src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/confirm/route.ts",
  "src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare/route.test.ts",
  "src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare/route.ts",
  "src/app/api/smart-accounts/yield-optimization/withdrawals/confirm/route.test.ts",
  "src/app/api/smart-accounts/yield-optimization/withdrawals/confirm/route.ts",
  "src/app/api/smart-accounts/yield-optimization/withdrawals/prepare/route.test.ts",
  "src/components/wallet-workspace/facelift/use-earn-actions.ts",
  "src/hooks/use-smart-account-sidebar-data.ts",
  "src/lib/core/database.ts",
  "src/lib/yield-optimization/earn-autodeposit-repository.server.ts",
  "src/lib/yield-optimization/earn-confirm-single-writer.server.test.ts",
  "src/lib/yield-optimization/earn-deposit-confirm.server.ts",
  "src/lib/yield-optimization/earn-full-exit-zero-proof.server.test.ts",
  "src/lib/yield-optimization/earn-full-exit-zero-proof.server.ts",
  "src/lib/yield-optimization/earn-withdraw-confirm.server.ts",
  "src/lib/yield-optimization/earn-withdraw-input-resolution.server.ts",
] as const;
const requiredRoutes = [
  "apps/web/src/app/api/smart-accounts/mobile/earn/deposit/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/mobile/earn/withdraw/prepare-context/route.ts",
  "apps/web/src/app/api/smart-accounts/mobile/earn/withdraw/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/mobile/earn/withdraw/cleanup/prepare-context/route.ts",
  "apps/web/src/app/api/smart-accounts/mobile/earn/withdraw/cleanup/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/mobile/earn/autodeposit/setup/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/mobile/earn/autodeposit/close/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/deposits/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/policies/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/close/confirm/route.ts",
] as const;

const moneyMovementSources = [
  "apps/web/src/lib/yield-optimization/earn-deposit-confirm.server.ts",
  "apps/web/src/lib/yield-optimization/earn-withdraw-input-resolution.server.ts",
  "apps/web/src/lib/yield-optimization/earn-withdraw-confirm.server.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/policies/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/mobile/earn/withdraw/cleanup/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/mobile/earn/withdraw/cleanup/prepare-context/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare/route.ts",
] as const;

const autodepositConfirmRoutes = [
  "apps/web/src/app/api/smart-accounts/mobile/earn/autodeposit/setup/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/mobile/earn/autodeposit/close/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/setup/confirm/route.ts",
  "apps/web/src/app/api/smart-accounts/yield-optimization/autodeposit/close/confirm/route.ts",
] as const;

const forbiddenMoneyMovementCalls = [
  "recordConfirmedYieldDeposit(",
  "recordConfirmedYieldWithdrawal(",
  "recordConfirmedEarnCleanup(",
  "recordConfirmedEarnDepositOnboardingPolicyStage(",
  "reconcileEarnVaultPosition(",
  "findReconciledActiveYieldPositionForVault(",
] as const;

const forbiddenAutodepositCalls = [
  "recordConfirmedAutodepositDelegation(",
  "recordConfirmedAutodepositTokenApproval(",
  "recordPendingAutodepositSetup(",
  "recordClosedAutodepositTarget(",
] as const;

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

console.log("ASK-2212 Earn confirmation single-writer verifier\n");

for (const route of requiredRoutes) {
  check(
    `released compatibility route exists: ${route}`,
    existsSync(resolve(repoRoot, route))
  );
}

for (const path of moneyMovementSources) {
  const contents = source(path);
  for (const call of forbiddenMoneyMovementCalls) {
    check(`${path} does not call ${call}`, !contents.includes(call));
  }
}

const cleanupPrepareSource = source(
  "apps/web/src/app/api/smart-accounts/yield-optimization/withdrawals/cleanup/prepare/route.ts"
);
check(
  "current web cleanup reads at the caller's confirmed withdrawal slot",
  cleanupPrepareSource.includes("requestedMinContextSlot") &&
    !cleanupPrepareSource.includes("const minContextSlot = 0")
);
check(
  "cached web cleanup falls back to the projected full-withdrawal slot",
  cleanupPrepareSource.includes("findLatestFullYieldWithdrawalForVault") &&
    cleanupPrepareSource.includes("full_withdrawal_projection_pending")
);

const withdrawPrepareSource = source(
  "apps/web/src/lib/yield-optimization/earn-withdraw-input-resolution.server.ts"
);

const sidebarDataSource = source(
  "apps/web/src/hooks/use-smart-account-sidebar-data.ts"
);
const withdrawExecutionSource = sidebarDataSource.slice(
  sidebarDataSource.indexOf("const executeEarnWithdraw ="),
  sidebarDataSource.indexOf("const executeEarnCleanup =")
);
const cleanupExecutionSource = sidebarDataSource.slice(
  sidebarDataSource.indexOf("const executeEarnCleanup ="),
  sidebarDataSource.indexOf("const executeEarnAutodeposit")
);
check(
  "web withdrawal keeps signed bytes and broadcasts through the app RPC",
  withdrawExecutionSource.includes("signThenSendRaw: true")
);
check(
  "web cleanup keeps signed bytes and broadcasts through the app RPC",
  cleanupExecutionSource.includes("signThenSendRaw: true")
);
check(
  "withdraw preparation retries a temporarily unprojected policy",
  withdrawPrepareSource.includes("POLICY_PROJECTION_RETRY_DELAYS_MS") &&
    withdrawPrepareSource.includes("earn_policy_projection_pending")
);

for (const path of autodepositConfirmRoutes) {
  const contents = source(path);
  for (const call of forbiddenAutodepositCalls) {
    check(`${path} does not call ${call}`, !contents.includes(call));
  }
}

for (const behavioralTest of behavioralTests) {
  check(
    `focused behavioral test exists: ${behavioralTest}`,
    existsSync(resolve(repoRoot, behavioralTest))
  );
}

if (failures.length === 0) {
  const sharedMockTests = behavioralTests.filter(
    (testPath) => !mockIsolatedBehavioralTests.has(testPath)
  );
  const testGroups = [
    sharedMockTests,
    ...[...mockIsolatedBehavioralTests].map((testPath) => [testPath]),
  ];
  const testsPassed = testGroups.every((testGroup) => {
    const testResult = spawnSync("bun", ["test", ...testGroup], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit",
    });
    return testResult.status === 0;
  });
  check("focused single-writer behavioral suite passes", testsPassed);
}

if (failures.length === 0) {
  const lintArgs = changedWebTypeScriptFiles.flatMap((path) => [
    "--file",
    path,
  ]);
  const lintResult = spawnSync("bunx", ["next", "lint", ...lintArgs], {
    cwd: resolve(repoRoot, "apps/web"),
    encoding: "utf8",
    stdio: "inherit",
  });
  check("focused changed-file lint passes", lintResult.status === 0);
}

if (failures.length === 0 && crossRepoE2e) {
  const routingRoot = routingRootOption
    ? resolve(routingRootOption)
    : resolve(repoRoot, "../loyal-yield-routing");
  const clientAppRoot = clientAppRootOption
    ? resolve(clientAppRootOption)
    : repoRoot;
  const crossRepoScript = resolve(
    routingRoot,
    "scripts/verify-earn-client-local-e2e.sh"
  );
  check(
    "cross-repo isolated verifier exists",
    existsSync(crossRepoScript),
    crossRepoScript
  );
  check(
    "cross-repo web client driver exists",
    existsSync(
      resolve(
        clientAppRoot,
        "apps/web/scripts/verify-earn-client-local-chain.ts"
      )
    ),
    clientAppRoot
  );
  if (failures.length === 0) {
    const e2eResult = spawnSync(
      "bash",
      [
        crossRepoScript,
        "--app-root",
        clientAppRoot,
        "--mobile-app-root",
        repoRoot,
      ],
      {
        cwd: routingRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MOBILE_EARN_REAL_API: "1",
          MOBILE_REQUIRE_REAL_API: "1",
        },
        stdio: "inherit",
      }
    );
    check(
      "isolated routing + web + Android withdrawal E2E passes",
      e2eResult.status === 0
    );
  }
}

console.log(`\n${checks - failures.length}/${checks} checks passed.`);
if (failures.length > 0) {
  console.error("\nVERDICT: FAIL");
  process.exitCode = 1;
} else {
  console.log(
    crossRepoE2e
      ? "\nVERDICT: PASS (API compatibility + isolated routing/web/mobile E2E)"
      : "\nVERDICT: PASS (local required checks; run --cross-repo-e2e for the isolated full flow)"
  );
}
