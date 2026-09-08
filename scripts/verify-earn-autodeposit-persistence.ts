#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The former source-string verifier asserted synchronous web confirm writes.
// Those endpoints are retired. Keep this documented entrypoint, but run real
// compatibility/idempotency contracts instead of mirroring implementation shape.
if (process.argv.includes("--live")) {
  throw new Error(
    "The legacy --live mode is retired. Use the inline read-only production probes and release gates in docs/workers/earn-client-release.md."
  );
}
const root = fileURLToPath(new URL("../", import.meta.url));
for (const args of [
  ["apps/web/scripts/verify-earn-confirm-single-writer.ts"],
  [
    "test",
    "apps/web/src/lib/yield-optimization/earn-autodeposit-load-state.test.ts",
  ],
]) {
  const result = spawnSync("bun", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.info(
  "PASS: Autodeposit compatibility/persistence contracts. Routing owns canonical projection; local chain verification is a separate release gate."
);
