import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(scriptRoot, "..");
const repoRoot = resolve(mobileRoot, "..");
const taskBase =
  process.env.PR_520_TASK_BASE ??
  "a25e32bb906c2e86939bff0f0a7ea515637d7391";
const serverRef = process.env.PR_520_SERVER_REF ?? "origin/main";

const allowedTaskPaths = new Set([
  "mobile/scripts/verify-earn-withdrawal-alerts.ts",
  "mobile/src/lib/solana/earn/__tests__/autodeposit-rejection.test.ts",
  "mobile/src/lib/solana/earn/__tests__/withdraw.test.ts",
  "mobile/src/lib/solana/earn/autodeposit.ts",
  "mobile/src/lib/wallet/__tests__/seed-vault-signer.test.ts",
  "mobile/src/lib/wallet/seed-vault-signer.ts",
  "mobile/src/services/__tests__/lifecycle-rejection.test.ts",
]);

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function readServerSource(path: string): string {
  return runGit(["show", `${serverRef}:${path}`]);
}

const failures: { check: string; error: string }[] = [];

async function check(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.info(`PASS: ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ check: name, error: message });
    console.error(`FAIL: ${name}: ${message}`);
  }
}

await check("task delta stays inside PR #520 earn.withdrawal scope", () => {
  execFileSync("git", ["cat-file", "-e", `${taskBase}^{commit}`], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  const tracked = runGit([
    "diff",
    "--name-only",
    "--diff-filter=ACMRD",
    taskBase,
    "--",
  ]);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);
  const changedPaths = new Set(
    [...tracked.split("\n"), ...untracked.split("\n")].filter(Boolean),
  );

  assert.ok(
    changedPaths.has("mobile/scripts/verify-earn-withdrawal-alerts.ts"),
    "the verifier must include itself in the checked task delta",
  );
  for (const changedPath of changedPaths) {
    assert.ok(
      allowedTaskPaths.has(changedPath),
      `out-of-scope task path: ${changedPath}`,
    );
  }

  const deleted = runGit([
    "diff",
    "--name-only",
    "--diff-filter=D",
    taskBase,
    "--",
  ]);
  assert.equal(deleted, "", "the task must not delete repository files");
});

await check("pre-submit rejection is INFO and cannot trigger the ERROR alert", () => {
  const contract = readServerSource(
    "frontend/src/features/observability/lifecycle-contract.ts",
  );
  const otlp = readServerSource("frontend/src/features/observability/otlp.ts");
  assert.match(contract, /"cancelled"/);
  assert.match(contract, /"wallet_rejected"/);
  assert.match(
    otlp,
    /const isError =\s*event\.outcome === "failed" \|\| event\.recoveryRequired === true;/,
  );
  assert.match(otlp, /severityText: isError \? "ERROR" : "INFO"/);
  assert.match(otlp, /severityNumber: isError \? 17 : 9/);
  assert.match(
    otlp,
    /`\$\{event\.flowName\}\.\$\{event\.stage\}\.\$\{event\.outcome\}`/,
  );
});

await check("post-submit rejection remains ERROR-alertable", () => {
  const otlp = readServerSource("frontend/src/features/observability/otlp.ts");
  assert.match(
    otlp,
    /const isError =\s*event\.outcome === "failed" \|\| event\.recoveryRequired === true;/,
  );
  assert.match(otlp, /severityText: isError \? "ERROR" : "INFO"/);
  assert.match(otlp, /severityNumber: isError \? 17 : 9/);
});

await check("runtime rejection and retry contracts pass", () => {
  const jest = `${mobileRoot}/node_modules/.bin/jest`;
  assert.ok(existsSync(jest), `Jest binary not found at ${jest}`);
  execFileSync(
    jest,
    [
      "--runInBand",
      "--config",
      "jest.config.js",
      "src/services/__tests__/lifecycle-rejection.test.ts",
      "src/lib/wallet/__tests__/seed-vault-signer.test.ts",
      "src/lib/solana/earn/__tests__/autodeposit-rejection.test.ts",
      "src/lib/solana/earn/__tests__/withdraw.test.ts",
    ],
    { cwd: mobileRoot, stdio: "inherit" },
  );
});

await check("task delta has no whitespace errors", () => {
  execFileSync("git", ["diff", "--check", taskBase, "--"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
});

const result =
  failures.length === 0
    ? { status: "pass" as const }
    : { status: "fail" as const, failures };
console.info(`EARN_WITHDRAWAL_ALERT_VERIFIER_RESULT ${JSON.stringify(result)}`);
if (failures.length > 0) process.exitCode = 1;
