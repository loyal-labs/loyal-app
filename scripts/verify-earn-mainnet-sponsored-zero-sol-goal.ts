import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import bs58 from "bs58";
import { Connection } from "@solana/web3.js";

import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import {
  loadSponsorFeePayer,
  loadTestingKeypair,
} from "./verify-earn-sponsored-flow-helpers.ts";

type JsonRecord = Record<string, unknown>;

type FlowSpec = {
  name: string;
  passMarker: string;
  script: string;
};

type FlowRun = FlowSpec & {
  evidence: unknown;
  exitCode: number | null;
  ok: boolean;
  stderr: string;
  stdout: string;
};

type SignatureEvidence = {
  signature: string;
  sources: string[];
};

type ChainCheck = {
  feePayer?: string;
  signature: string;
  source: string;
  sponsorLamportsDelta?: string | null;
  status: "failed" | "success";
  systemTransferToWalletLamports?: string;
  walletLamportsDelta?: string | null;
  walletPostLamports?: string | null;
  walletPreLamports?: string | null;
};

type VerifierTrace = {
  chainChecks: ChainCheck[];
  config: {
    rpcUrl: string;
    solanaEnv: string;
    sponsorFeePayer: string;
    tracePath: string;
    walletAddress: string;
  };
  failures: string[];
  flowRuns: FlowRun[];
  prefundEvidencePaths: string[];
  signatureEvidence: SignatureEvidence[];
  verdict: "FAIL" | "PASS";
};

const FLOW_SPECS: FlowSpec[] = [
  {
    name: "earn-mainnet-sponsored",
    passMarker: "[earn-mainnet-sponsored] PASS",
    script: "scripts/verify-earn-mainnet-sponsored-flow.ts",
  },
  {
    name: "earn-autodeposit-mainnet-sponsored",
    passMarker: "[earn-autodeposit-mainnet-sponsored] PASS",
    script: "scripts/verify-earn-autodeposit-mainnet-sponsored-flow.ts",
  },
];

const SOLANA_ENV = resolveSolanaEnv(
  process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV ?? "mainnet"
);
const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  process.env.RPC_URL ??
  getSolanaEndpoints(SOLANA_ENV).rpcEndpoint;
const TRACE_PATH = resolve(
  process.cwd(),
  process.env.EARN_SPONSORED_ZERO_SOL_TRACE_PATH ??
    "docs/solana/earn-sponsored-zero-sol-verifier-run.md"
);

function safeLoadPublicKeys(): {
  sponsorFeePayer: string;
  walletAddress: string;
} {
  let sponsorFeePayer = "(unavailable)";
  let walletAddress = "(unavailable)";
  try {
    sponsorFeePayer = loadSponsorFeePayer().toBase58();
  } catch {
    // Keep trace writing robust even when env validation fails before live work.
  }
  try {
    walletAddress = loadTestingKeypair().publicKey.toBase58();
  } catch {
    // Keep trace writing robust even when env validation fails before live work.
  }
  return { sponsorFeePayer, walletAddress };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseJsonObjectFromOutput(output: string, marker: string): unknown {
  const markerIndex = output.lastIndexOf(marker);
  const firstBrace = output.indexOf("{", markerIndex >= 0 ? markerIndex : 0);
  if (firstBrace < 0) {
    throw new Error("No JSON object found after PASS marker.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < output.length; index += 1) {
    const char = output[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(output.slice(firstBrace, index + 1));
      }
    }
  }

  throw new Error("JSON object after PASS marker was incomplete.");
}

function runFlow(spec: FlowSpec): FlowRun {
  const result = spawnSync("bun", [spec.script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.status;
  let evidence: unknown = null;
  let ok = exitCode === 0 && stdout.includes(spec.passMarker);

  if (ok) {
    try {
      evidence = parseJsonObjectFromOutput(stdout, spec.passMarker);
    } catch (error) {
      ok = false;
      evidence = {
        parseError:
          error instanceof Error ? error.message : "Unable to parse evidence.",
      };
    }
  }

  return {
    ...spec,
    evidence,
    exitCode,
    ok,
    stderr,
    stdout,
  };
}

function collectUnsafeLivePreflightFailures(): string[] {
  const failures: string[] = [];
  for (const spec of FLOW_SPECS) {
    const source = readFileSync(resolve(process.cwd(), spec.script), "utf8");
    if (source.includes("/prefund/sponsored")) {
      failures.push(
        `${spec.script} still references a /prefund/sponsored endpoint.`
      );
    }
    if (/\bsendPreparedWithWallet\s*\(/.test(source)) {
      failures.push(
        `${spec.script} still directly sends a wallet-signed prepared transaction.`
      );
    }
  }
  return failures;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSignature(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(value)) {
    return false;
  }
  try {
    return bs58.decode(value).length === 64;
  } catch {
    return false;
  }
}

function isStateSnapshotSignaturePath(path: string[]): boolean {
  return path.some(
    (part) =>
      /^post.*EarnState$/.test(part) ||
      part === "policySponsoredConfirm" ||
      part === "postPolicyEarnState"
  );
}

function collectEvidence(args: {
  flowRuns: FlowRun[];
  prefundEvidencePaths: string[];
  signatureEvidence: Map<string, string[]>;
}) {
  function walk(value: unknown, path: string[]) {
    if (typeof value === "string") {
      const key = path[path.length - 1] ?? "";
      if (
        key.toLowerCase().includes("endpoint") &&
        value.includes("/prefund/sponsored")
      ) {
        args.prefundEvidencePaths.push(`${path.join(".")}=${value}`);
      }
      if (isSignature(value) && !isStateSnapshotSignaturePath(path)) {
        const sources = args.signatureEvidence.get(value) ?? [];
        sources.push(path.join("."));
        args.signatureEvidence.set(value, sources);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, String(index)]));
      return;
    }

    if (!isJsonRecord(value)) {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      if (
        key.toLowerCase().includes("prefund") &&
        child !== null &&
        child !== undefined
      ) {
        args.prefundEvidencePaths.push(childPath.join("."));
      }
      if (key === "sponsored" && child === false) {
        args.prefundEvidencePaths.push(
          `${childPath.join(".")}=false-sponsored-step`
        );
      }
      walk(child, childPath);
    }
  }

  for (const flowRun of args.flowRuns) {
    walk(flowRun.evidence, [flowRun.name, "evidence"]);
  }
}

function accountKeyToString(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    const record = value as {
      pubkey?: string | { toBase58?: () => string };
      toBase58?: () => string;
    };
    if (typeof record.pubkey === "string") {
      return record.pubkey;
    }
    if (
      record.pubkey &&
      typeof record.pubkey === "object" &&
      typeof record.pubkey.toBase58 === "function"
    ) {
      return record.pubkey.toBase58();
    }
    if (typeof record.toBase58 === "function") {
      return record.toBase58();
    }
  }
  return null;
}

function lamportsToBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return BigInt(0);
}

function parsedSystemTransferLamportsToWallet(args: {
  instructions: readonly unknown[];
  walletAddress: string;
}): bigint {
  let total = BigInt(0);
  for (const instruction of args.instructions) {
    if (!isJsonRecord(instruction)) {
      continue;
    }
    const parsed = instruction.parsed;
    if (!isJsonRecord(parsed) || parsed.type !== "transfer") {
      continue;
    }
    const info = parsed.info;
    if (!isJsonRecord(info) || info.destination !== args.walletAddress) {
      continue;
    }
    total += lamportsToBigInt(info.lamports);
  }
  return total;
}

async function fetchParsedTransactionWithRetry(args: {
  connection: Connection;
  signature: string;
}) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const transaction = await args.connection.getParsedTransaction(
        args.signature,
        {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }
      );
      if (transaction) {
        return transaction;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(1_000);
  }

  throw new Error(
    lastError instanceof Error
      ? lastError.message
      : "Transaction was not found on mainnet RPC."
  );
}

async function inspectSignature(args: {
  connection: Connection;
  signature: SignatureEvidence;
  sponsorFeePayer: string;
  walletAddress: string;
}): Promise<ChainCheck> {
  try {
    const transaction = await fetchParsedTransactionWithRetry({
      connection: args.connection,
      signature: args.signature.signature,
    });
    const accountKeys =
      transaction.transaction.message.accountKeys.map(accountKeyToString);
    const feePayer = accountKeys[0] ?? undefined;
    const walletIndex = accountKeys.findIndex(
      (key) => key === args.walletAddress
    );
    const sponsorIndex = accountKeys.findIndex(
      (key) => key === args.sponsorFeePayer
    );
    const meta = transaction.meta;
    const walletPreLamports =
      walletIndex >= 0
        ? lamportsToBigInt(meta?.preBalances?.[walletIndex])
        : null;
    const walletPostLamports =
      walletIndex >= 0
        ? lamportsToBigInt(meta?.postBalances?.[walletIndex])
        : null;
    const sponsorPreLamports =
      sponsorIndex >= 0
        ? lamportsToBigInt(meta?.preBalances?.[sponsorIndex])
        : null;
    const sponsorPostLamports =
      sponsorIndex >= 0
        ? lamportsToBigInt(meta?.postBalances?.[sponsorIndex])
        : null;
    const topLevelTransfers = parsedSystemTransferLamportsToWallet({
      instructions: transaction.transaction.message.instructions,
      walletAddress: args.walletAddress,
    });
    const innerTransfers = (meta?.innerInstructions ?? []).reduce(
      (sum, inner) =>
        sum +
        parsedSystemTransferLamportsToWallet({
          instructions: inner.instructions,
          walletAddress: args.walletAddress,
        }),
      BigInt(0)
    );

    return {
      feePayer,
      signature: args.signature.signature,
      source: args.signature.sources.join(", "),
      sponsorLamportsDelta:
        sponsorPreLamports === null || sponsorPostLamports === null
          ? null
          : (sponsorPostLamports - sponsorPreLamports).toString(),
      status: "success",
      systemTransferToWalletLamports: (
        topLevelTransfers + innerTransfers
      ).toString(),
      walletLamportsDelta:
        walletPreLamports === null || walletPostLamports === null
          ? null
          : (walletPostLamports - walletPreLamports).toString(),
      walletPostLamports: walletPostLamports?.toString() ?? null,
      walletPreLamports: walletPreLamports?.toString() ?? null,
    };
  } catch (error) {
    return {
      signature: args.signature.signature,
      source: args.signature.sources.join(", "),
      status: "failed",
      walletLamportsDelta:
        error instanceof Error ? error.message : "Unable to inspect signature.",
    };
  }
}

function firstLine(value: string): string {
  return (
    value
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

function truncate(value: string, maxLength = 12_000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n... truncated ${
    value.length - maxLength
  } chars ...`;
}

function redactSensitive(value: string): string {
  return value.replace(
    /([?&](?:api-key|apikey|key|token)=)[^&\s"'`)]+/gi,
    "$1[REDACTED]"
  );
}

function markdownCodeBlock(value: string): string {
  return `\`\`\`\n${truncate(redactSensitive(value)).replaceAll(
    "```",
    "`\\`\\`"
  )}\n\`\`\``;
}

function writeTrace(trace: VerifierTrace) {
  const flowSections = trace.flowRuns
    .map(
      (flow) => `### ${flow.name}

- exitCode: ${flow.exitCode ?? "null"}
- ok: ${flow.ok}
- first stdout line: ${firstLine(flow.stdout) || "(empty)"}
- first stderr line: ${firstLine(flow.stderr) || "(empty)"}

stdout:

${markdownCodeBlock(flow.stdout)}

stderr:

${markdownCodeBlock(flow.stderr)}
`
    )
    .join("\n");
  const chainRows = trace.chainChecks
    .map(
      (check) =>
        `| ${check.status} | ${check.signature} | ${check.feePayer ?? ""} | ${
          check.walletPreLamports ?? ""
        } | ${check.walletPostLamports ?? ""} | ${
          check.walletLamportsDelta ?? ""
        } | ${check.systemTransferToWalletLamports ?? ""} | ${check.source} |`
    )
    .join("\n");
  const content = `# Earn Sponsored Zero-SOL Verifier Run

- generatedAt: ${new Date().toISOString()}
- verdict: ${trace.verdict}
- solanaEnv: ${trace.config.solanaEnv}
- walletAddress: ${trace.config.walletAddress}
- sponsorFeePayer: ${trace.config.sponsorFeePayer}
- rpcUrl: ${redactSensitive(trace.config.rpcUrl)}

## Required Checks

- both sponsored live scripts exit 0 and emit PASS evidence
- safety preflight finds no /prefund/sponsored endpoint literals and no direct wallet-send calls in child sponsored verifiers
- no /prefund/sponsored evidence is present
- no evidence step reports sponsored: false for setup/close
- every emitted signature is confirmed on mainnet
- every emitted transaction fee payer is the sponsor
- the test wallet has zero pre/post SOL balance and zero SOL delta in every emitted transaction
- no emitted transaction transfers SOL to the test wallet

## Verdict

${trace.verdict}

## Failures

${
  trace.failures.length > 0
    ? trace.failures.map((failure) => `- ${failure}`).join("\n")
    : "- none"
}

## Prefund Evidence

${
  trace.prefundEvidencePaths.length > 0
    ? trace.prefundEvidencePaths.map((path) => `- ${path}`).join("\n")
    : "- none"
}

## Chain Checks

| status | signature | fee payer | wallet pre | wallet post | wallet delta | system transfer to wallet | source |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
${chainRows || "| none | | | | | | | |"}

## Flow Logs

${flowSections}
`;

  mkdirSync(dirname(trace.config.tracePath), { recursive: true });
  writeFileSync(trace.config.tracePath, content);
}

async function main() {
  const wallet = loadTestingKeypair();
  const sponsorFeePayer = loadSponsorFeePayer();
  const trace: VerifierTrace = {
    chainChecks: [],
    config: {
      rpcUrl: RPC_URL,
      solanaEnv: SOLANA_ENV,
      sponsorFeePayer: sponsorFeePayer.toBase58(),
      tracePath: TRACE_PATH,
      walletAddress: wallet.publicKey.toBase58(),
    },
    failures: [],
    flowRuns: [],
    prefundEvidencePaths: [],
    signatureEvidence: [],
    verdict: "FAIL",
  };

  if (SOLANA_ENV !== "mainnet") {
    trace.failures.push(
      `NEXT_PUBLIC_SOLANA_ENV must resolve to mainnet, got ${SOLANA_ENV}.`
    );
  }

  const unsafeLivePreflightFailures = collectUnsafeLivePreflightFailures();
  if (unsafeLivePreflightFailures.length > 0) {
    trace.failures.push(
      "Unsafe live verifier preflight failed; refusing to execute child scripts that can fund or spend from the user wallet."
    );
    trace.failures.push(...unsafeLivePreflightFailures);
    trace.verdict = "FAIL";
    writeTrace(trace);
    console.log(`[earn-sponsored-zero-sol-goal] ${trace.verdict}`);
    console.log(`tracePath=${trace.config.tracePath}`);
    console.log(
      JSON.stringify(
        {
          failures: trace.failures,
          verdict: trace.verdict,
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  trace.flowRuns = FLOW_SPECS.map(runFlow);
  for (const flowRun of trace.flowRuns) {
    if (!flowRun.ok) {
      trace.failures.push(
        `${flowRun.name} did not exit 0 with marker ${flowRun.passMarker}.`
      );
    }
  }

  const signatures = new Map<string, string[]>();
  collectEvidence({
    flowRuns: trace.flowRuns,
    prefundEvidencePaths: trace.prefundEvidencePaths,
    signatureEvidence: signatures,
  });
  trace.signatureEvidence = [...signatures.entries()].map(
    ([signature, sources]) => ({
      signature,
      sources,
    })
  );

  if (trace.prefundEvidencePaths.length > 0) {
    trace.failures.push(
      "Verifier evidence includes prefund endpoint usage or unsponsored setup/close evidence."
    );
  }
  if (trace.signatureEvidence.length === 0) {
    trace.failures.push("No transaction signatures were emitted by the flows.");
  }

  if (trace.signatureEvidence.length > 0) {
    const connection = new Connection(RPC_URL, "confirmed");
    trace.chainChecks = await Promise.all(
      trace.signatureEvidence.map((signature) =>
        inspectSignature({
          connection,
          signature,
          sponsorFeePayer: sponsorFeePayer.toBase58(),
          walletAddress: wallet.publicKey.toBase58(),
        })
      )
    );
  }

  for (const check of trace.chainChecks) {
    if (check.status !== "success") {
      trace.failures.push(
        `Unable to inspect transaction ${check.signature}: ${check.walletLamportsDelta}`
      );
      continue;
    }
    if (check.feePayer !== sponsorFeePayer.toBase58()) {
      trace.failures.push(
        `Transaction ${check.signature} fee payer ${
          check.feePayer
        } is not sponsor ${sponsorFeePayer.toBase58()}.`
      );
    }
    if (check.walletPreLamports !== null && check.walletPreLamports !== "0") {
      trace.failures.push(
        `Transaction ${check.signature} wallet pre lamports ${check.walletPreLamports} is not zero.`
      );
    }
    if (check.walletPostLamports !== null && check.walletPostLamports !== "0") {
      trace.failures.push(
        `Transaction ${check.signature} wallet post lamports ${check.walletPostLamports} is not zero.`
      );
    }
    if (
      check.walletLamportsDelta !== null &&
      check.walletLamportsDelta !== "0"
    ) {
      trace.failures.push(
        `Transaction ${check.signature} wallet SOL delta ${check.walletLamportsDelta} is not zero.`
      );
    }
    if (
      check.systemTransferToWalletLamports &&
      check.systemTransferToWalletLamports !== "0"
    ) {
      trace.failures.push(
        `Transaction ${check.signature} transfers ${check.systemTransferToWalletLamports} lamports to the wallet.`
      );
    }
  }

  trace.verdict = trace.failures.length === 0 ? "PASS" : "FAIL";
  writeTrace(trace);

  console.log(`[earn-sponsored-zero-sol-goal] ${trace.verdict}`);
  console.log(`tracePath=${trace.config.tracePath}`);
  console.log(
    JSON.stringify(
      {
        chainChecks: trace.chainChecks,
        failures: trace.failures,
        prefundEvidencePaths: trace.prefundEvidencePaths,
        signatureCount: trace.signatureEvidence.length,
        verdict: trace.verdict,
      },
      null,
      2
    )
  );

  if (trace.verdict !== "PASS") {
    process.exit(1);
  }
}

main().catch((error) => {
  const publicKeys = safeLoadPublicKeys();
  const trace: VerifierTrace = {
    chainChecks: [],
    config: {
      rpcUrl: RPC_URL,
      solanaEnv: SOLANA_ENV,
      sponsorFeePayer: publicKeys.sponsorFeePayer,
      tracePath: TRACE_PATH,
      walletAddress: publicKeys.walletAddress,
    },
    failures: [
      error instanceof Error ? error.stack ?? error.message : String(error),
    ],
    flowRuns: [],
    prefundEvidencePaths: [],
    signatureEvidence: [],
    verdict: "FAIL",
  };
  writeTrace(trace);
  console.error("[earn-sponsored-zero-sol-goal] FAIL", error);
  console.error(`tracePath=${trace.config.tracePath}`);
  process.exit(1);
});
