const checks = [
  {
    name: "exact-output transaction construction",
    command: [
      "bun",
      "test",
      "packages/smart-account-vaults/src/client.test.ts",
      "--test-name-pattern",
      "\\[earn-withdraw-exact-output\\]",
    ],
    minimumPasses: 4,
  },
  {
    name: "requested and confirmed amount contract",
    command: [
      "bun",
      "test",
      "frontend/src/lib/yield-optimization/earn-confirm-contracts.test.ts",
      "frontend/src/lib/yield-optimization/earn-withdraw-confirm.test.ts",
      "--test-name-pattern",
      "\\[earn-withdraw-exact-output\\]",
    ],
    minimumPasses: 2,
  },
  {
    name: "smart-account-vaults typecheck",
    command: [
      "bun",
      "run",
      "--cwd",
      "packages/smart-account-vaults",
      "typecheck",
    ],
  },
  {
    name: "smart-account-vaults package build",
    command: ["bun", "run", "--cwd", "packages/smart-account-vaults", "build"],
  },
  {
    name: "changed-file formatting",
    command: [
      "bunx",
      "prettier",
      "--check",
      "frontend/src/lib/yield-optimization/earn-confirm-contracts.shared.ts",
      "frontend/src/lib/yield-optimization/earn-confirm-contracts.test.ts",
      "frontend/src/lib/yield-optimization/earn-withdraw-confirm.test.ts",
      "frontend/src/lib/yield-optimization/earn-withdraw-proof.shared.ts",
      "packages/smart-account-vaults/src/client.ts",
      "packages/smart-account-vaults/src/client.test.ts",
      "packages/smart-account-vaults/src/types.ts",
      "scripts/verify-earn-withdraw-exact-output.ts",
    ],
  },
  {
    name: "whitespace and conflict markers",
    command: ["git", "diff", "--check"],
  },
] as const;

let failed = false;

for (const check of checks) {
  const result = Bun.spawnSync(check.command, {
    cwd: import.meta.dir + "/..",
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  const passMatch = output.match(/(\d+) pass/);
  const passCount = passMatch ? Number(passMatch[1]) : 0;

  if (
    result.exitCode !== 0 ||
    ("minimumPasses" in check && passCount < check.minimumPasses)
  ) {
    failed = true;
    console.error(`FAIL ${check.name}`);
    console.error(output.trim());
    continue;
  }

  console.log(
    `PASS ${check.name}${passCount > 0 ? ` (${passCount} assertions)` : ""}`
  );
}

if (failed) {
  process.exit(1);
}

console.log("PASS Earn withdrawal exact-output verifier");
