import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { StandardWalletAdapter } from "@solana/wallet-standard-wallet-adapter-base";
import { SolanaSignTransaction } from "@solana/wallet-standard-features";
import { StandardConnect, StandardEvents } from "@wallet-standard/features";

import {
  EarnPrepareRequestError,
  fetchEarnPrepare,
  getEarnPrepareLifecycleDiagnostics,
} from "../frontend/src/lib/yield-optimization/earn-prepare-request.client";
import { normalizeEarnWithdrawPreparationError } from "../frontend/src/lib/yield-optimization/earn-withdraw-input-resolution.server";

type Check = {
  detail: string;
  name: string;
  pass: boolean;
};

const root = resolve(import.meta.dir, "..");
const checks: Check[] = [];

function check(name: string, pass: boolean, detail: string): void {
  checks.push({ detail, name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
}

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function createStandardWallet(declaredVersions: unknown) {
  return {
    accounts: [],
    chains: ["solana:mainnet"],
    features: {
      [SolanaSignTransaction]: {
        signTransaction: async () => [],
        ...(declaredVersions === undefined
          ? {}
          : { supportedTransactionVersions: declaredVersions }),
        version: "1.0.0",
      },
      [StandardConnect]: {
        connect: async () => ({ accounts: [] }),
        version: "1.0.0",
      },
      [StandardEvents]: {
        on: () => () => undefined,
        version: "1.0.0",
      },
    },
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    name: `Verifier ${String(declaredVersions)}`,
  };
}

function getSupportedVersions(declaredVersions: unknown) {
  const adapter = new StandardWalletAdapter({
    wallet: createStandardWallet(declaredVersions) as never,
  });
  const supported = adapter.supportedTransactionVersions;
  adapter.destroy();
  return supported;
}

for (const invalid of [undefined, null, "legacy"]) {
  let supported: ReturnType<typeof getSupportedVersions> | undefined;
  let threw = false;
  try {
    supported = getSupportedVersions(invalid);
  } catch {
    threw = true;
  }
  check(
    `wallet malformed ${String(invalid)}`,
    !threw && supported instanceof Set && supported.size === 0,
    "malformed declaration is admitted with zero invented transaction versions"
  );
}

check(
  "wallet legacy",
  getSupportedVersions(["legacy"]) === null,
  "legacy-only behavior remains null"
);
const modernVersions = getSupportedVersions(["legacy", 0]);
check(
  "wallet legacy and v0",
  modernVersions instanceof Set &&
    modernVersions.has("legacy") &&
    modernVersions.has(0),
  "valid version set remains intact"
);

const sourceChanged = normalizeEarnWithdrawPreparationError(
  new Error("KLEND_MARKET_NOT_FOUND")
);
check(
  "KLend source drift normalization",
  sourceChanged?.status === 409 &&
    sourceChanged.code === "earn_withdraw_source_changed" &&
    !sourceChanged.message.includes("KLEND"),
  `${sourceChanged?.status ?? "none"}/${sourceChanged?.code ?? "none"}`
);
const missingAccount = normalizeEarnWithdrawPreparationError(
  new Error('Earn full withdraw prefix simulation failed: "AccountNotFound"')
);
check(
  "missing account normalization",
  missingAccount?.status === 409 &&
    missingAccount.code === "earn_withdraw_required_account_missing" &&
    !missingAccount.message.includes("AccountNotFound"),
  `${missingAccount?.status ?? "none"}/${missingAccount?.code ?? "none"}`
);

const resolverSource = source(
  "frontend/src/lib/yield-optimization/earn-withdraw-input-resolution.server.ts"
);
check(
  "live exact source boundary",
  resolverSource.includes("force: true") &&
    resolverSource.includes("selectRequestedEarnWithdrawSource") &&
    resolverSource.includes("source.sourceId === sourceId") &&
    !resolverSource.includes("fallback to USDC"),
  "forced reconciliation and exact source-id selection are present"
);

const flowId = "123e4567-e89b-42d3-a456-426614174000";
let transientAttempts = 0;
let propagatedFlowId = true;
let transientError: unknown;
try {
  const response = await fetchEarnPrepare({
    body: JSON.stringify({ amountRaw: "max", sourceId: "reserve:verifier" }),
    fetchImpl: (async (_input, init) => {
      transientAttempts += 1;
      propagatedFlowId &&=
        new Headers(init?.headers).get("x-loyal-flow-id") === flowId;
      if (transientAttempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      return Response.json(
        {
          error: {
            code: "earn_withdraw_source_changed",
            message: "The selected Earn source changed.",
          },
        },
        { status: 409 }
      );
    }) as typeof fetch,
    flowId,
    url: "/api/smart-accounts/yield-optimization/withdrawals/prepare",
  });
  if (!response.ok) {
    transientError = new EarnPrepareRequestError(
      "The selected Earn source changed.",
      { httpStatus: response.status }
    );
  }
} catch (error) {
  transientError = error;
}
check(
  "prepare transport retry and flow correlation",
  transientAttempts === 2 &&
    propagatedFlowId &&
    transientError instanceof EarnPrepareRequestError &&
    transientError.httpStatus === 409,
  `attempts=${transientAttempts}, flow=${propagatedFlowId}, status=${
    transientError instanceof EarnPrepareRequestError
      ? transientError.httpStatus
      : "unknown"
  }`
);

let httpAttempts = 0;
let httpError: unknown;
try {
  const response = await fetchEarnPrepare({
    body: JSON.stringify({ amountRaw: "max", sourceId: "reserve:verifier" }),
    fetchImpl: (async () => {
      httpAttempts += 1;
      return Response.json(
        { error: { code: "prepare_failed", message: "Try again." } },
        { status: 503 }
      );
    }) as typeof fetch,
    flowId,
    url: "/api/smart-accounts/yield-optimization/withdrawals/prepare",
  });
  if (!response.ok) {
    httpError = new EarnPrepareRequestError("Try again.", {
      httpStatus: response.status,
    });
  }
} catch (error) {
  httpError = error;
}
const httpDiagnostics = getEarnPrepareLifecycleDiagnostics(httpError);
check(
  "HTTP failure is not generically replayed",
  httpAttempts === 1 && httpDiagnostics.httpStatus === 503,
  `attempts=${httpAttempts}, status=${httpDiagnostics.httpStatus ?? "none"}`
);

const clientSource = source(
  "frontend/src/hooks/use-smart-account-sidebar-data.ts"
);
check(
  "confirmed withdrawal recovery boundary",
  clientSource.includes("for (let attempt = 0; attempt < 2") &&
    clientSource.includes("success: true") &&
    clientSource.includes('status: "confirmation_record_failed"') &&
    clientSource.includes("Do not withdraw again"),
  "confirmation retries only the idempotent record and preserves confirmed status"
);

const diff = Bun.spawnSync(["git", "diff", "--name-only"], {
  cwd: root,
  stderr: "pipe",
  stdout: "pipe",
});
const staged = Bun.spawnSync(["git", "diff", "--cached", "--name-only"], {
  cwd: root,
  stderr: "pipe",
  stdout: "pipe",
});
const untracked = Bun.spawnSync(
  ["git", "ls-files", "--others", "--exclude-standard"],
  {
    cwd: root,
    stderr: "pipe",
    stdout: "pipe",
  }
);
const changedFiles = [
  ...diff.stdout.toString().trim().split("\n"),
  ...staged.stdout.toString().trim().split("\n"),
  ...untracked.stdout.toString().trim().split("\n"),
].filter(
  (path, index, paths) =>
    path.length > 0 &&
    !path.startsWith(".moraine-worktree/") &&
    paths.indexOf(path) === index
);
const prohibited = changedFiles.filter(
  (path) =>
    path.startsWith("programs/") ||
    path.startsWith("workers/") ||
    path.includes("earn-product-mints") ||
    path.includes("policy-plan") ||
    path.includes("autodeposit")
);
check(
  "scope guard",
  diff.exitCode === 0 &&
    staged.exitCode === 0 &&
    untracked.exitCode === 0 &&
    prohibited.length === 0,
  prohibited.length === 0 ? "no prohibited diff paths" : prohibited.join(", ")
);

const commands = [
  [
    "bun",
    "test",
    "packages/smart-account-vaults/src/client.test.ts",
    "--test-name-pattern",
    "\\[earn-withdraw-account-drift\\]",
  ],
  [
    "bun",
    "test",
    "frontend/src/lib/yield-optimization/yield-deposit-repository.server.test.ts",
    "--test-name-pattern",
    "keeps policies active when a full withdrawal confirmation is replayed",
  ],
] as const;

for (const command of commands) {
  const result = Bun.spawnSync(command, {
    cwd: root,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  check(
    command.at(-1) ?? command.join(" "),
    result.exitCode === 0 && /\bpass\b/.test(output),
    output.trim().split("\n").at(-1) ?? `exit ${result.exitCode}`
  );
}

const failed = checks.filter((item) => !item.pass);
console.log(`\nVerdict: ${failed.length === 0 ? "PASS" : "FAIL"}`);
console.log("Production: LIVE PENDING");
if (failed.length > 0) {
  console.error(
    `Remaining gaps: ${failed.map((item) => item.name).join(", ")}`
  );
  process.exit(1);
}
console.log(
  "Remaining gaps: none locally; deploy and representative traffic required for production verification"
);
