#!/usr/bin/env bun
/**
 * Sole acceptance verifier for loyal-vault-demo.
 *
 * Contract: docs/loyal-vault-demo-verifier.md (adopted verbatim from the planning artifact).
 *
 *   bun run --cwd apps/loyal-vault-demo verify:demo --tier full --report /tmp/loyal-vault-demo-report.json
 *
 * Guarantees enforced by this file:
 *   - Read-only. It never signs, broadcasts, deploys, mutates a database, or induces
 *     worker allocation. It writes the requested report; opt-in browser checks use
 *     temporary browser state and static pre-signed fixtures, never private keys.
 *   - Missing application behavior is FAIL, never a placeholder PASS.
 *   - Chain observations are live RPC reads. Nothing simulated is ever labelled live.
 *   - Candidate identities recorded in this file come from source; they are only
 *     authoritative once the matching chain observation in the report confirms them.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  findAdaptorAddReceiptPda,
  findProtocolPda,
  findStrategyInitReceiptPda,
  findVaultAssetIdleAuthPda,
  findVaultLpMintAuthPda,
  findVaultLpMintPda,
  findVaultStrategyAuthPda,
  getVaultDecoder,
  getProtocolDecoder,
  PROTOCOL_DISCRIMINATOR,
} from "@voltr/vault-sdk";

/* ------------------------------------------------------------------ layout */

const APP_ROOT = resolve(import.meta.dir, "..");
/** Pinned mainnet-beta genesis hash, enforced by the app's read client. */
const APP_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const REPO_ROOT = resolve(APP_ROOT, "..", "..");
const CONTRACT_DOC = resolve(REPO_ROOT, "docs", "loyal-vault-demo-verifier.md");
const CONTRACT_ORIGIN =
  "/Users/user/.codex/visualizations/2026/09/05/01a06ee7-4ed6-7381-9958-2e42c69ca10f/loyal-vault-demo-implementation-plan.md";
const REPORT_SCHEMA = "loyal-vault-demo.verifier-report/1";

/* -------------------------------------------------- candidate identity graph
 * Source of these values: loyal-yield-routing
 * tools/backyard-voltr/src/domain/rwa-multiply-route-spec.ts (candidate, not proof).
 * Each entry stays "candidate" until R00 records a matching chain observation.
 */
const IDENTITY = {
  contractId: "loyal-vault-demo/1",
  cluster: "mainnet-beta",
  expectedGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  vault: "HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA",
  assetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  assetSymbol: "USDC",
  assetDecimals: 6,
  /** Corroborated by the parent task's preflight; confirmed only by this verifier's own decode. */
  expectedLpMint: "6tNheTBYSpQkfMLhcczKgmTLSGffK54npKMG1WQR2tvb",
  expectedWithdrawalWaitingPeriodSeconds: 600,
  expectedLockedProfitDegradationSeconds: 86_400,
  smartAccount: "ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh",
  /** Declared by the runtime manifest; confirmed only by Squads state + SDK. */
  smartAccountIndex: 0,
  rejectedConsumerEarnIndex: 1,
  squadsProgram: "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
  squadsSettings: "5YQ78RwqukvCcykpmjmgRFmbEUeAgLpuVDxx1xNZnHD6",
  voltrProgram: "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8",
  customAdaptorProgram: "FSj27QT2PtP7365pQRtgSAwSwk5h2m2ATCBoXQjwTSxW",
  customAdaptorStrategyConfig: "DCpR24Eb6xCWxDyaZvCBTkadkxCB2vkqJN1EfYNWtLxY",
  trustfulAdaptorProgram: "3pnpK9nrs1R65eMV1wqCXkDkhSgN18xb1G5pgYPwoZjJ",
  trustfulStrategy: "4MetvifzuZShQ5zUhff4mVvwpu3kfKcqYfuY8pW7Zy9B",
  trustfulHoldingAta: "BsyRSvD5vfrE9VKhaZqvBt5nHAbPA4omAv3eePNXbQyN",
  /** getSmartAccountPda(index 1) is the consumer Earn vault: never this app's target. */
  expectedConsumerEarnSmartAccount:
    "DMPn3d7G2rcVVhvRbpSyEeq3cBW7bygiGjSgrLci5FYK",
  klendProgram: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  farmsProgram: "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr",
  kaminoMarket: "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y",
  kaminoObligation: "Gtwj2FNuiPoV2mGLC5SpHZ9PCmDrHHKaHXtacRaqm8vT",
  kaminoCollateralReserve: "AwCyCPZYJSZ93xcVKNK7jR8e1BHzJXq1D4bReNuh9woY",
  kaminoDebtReserve: "Atj6UREVWa7WxbF2EMKNyfmYUY1U1txughe2gjhcPDCo",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  associatedTokenProgram: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  systemProgram: "11111111111111111111111111111111",
  candidateWithdrawalWaitingPeriodSeconds: 600,
} as const;

/** Candidate values must never be reported as chain-verified. */
type BindingState =
  | "candidate-source"
  | "chain-verified"
  | "chain-rejected"
  | "unavailable";

/* ------------------------------------------------------ diagnostic bounds */

const BOUNDS = {
  rpcTimeoutMs: 30_000,
  rpcMaxAttempts: 3,
  perCheckTimeoutMs: 120_000,
  /** Declared before baseline; never widened to mask a mismatch (contract R02). */
  freshness: {
    vaultObservationMaxAgeMs: 15_000,
    positionObservationMaxAgeMs: 10_000,
    allocationSnapshotMaxAgeSlots: 32,
    workerObservationMaxAgeMs: 180_000,
    /**
     * The vault's lastUpdatedTs is a manager-write timestamp, and RPC slot
     * recency is not NAV freshness. NAV freshness comes from the adaptor's
     * reported NAV age and the worker's own observation, each shown separately.
     */
    navFreshnessSource:
      "adaptor reported NAV age + worker observation, never RPC recency or lastUpdatedTs",
    navClaimedRawTolerance: "0 raw units",
    lpAccountingRawTolerance: "0 raw units",
    feeRoundingToleranceRaw: 1,
  },
  budget: {
    maxConcurrentViewerSessions: 2,
    rpcRequestsPerObservationCycle: 12,
    positionPollIntervalMs: 5_000,
    vaultCacheTtlMs: 5_000,
    perRequestTimeoutMs: 15_000,
    errorBackoffMs: 30_000,
  },
} as const;

/* --------------------------------------------------------------- CLI args */

type Tier = "full" | "fast";

function parseArgs(argv: string[]) {
  let tier: Tier = "full";
  let hostedEvidencePath: string | null = null;
  let report = "/tmp/loyal-vault-demo-report.json";
  let rpcUrl =
    process.env.LOYAL_VAULT_DEMO_RPC_URL ??
    "https://api.mainnet-beta.solana.com";
  const skip = (value: string) => {
    throw new Error(`Unsupported flag: ${value}`);
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--hosted-evidence") {
      if (hostedEvidencePath !== null || !argv[index + 1] || argv[index + 1].startsWith("--"))
        throw new Error("--hosted-evidence requires one JSON envelope path");
      hostedEvidencePath = argv[++index];
    }
    else if (value === "--tier") tier = parseTier(argv[++index]);
    else if (value === "--report") report = argv[++index] ?? report;
    else if (value === "--rpc-url") rpcUrl = argv[++index] ?? rpcUrl;
    else if (value === "--help" || value === "-h") {
      /* printed below */
    } else skip(value ?? "");
  }
  return { tier, report, rpcUrl, hostedEvidencePath };
}

function parseTier(value: string | undefined): Tier {
  if (value === "full" || value === "fast") return value;
  throw new Error(`--tier must be "full" or "fast", received ${String(value)}`);
}

import { getSmartAccountPda } from "@loyal-labs/loyal-smart-accounts-core";
import { PublicKey } from "@solana/web3.js";
import { getAdaptorAddReceiptDecoder } from "@voltr/vault-sdk";
import {
  getStrategyInitReceiptDecoder,
  getStrategyInitReceiptEncoder,
} from "@voltr/vault-sdk";
import {
  buildCoherentVaultCore,
  decodeAdaptorConfig,
  deriveIdleAuthority,
  deriveVaultBatchAddresses,
} from "../src/features/vault/server/coherent-batch";
import { BoundedRpc } from "../src/features/vault/server/rpc";
import { VAULT_IDENTITY as APP_IDENTITY, RPC_BOUNDS } from "../src/features/vault/server/config";
import {
  assetsForWithdrawAmount,
  decimalBitsToRaw,
  lpForDepositAmount,
  lpForWithdrawAmount,
  receiptEffectiveAssetRaw,
} from "../src/features/vault/domain/accounting";

/* ------------------------------------------------------------------- types */

type CheckStatus = "pass" | "fail" | "blocked" | "not_run";
type Provenance =
  | "static-inspection"
  | "chain-read"
  | "controlled-runtime"
  | "simulation"
  | "submission"
  | "confirmation"
  | "finalization"
  | "reconciliation"
  | "deployment"
  | "browser";

type Evidence = Readonly<{
  kind: string;
  detail: string;
  provenance: Provenance;
  /** Path of an evidence artifact. Locates an observation; never proves it. */
  path?: string;
  slot?: number;
  observedAt?: string;
  bindingState?: BindingState;
}>;

type Block = Readonly<{
  gate: string;
  owner: string;
  reason: string;
  resumeCondition: string;
  measuredEvidence?: string;
}>;

type Finding = Readonly<{
  id: string;
  condition: string;
  requirement: string;
  status: CheckStatus;
  completionEligible: boolean;
  provenance: Provenance[];
  evidence: Evidence[];
  failures: string[];
  missing: string[];
  blocks: Block[];
}>;

class Check {
  readonly evidence: Evidence[] = [];
  readonly failures: string[] = [];
  readonly missing: string[] = [];
  readonly blocks: Block[] = [];
  private provenance = new Set<Provenance>();

  constructor(
    readonly id: string,
    readonly condition: string,
    readonly requirement: string
  ) {}

  add(provenance: Provenance, evidence: Evidence): this {
    this.provenance.add(provenance);
    this.evidence.push({ ...evidence, provenance });
    return this;
  }

  fail(reason: string): this {
    this.failures.push(reason);
    return this;
  }

  /** A local implementation gap. Never relabelled BLOCKED. */
  missing_(reason: string): this {
    this.missing.push(reason);
    return this;
  }

  block(block: Block): this {
    this.blocks.push(block);
    return this;
  }

  finalize(tier: Tier): Finding {
    const hasFailure = this.failures.length > 0 || this.missing.length > 0;
    const status: CheckStatus = hasFailure
      ? "fail"
      : this.blocks.length > 0
      ? "blocked"
      : this.evidence.length > 0
      ? "pass"
      : "not_run";
    return {
      id: this.id,
      condition: this.condition,
      requirement: this.requirement,
      status,
      completionEligible: tier === "full" && status === "pass",
      provenance: [...this.provenance],
      evidence: this.evidence,
      failures: this.failures,
      missing: this.missing,
      blocks: this.blocks,
    };
  }
}

/* ------------------------------------------------------- pinned-SDK utilities
 * All address derivation and account decoding goes through the pinned
 * dependencies (@solana/kit, @solana-program/token, @voltr/vault-sdk). The
 * verifier deliberately contains no hand-rolled base58, no hand-rolled
 * findProgramAddress, and no guessed Squads seed layout: a custom derivation
 * without the ProgramDerivedAddress domain separator and a real Ed25519
 * off-curve test produces addresses that look plausible and mean nothing.
 */

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const utf8 = (value: string) => new TextEncoder().encode(value);

/** Renders addresses, bigints and byte arrays from SDK decoders for evidence. */
function render(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(render).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${key}:${render(entry)}`)
      .join(",")}}`;
  }
  return String(value);
}

/** Collects every numeric leaf keyed by its path, for config evidence. */
function numericLeaves(
  value: unknown,
  prefix = "",
  out: Record<string, string> = {}
): Record<string, string> {
  if (typeof value === "bigint" || typeof value === "number") {
    out[prefix] = value.toString();
    return out;
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  ) {
    for (const [key, entry] of Object.entries(value))
      numericLeaves(entry, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

type DecodedVault =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

function decodeVaultConfig(dataBase64: string): DecodedVault {
  try {
    const decoded = getVaultDecoder().decode(
      Buffer.from(dataBase64, "base64")
    ) as unknown;
    return { ok: true, value: decoded as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/* ------------------------------------------------------- chain read client */

type RpcResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: string; attempts: number; transient: boolean };

type AccountInfo = Readonly<{
  address: string;
  owner: string;
  lamports: number;
  dataLength: number;
  dataSha256: string;
  executable: boolean;
  dataBase64: string;
  /** Slot of THIS account's read, at finalized commitment. */
  contextSlot: number;
}>;

class ChainReader {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = BOUNDS.rpcTimeoutMs,
    private readonly maxAttempts = BOUNDS.rpcMaxAttempts
  ) {}

  async call<T>(method: string, params: unknown[]): Promise<RpcResult<T>> {
    let lastError = "no attempt";
    let transient = false;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          result?: T;
          error?: { message?: string };
        };
        if (payload.error?.message) {
          return {
            ok: false,
            error: `rpc ${method}: ${payload.error.message}`,
            attempts: attempt,
            transient: false,
          };
        }
        return { ok: true, value: payload.result as T, attempts: attempt };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        transient = true;
      } finally {
        clearTimeout(timer);
      }
    }
    return {
      ok: false,
      error: `rpc ${method}: ${lastError}`,
      attempts: this.maxAttempts,
      transient,
    };
  }

  async getAccountInfo(
    account: string
  ): Promise<RpcResult<AccountInfo | null>> {
    const result = await this.call<{
      context: { slot: number };
      value: null | Readonly<{
        owner: string;
        lamports: number;
        data: [string, string];
        executable: boolean;
      }>;
    }>("getAccountInfo", [
      account,
      { encoding: "base64", commitment: "finalized" },
    ]);
    if (!result.ok) return result;
    const value = result.value?.value ?? null;
    const contextSlot = result.value?.context?.slot ?? -1;
    if (!value) return { ok: true, value: null, attempts: result.attempts };
    const data = Buffer.from(value.data[0]!, "base64");
    return {
      ok: true,
      attempts: result.attempts,
      value: {
        address: account,
        owner: value.owner,
        lamports: value.lamports,
        dataLength: data.byteLength,
        dataSha256: sha256(new Uint8Array(data)),
        executable: value.executable,
        dataBase64: value.data[0]!,
        contextSlot,
      },
    };
  }

  /** SPL mint fields the verifier can decode without the Voltr SDK. */
  static decodeMint(
    info: AccountInfo
  ): { decimals: number; supplyRaw: string } | null {
    if (info.dataLength < 46) return null;
    const bytes = Buffer.from(info.dataBase64, "base64");
    return {
      decimals: bytes.readUInt8(44),
      supplyRaw: bytes.readBigUInt64LE(36).toString(),
    };
  }
}

/** Pinned-SDK derivations for the vault-level Voltr account surface. */
async function deriveVoltrPdaSurface(): Promise<
  ReadonlyArray<{ label: string; address: string }>
> {
  const program = address(IDENTITY.voltrProgram);
  const vault = address(IDENTITY.vault);
  const [protocol] = await findProtocolPda({ programAddress: program });
  const [idleAuth] = await findVaultAssetIdleAuthPda(
    { vault },
    { programAddress: program }
  );
  const [lpMint] = await findVaultLpMintPda(
    { vault },
    { programAddress: program }
  );
  const [lpMintAuth] = await findVaultLpMintAuthPda(
    { vault },
    { programAddress: program }
  );
  const [idleAta] = await findAssociatedTokenPda(
    {
      owner: idleAuth,
      mint: address(IDENTITY.assetMint),
      tokenProgram: address(IDENTITY.tokenProgram),
    },
    { programAddress: address(IDENTITY.associatedTokenProgram) }
  );
  const [strategyAuth] = await findVaultStrategyAuthPda(
    { vault, strategy: address(IDENTITY.customAdaptorStrategyConfig) },
    { programAddress: program }
  );
  return [
    { label: "protocol", address: protocol },
    { label: "vaultAssetIdleAuth", address: idleAuth },
    { label: "vaultAssetIdleAta", address: idleAta },
    { label: "vaultLpMint", address: lpMint },
    { label: "vaultLpMintAuth", address: lpMintAuth },
    {
      label: "vaultStrategyAuth(customAdaptorStrategy)",
      address: strategyAuth,
    },
  ];
}

/* ----------------------------------------------------------- app inventory */

const EXPECTED_APP_FILES = [
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/api/vault/route.ts",
  "src/app/api/position/route.ts",
  "src/app/api/transactions/prepare/route.ts",
  "src/app/api/transactions/status/route.ts",
  "next.config.ts",
  "src/features/vault/domain",
  "src/features/vault/server",
  "src/features/vault/ui",
  "src/features/vault/domain/types.ts",
  "src/features/vault/server/config.ts",
  "src/features/vault/ui/wallet-provider.tsx",
] as const;

type Inventory = Readonly<{
  path: string;
  present: boolean;
  kind: "file" | "directory";
}>;

/* ------------------------------------------------- open-deposit release evidence
 * Defect (repaired 2026-09-17): R06 failed unconditionally whenever the app
 * offered deposits, so the fully evidenced open-pilot state the deposit gate
 * exists for could never pass release acceptance. The repair keeps the
 * condition at least as strict and fail-closed: offered deposits are accepted
 * only when this evaluator independently re-derives every admission condition
 * from a fresh route-state row (read here through the app's exported
 * DEPOSIT_SERVICE_SQL locator against the least-privilege observation role)
 * plus this verifier's own fresh chain batch and consumed-report view. The
 * gate helper's projected booleans alone are never proof; every raw field that
 * the row exposes is re-checked here. This evaluator is pure so the controlled
 * mutation cases in R06 can prove both directions. It never calls
 * matchDepositService. */
const OPEN_DEPOSIT_EVALUATION = {
  observationClockSkewMs: 2_000,
  observationMaxAgeMs: 15_000,
  /** Batch/report coherence window, matching the declared R02 slot bounds. */
  maxObservationSlotDrift: 32,
  /** Approved pilot ceiling: 100,000 USDC (100_000_000_000 raw). */
  maxCapRaw: 100_000_000_000n,
} as const;

type DepositReleaseCore = {
  slot: number;
  assetTotalValue: bigint;
  idleCustodyRaw: bigint;
  managerCustody: { exists: boolean; amountRaw: bigint } | null;
  maxCapRaw: bigint;
};

type DepositReleaseReport = {
  status: string;
  reportSignature?: string;
  reportConfirmedSlot?: number;
  lastNavRaw?: string;
  bindingsMatchPinned?: boolean;
};

type DepositReleaseEvaluation = { open: true } | { open: false; reason: string };

function evaluateOpenDepositRelease(
  core: DepositReleaseCore,
  report: DepositReleaseReport,
  row: Record<string, unknown>
): DepositReleaseEvaluation {
  const closed = (reason: string): DepositReleaseEvaluation => ({ open: false, reason });
  if (
    report.status !== "fresh" ||
    !report.reportSignature ||
    !report.reportConfirmedSlot ||
    typeof report.lastNavRaw !== "string" ||
    report.bindingsMatchPinned !== true
  )
    return closed("consumed-report evidence is not fresh, finalized and pinned-binding verified");
  if (row.release_active !== true) return closed("the worker release lease is not active");
  if (row.pilot_active !== true) return closed("the capped pilot budget authority is not activated");
  if (row.no_manual_hold !== true) return closed("a manual recovery latch is open");
  if (row.no_pending !== true) return closed("an unresolved worker operation is pending");
  if (row.last_action !== "REPORT_NAV")
    return closed("the newest reconciled operation is not the consumed REPORT_NAV");
  if (row.last_signature !== report.reportSignature)
    return closed("the newest reconciled operation does not match the consumed report signature");
  if (row.last_confirmed_slot !== String(report.reportConfirmedSlot))
    return closed("the newest reconciled operation slot does not match the consumed report slot");
  const observation = row.observation;
  if (!observation || typeof observation !== "object" || Array.isArray(observation))
    return closed("the worker observation payload is missing");
  const view = observation as Record<string, unknown>;
  const now = typeof row.database_now === "string" ? Date.parse(row.database_now) : NaN;
  const at = typeof view.observedAt === "string" ? Date.parse(view.observedAt) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(at))
    return closed("worker observation timestamps are not parseable");
  if (
    now - at < -OPEN_DEPOSIT_EVALUATION.observationClockSkewMs ||
    now - at > OPEN_DEPOSIT_EVALUATION.observationMaxAgeMs
  )
    return closed("the worker observation is not fresh against the route-state clock");
  if (!Number.isSafeInteger(view.observedSlot))
    return closed("the worker observation slot is not an integer");
  const observedSlot = Number(view.observedSlot);
  if (
    observedSlot < core.slot - OPEN_DEPOSIT_EVALUATION.maxObservationSlotDrift ||
    observedSlot > core.slot + OPEN_DEPOSIT_EVALUATION.maxObservationSlotDrift
  )
    return closed("the worker observation slot is not coherent with this verifier's chain batch");
  if (observedSlot < report.reportConfirmedSlot)
    return closed("the worker observation predates the consumed report");
  if (view.navFresh !== true) return closed("the worker observation is not NAV-fresh");
  if (!["idle", "positioned"].includes(String(view.routeStatus)))
    return closed("the route is not idle or positioned");
  if (!core.managerCustody || view.squadsIdleRaw !== core.managerCustody.amountRaw.toString())
    return closed("the worker's smart-account custody does not match the chain batch");
  if (
    view.aumRaw !== core.assetTotalValue.toString() ||
    view.voltrIdleRaw !== core.idleCustodyRaw.toString()
  )
    return closed("the worker's vault NAV/idle values do not match the chain batch");
  if (view.computedStrategyNavRaw !== report.lastNavRaw || view.reportedNavRaw !== report.lastNavRaw)
    return closed("the worker's strategy NAV does not match the consumed report");
  if (view.voltrStrategyIdleRaw !== "0") return closed("unexpected strategy idle value");
  if (core.maxCapRaw <= 0n || core.maxCapRaw > OPEN_DEPOSIT_EVALUATION.maxCapRaw)
    return closed("the on-chain deposit cap is not a positive capped-pilot limit");
  if (core.assetTotalValue >= core.maxCapRaw) return closed("the pilot vault is at its deposit limit");
  return { open: true };
}

function inventory(): Inventory[] {
  return EXPECTED_APP_FILES.map((relative) => {
    const absolute = resolve(APP_ROOT, relative);
    const present = existsSync(absolute);
    return {
      path: relative,
      present,
      kind:
        present && statSync(absolute).isDirectory()
          ? ("directory" as const)
          : ("file" as const),
    };
  });
}

function appFileCount(): number {
  let count = 0;
  const walk = (directory: string) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory)) {
      const absolute = `${directory}/${entry}`;
      if (statSync(absolute).isDirectory()) {
        if (entry !== "node_modules" && entry !== ".next") walk(absolute);
      } else count += 1;
    }
  };
  walk(APP_ROOT);
  return count;
}

/* -------------------------------------------------------------- gates */

const EXTERNAL_GATES = [
  {
    gate: "Current runtime bindings/read access",
    owner: "Yield runtime maintainer + environment owner",
    resumeCondition:
      "Validated deployed manifest, RPC and least-privilege observation access are available; current NAV/withdrawal semantics verified.",
    state: "open" as const,
  },
  {
    gate: "Persistent deposit/exit servicing",
    owner: "Yield operator",
    resumeCondition:
      "Explicit ongoing operating envelope/configuration supports the demo's amounts and restoration while preserving the single writer, valid beyond Phase 3 closure.",
    state: "open" as const,
  },
  {
    gate: "Hosting deployment",
    owner: "Deployment owner/user",
    resumeCondition:
      "Target project/URL, environment and deploy permission recorded; hosted build succeeds.",
    state: "open" as const,
  },
  {
    gate: "Live wallet/funding",
    owner: "User/operator",
    resumeCondition:
      "Exact wallet, vault, actions, amount/fee/count caps and expiry authorized; wallet funded; eligible lane has capacity.",
    state: "open" as const,
    note: "Phase 3's 1/20/60 USDC canary envelope does not authorize this demo.",
  },
  {
    gate: "Receipt timing/liquidity",
    owner: "Voltr chain state + yield operator",
    resumeCondition:
      "Actual receipt eligible and required liquidity restored; earliest recheck time recorded.",
    state: "open" as const,
  },
  {
    gate: "Protocol/accounting incompatibility",
    owner: "User + runtime/protocol owner",
    resumeCondition:
      "Measured conflict resolved within existing semantics, or smallest scope change explicitly approved.",
    state: "open" as const,
  },
];

/* ------------------------------------------------------------ main */

/* Recorded deployment evidence locates a release; it never proves live servicing. */
type HostedEvidence = Readonly<{
  path: string;
  deployment: { url: string; deploymentId: string; sourceCommit: string; status: "Ready"; capturedAt: string };
  vault: Record<string, unknown>;
  worker: Record<string, unknown>;
}>;

export function loadHostedEvidence(path: string | null, currentCommit: string | null): HostedEvidence | null {
  if (path === null) return null;
  const object = (value: unknown): Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error("Hosted evidence requires JSON objects");
    return value as Record<string, unknown>;
  };
  const require = (ok: unknown, reason: string): void => {
    if (!ok) throw new Error(`Hosted evidence rejected: ${reason}`);
  };
  const row = object(JSON.parse(readFileSync(path, "utf8")));
  const deployment = object(row.deployment), vault = object(row.vault), worker = object(row.worker);
  const url = new URL(String(deployment.url));
  require(url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
    && (url.hostname === "loyal-vault-pilot.vercel.app" || /^loyal-vault-pilot-[a-z0-9]+-loyals-projects-4b3ed656\.vercel\.app$/.test(url.hostname)), "pilot URL");
  require(typeof deployment.deploymentId === "string" && /^dpl_[A-Za-z0-9]+$/.test(deployment.deploymentId)
    && deployment.status === "Ready", "deployment identity/status");
  require(typeof deployment.sourceCommit === "string" && /^[0-9a-f]{40}$/.test(deployment.sourceCommit)
    && deployment.sourceCommit === currentCommit, "candidate commit");
  require(typeof deployment.capturedAt === "string" && Number.isFinite(Date.parse(deployment.capturedAt)), "capture time");
  require(row.vaultHttpStatus === 200 && row.workerHttpStatus === 200, "served HTTP results");
  const identity = object(vault.identity), terms = object(vault.terms), service = object(vault.serviceState), freshness = object(vault.freshness);
  require(vault.schemaVersion === "loyal-vault-demo.vault-observation/1" && identity.vault === IDENTITY.vault
    && identity.voltrProgram === IDENTITY.voltrProgram && identity.assetMint === IDENTITY.assetMint
    && identity.lpMint === IDENTITY.expectedLpMint && identity.manager === IDENTITY.smartAccount
    && identity.assetDecimals === 6 && identity.lpDecimals === 9, "vault identities");
  // Hosted on-chain terms must equal the approved pilot cap exactly: 100,000
  // USDC = 100_000_000_000 raw (identity.pilotDepositCapRaw).
  require(terms.maxCapRaw === "100000000000" && terms.withdrawalWaitingPeriodSeconds === String(IDENTITY.expectedWithdrawalWaitingPeriodSeconds), "pilot terms");
  require(["unavailable", "available"].includes(String(service.deposits))
    && (service.deposits !== "unavailable" || (typeof service.depositsReason === "string" && service.depositsReason.length > 0)), "deposit disclosure");
  require(typeof freshness.observedSlot === "number" && Number.isSafeInteger(freshness.observedSlot) && freshness.observedSlot > 0
    && typeof freshness.observedAt === "string" && Number.isFinite(Date.parse(freshness.observedAt)), "vault observation");
  require(worker.source === "yield-worker-journal" && typeof worker.leaseActive === "boolean"
    && ["fresh", "stale"].includes(String(worker.freshness)) && typeof worker.observedSlot === "string"
    && /^[1-9][0-9]*$/.test(worker.observedSlot) && typeof worker.observedAt === "string" && Number.isFinite(Date.parse(worker.observedAt)), "worker observation");
  require(service.deposits !== "available" || (worker.leaseActive === true && worker.freshness === "fresh"), "offered deposits without servicing");
  return { path, deployment: deployment as HostedEvidence["deployment"], vault, worker };
}

async function main() {
  const startedAt = new Date().toISOString();
  const { tier, report, rpcUrl, hostedEvidencePath } = parseArgs(process.argv.slice(2));
  const source = readSourceIdentity();
  const hosted = loadHostedEvidence(hostedEvidencePath, source.commit);
  const chain = new ChainReader(rpcUrl);
  const checks: Check[] = [];
  const check = (id: string, condition: string, requirement: string) => {
    const created = new Check(id, condition, requirement);
    checks.push(created);
    return created;
  };

  const findings: Finding[] = [];
  const run = async (
    id: string,
    condition: string,
    requirement: string,
    body: (c: Check) => Promise<Check>
  ) => {
    const created = check(id, condition, requirement);
    const started = Date.now();
    let result: Check;
    try {
      result = await body(created);
    } catch (error) {
      result = created.fail(
        `verifier defect while evaluating ${id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    findings.push(result.finalize(tier));
    return { id, elapsedMs: Date.now() - started };
  };

  /* ---- shared observations (collected once, reused by every check) ---- */
  const observations: Record<string, unknown> = {};
  /** Slot of each account read; accounts never inherit a global slot. */
  const contextSlots: Record<string, number | null> = {};
  const observe = async <T>(
    key: string,
    task: () => Promise<T>
  ): Promise<T> => {
    const value = await task();
    observations[key] = value;
    return value;
  };

  const observeAccount = async (key: string, account: string) => {
    const result = await chain.getAccountInfo(account);
    contextSlots[key] = result.ok ? result.value?.contextSlot ?? null : null;
    return result;
  };

  const genesis = await observe("genesisHash", () =>
    chain.call<string>("getGenesisHash", [])
  );
  const epoch = await observe("epochInfo", () =>
    chain.call<{ absoluteSlot: number; epoch: number; blockHeight: number }>(
      "getEpochInfo",
      []
    )
  );
  const [protocolAddress, protocolBump] = await findProtocolPda({ programAddress: address(IDENTITY.voltrProgram) });
  const protocolAccount = await observeAccount("protocolAccount", protocolAddress);
  const vaultAccount = await observeAccount("vaultAccount", IDENTITY.vault);
  const assetMintAccount = await observeAccount(
    "assetMintAccount",
    IDENTITY.assetMint
  );
  const smartAccount = await observeAccount(
    "smartAccount",
    IDENTITY.smartAccount
  );
  const voltrProgram = await observeAccount(
    "voltrProgramAccount",
    IDENTITY.voltrProgram
  );
  const strategyConfig = await observeAccount(
    "strategyConfigAccount",
    IDENTITY.customAdaptorStrategyConfig
  );

  const observedAt = new Date().toISOString();
  // Accounts never inherit a global slot: each read reports its own finalized
  // context slot. The epoch observation is reported separately as runtime state.

  /* ---------------------------------------------------- R00 */
  await run(
    "R00",
    "Identity, authority and feasibility",
    "Chain genesis, account owners, vault/USDC/LP mint, token programs and decimals, smart-account index/address, strategy receipts, custody destinations, current adaptor/NAV bindings, deployed manager identity, independently derived PDAs, and feasibility of unrelated-user deposits/requests under live NAV refresh.",
    async (c) => {
      // Contract document is present and hashed (adoption provenance).
      if (!existsSync(CONTRACT_DOC))
        return c.fail(`contract document missing at ${CONTRACT_DOC}`);
      const contractBytes = readFileSync(CONTRACT_DOC);
      c.add("static-inspection", {
        kind: "contract-adoption",
        detail: `docs/loyal-vault-demo-verifier.md sha256=${sha256(
          new Uint8Array(contractBytes)
        )} bytes=${contractBytes.byteLength} adoptedFrom=${CONTRACT_ORIGIN}`,
        provenance: "static-inspection",
        path: "docs/loyal-vault-demo-verifier.md",
      });

      // Candidate identity is recorded as candidate, never as verified.
      c.add("static-inspection", {
        kind: "candidate-identity",
        detail: `vault=${IDENTITY.vault} assetMint=${IDENTITY.assetMint} smartAccount=${IDENTITY.smartAccount} index=${IDENTITY.smartAccountIndex} voltr=${IDENTITY.voltrProgram} customAdaptor=${IDENTITY.customAdaptorProgram} strategyConfig=${IDENTITY.customAdaptorStrategyConfig} candidateWaitingPeriodSeconds=${IDENTITY.candidateWithdrawalWaitingPeriodSeconds}`,
        provenance: "static-inspection",
        bindingState: "candidate-source",
      });

      if (genesis.ok) {
        const matches = genesis.value === IDENTITY.expectedGenesisHash;
        c.add("chain-read", {
          kind: "genesis-hash",
          detail: `expected=${IDENTITY.expectedGenesisHash} observed=${genesis.value} match=${matches}`,
          provenance: "chain-read",
          bindingState: matches ? "chain-verified" : "chain-rejected",
          observedAt,
        });
        if (!matches)
          c.fail(
            `genesis hash ${genesis.value} is not mainnet-beta ${IDENTITY.expectedGenesisHash}`
          );
      } else {
        c.block({
          gate: "mainnet RPC read access",
          owner:
            "Environment owner (needs a non-rate-limited mainnet read endpoint)",
          reason: `getGenesisHash unavailable: ${genesis.error}`,
          resumeCondition:
            "LOYAL_VAULT_DEMO_RPC_URL points at a reachable mainnet read endpoint.",
          measuredEvidence: `attempts=${genesis.attempts}`,
        });
      }

      // Vault account: ownership, finalized context slot, pinned-SDK decode.
      // This verifier's own decode is the proof. The parent task's independent
      // preflight is recorded below as corroboration, never as proof.
      if (vaultAccount.ok && vaultAccount.value) {
        const info = vaultAccount.value;
        const owned = info.owner === IDENTITY.voltrProgram;
        c.add("chain-read", {
          kind: "vault-account",
          detail: `owner=${info.owner} lamports=${info.lamports} dataLength=${info.dataLength} dataSha256=${info.dataSha256} ownerMatchesCandidateVoltr=${owned}`,
          provenance: "chain-read",
          slot: info.contextSlot,
          observedAt,
          bindingState: owned ? "chain-verified" : "chain-rejected",
        });
        if (!owned)
          c.fail(
            `vault account owner ${info.owner} is not the candidate Voltr program`
          );

        const decoded = decodeVaultConfig(info.dataBase64);
        if (!decoded.ok) {
          c.fail(
            `pinned @voltr/vault-sdk getVaultDecoder failed on finalized vault data: ${decoded.error}`
          );
        } else {
          const vault = decoded.value;
          const lastUpdated = render(vault.lastUpdatedTs);
          const lastUpdatedIso = /^\d+$/.test(lastUpdated)
            ? new Date(Number(lastUpdated) * 1000).toISOString()
            : "undecoded";
          c.add("chain-read", {
            kind: "vault-config-decode",
            detail: `manager=${render(vault.manager)} admin=${render(
              vault.admin
            )} pendingAdmin=${render(vault.pendingAdmin)} asset=${render(
              vault.asset
            )} lp=${render(vault.lp)} version=${render(
              vault.version
            )} allowAnyAdaptor=${render(
              vault.allowAnyAdaptor
            )} lastUpdatedTs=${lastUpdated} (${lastUpdatedIso})`,
            provenance: "chain-read",
            slot: info.contextSlot,
            observedAt,
          });
          const numbers = numericLeaves(vault);
          const waitingKey = Object.keys(numbers).find((key) =>
            /withdrawalWaitingPeriod/i.test(key)
          );
          const decayKey = Object.keys(numbers).find((key) =>
            /lockedProfitDegradation/i.test(key)
          );
          const feeKeys = Object.keys(numbers)
            .filter((key) => /maxCap|Fee\b|Fee$|startAtTs/i.test(key))
            .slice(0, 12);
          c.add("chain-read", {
            kind: "vault-terms-decode",
            detail: `withdrawalWaitingPeriod=${
              waitingKey ? `${numbers[waitingKey]}s` : "undecoded"
            } lockedProfitDegradation=${
              decayKey ? `${numbers[decayKey]}s` : "undecoded"
            } capsAndFees=${JSON.stringify(
              Object.fromEntries(feeKeys.map((key) => [key, numbers[key]]))
            )}`,
            provenance: "chain-read",
            slot: info.contextSlot,
            observedAt,
          });
          if (render(vault.manager) !== IDENTITY.smartAccount) {
            c.fail(
              `decoded vault manager ${render(
                vault.manager
              )} is not the expected smart-account vault ${
                IDENTITY.smartAccount
              }`
            );
          }
          // asset and lp are nested structs: { mint, ... }.
          const decodedAssetMint = render(
            (vault.asset as Record<string, unknown> | undefined)?.mint
          );
          const decodedLpMint = render(
            (vault.lp as Record<string, unknown> | undefined)?.mint
          );
          if (decodedAssetMint !== IDENTITY.assetMint) {
            c.fail(
              `decoded vault asset mint ${decodedAssetMint} is not USDC ${IDENTITY.assetMint}`
            );
          }
          if (decodedLpMint !== IDENTITY.expectedLpMint) {
            c.fail(
              `decoded vault LP mint ${decodedLpMint} is not the expected ${IDENTITY.expectedLpMint}`
            );
          }
          if (
            waitingKey &&
            numbers[waitingKey] !==
              String(IDENTITY.expectedWithdrawalWaitingPeriodSeconds)
          ) {
            c.fail(
              `decoded withdrawal waiting period ${numbers[waitingKey]}s does not match expected ${IDENTITY.expectedWithdrawalWaitingPeriodSeconds}s`
            );
          }
          if (
            decayKey &&
            numbers[decayKey] !==
              String(IDENTITY.expectedLockedProfitDegradationSeconds)
          ) {
            c.fail(
              `decoded locked-profit degradation ${numbers[decayKey]}s does not match expected ${IDENTITY.expectedLockedProfitDegradationSeconds}s`
            );
          }
          // Freshness semantics: a manager-write timestamp is not NAV freshness.
          c.add("chain-read", {
            kind: "freshness-semantics",
            detail: `vault lastUpdatedTs=${lastUpdated} (${lastUpdatedIso}) records the manager's last write; RPC slot recency is not NAV freshness. NAV freshness must come from the adaptor's reported NAV age and the worker's own observation, and the UI must show both.`,
            provenance: "chain-read",
            slot: info.contextSlot,
            observedAt,
          });
          // Independent SDK derivation of the LP mint PDA must equal the decoded LP mint.
          const derivedLpMint = await findVaultLpMintPda(
            { vault: address(IDENTITY.vault) },
            { programAddress: address(IDENTITY.voltrProgram) }
          ).then(([mint]) => mint);
          c.add("chain-read", {
            kind: "lp-mint-pda-derivation",
            detail: `findVaultLpMintPda=${derivedLpMint} decodedLpMint=${decodedLpMint} match=${
              derivedLpMint === decodedLpMint
            }`,
            provenance: "chain-read",
            slot: info.contextSlot,
            observedAt,
            bindingState:
              derivedLpMint === decodedLpMint
                ? "chain-verified"
                : "chain-rejected",
          });
          if (derivedLpMint !== decodedLpMint) {
            c.fail(
              `SDK-derived LP mint PDA ${derivedLpMint} does not equal the vault's decoded LP mint ${decodedLpMint}`
            );
          }
        }
      } else if (vaultAccount.ok) {
        c.fail(`candidate vault ${IDENTITY.vault} has no account on chain`);
      } else {
        c.block({
          gate: "mainnet RPC read access",
          owner: "Environment owner",
          reason: `getAccountInfo(vault) unavailable: ${vaultAccount.error}`,
          resumeCondition: "Reachable mainnet read endpoint configured.",
        });
      }

      // USDC mint decimals/supply decode (independent SPL layout decode).
      if (assetMintAccount.ok && assetMintAccount.value) {
        const mint = ChainReader.decodeMint(assetMintAccount.value);
        const ownerMatches =
          assetMintAccount.value.owner === IDENTITY.tokenProgram;
        c.add("chain-read", {
          kind: "asset-mint",
          detail: `owner=${assetMintAccount.value.owner} decimals=${
            mint?.decimals ?? "undecoded"
          } supplyRaw=${
            mint?.supplyRaw ?? "undecoded"
          } ownerMatchesTokenProgram=${ownerMatches}`,
          provenance: "chain-read",
          slot: assetMintAccount.value.contextSlot,
          observedAt,
          bindingState:
            ownerMatches && mint?.decimals === IDENTITY.assetDecimals
              ? "chain-verified"
              : "chain-rejected",
        });
        if (!ownerMatches)
          c.fail(
            `asset mint owner ${assetMintAccount.value.owner} is not the SPL token program`
          );
        if (mint && mint.decimals !== IDENTITY.assetDecimals)
          c.fail(
            `asset mint decimals ${mint.decimals} != ${IDENTITY.assetDecimals}`
          );
      } else if (assetMintAccount.ok) {
        c.fail(`USDC mint ${IDENTITY.assetMint} has no account on chain`);
      } else {
        c.block({
          gate: "mainnet RPC read access",
          owner: "Environment owner",
          reason: `getAccountInfo(USDC mint) unavailable: ${assetMintAccount.error}`,
          resumeCondition: "Reachable mainnet read endpoint configured.",
        });
      }

      // Smart account / Voltr manager. The pinned-SDK vault decode above is the
      // binding that user flows actually depend on. A Squads vault PDA is
      // legitimately system-owned with zero data bytes, so account ownership
      // proves nothing about the claimed index: index confirmation requires the
      // Squads settings account decoded with the actual Smart Account SDK, and
      // no guessed seed layout is acceptable.
      if (smartAccount.ok && smartAccount.value) {
        const info = smartAccount.value;
        c.add("chain-read", {
          kind: "smart-account",
          detail: `smart-account vault ${IDENTITY.smartAccount} owner=${info.owner} lamports=${info.lamports} dataLength=${info.dataLength} (system-owned zero-data is a valid Squads vault PDA form; it does not imply an ordinary keypair wallet)`,
          provenance: "chain-read",
          slot: info.contextSlot,
          observedAt,
          bindingState: "candidate-source",
        });
        // Index confirmation comes from the canonical Smart Account SDK
        // derivation against the pinned settings account; no hand-rolled seeds.
        const derivedIndex0 = getSmartAccountPda({
          settingsPda: new PublicKey(IDENTITY.squadsSettings),
          accountIndex: 0,
        })[0].toBase58();
        const derivedIndex1 = getSmartAccountPda({
          settingsPda: new PublicKey(IDENTITY.squadsSettings),
          accountIndex: 1,
        })[0].toBase58();
        const index0Matches = derivedIndex0 === IDENTITY.smartAccount;
        const index1IsConsumerEarn =
          derivedIndex1 === IDENTITY.expectedConsumerEarnSmartAccount;
        c.add("static-inspection", {
          kind: "smart-account-derivation",
          detail: `getSmartAccountPda(settings ${IDENTITY.squadsSettings}) index0=${derivedIndex0} (target, match=${index0Matches}) index1=${derivedIndex1} (consumer Earn, match=${index1IsConsumerEarn})`,
          provenance: "static-inspection",
        });
        if (!index0Matches)
          c.fail(
            `SDK-derived smart-account index 0 ${derivedIndex0} is not the pinned manager ${IDENTITY.smartAccount}`
          );
        if (!index1IsConsumerEarn)
          c.fail(
            `SDK-derived smart-account index 1 ${derivedIndex1} is not the known consumer Earn vault ${IDENTITY.expectedConsumerEarnSmartAccount}`
          );
      } else if (smartAccount.ok) {
        c.fail(
          `candidate smart account ${IDENTITY.smartAccount} has no account on chain`
        );
      } else {
        c.block({
          gate: "mainnet RPC read access",
          owner: "Environment owner",
          reason: `getAccountInfo(smart account) unavailable: ${smartAccount.error}`,
          resumeCondition: "Reachable mainnet read endpoint configured.",
        });
      }

      if (voltrProgram.ok && voltrProgram.value) {
        c.add("chain-read", {
          kind: "voltr-program",
          detail: `on-chain program ${IDENTITY.voltrProgram} executable=${voltrProgram.value.executable} owner=${voltrProgram.value.owner} dataLength=${voltrProgram.value.dataLength}`,
          provenance: "chain-read",
          slot: voltrProgram.value.contextSlot,
          observedAt,
          bindingState: "chain-verified",
        });
      }

      // Adaptor/strategy bindings are proven by decoding receipts with the
      // pinned SDK (owner, vault, adaptor/strategy fields), never by existence
      // alone. allowAnyAdaptor is decoded from the vault account and reported
      // alongside: while it is set, a missing adaptor-add receipt does NOT
      // establish that an adaptor or strategy is inactive, so absence is an
      // unproven binding, never a rejection of the adaptor itself. An RPC
      // failure is unknown and blocks, never rejects.
      const vaultForFlags =
        vaultAccount.ok && vaultAccount.value
          ? decodeVaultConfig(vaultAccount.value.dataBase64)
          : ({ ok: false, error: "vault account unavailable" } as const);
      const allowAnyAdaptorFlag = vaultForFlags.ok
        ? render(vaultForFlags.value["allowAnyAdaptor"])
        : "unknown";
      const lanes = [
        {
          label: "custom",
          adaptorProgram: IDENTITY.customAdaptorProgram,
          strategy: IDENTITY.customAdaptorStrategyConfig,
          holdingAta: null as string | null,
        },
        {
          label: "trustful",
          adaptorProgram: IDENTITY.trustfulAdaptorProgram,
          strategy: IDENTITY.trustfulStrategy,
          holdingAta: IDENTITY.trustfulHoldingAta,
        },
      ];
      const adaptorAddDecoder = getAdaptorAddReceiptDecoder();
      const strategyInitDecoder = getStrategyInitReceiptDecoder();
      const decodeOrError = <T>(
        decoder: { decode: (bytes: Uint8Array) => T },
        bytes: Uint8Array
      ): { ok: true; value: T } | { ok: false; error: string } => {
        try {
          return { ok: true, value: decoder.decode(bytes) };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      };
      for (const lane of lanes) {
        const [receiptPda] = await findAdaptorAddReceiptPda(
          {
            vault: address(IDENTITY.vault),
            adaptorProgram: address(lane.adaptorProgram),
          },
          { programAddress: address(IDENTITY.voltrProgram) }
        );
        const receipt = await chain.getAccountInfo(receiptPda);
        if (!receipt.ok) {
          c.block({
            gate: "mainnet RPC read access",
            owner: "Environment owner",
            reason: `adaptor-add receipt ${receiptPda} (${lane.label}) read unavailable: ${receipt.error}`,
            resumeCondition: "Reachable mainnet read endpoint configured.",
          });
        } else if (!receipt.value) {
          c.add("chain-read", {
            kind: "adaptor-add-receipt",
            detail: `${lane.label} adaptor ${lane.adaptorProgram}: adaptor-add receipt ${receiptPda} absent; allowAnyAdaptor=${allowAnyAdaptorFlag}, so this does not establish inactivity or non-use`,
            provenance: "chain-read",
            observedAt,
            bindingState: "unavailable",
          });
        } else {
          const decoded = decodeOrError(
            adaptorAddDecoder,
            Buffer.from(receipt.value.dataBase64, "base64")
          );
          const fieldsMatch =
            decoded.ok &&
            decoded.value.vault === address(IDENTITY.vault) &&
            decoded.value.adaptorProgram === address(lane.adaptorProgram) &&
            receipt.value.owner === IDENTITY.voltrProgram;
          c.add("chain-read", {
            kind: "adaptor-add-receipt",
            detail: `${lane.label} adaptor ${
              lane.adaptorProgram
            }: receipt ${receiptPda} decoded=${decoded.ok} vault=${render(
              decoded.ok ? decoded.value.vault : null
            )} adaptorProgram=${render(
              decoded.ok ? decoded.value.adaptorProgram : null
            )} owner=${
              receipt.value.owner
            } fieldsMatch=${fieldsMatch} allowAnyAdaptor=${allowAnyAdaptorFlag}`,
            provenance: "chain-read",
            slot: receipt.value.contextSlot,
            observedAt,
            bindingState: fieldsMatch ? "chain-verified" : "chain-rejected",
          });
          if (!decoded.ok)
            c.fail(
              `adaptor-add receipt ${receiptPda} does not decode with the pinned SDK: ${decoded.error}`
            );
          if (decoded.ok && !fieldsMatch)
            c.fail(
              `adaptor-add receipt ${receiptPda} is not bound to vault ${IDENTITY.vault} + adaptor ${lane.adaptorProgram} under program ${IDENTITY.voltrProgram}`
            );
        }

        const [initReceiptPda] = await findStrategyInitReceiptPda(
          {
            vault: address(IDENTITY.vault),
            strategy: address(lane.strategy),
          },
          { programAddress: address(IDENTITY.voltrProgram) }
        );
        const initReceipt = await chain.getAccountInfo(initReceiptPda);
        if (!initReceipt.ok) {
          c.block({
            gate: "mainnet RPC read access",
            owner: "Environment owner",
            reason: `strategy-init receipt ${initReceiptPda} (${lane.label}) read unavailable: ${initReceipt.error}`,
            resumeCondition: "Reachable mainnet read endpoint configured.",
          });
        } else if (!initReceipt.value) {
          c.add("chain-read", {
            kind: "strategy-init-receipt",
            detail: `${lane.label} strategy ${lane.strategy}: strategy-init receipt ${initReceiptPda} absent — not provably bound to this vault; the catalog may fund other lanes, and this is not proof the strategy is inactive elsewhere`,
            provenance: "chain-read",
            observedAt,
            bindingState: "chain-rejected",
          });
        } else {
          const decoded = decodeOrError(
            strategyInitDecoder,
            Buffer.from(initReceipt.value.dataBase64, "base64")
          );
          const fieldsMatch =
            decoded.ok &&
            decoded.value.vault === address(IDENTITY.vault) &&
            decoded.value.strategy === address(lane.strategy) &&
            decoded.value.adaptorProgram === address(lane.adaptorProgram) &&
            initReceipt.value.owner === IDENTITY.voltrProgram;
          c.add("chain-read", {
            kind: "strategy-init-receipt",
            detail: `${lane.label} strategy ${
              lane.strategy
            }: receipt ${initReceiptPda} decoded=${decoded.ok} vault=${render(
              decoded.ok ? decoded.value.vault : null
            )} strategy=${render(
              decoded.ok ? decoded.value.strategy : null
            )} adaptorProgram=${render(
              decoded.ok ? decoded.value.adaptorProgram : null
            )} positionValue=${render(
              decoded.ok ? decoded.value.positionValue : null
            )} lastUpdatedTs=${render(
              decoded.ok ? decoded.value.lastUpdatedTs : null
            )} (strategy receipt time, distinct from vault lastUpdatedTs) fieldsMatch=${fieldsMatch}`,
            provenance: "chain-read",
            slot: initReceipt.value.contextSlot,
            observedAt,
            bindingState: fieldsMatch ? "chain-verified" : "chain-rejected",
          });
          if (!decoded.ok)
            c.fail(
              `strategy-init receipt ${initReceiptPda} does not decode with the pinned SDK: ${decoded.error}`
            );
          if (decoded.ok && !fieldsMatch)
            c.fail(
              `strategy-init receipt ${initReceiptPda} is not bound to vault ${IDENTITY.vault} + strategy ${lane.strategy} + adaptor ${lane.adaptorProgram}`
            );
        }

        if (lane.holdingAta) {
          const holding = await chain.getAccountInfo(lane.holdingAta);
          if (!holding.ok) {
            c.block({
              gate: "mainnet RPC read access",
              owner: "Environment owner",
              reason: `strategy holding ATA ${lane.holdingAta} read unavailable: ${holding.error}`,
              resumeCondition: "Reachable mainnet read endpoint configured.",
            });
          } else if (holding.value) {
            const bytes = Buffer.from(holding.value.dataBase64, "base64");
            const balance =
              bytes.byteLength >= 72 ? bytes.readBigUInt64LE(64) : null;
            c.add("chain-read", {
              kind: "strategy-custody",
              detail: `${lane.label} strategy holding ATA ${
                lane.holdingAta
              } owner=${holding.value.owner} balanceRaw=${
                balance === null ? "undecodable" : balance.toString()
              } (lane custody, not yet attributed inside NAV reconciliation)`,
              provenance: "chain-read",
              slot: holding.value.contextSlot,
              observedAt,
              bindingState: balance === null ? "unavailable" : "chain-verified",
            });
          } else {
            c.add("chain-read", {
              kind: "strategy-custody",
              detail: `${lane.label} strategy holding ATA ${lane.holdingAta} does not exist on chain`,
              provenance: "chain-read",
              observedAt,
              bindingState: "unavailable",
            });
          }
        }
      }
      c.add("static-inspection", {
        kind: "adaptor-authority-note",
        detail: `vault decodes allowAnyAdaptor=${allowAnyAdaptorFlag}: any adaptor binding change by the runtime invalidates this app's binding assumptions and must be re-proven from receipts`,
        provenance: "static-inspection",
      });

      if (strategyConfig.ok && strategyConfig.value) {
        const ownedByCandidateAdaptor =
          strategyConfig.value.owner === IDENTITY.customAdaptorProgram;
        c.add("chain-read", {
          kind: "strategy-config-account",
          detail: `custom adaptor strategy config ${IDENTITY.customAdaptorStrategyConfig} owner=${strategyConfig.value.owner} dataLength=${strategyConfig.value.dataLength} dataSha256=${strategyConfig.value.dataSha256} ownedByCandidateAdaptorProgram=${ownedByCandidateAdaptor}`,
          provenance: "chain-read",
          slot: strategyConfig.value.contextSlot,
          observedAt,
          bindingState: ownedByCandidateAdaptor
            ? "chain-verified"
            : "chain-rejected",
        });
        if (!ownedByCandidateAdaptor) {
          c.fail(
            `strategy config owner ${strategyConfig.value.owner} is not the candidate custom adaptor program`
          );
        }
        const config = decodeAdaptorConfig({
          address: strategyConfig.value.address,
          owner: strategyConfig.value.owner,
          lamports: strategyConfig.value.lamports,
          data: Buffer.from(strategyConfig.value.dataBase64, "base64"),
        }, IDENTITY.customAdaptorStrategyConfig);
        if (!config.ok) {
          c.fail(`custom adaptor config decode failed: ${config.reason}`);
        } else {
          if (!config.bindingsMatchPinned)
            c.fail(`custom adaptor binding mismatch: ${config.bindingMismatches.join("; ")}`);
          c.add("chain-read", {
            kind: "adaptor-report-config",
            detail: `version=${config.version} vaultIndex=${config.vaultIndex} bindingsMatchPinned=${config.bindingsMatchPinned} maxReportNavRaw=${config.maxReportNavRaw} maxReportAgeSlots=${config.maxReportAgeSlots} reservedReportFields=zero. Account decoding does not prove deployed program enforcement or service readiness.`,
            provenance: "chain-read",
            slot: strategyConfig.value.contextSlot,
            observedAt,
            bindingState: config.bindingsMatchPinned ? "chain-verified" : "chain-rejected",
          });
          // Repaired 2026-09-17: this was an unconditional failure, so a
          // healthy release with a real consumed report could never pass. The
          // v2 config's reserved zero report fields are expected semantics,
          // never report evidence. NAV freshness instead requires actual
          // bounded consumed-report proof against a coherent batch read here;
          // the fail-closed branch below keeps R00 failing while no fresh
          // pinned consumed proof exists (the current runtime state).
          const navEvidenceStartedAt = performance.now();
          const navBatch = await deriveVaultBatchAddresses();
          const navIdleAuthority = await deriveIdleAuthority();
          const navBatchRead = await new BoundedRpc(rpcUrl).getMultipleAccounts(
            navBatch.map((entry) => entry.address)
          );
          if (!navBatchRead.ok) {
            c.block({
              gate: "mainnet RPC read access",
              owner: "Environment owner",
              reason: `coherent NAV evidence batch read unavailable: ${navBatchRead.error}`,
              resumeCondition: "Reachable mainnet read endpoint configured.",
            });
          } else {
            const navCore = buildCoherentVaultCore(
              navBatch,
              navBatchRead.value,
              navBatchRead.contextSlot ?? -1,
              { idleAuthority: navIdleAuthority }
            );
            if (!navCore.ok) {
              c.fail(`the coherent NAV evidence batch did not validate: ${navCore.reason}`);
            } else {
              const { readConsumedReport } = await import(
                "../src/features/vault/server/consumed-report"
              );
              // Bounded by readConsumedReport's internal min(3s, 15s from
              // navEvidenceStartedAt) deadline against this same batch.
              const report = await readConsumedReport(navCore.core, navEvidenceStartedAt);
              if (
                report.status === "fresh" &&
                report.reportSignature &&
                report.reportConfirmedSlot &&
                report.bindingsMatchPinned === true
              ) {
                c.add("reconciliation", {
                  kind: "consumed-report-nav-freshness",
                  detail: `A finalized consumed REPORT_NAV (signature ${report.reportSignature}, confirmed slot ${report.reportConfirmedSlot}, sequence ${report.lastSequence}, navRaw ${report.lastNavRaw}, NAV age ${report.navAgeSeconds} seconds < ${report.maxNavAgeSeconds}; consumed within ${report.maxReportAgeSlots} slots) matches this batch's disarmed ticket and strategy receipt at slot ${navCore.core.slot}. Reserved zero config fields are semantics; this finalized evidence, not the config decode, carries NAV freshness.`,
                  provenance: "reconciliation",
                  slot: navCore.core.slot,
                  observedAt: new Date().toISOString(),
                });
              } else {
                c.fail(
                  `NAV freshness remains unproven from consumed-report evidence: ${report.detail}`
                );
              }
            }
          }
        }
      } else if (strategyConfig.ok) {
        c.fail(
          `candidate custom adaptor strategy config ${IDENTITY.customAdaptorStrategyConfig} has no account on chain`
        );
      }

      // Remaining Voltr PDAs are derived with the pinned SDK and recorded as
      // derivations; their on-chain state is read in later checkpoints.
      const derivedPdas = await deriveVoltrPdaSurface();
      c.add("chain-read", {
        kind: "voltr-pda-surface",
        detail: `pinned @voltr/vault-sdk derivations: ${derivedPdas
          .map((entry) => `${entry.label}=${entry.address}`)
          .join(" ")}`,
        provenance: "chain-read",
        observedAt,
      });
      c.missing_(
        "per-strategy reported values and custodies are not decoded and attributed inside the NAV reconciliation yet, so strategy exposure beyond idle custody stays unknown (R02 reports it without zero-filling)"
      );

      // Corroboration from the parent task's independent finalized decode. It
      // locates and cross-checks an observation; it is never itself proof.
      const corroborationPath =
        "/private/tmp/loyal-vault-demo-chain-preflight.json";
      if (existsSync(corroborationPath)) {
        const corroborating = JSON.parse(
          readFileSync(corroborationPath, "utf8")
        ) as {
          slot?: number;
          observedAt?: string;
          vault?: Record<string, unknown>;
        };
        const corroboratedManager = render(corroborating.vault?.manager);
        c.add("static-inspection", {
          kind: "independent-corroboration",
          detail: `parent preflight at slot ${corroborating.slot} (${
            corroborating.observedAt
          }) decoded manager=${corroboratedManager}; agreement=${
            corroboratedManager === IDENTITY.smartAccount
          }; corroboration only, never proof`,
          provenance: "chain-read",
          path: corroborationPath,
          slot: corroborating.slot,
          observedAt: corroborating.observedAt,
        });
      }
      if (!protocolAccount.ok || !protocolAccount.value) {
        c.fail("Canonical Voltr protocol account is unavailable");
      } else {
        const info = protocolAccount.value;
        const bytes = Buffer.from(info.dataBase64, "base64");
        if (info.owner !== IDENTITY.voltrProgram || info.executable || bytes.length !== getProtocolDecoder().fixedSize ||
          !PROTOCOL_DISCRIMINATOR.every((byte, index) => bytes[index] === byte)) {
          c.fail("Canonical Voltr protocol account owner/layout mismatch");
        } else {
          const protocol = getProtocolDecoder().decode(bytes);
          if (protocol.bump !== protocolBump) c.fail("Protocol bump does not match independent PDA derivation");
          c.add("chain-read", {
            kind: "protocol-authorities",
            detail: `address=${protocolAddress} admin=${protocol.admin} treasury=${protocol.treasury} operationalState=${protocol.operationalState} dataSha256=${info.dataSha256}. The pinned SDK stores fee rates in vault.feeConfiguration, not this protocol account. Raw operational bits are observed, not interpreted as proven permission to transact.`,
            provenance: "chain-read", slot: info.contextSlot, observedAt,
          });
        }
      }
      c.missing_(
        "vault fee/term fields and protocol authorities are decoded; deployed program enforcement of deposit restrictions, operational flags and fee rules remains unproven"
      );
      c.missing_(
        "R00 feasibility question unanswered: whether current NAV refresh safely supports an unrelated user's deposit/request while the manager is active, and whether existing limits service partner deposits/exits (canary budget excluded)"
      );

      // Pinned SDK presence is an implementation prerequisite, not a gate.
      const sdk = await probeVoltrSdk();
      c.add("static-inspection", {
        kind: "pinned-sdk",
        detail: sdk.available
          ? `@voltr/vault-sdk ${
              sdk.version
            } resolvable; user surface exports present: ${sdk.userSurface.join(
              ", "
            )}`
          : `@voltr/vault-sdk not resolvable yet (${sdk.reason})`,
        provenance: "static-inspection",
      });
      if (!sdk.available)
        c.missing_(
          "pinned Voltr SDK is not installed/resolvable for this app yet"
        );
      return c;
    }
  );

  /* ---------------------------------------------------- R01 */
  await run(
    "R01",
    "Exact application and signer boundary",
    "One demo app, one bound vault, only deposit/request-withdraw/claim money actions, no extra manager writer or privileged signing capability; runtime input rejection of manipulated wallet/vault/destination/amount/program; no credential exposure in client assets; no unrestricted RPC proxy.",
    async (c) => {
      c.add("static-inspection", {
        kind: "app-inventory",
        detail: `expected app files present: ${
          inventory().filter((entry) => entry.present).length
        }/${
          EXPECTED_APP_FILES.length
        }; app source files total=${appFileCount()}`,
        provenance: "static-inspection",
      });
      for (const entry of inventory().filter(
        (candidate) => !candidate.present
      )) {
        c.missing_(`missing ${entry.kind}: ${entry.path}`);
      }
      const workspaceRegistered = readFileSync(
        resolve(REPO_ROOT, "package.json"),
        "utf8"
      ).includes('"apps/loyal-vault-demo"');
      c.add("static-inspection", {
        kind: "workspace-registration",
        detail: `root workspaces list contains apps/loyal-vault-demo=${workspaceRegistered}`,
        provenance: "static-inspection",
      });
      if (!workspaceRegistered)
        c.missing_("root workspace registration for apps/loyal-vault-demo");

      const { parsePrepareRequest } = await import("../src/features/vault/domain/transactions");
      const wallet = "BAqgbERmvUViqDSx961xpRBHGt68SpACiWL4t9696qZZ";
      const validDeposit = { action: "deposit", wallet, amountRaw: "1000000" };
      if (!parsePrepareRequest(validDeposit).ok) c.fail("valid deposit input rejected");
      let inputCases = 0;
      for (const manipulated of [
        { ...validDeposit, recipient: wallet }, { ...validDeposit, vault: wallet },
        { ...validDeposit, program: wallet }, { ...validDeposit, mint: wallet },
        { ...validDeposit, amountRaw: 1000000 }, { ...validDeposit, amountRaw: "0" },
        { ...validDeposit, amountRaw: "1.5" }, { ...validDeposit, amountRaw: "1e6" },
        { ...validDeposit, amountRaw: "-1" }, { ...validDeposit, amountRaw: "18446744073709551616" },
        { ...validDeposit, action: "instant-withdraw" }, { ...validDeposit, wallet: IDENTITY.vault },
        { action: "claim", wallet, amountRaw: "1" }, { action: "claim", wallet, recipient: wallet },
      ]) {
        if (parsePrepareRequest(manipulated).ok) c.fail(`manipulated prepare request accepted: ${JSON.stringify(manipulated)}`);
        inputCases++;
      }
      c.add("controlled-runtime", {
        kind: "prepare-input-boundary",
        detail: `${inputCases} manipulated money-action inputs rejected by the production parser; one valid deposit accepted. No signing or submission.`,
        provenance: "controlled-runtime",
      });
      c.missing_("browser bundle credential boundary and deployed application configuration remain unverified");
      c.missing_("no deployment resources to inspect (hosting gate open)");
      return c;
    }
  );

  /* ---------------------------------------------------- R02 */
  await run(
    "R02",
    "Truthful overview, position and allocation",
    "Rendered overview/wallet panel agree with fresh chain reads: USDC/LP balances, LP supply/share valuation, fees, idle liquidity, escrowed shares, pending redemption; disjoint allocation components reconciled against Voltr NAV; no double counting, no unknown nonzero remainder; declared freshness/rounding parameters.",
    async (c) => {
      c.add("static-inspection", {
        kind: "measurement-parameters",
        detail: `freshness=${JSON.stringify(
          BOUNDS.freshness
        )} declared before baseline`,
        provenance: "static-inspection",
      });
      const { verifyTokenHoldings, verifyTokenDiscoveryConsistency } = await import("./verify-token-holdings");
      await verifyTokenDiscoveryConsistency();
      const holdingsChecks = verifyTokenHoldings();
      c.add("controlled-runtime", { kind: "token-holdings-validation", detail: `${holdingsChecks.passed} token and mint binding, raw precision, frozen-state and unavailable metadata checks across SPL and Token-2022`, provenance: "controlled-runtime" });
      const { getTokenHoldings } = await import("../src/features/vault/server/token-holdings");
      const holdings = await getTokenHoldings();
      if (!holdings.ok) c.fail(`Smart account holdings unavailable: ${holdings.reason}`);
      else c.add("chain-read", { kind: "smart-account-token-holdings", detail: `accounts=${holdings.observation.holdings.length} nonzero=${JSON.stringify(holdings.observation.holdings.filter(row => BigInt(row.raw) > 0n))}; separate from priced vault NAV`, provenance: "chain-read", slot: holdings.observation.observedSlot, observedAt: holdings.observation.observedAt });
      const { verifyKaminoDecoder } = await import("./verify-kamino");
      const kaminoChecks = verifyKaminoDecoder();
      c.add("controlled-runtime", {
        kind: "kamino-obligation-wire",
        detail: `${kaminoChecks.passed} controlled cases: every collateral/debt slot, full-width raw integers, invalid ownership/layout rejection. Live funded positions and reserve valuation remain unproven.`,
        provenance: "controlled-runtime",
      });
      // The app read model is exercised directly: same code path as the API.
      process.env.LOYAL_VAULT_DEMO_RPC_URL = rpcUrl;
      const readModel = await import(
        "../src/features/vault/server/vault-observation"
      );
      const positionModel = await import(
        "../src/features/vault/server/position"
      );

      const vaultRead = await readModel.getVaultObservation();
      if (!vaultRead.ok) {
        if (vaultRead.kind === "rpc-error") {
          c.block({
            gate: "mainnet RPC read access",
            owner: "Environment owner",
            reason: `app read model unavailable: ${vaultRead.reason}`,
            resumeCondition: "Reachable mainnet read endpoint configured.",
          });
        } else {
          c.fail(
            `app read model returned a decode/identity error: ${vaultRead.reason}`
          );
        }
        return c;
      }
      const { observation, snapshot } = vaultRead;
      const identityMatches =
        observation.identity.vault === IDENTITY.vault &&
        observation.identity.assetMint === IDENTITY.assetMint &&
        observation.identity.lpMint === IDENTITY.expectedLpMint &&
        observation.identity.manager === IDENTITY.smartAccount &&
        observation.identity.voltrProgram === IDENTITY.voltrProgram;
      c.add("chain-read", {
        kind: "read-model-observation",
        detail: `app read model observed vault ${observation.identity.vault} assetTotalValue=${observation.assetTotalValue.raw} idleCustody=${observation.idleCustody.raw} lpSupply=${observation.lpSupplyBreakdown.circulating} reconciliation=${observation.allocation.reconciliation} unknownComponents=${observation.allocation.unknownExposure.length} slot=${observation.freshness.observedSlot} identityMatches=${identityMatches} snapshotCoherent=${observation.freshness.snapshotCoherent}`,
        provenance: "chain-read",
        slot: observation.freshness.observedSlot,
        observedAt: observation.valuation.observedAt,
        bindingState: identityMatches ? "chain-verified" : "chain-rejected",
      });
      if (!identityMatches)
        c.fail("read model identity does not match the pinned identity");
      if (observation.freshness.observedSlot <= 0)
        c.fail("read model reported no finalized context slot for its reads");
      for (const [component, slot] of Object.entries(
        observation.freshness.componentSlots
      )) {
        if (typeof slot !== "number" || slot <= 0)
          c.fail(
            `read model component ${component} has no real observation slot`
          );
      }
      c.add("chain-read", {
        kind: "nav-freshness-disclosure",
        detail: `vaultLastUpdatedTs=${observation.freshness.vaultLastUpdatedTsIso} is a manager-write timestamp, not NAV freshness; freshness is the per-read slot/time evidence above, and strategy receipt lastUpdatedTs is reported separately by R00`,
        provenance: "chain-read",
        slot: observation.freshness.observedSlot,
        observedAt: observation.valuation.observedAt,
      });

      // LP accounting reconciliation, measured from the live snapshot.
      const breakdown = observation.lpSupplyBreakdown;
      const sumComponents =
        BigInt(breakdown.circulating) +
        BigInt(breakdown.unharvestedFees) +
        BigInt(breakdown.deadWeight) +
        BigInt(breakdown.unrealisedFees);
      if (sumComponents !== BigInt(breakdown.total))
        c.fail(
          `LP components (${breakdown.circulating}+${breakdown.unharvestedFees}+${breakdown.deadWeight}+${breakdown.unrealisedFees}) do not sum to total ${breakdown.total}`
        );
      if (BigInt(breakdown.circulating) !== snapshot.lpSupply)
        c.fail(
          "read model circulating LP is not the mint supply of the same snapshot"
        );
      if (BigInt(breakdown.total) < snapshot.lpSupply)
        c.fail("accounted LP total is smaller than the circulating supply");
      const perLp = observation.perLpQuote;
      if (BigInt(breakdown.total) > 0n) {
        const recomputed =
          (snapshot.assetTotalValue * BigInt(perLp.lpUnitRaw)) /
          BigInt(breakdown.total);
        if (recomputed !== BigInt(perLp.raw))
          c.fail(
            `per-LP quote ${perLp.raw} != floor(NAV x LP unit / total) = ${recomputed}`
          );
        // The per-whole-LP quote is floor(NAV x LP unit / accounted supply).
        // It can exceed the whole NAV only when less than one whole LP unit is
        // outstanding, which is a legitimate state for a young vault.
        if (
          BigInt(breakdown.total) >= BigInt(perLp.lpUnitRaw) &&
          BigInt(perLp.raw) > snapshot.assetTotalValue
        )
          c.fail(
            "per-LP quote exceeds the whole reported NAV while at least one whole LP is outstanding"
          );
        if (
          BigInt(breakdown.total) < BigInt(perLp.lpUnitRaw) &&
          BigInt(perLp.raw) <= snapshot.assetTotalValue
        )
          c.add("chain-read", {
            kind: "sub-unit-supply",
            detail: `accounted supply ${breakdown.total} is below one whole LP unit ${perLp.lpUnitRaw}, so the per-whole-LP quote ${perLp.raw} legitimately exceeds NAV ${snapshot.assetTotalValue}`,
            provenance: "chain-read",
            slot: observation.freshness.observedSlot,
            observedAt: observation.valuation.observedAt,
          });
      }

      // Exact-accounting boundary invariants against this snapshot.
      if (lpForDepositAmount(snapshot, 0n) !== 0n)
        c.fail("zero deposit must mint zero LP");
      if (snapshot.lpSupply > 0n && snapshot.assetTotalValue > 0n && assetsForWithdrawAmount(snapshot, 0n) !== 0n)
        c.fail("zero LP burn must pay zero assets");
      if (
        decimalBitsToRaw(0n) !== "0" ||
        decimalBitsToRaw((1n << 48n) - 1n) !== "0"
      )
        c.fail(
          "decimal-bits conversion must floor fractional bits to zero raw units"
        );
      if (decimalBitsToRaw(1_000_000n << 48n) !== "1000000")
        c.fail(
          `decimalBitsToRaw(1_000_000n << 48n) returned ${decimalBitsToRaw(
            1_000_000n << 48n
          )}, expected "1000000"`
        );
      if (decimalBitsToRaw((1_500_000n << 48n) + 2n ** 47n) !== "1500000")
        c.fail(
          "mid-scale decimal bits with a set top fractional bit did not floor to the whole raw amount"
        );
      if (snapshot.lpSupply <= 0n || snapshot.assetTotalValue <= 0n) {
        // The pinned SDK rejects withdrawals without circulating supply/assets.
        // Verify that refusal; do not invent a funded snapshot or a zero payout.
        for (const quote of [
          () => assetsForWithdrawAmount(snapshot, 1n),
          () => lpForWithdrawAmount(snapshot, 1n),
        ]) {
          let refused = false;
          try { quote(); } catch (error) {
            refused = error instanceof Error && ["Invalid LP supply", "Invalid total assets"].includes(error.message);
          }
          if (!refused) c.fail("empty-vault withdrawal quote did not refuse with its supply/assets gate");
        }
        c.add("chain-read", {
          kind: "empty-vault-withdrawal-refusal",
          detail: `circulating LP=${snapshot.lpSupply}, NAV=${snapshot.assetTotalValue}; positive withdrawal quotes refuse. Funded withdrawal and receipt arithmetic remain unverified by this empty snapshot.`,
          provenance: "chain-read",
          slot: observation.freshness.observedSlot,
          observedAt: observation.valuation.observedAt,
        });
      } else {
      for (const requestRaw of [1n, 1_000n, 123_456_789n]) {
        const lpNeeded = lpForWithdrawAmount(snapshot, requestRaw);
        if (assetsForWithdrawAmount(snapshot, lpNeeded) < requestRaw)
          c.fail(
            `redemption rounding favours the vault: request ${requestRaw} -> lp ${lpNeeded}`
          );
      }
      if (
        BigInt(breakdown.total) > 0n &&
        lpForDepositAmount(snapshot, 10n ** BigInt(snapshot.lpDecimals)) <= 0n
      )
        c.fail("a whole-LP deposit must mint positive LP while supply exists");
      const wholeSupplyPayout = assetsForWithdrawAmount(
        snapshot,
        snapshot.lpSupply
      );
      if (wholeSupplyPayout > snapshot.assetTotalValue)
        c.fail(
          "burning all circulating LP must never pay more than reported NAV"
        );
      const oneLp = 10n ** BigInt(snapshot.lpDecimals);
      const atPresent = assetsForWithdrawAmount(snapshot, oneLp);
      const lowerAtRequest = atPresent > 0n ? atPresent - 1n : 0n;
      const effectivePresentWins = receiptEffectiveAssetRaw(snapshot, {
        amountLpEscrowed: oneLp,
        amountAssetToWithdrawDecimalBits: atPresent << 48n,
      });
      const effectiveRequestWins = receiptEffectiveAssetRaw(snapshot, {
        amountLpEscrowed: oneLp,
        amountAssetToWithdrawDecimalBits: lowerAtRequest << 48n,
      });
      if (BigInt(effectivePresentWins.effectiveRaw) !== atPresent)
        c.fail(
          "effective payout must equal the current-snapshot amount when the request amount is not lower"
        );
      if (BigInt(effectiveRequestWins.effectiveRaw) !== lowerAtRequest)
        c.fail("effective payout must equal the lower request-time amount");
      c.add("chain-read", {
        kind: "exact-accounting-invariants",
        detail: `zero-amount boundaries hold; floor(decimal bits)=0; whole-supply burn payout=${wholeSupplyPayout} <= NAV=${snapshot.assetTotalValue}; deposit of 1 whole LP mints positive LP; receipt payout = min(at-request, at-present) verified in both directions`,
        provenance: "chain-read",
        slot: observation.freshness.observedSlot,
        observedAt: observation.valuation.observedAt,
      });

      }

      // Allocation: unknown nonzero exposure is reported, never zero-filled.
      const allocation = observation.allocation;
      if (allocation.reconciliation === "unavailable")
        c.fail(
          "allocation components are marked unavailable by the read model"
        );
      const unknownTotal = allocation.unknownExposure.reduce(
        (acc, entry) => acc + BigInt(entry.amount.raw),
        0n
      );
      c.add("chain-read", {
        kind: "allocation-reconciliation",
        detail: `knownTotal=${
          allocation.knownTotalRaw
        } unknownExposure=${unknownTotal} components=${allocation.components
          .map((entry) => `${entry.key}:${entry.kind}:${entry.amount.raw}`)
          .join(" ")} reconciliation=${allocation.reconciliation}`,
        provenance: "chain-read",
        slot: observation.freshness.observedSlot,
        observedAt: observation.valuation.observedAt,
      });
      if (unknownTotal > 0n)
        c.missing_(
          "reported NAV differs from measured custody; manager strategy accounting is disclosed separately and cannot prove or fill the remainder"
        );

      // Wallet parsing must reject every forbidden parameter value.
      for (const forbidden of [
        IDENTITY.vault,
        IDENTITY.expectedLpMint,
        IDENTITY.assetMint,
        IDENTITY.voltrProgram,
        "!!!not-a-base58-address",
      ]) {
        const rejected = await positionModel.getPositionObservation(forbidden);
        if (rejected.ok || rejected.unavailable.kind !== "invalid-input")
          c.fail(`wallet parsing accepted a forbidden value: ${forbidden}`);
      }
      const missingWallet = await positionModel.getPositionObservation(null);
      if (
        missingWallet.ok ||
        missingWallet.unavailable.kind !== "invalid-input"
      )
        c.fail("wallet parsing accepted a missing wallet parameter");

      // Wallet-scoped position read (derived accounts only) for the pinned
      // smart account: an empty position is a valid measured result.
      const position = await positionModel.getPositionObservation(
        IDENTITY.smartAccount
      );
      if (!position.ok) {
        if (position.unavailable.kind === "rpc-error") {
          c.block({
            gate: "mainnet RPC read access",
            owner: "Environment owner",
            reason: `wallet-scoped position read unavailable: ${position.unavailable.reason}`,
            resumeCondition: "Reachable mainnet read endpoint configured.",
          });
        } else {
          c.fail(
            `wallet-scoped position read failed for ${IDENTITY.smartAccount}: ${position.unavailable.reason} (${position.unavailable.kind})`
          );
        }
        return c;
      }
      const pos = position.observation;
      c.add("chain-read", {
        kind: "wallet-scoped-position",
        detail: `position for ${pos.wallet}: usdc=${
          pos.usdc.balance.raw
        } (account=${pos.usdc.accountAddress ?? "absent"}) lp=${
          pos.lp.balance.raw
        } (account=${pos.lp.accountAddress ?? "absent"}) escrowedLp=${
          pos.escrowedLp ? pos.escrowedLp.raw : "none"
        } receipt=${
          pos.receipt
            ? `${pos.receipt.eligibility} effective=${pos.receipt.assetEffectiveRaw} withdrawableFrom=${pos.receipt.withdrawableFromTsIso}`
            : "none"
        } slot=${pos.freshness.observedSlot} notes=${pos.unavailable.length}`,
        provenance: "chain-read",
        slot: pos.freshness.observedSlot,
        observedAt: pos.valuation.observedAt,
      });
      if (pos.wallet !== IDENTITY.smartAccount)
        c.fail("position observation is not bound to the requested wallet");
      if (pos.freshness.observedSlot <= 0)
        c.fail("position read reported no real context slot");
      if (pos.receipt && pos.receipt.escrowedLpCountedInWalletBalance)
        c.fail("escrowed LP must never be counted in the wallet LP balance");
      if (!pos.usdc.accountAddress && pos.usdc.balance.raw !== "0")
        c.fail(
          "a missing USDC token account must be reported as zero, never fabricated"
        );

      c.missing_(
        "local dashboard is implemented; a deployed overview/wallet panel has not been compared against chain observations"
      );
      c.missing_(
        "owner-scanned Kamino obligations and stored reserve conversions are displayed; current valuations and reconciliation with manager-written strategy receipts remain incomplete"
      );
      return c;
    }
  );

  /* ---------------------------------------------------- R03 */
  await run(
    "R03",
    "Deposit and LP receipt",
    "Real app/server/SDK path previews USDC amount, estimated LP, program fees and SOL costs; prepares the correctly bound unsigned transaction; wallet signs; rejected signatures cause no submission; invalid inputs are rejected or re-quoted; finalized transaction effects prove USDC debit, vault credit and LP credit before any success state.",
    async (c) => {
      c.add("static-inspection", {
        kind: "builder-source",
        detail:
          "user deposit builder surface identified in loyal-yield-routing: @voltr/vault-sdk getDepositVaultInstructionAsync with DEPOSIT_VAULT_LABELS [userTransferAuthority, protocol, vault, vaultAssetMint, vaultLpMint, userAssetAta, vaultAssetIdleAta, vaultAssetIdleAuth, userLpAta, vaultLpMintAuth, assetTokenProgram, lpTokenProgram, systemProgram]; amount bound by vault cap; candidate only until SDK decode confirms bindings",
        provenance: "static-inspection",
        bindingState: "candidate-source",
      });
      const { verifyTransactionEffects } = await import("./verify-transaction-effects");
      const effectsChecks = await verifyTransactionEffects();
      c.add("controlled-runtime", {
        kind: "canonical-transaction-effects",
        detail: `${effectsChecks.passed} synthetic-record cases across deposit, partial/full requests and claim; exact conservation, foreign wallet/owner and extra-instruction rejection. Not live lifecycle proof.`,
        provenance: "controlled-runtime",
      });
      c.add("static-inspection", {
        kind: "preview-accounting",
        detail:
          "SDK exposes no enforceable deposit price/min-output bound in the candidate builder surface, so previews must be labelled estimates with disclosed execution semantics (contract R03)",
        provenance: "static-inspection",
      });
      c.missing_(
        "browser wallet signing and deployed deposit journey not yet verified"
      );
      c.missing_(
        "controlled status reconciliation passes; intended deposited amount and LP issuance still require finalized live lifecycle evidence"
      );
      return c;
    }
  );

  /* ---------------------------------------------------- R04 */
  await run(
    "R04",
    "Withdrawal request, restoration and claim",
    "Partial and withdraw-all requests with correct LP semantics; receipts discovered after reload; request escrow and receipt creation proven; eligibility time, waiting state and liquidity restoration displayed independently; claim preflighted against receipt ownership, program eligibility and liquidity; finalized claim effects prove escrowed LP burn and USDC credit; worker restoration from its journal plus chain evidence only.",
    async (c) => {
      c.add("static-inspection", {
        kind: "builder-source",
        detail:
          "user surfaces identified in loyal-yield-routing: getRequestWithdrawVaultInstructionAsync(amount, isAmountInLp=true, isWithdrawAll) and claim via getWithdrawVaultInstructionAsync taking no amount (claim amount/recipient must come from the on-chain receipt); cancelWithdraw and instantWithdraw exist in the SDK but are out of demo scope",
        provenance: "static-inspection",
        bindingState: "candidate-source",
      });
      c.add("static-inspection", {
        kind: "receipt-deadline-source",
        detail:
          "Go worker decodes the receipt deadline from receipt data bytes [96:104) as WithdrawableFromTS (voltr_observe.go) — the deadline is chain-read, not a hardcoded timer; the app must read the same field from the pinned SDK decoder",
        provenance: "chain-read",
        bindingState: "candidate-source",
      });
      c.missing_(
        "request/claim builders and receipt reads exist; deployed request/claim journey and transaction-scoped receipt creation/burn evidence remain unverified"
      );
      c.missing_(
        "read-only existing worker-journal adapter and panel are implemented; least-privilege database access and live restoration observations remain unverified"
      );
      return c;
    }
  );

  /* ---------------------------------------------------- R05 */
  await run(
    "R05",
    "Recovery and wallet isolation",
    "Controlled failures through real components: wallet change during quote/sign, signature refusal, lost submission response, blockhash expiry, stale NAV, RPC failure, insufficient claim liquidity, two wallets with pending receipts; wallet-scoped invalidation; no foreign action, double credit, duplicate blind send, premature success or worker invocation.",
    async (c) => {
      c.add("static-inspection", {
        kind: "recovery-design",
        detail:
          "ambiguous missing-signature outcomes must reconcile against account/transaction evidence and never auto-resend; only nonsensitive recovery identifiers may persist",
        provenance: "static-inspection",
      });
      const { verifyWorkerObservation } = await import("./verify-worker-observation");
      const workerChecks = verifyWorkerObservation();
      c.add("controlled-runtime", {
        kind: "worker-observation-boundary",
        detail: `${workerChecks.passed} projection checks distinguish stale observations, lease absence, malformed records and submission from completion. Live database/worker comparison remains unverified.`,
        provenance: "controlled-runtime",
      });
      const { verifyDepositService } = await import("./verify-deposit-service");
      const depositServiceChecks = verifyDepositService();
      c.add("controlled-runtime", {
        kind: "deposit-service-admission",
        detail: `${depositServiceChecks.passed} checks cover release and pilot authority, unresolved work, manual holds, report replacement, stale NAV/custody and the deposit cap. These are controlled inputs, not live release acceptance.`,
        provenance: "controlled-runtime",
      });
      const browserBase = process.env.LOYAL_VAULT_DEMO_BROWSER_BASE_URL;
      if (browserBase) {
        try {
          const output = execFileSync("node", [resolve(import.meta.dir, "browser/recovery.mjs")], {
            encoding: "utf8", timeout: 120_000, maxBuffer: 1_000_000,
            env: { ...process.env, LOYAL_VAULT_DEMO_BROWSER_BASE_URL: browserBase },
          });
          const browser = JSON.parse(output.trim());
          if (browser.passed !== 14 || browser.networkSubmissions !== 0) throw new Error("Unexpected browser check result");
          c.add("controlled-runtime", {
            kind: "browser-read-controls",
            detail: "Manual refresh and a bound finalized failure refresh vault, position, Kamino and worker without another send; resolving one wallet preserves the other recovery record; a controlled hidden visibility event stops their scheduled requests for 5.5 seconds and visible resumes them. Failed vault reads retain the last-success timestamp but hide balances. Native OS visibility and cross-viewer RPC budgets remain separate checks.",
            provenance: "controlled-runtime",
          });
          c.add("controlled-runtime", {
            kind: "browser-recovery",
            detail: "Executed real UI with static pre-signed unfunded fixtures and network interception: quote/signing disconnects, direct wallet change during a pending quote, and signature refusal do not send; lost response retains signature, reconnect does not resend, expiry releases without sending, competing tabs make one submission attempt, A-to-B-to-A invalidates delayed signatures, B cannot act on A pending recovery, and A quote returned to B is rejected before a signing prompt. No private keys or live submissions.",
            provenance: "controlled-runtime",
          });
        } catch {
          c.fail("Controlled browser recovery harness did not pass; inspect its bounded diagnostics.");
        }
      } else {
        c.missing_("Set LOYAL_VAULT_DEMO_BROWSER_BASE_URL to the local dev server to execute the checked-in browser recovery scenarios.");
      }
      const { verifyPreflightFailures } = await import("./verify-preflight");
      const preflightChecks = verifyPreflightFailures();
      c.add("controlled-runtime", {
        kind: "transaction-preflight-failures",
        detail: `${preflightChecks.passed} real preflight gate cases: stale/unknown NAV, unknown/exceeded capacity, foreign receipt, insufficient escrow, deadline and claim liquidity refuse preparation; exact boundaries remain eligible. No transaction construction or submission occurs in these checks.`,
        provenance: "controlled-runtime",
      });
      const { verifyRecoveryContract } = await import("./verify-recovery");
      const recoveryChecks = verifyRecoveryContract();
      c.add("controlled-runtime", {
        kind: "recovery-storage-boundary",
        detail: `${recoveryChecks.passed} controlled recovery cases: absent differs from corrupt/unreadable data; invalid metadata blocks replacement and remains untouched. Browser fault scenarios remain separately required.`,
        provenance: "controlled-runtime",
      });
      // Controlled failure through a real component: the app's bounded RPC
      // client against an unroutable endpoint must produce a typed failure,
      // never a zero balance or a "missing account".
      const { BoundedRpc } = await import("../src/features/vault/server/rpc");
      const dead = new BoundedRpc("http://127.0.0.1:1/", 1_000, 1);
      const failed = await dead.getAccountInfo(IDENTITY.vault);
      if (failed.ok) {
        c.fail("an unroutable RPC endpoint returned success");
      } else if (failed.kind === "decode") {
        c.fail(
          "an unroutable RPC endpoint was misreported as a decode/missing-account outcome"
        );
      } else {
        c.add("controlled-runtime", {
          kind: "rpc-failure-typing",
          detail: `unroutable endpoint produced kind=${failed.kind} attempts=${failed.attempts} error="${failed.error}"; no balance or account was fabricated`,
          provenance: "controlled-runtime",
        });
      }

      return c;
    }
  );

  /* ---------------------------------------------------- R06 */
  await run(
    "R06",
    "Bounded reads and observable service state",
    "Shared/cached vault observation with wallet-scoped reads; two-viewer reuse measured; finite RPC/retry budget with refresh on transaction outcomes; hidden-tab refresh stopped; last successful vault observation and worker observation shown separately; stale worker observation blocks new deposits without disabling an eligible on-chain claim.",
    async (c) => {
      const { verifyTransactionRpcContract } = await import("./verify-transaction-rpc");
      const transactionRpcChecks = await verifyTransactionRpcContract();
      c.add("controlled-runtime", {
        kind: "transaction-rpc-wire-contract",
        detail: `${transactionRpcChecks.passed} controlled cases: real RPC envelope shape, explicit null, malformed evidence rejection and provider error redaction`,
        provenance: "controlled-runtime",
      });
      c.add("static-inspection", {
        kind: "read-budget",
        detail: `budget=${JSON.stringify(
          BOUNDS.budget
        )} declared before baseline`,
        provenance: "static-inspection",
      });
      c.add("static-inspection", {
        kind: "worker-observation-source",
        detail:
          "Read-only worker journal adapter and /api/worker observation channel are implemented. Approved least-privilege credentials and comparison with live worker restoration remain unverified.",
        provenance: "static-inspection",
        bindingState: "candidate-source",
      });
      // Measured through the app's shared read model: two consumers reuse one
      // cached observation, chain time comes from the clock sysvar, NAV
      // freshness is never claimed without proof, and deposits stay
      // unavailable without worker service evidence.
      let depositsOffered: string | null = null;
      const readModel = await import(
        "../src/features/vault/server/vault-observation"
      );
      const firstViewer = await readModel.getVaultObservation();
      if (!firstViewer.ok) {
        c.fail(`shared vault observation unavailable: ${firstViewer.reason}`);
      } else {
        const secondViewer = await readModel.getVaultObservation();
        const reused = firstViewer === secondViewer;
        if (!reused)
          c.fail(
            "shared vault cache did not reuse one observation for two in-process consumers within its TTL"
          );
        const observation = firstViewer.observation;
        if (observation.freshness.chainTimeSource !== "clock-sysvar")
          c.fail(
            `accounting time is not chain time: ${observation.freshness.chainTimeSource}`
          );
        if (
          observation.navFreshness.status === "fresh" &&
          (!observation.navFreshness.bindingsMatchPinned ||
            BigInt(observation.navFreshness.lastSequence ?? "0") === 0n)
        )
          c.fail("NAV freshness was claimed without adaptor report proof");
        // The former unconditional failure here could never accept the fully
        // evidenced open-pilot state (release acceptance defect, repaired
        // 2026-09-17). Offered deposits are instead verified below against a
        // fresh consumed-report view of the same independently read chain
        // batch and a fresh route-state row; missing or mismatched evidence
        // still fails.
        if (observation.serviceState.deposits !== "unavailable")
          depositsOffered = observation.serviceState.depositsReason ?? "deposits offered";
        if (
          observation.allocation.unknownExposure.length > 0 &&
          observation.allocation.reconciliation === "reconciled"
        )
          c.fail(
            `unknown exposure does not block reconciliation: ${observation.allocation.reconciliation}`
          );
        c.add("chain-read", {
          kind: "shared-observation-service-state",
          detail: `inProcessConsumerReuse=${reused} (not a two-browser-session RPC budget measurement) chainTime=${observation.freshness.chainTimeSource} slot=${observation.freshness.observedSlot} navFreshness=${observation.navFreshness.status} deposits=${observation.serviceState.deposits} withdrawals=${observation.serviceState.withdrawals} reconciliation=${observation.allocation.reconciliation}`,
          provenance: "chain-read",
          slot: observation.freshness.observedSlot,
          observedAt: observation.valuation.observedAt,
        });
      }
      /* Controlled proof that the open-deposit evaluator accepts one coherent
       * evidence row and refuses every mutated admission condition. These are
       * controlled inputs proving the evaluator both ways, not live release
       * acceptance. */
      {
        const controlledCore: DepositReleaseCore = {
          slot: 1000,
          // asset/idle/NAV amounts are arbitrary synthetic fixtures; the cap
          // field uses the approved production ceiling so the accepted row is
          // representative (100,000 USDC = 100_000_000_000 raw).
          assetTotalValue: 5_000_023n,
          idleCustodyRaw: 23n,
          managerCustody: { exists: true, amountRaw: 0n },
          maxCapRaw: 100_000_000_000n,
        };
        const controlledReport: DepositReleaseReport = {
          status: "fresh",
          reportSignature: "controlled-signature",
          reportConfirmedSlot: 998,
          lastNavRaw: "5000000",
          bindingsMatchPinned: true,
        };
        const controlledRow = {
          database_now: "2026-09-17T00:00:10Z",
          release_active: true,
          pilot_active: true,
          no_manual_hold: true,
          no_pending: true,
          last_action: "REPORT_NAV",
          last_signature: "controlled-signature",
          last_confirmed_slot: "998",
          observation: {
            observedAt: "2026-09-17T00:00:05Z",
            observedSlot: 1010,
            navFresh: true,
            routeStatus: "positioned",
            aumRaw: "5000023",
            voltrIdleRaw: "23",
            squadsIdleRaw: "0",
            computedStrategyNavRaw: "5000000",
            reportedNavRaw: "5000000",
            voltrStrategyIdleRaw: "0",
          },
        };
        if (!evaluateOpenDepositRelease(controlledCore, controlledReport, controlledRow).open)
          c.fail("the open-deposit evaluator refused a fully coherent controlled evidence row");
        let refused = 0;
        const expectClosed = (label: string, evaluation: DepositReleaseEvaluation) => {
          if (evaluation.open) c.fail(`open-deposit evaluator accepted mutated evidence: ${label}`);
          else refused += 1;
        };
        for (const patch of [
          { release_active: false },
          { release_active: "true" },
          { pilot_active: false },
          { no_manual_hold: false },
          { no_pending: false },
          { last_action: "OPEN_ROUTE_STEP" },
          { last_signature: "different-report" },
          { last_confirmed_slot: "999" },
          { database_now: "invalid" },
          { database_now: "2026-09-17T00:01:00Z" },
          { observation: null },
          { observation: [] },
        ] as const)
          expectClosed(`row:${Object.keys(patch)[0]}`, evaluateOpenDepositRelease(controlledCore, controlledReport, { ...controlledRow, ...patch }));
        for (const patch of [
          { observedAt: "2026-09-17T00:01:00Z" },
          { observedSlot: 967 },
          { observedSlot: 1033 },
          { observedSlot: "1010" },
          { observedSlot: 997 },
          { navFresh: false },
          { routeStatus: "withdrawal_pending" },
          { routeStatus: "unknown" },
          { aumRaw: "5000024" },
          { voltrIdleRaw: "24" },
          { squadsIdleRaw: "1" },
          { computedStrategyNavRaw: "4999999" },
          { reportedNavRaw: "4999999" },
          { voltrStrategyIdleRaw: "1" },
        ] as const)
          expectClosed(
            `observation:${Object.keys(patch)[0]}`,
            evaluateOpenDepositRelease(controlledCore, controlledReport, {
              ...controlledRow,
              observation: { ...controlledRow.observation, ...patch },
            })
          );
        for (const patch of [
          { status: "unknown" },
          { status: "stale" },
          { reportSignature: undefined },
          { reportConfirmedSlot: undefined },
          { lastNavRaw: undefined },
          { bindingsMatchPinned: false },
        ] as const)
          expectClosed(`report:${Object.keys(patch)[0]}`, evaluateOpenDepositRelease(controlledCore, { ...controlledReport, ...patch }, controlledRow));
        for (const patch of [
          { slot: 977 },
          { managerCustody: null },
          { maxCapRaw: 0n },
          { maxCapRaw: 100_000_000_001n },
          { maxCapRaw: controlledCore.assetTotalValue },
        ] as const)
          expectClosed(`core:${Object.keys(patch)[0]}`, evaluateOpenDepositRelease({ ...controlledCore, ...patch }, controlledReport, controlledRow));
        if (refused !== 12 + 14 + 6 + 5)
          c.fail(`open-deposit mutation coverage drifted: refused=${refused}, expected 37`);
        c.add("controlled-runtime", {
          kind: "open-deposit-release-evaluator",
          detail: `1 coherent evidence row accepted; ${refused} mutated conditions refused across lease, pilot authority, manual hold, pending work, report identity/slot, observation freshness/slot coherence, NAV/custody equality and cap bounds. Controlled inputs, not live release acceptance.`,
          provenance: "controlled-runtime",
        });
      }
      /* Controlled checks: the RPC envelope, null and failure semantics, and
       * the batch validation path are exercised against inputs this process
       * controls before the public endpoint is probed once. */
      const ACCOUNTS = {
        present: "11111111111111111111111111111112",
        nullAccount: "11111111111111111111111111111113",
        noResult: "11111111111111111111111111111114",
        noContext: "11111111111111111111111111111115",
        malformed: "11111111111111111111111111111116",
        shortArray: "11111111111111111111111111111117",
        http500: "11111111111111111111111111111118",
        http429: "11111111111111111111111111111119",
      } as const;
      const b64 = Buffer.from([1, 2, 3, 4]).toString("base64");
      let genesisMode: "pinned" | "foreign" = "pinned";
      let attempts = 0;
      const server = Bun.serve({
        port: 0,
        fetch: async (request) => {
          attempts += 1;
          const body = (await request.json()) as {
            method: string;
            params: unknown[];
          };
          if (body.method === "getGenesisHash") {
            return Response.json(
              genesisMode === "pinned"
                ? {
                    jsonrpc: "2.0",
                    id: 1,
                    result:
                      IDENTITY.cluster === "mainnet-beta"
                        ? APP_GENESIS_HASH
                        : "x",
                  }
                : {
                    jsonrpc: "2.0",
                    id: 1,
                    result: "4sGjMW1sXHzS42UCfHalTqExSGS8Wcih6ja3Hhywdjec",
                  }
            );
          }
          const account = String((body.params?.[0] as string) ?? "");
          if (body.method === "getMultipleAccounts") {
            const requested = body.params[0] as string[];
            if (requested.includes(ACCOUNTS.shortArray)) {
              return Response.json({
                jsonrpc: "2.0",
                id: 1,
                result: {
                  context: { slot: 42 },
                  value: [
                    {
                      owner: APP_IDENTITY.tokenProgram,
                      lamports: 1,
                      data: [b64, "base64"],
                    },
                  ],
                },
              });
            }
            return Response.json({
              jsonrpc: "2.0",
              id: 1,
              result: {
                context: { slot: 42 },
                value: requested.map((key) =>
                  key === ACCOUNTS.nullAccount
                    ? null
                    : {
                        owner: APP_IDENTITY.tokenProgram,
                        lamports: 1,
                        data: [b64, "base64"],
                      }
                ),
              },
            });
          }
          if (account === ACCOUNTS.http500)
            return new Response("boom", { status: 500 });
          if (account === ACCOUNTS.http429)
            return new Response("slow down", { status: 429 });
          if (account === ACCOUNTS.noResult)
            return Response.json({ jsonrpc: "2.0", id: 1 });
          if (account === ACCOUNTS.noContext)
            return Response.json({
              jsonrpc: "2.0",
              id: 1,
              result: { value: null },
            });
          if (account === ACCOUNTS.malformed)
            return Response.json({
              jsonrpc: "2.0",
              id: 1,
              result: { context: { slot: 42 }, value: { owner: 5, data: "x" } },
            });
          if (account === ACCOUNTS.nullAccount)
            return Response.json({
              jsonrpc: "2.0",
              id: 1,
              result: { context: { slot: 42 }, value: null },
            });
          return Response.json({
            jsonrpc: "2.0",
            id: 1,
            result: {
              context: { slot: 42 },
              value: {
                owner: APP_IDENTITY.tokenProgram,
                lamports: 1,
                data: [b64, "base64"],
              },
            },
          });
        },
      });
      try {
        const url = `http://127.0.0.1:${server.port}`;
        const rpc = new BoundedRpc(url, 2_000, 2);
        const present = await rpc.getAccountInfo(ACCOUNTS.present);
        if (
          !present.ok ||
          present.value === null ||
          present.value.owner !== APP_IDENTITY.tokenProgram ||
          present.value.data.length !== 4 ||
          present.contextSlot !== 42
        )
          c.fail(`present account misread: ${JSON.stringify(present)}`);
        const absent = await rpc.getAccountInfo(ACCOUNTS.nullAccount);
        if (!absent.ok || absent.value !== null)
          c.fail(
            `an explicit null result must read as a missing account, got ${JSON.stringify(
              absent
            )}`
          );
        for (const [label, key] of [
          ["missing result", ACCOUNTS.noResult],
          ["missing context", ACCOUNTS.noContext],
          ["malformed value", ACCOUNTS.malformed],
        ] as const) {
          const bad = await rpc.getAccountInfo(key);
          if (bad.ok || bad.kind !== "decode")
            c.fail(
              `${label} was not a typed decode failure: ${JSON.stringify(bad)}`
            );
        }
        const shortArray = await rpc.getMultipleAccounts([
          ACCOUNTS.present,
          ACCOUNTS.shortArray,
        ]);
        if (shortArray.ok || shortArray.kind !== "decode")
          c.fail(
            `a short result array was not a decode failure: ${JSON.stringify(
              shortArray
            )}`
          );
        const serverError = await rpc.getAccountInfo(ACCOUNTS.http500);
        if (serverError.ok || serverError.kind !== "network")
          c.fail(
            `HTTP 500 was not a network-class failure: ${JSON.stringify(
              serverError
            )}`
          );
        const rateLimited = await rpc.getAccountInfo(ACCOUNTS.http429);
        if (
          rateLimited.ok ||
          rateLimited.kind !== "rate-limited" ||
          rateLimited.attempts < 2
        )
          c.fail(
            `HTTP 429 was not retried after backoff as rate-limited: ${JSON.stringify(
              rateLimited
            )}`
          );
        genesisMode = "foreign";
        const foreign = await rpc.getGenesisHash();
        if (foreign.ok || foreign.kind !== "decode")
          c.fail("a non-mainnet genesis hash was accepted");
        genesisMode = "pinned";
        const pinned = await rpc.getGenesisHash();
        if (!pinned.ok)
          c.fail(`pinned genesis hash rejected: ${JSON.stringify(pinned)}`);
        if (
          (!serverError.ok && serverError.error.includes("127.0.0.1")) ||
          (!rateLimited.ok && rateLimited.error.includes("127.0.0.1"))
        ) {
          c.fail("failure text must not disclose endpoint details");
        }
        c.add("controlled-runtime", {
          kind: "rpc-envelope-semantics",
          detail: `present/null/missing-result/missing-context/malformed/short-array/HTTP500/HTTP429/genesis checks ran against a controlled endpoint (requests=${attempts}); 429 attempts=${
            rateLimited.ok ? 0 : rateLimited.attempts
          }`,
          provenance: "controlled-runtime",
        });
      } finally {
        server.stop(true);
      }

      /* The public endpoint is probed once, then the batch validation path is
       * driven with real account data and controlled mutations. */
      const batchStartedAt = performance.now();
      const publicProbe = new BoundedRpc(rpcUrl);
      const publicGenesis = await publicProbe.getGenesisHash();
      if (!publicGenesis.ok)
        c.fail(
          `public endpoint failed the pinned-cluster check: ${publicGenesis.error}`
        );
      const batch = await deriveVaultBatchAddresses();
      const idleAuthority = await deriveIdleAuthority();
      const live = await publicProbe.getMultipleAccounts(
        batch.map((entry) => entry.address)
      );
      if (!live.ok) {
        c.block({
          gate: "mainnet RPC read access",
          owner: "Environment owner",
          reason: `controlled batch read unavailable: ${live.error}`,
          resumeCondition: "Reachable mainnet read endpoint configured.",
        });
        return c;
      }
      const slot = live.contextSlot ?? -1;
      const accounts = [...live.value];
      const coreOk = buildCoherentVaultCore(batch, accounts, slot, {
        idleAuthority,
      });
      if (!coreOk.ok)
        c.fail(`the real batch did not validate: ${coreOk.reason}`);

      if (coreOk.ok && coreOk.core.managerCustody) {
        c.add("chain-read", {
          kind: "smart-account-usdc-custody",
          detail: `address=${coreOk.core.managerCustody.address} raw=${coreOk.core.managerCustody.amountRaw} exists=${coreOk.core.managerCustody.exists}; same finalized batch as vault, binding-checked and separate from manager reported strategy values`,
          provenance: "chain-read", slot, observedAt: new Date().toISOString(),
        });
      } else c.fail("Smart account custody could not be attributed in the coherent live batch");

      for (const [key, offset, label] of [
        ["vault", 0, "vault discriminator"],
        ["assetMint", 44, "USDC decimals"],
        ["idleAta", 32, "custody authority"],
        ["managerAssetAta", 32, "smart account custody authority"],
        ["managerAssetAta", 0, "smart account custody mint"],
      ] as const) {
        const index = batch.findIndex((entry) => entry.key === key);
        const mutated = accounts.map((account) =>
          account ? { ...account, data: new Uint8Array(account.data) } : null
        );
        if (!mutated[index]) {
          c.fail(`cannot exercise ${label}: required fixture missing`);
          continue;
        }
        mutated[index]!.data[offset] ^= 1;
        if (buildCoherentVaultCore(batch, mutated, slot, { idleAuthority }).ok)
          c.fail(`${label} mutation accepted`);
      }
      if (
        buildCoherentVaultCore(batch, [...accounts].reverse(), slot, {
          idleAuthority,
        }).ok
      )
        c.fail("reordered batch accepted");
      if (
        buildCoherentVaultCore(batch, accounts.slice(1), slot, {
          idleAuthority,
        }).ok
      )
        c.fail("truncated batch accepted");
      const configIndex = batch.findIndex((entry) =>
        entry.key.startsWith("adaptorConfig:")
      );
      const configAccount = accounts[configIndex];
      if (configAccount)
        for (const offset of [9, 176, 336, 400, 408, 416, 440]) {
          const mutated = {
            ...configAccount,
            data: new Uint8Array(configAccount.data),
          };
          mutated.data[offset] ^= 1;
          const result = decodeAdaptorConfig(mutated, configAccount.address);
          if (result.ok && result.bindingsMatchPinned)
            c.fail(`forged config binding at offset ${offset} accepted`);
        }

      const missingIdle = [...accounts];
      const idleIndex = batch.findIndex((entry) => entry.key === "idleAta");
      missingIdle[idleIndex] = null;
      const idleMissing = buildCoherentVaultCore(batch, missingIdle, slot, {
        idleAuthority,
      });
      if (idleMissing.ok) {
        c.fail("a missing idle custody account was accepted as a zero balance");
      } else if (idleMissing.kind !== "account-missing") {
        c.fail(
          `a missing idle custody account was misreported as ${idleMissing.kind}`
        );
      }

      const wrongClock = [...accounts];
      const clockIndex = batch.findIndex((entry) => entry.key === "clock");
      wrongClock[clockIndex] = wrongClock[clockIndex]
        ? {
            ...wrongClock[clockIndex]!,
            owner: "11111111111111111111111111111111",
          }
        : null;
      const clockFailure = buildCoherentVaultCore(batch, wrongClock, slot, {
        idleAuthority,
      });
      if (clockFailure.ok || clockFailure.kind !== "decode-error") {
        c.fail("a clock sysvar with the wrong owner was not rejected");
      }

      const mismatched = [...accounts];
      const customStrategy = APP_IDENTITY.knownStrategyCandidates[0];
      const receiptIndex = batch.findIndex(
        (entry) => entry.key === `strategyReceipt:${customStrategy}`
      );
      const forgedReceipt = getStrategyInitReceiptEncoder().encode({
        vault: APP_IDENTITY.vault,
        strategy: customStrategy,
        adaptorProgram: APP_IDENTITY.voltrProgram,
        positionValue: 9_999_999n,
        lastUpdatedTs: 1n,
        version: 1,
        bump: 254,
        vaultStrategyAuthBump: 255,
        padding0: new Uint8Array(5),
        reserved: new Uint8Array(64),
      });
      mismatched[receiptIndex] = {
        address: batch[receiptIndex]!.address,
        owner: APP_IDENTITY.voltrProgram,
        lamports: 1,
        data: new Uint8Array(forgedReceipt),
      };
      const mismatch = buildCoherentVaultCore(batch, mismatched, slot, {
        idleAuthority,
      });
      if (!mismatch.ok) {
        c.fail(
          `a mismatched adaptor attribution failed the whole batch instead of failing attribution: ${mismatch.reason}`
        );
      } else {
        const failed = mismatch.core.strategyAttributions.find(
          (entry) => entry.strategy === customStrategy
        );
        if (!failed || failed.status !== "attribution-failed") {
          c.fail(
            `a receipt naming a foreign adaptor was not refused: ${JSON.stringify(
              failed
            )}`
          );
        } else {
          const counted = mismatch.core.strategyAttributions.some(
            (entry) =>
              entry.strategy === customStrategy && entry.status === "attributed"
          );
          if (counted)
            c.fail("a refused lane was still counted as attributed exposure");
          c.add("controlled-runtime", {
            kind: "adaptor-attribution-refusal",
            detail: `a forged receipt naming ${APP_IDENTITY.voltrProgram} as adaptor was refused: ${failed.reason}`,
            provenance: "controlled-runtime",
          });
        }
      }
      c.add("chain-read", {
        kind: "batch-validation",
        detail: `public batch slot=${slot} accounts=${
          batch.length
        } realBatchValidated=${coreOk.ok} missingIdle=${
          idleMissing.ok ? "accepted" : idleMissing.kind
        } clockOwnerEnforced=${!clockFailure.ok} publicGenesis=${
          publicGenesis.ok
        }`,
        provenance: "chain-read",
        slot,
      });

      if (depositsOffered !== null) {
        // Repaired release acceptance: offered deposits must be proven by
        // independently checked runtime evidence — the pinned deployed worker
        // lease/image identity, activated capped pilot authority, no pending
        // or manual hold, the newest reconciled action matching the consumed
        // REPORT_NAV signature and slot, worker NAV/custody equal to this
        // verifier's own fresh chain batch, and capped headroom. Fail-closed:
        // any missing or mismatched piece fails the check.
        if (!coreOk.ok) {
          c.fail(
            `deposits are offered (${depositsOffered}) but the coherent chain batch is invalid: ${coreOk.reason}`
          );
        } else {
          const enabled = process.env.LOYAL_VAULT_DEMO_DEPOSITS_ENABLED === "1";
          const image = process.env.LOYAL_VAULT_DEMO_WORKER_IMAGE;
          const service = process.env.LOYAL_VAULT_DEMO_WORKER_SERVICE_ID;
          const dbUrl = process.env.LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL;
          if (!enabled)
            c.fail("deposits are offered while LOYAL_VAULT_DEMO_DEPOSITS_ENABLED is not 1");
          if (!image || !/^sha-[a-f0-9]{40}$/.test(image))
            c.fail(
              "deposits are offered without a well-formed immutable LOYAL_VAULT_DEMO_WORKER_IMAGE pin (sha-<40 hex>)"
            );
          if (!service || !/^srv-[a-z0-9]+$/.test(service))
            c.fail("deposits are offered without a well-formed LOYAL_VAULT_DEMO_WORKER_SERVICE_ID pin");
          if (!dbUrl)
            c.fail(
              "deposits are offered without least-privilege route-state access (LOYAL_VAULT_DEMO_OBSERVATION_DATABASE_URL)"
            );
          if (enabled && image && service && dbUrl) {
            try {
              // One bounded evidence window covering the chain batch, the
              // consumed-report verification against that same batch's
              // ticket/receipt, and the fresh route-state read.
              const remainingMs = () =>
                Math.floor(batchStartedAt + RPC_BOUNDS.maxStalenessMs - performance.now());
              if (remainingMs() <= 0) {
                c.fail(
                  "deposits are offered but the shared batch/report/route-state evidence deadline expired"
                );
              } else {
                const { readConsumedReport } = await import(
                  "../src/features/vault/server/consumed-report"
                );
                // Re-verified against coreOk.core itself: the cached shared
                // observation may carry a different consumed sequence than the
                // batch this verifier read independently.
                const report = await readConsumedReport(coreOk.core, batchStartedAt);
                const remaining = remainingMs();
                if (remaining <= 0) {
                  c.fail(
                    "deposits are offered but the shared batch/report/route-state evidence deadline expired"
                  );
                } else {
                  const { neon } = await import("@neondatabase/serverless");
                  const { DEPOSIT_SERVICE_SQL } = await import(
                    "../src/features/vault/server/deposit-service"
                  );
                  const sql = neon(dbUrl);
                  const [rows] = await sql.transaction(
                    [
                      sql.query(DEPOSIT_SERVICE_SQL, [
                        `rwa-multiply:${APP_IDENTITY.manager}`,
                        // The lease parameter binds the row to the pinned image
                        // and service: release_active can only be true when the
                        // live lease owner is exactly this identity.
                        `render:${service}:${image}`,
                        APP_IDENTITY.adaptorConfigStrategy,
                      ]),
                    ],
                    {
                      readOnly: true,
                      isolationLevel: "RepeatableRead",
                      fetchOptions: { signal: AbortSignal.timeout(remaining) },
                    }
                  );
                  if (remainingMs() <= 0) {
                    c.fail("deposits are offered but the shared batch/report/route-state evidence deadline expired");
                  } else if (rows.length !== 1) {
                    c.fail(
                      `deposits are offered (${depositsOffered}) but the pinned release lease/pilot route state returned ${rows.length} rows`
                    );
                  } else {
                    const evaluation = evaluateOpenDepositRelease(
                      {
                        slot: coreOk.core.slot,
                        assetTotalValue: coreOk.core.assetTotalValue,
                        idleCustodyRaw: coreOk.core.idleCustodyRaw,
                        managerCustody: coreOk.core.managerCustody,
                        maxCapRaw: coreOk.core.vault.vaultConfiguration.maxCap,
                      },
                      report,
                      rows[0]!
                    );
                    if (!evaluation.open) {
                      c.fail(
                        `deposits are offered (${depositsOffered}) without independently verified servicing evidence: ${evaluation.reason}`
                      );
                    } else {
                      c.add("reconciliation", {
                        kind: "open-deposit-release-evidence",
                        detail: `deposits offered (${depositsOffered}) and independently re-derived at chain slot ${coreOk.core.slot}: active release lease bound to the pinned ${image} on ${service}, activated capped pilot authority, no manual hold, no pending operation, newest reconciled action REPORT_NAV matching the freshly verified consumed-report signature/slot, worker NAV/idle/smart-account custody equal to this verifier's own batch, strategy NAV equal to the consumed report, on-chain cap within (0,100,000 USDC] with headroom. Evidence limitations: the Render-side image deployment itself is trusted from the env pin plus live lease identity (no Render API proof here), and financed wallet-flow and rotation proofs remain separate gates (R08/plan).`,
                        provenance: "reconciliation",
                        slot: coreOk.core.slot,
                        observedAt: new Date().toISOString(),
                      });
                    }
                  }
                }
              }
            } catch {
              // Fixed sanitized reason: database/RPC errors can carry endpoint
              // or credential fragments and never enter the report.
              c.fail(
                `deposits are offered (${depositsOffered}) but the fresh report/route-state evidence read failed within the bounded deadline`
              );
            }
          }
        }
      }

      if (process.env.LOYAL_VAULT_DEMO_VERIFY_READ_BUDGET === "1") {
        try {
          const output = execFileSync("node", [resolve(import.meta.dir, "browser/read-budget.mjs")], {
            encoding: "utf8", timeout: 120_000, maxBuffer: 1_000_000,
          });
          const budget = JSON.parse(output.trim());
          if (budget.passed !== true || budget.networkSubmissions !== 0 || budget.immediateVaultRpcDelta !== 0 ||
            budget.windowMs !== 11000 || budget.windowRpc.total > 15 ||
            !Array.isArray(budget.browserVaultReads) || budget.browserVaultReads.length !== 2 ||
            !budget.browserVaultReads.every((count: number) => count >= 2)) throw new Error("Unexpected read-budget result");
          c.add("controlled-runtime", {
            kind: "two-browser-read-budget",
            detail: JSON.stringify(budget), provenance: "controlled-runtime",
          });
        } catch {
          c.fail("Two-browser read-budget measurement did not pass; inspect its bounded diagnostics.");
        }
      } else {
        c.missing_("Set LOYAL_VAULT_DEMO_VERIFY_READ_BUDGET=1 to measure two local browser sessions against a read-only counting relay.");
      }
      if (hosted) c.add("deployment", { kind: "served-worker-api", path: hosted.path, provenance: "deployment",
        detail: `Recorded /api/worker HTTP 200: leaseActive=${hosted.worker.leaseActive}, freshness=${hosted.worker.freshness}. This proves the observation endpoint, not current servicing.` });
      c.missing_("Live worker display and lease-active servicing against the current release remain unverified.");
      c.missing_(
        "refresh-on-transaction-outcome is implemented; its observed RPC budget and refreshed state still require controlled browser evidence"
      );
      return c;
    }
  );

  /* ---------------------------------------------------- R07 */
  await run(
    "R07",
    "Deployed browser behavior and partner usability",
    "Deployed URL identifies loyal-vault-demo and matches verified source/build; hosting performs the production build; scoped lint and app type checks pass; Partner Journey rubric passes at desktop and narrow mobile widths with address copy and transaction links resolving to bound accounts/signatures.",
    async (c) => {
      // Local checks that are runnable now are actually run, not asserted.
      const lint = await runCommand("bun", ["run", "lint"], APP_ROOT, 120_000);
      const typecheck = await runCommand(
        "bun",
        ["run", "typecheck"],
        APP_ROOT,
        120_000
      );
      c.add("static-inspection", {
        kind: "scoped-checks",
        detail: `lint exit=${lint.exit} (${lint.summary}); typecheck exit=${typecheck.exit} (${typecheck.summary}); local production build intentionally not run (repo rule)`,
        provenance: "static-inspection",
      });
      if (lint.exit !== 0) c.fail(`scoped lint does not pass: ${lint.summary}`);
      if (typecheck.exit !== 0)
        c.fail(`scoped typecheck does not pass: ${typecheck.summary}`);
      c.add("static-inspection", {
        kind: "app-surface",
        detail:
          "minimal server-rendered page (src/app/page.tsx) plus GET /api/vault and GET /api/position route handlers exist and are measured through the read model elsewhere; no local production build was run (repo rule), so prerender behaviour is unverified",
        provenance: "static-inspection",
      });
      if (hosted) {
        c.add("deployment", { kind: "hosted-deployment-record", path: hosted.path, provenance: "deployment",
          detail: `Recorded Ready deployment ${hosted.deployment.deploymentId} at ${hosted.deployment.url}; both served APIs returned HTTP 200. Hosting metadata is recorded evidence; this verifier has not re-fetched it.` });
      } else {
        c.block({ gate: "Hosting deployment", owner: "Deployment operator",
          reason: "No validated hosted evidence was supplied to this run.",
          resumeCondition: "Supply --hosted-evidence with the Ready deployment and served API captures." });
      }
      c.missing_("The deployed desktop/mobile Partner Journey and real wallet flow remain unverified.");
      return c;
    }
  );

  /* ---------------------------------------------------- R08 */
  await run(
    "R08",
    "Complete live proof and operational handoff",
    "Under separately recorded authorization, one partner-style wallet completes the deployed-app mainnet journey (deposit, finalized LP receipt, nonzero attributable Kamino exposure, partial request/claim, remaining withdrawal) with at least one restoration-proven request, plus operational handoff records.",
    async (c) => {
      c.add("static-inspection", {
        kind: "authorization-state",
        detail:
          "The capped pilot follows the approved activation plan; this verifier does not sign or broadcast and requires independently recorded live receipts.",
        provenance: "static-inspection",
      });
      c.missing_(
        "Current-release financed wallet journey and operational handoff evidence remain missing"
      );
      c.block({
        gate: "Live wallet/funding",
        owner: "User/operator",
        reason:
          "The approved capped pilot has not completed the current-release financed wallet journey.",
        resumeCondition:
          "Complete the approved funded journey and record its exact receipts, capacity and costs.",
      });
      c.block({
        gate: "Receipt timing/liquidity",
        owner: "Voltr chain state + yield operator",
        reason:
          "Waiting period follows chain time; no live receipt exists yet to observe.",
        resumeCondition:
          "Live request exists and its WithdrawableFromTS is reached with restored liquidity.",
      });
      return c;
    }
  );

  /* ------------------------------------------------------- verdict */
  const failures = findings.filter((finding) => finding.status === "fail");
  const blockedFindings = findings.filter(
    (finding) => finding.status === "blocked"
  );
  const blocks = findings.flatMap((finding) => finding.blocks);
  const notRunFindings = findings.filter(
    (finding) => finding.status === "not_run"
  );
  const completionEligible =
    tier === "full" &&
    failures.length === 0 &&
    notRunFindings.length === 0 &&
    blockedFindings.length === 0;
  const verdict =
    failures.length > 0 || notRunFindings.length > 0
      ? "FAIL"
      : tier === "fast"
      ? "INCOMPLETE"
      : blockedFindings.length > 0
      ? "BLOCKED"
      : "PASS";

  const reportPayload = {
    schemaVersion: REPORT_SCHEMA,
    contract: {
      id: IDENTITY.contractId,
      document: "docs/loyal-vault-demo-verifier.md",
      documentSha256: sha256(new Uint8Array(readFileSync(CONTRACT_DOC))),
      adoptedFrom: CONTRACT_ORIGIN,
      identity: {
        ...IDENTITY,
        identityBindingState: "candidate-source" as BindingState,
      },
    },
    generatedAt: new Date().toISOString(),
    startedAt,
    tier,
    verdict,
    completionEligible,
    verdictRationale:
      verdict === "FAIL"
        ? `known implementation failures or unevaluated checks: ${[
            ...failures,
            ...notRunFindings,
          ]
            .map((finding) => finding.id)
            .join(
              ", "
            )}; failures are reported even where checks are also externally blocked, and not_run prevents PASS`
        : verdict === "BLOCKED"
        ? `no known implementation failure; external blocks: ${blocks
            .map((block) => block.gate)
            .join(", ")}`
        : verdict === "INCOMPLETE"
        ? "fast tier cannot produce completion PASS (contract verdict rules)"
        : "every R-condition proven against the candidate deployment and current evidence",
    source,
    deployment: hosted ? { ...hosted.deployment, evidencePath: hosted.path, provenance: "recorded-captures" }
      : { url: null, buildId: null, unavailableReason: "No hosted evidence supplied to this run" },
    runtime: {
      cluster: IDENTITY.cluster,
      rpcUrlKind: rpcUrl.includes("api.mainnet-beta.solana.com")
        ? "public-mainnet"
        : "configured",
      genesisHash: genesis.ok ? genesis.value : null,
      /** Epoch observation slot only; account evidence carries its own context slot. */
      epochObservationSlot: epoch.ok ? epoch.value.absoluteSlot : null,
      observedEpoch: epoch.ok ? epoch.value.epoch : null,
      accountContextSlots: contextSlots,
      observedAt,
      observations,
    },
    parameters: BOUNDS,
    summary: {
      total: findings.length,
      pass: findings.filter((finding) => finding.status === "pass").length,
      fail: failures.length,
      blocked: blockedFindings.length,
      notRun: notRunFindings.length,
      completionEligibleChecks: findings
        .filter((finding) => finding.completionEligible)
        .map((finding) => finding.id),
    },
    checks: findings,
    externalGates: EXTERNAL_GATES.map(gate => gate.gate === "Hosting deployment" && hosted
      ? { ...gate, state: "closed", note: `Recorded Ready deployment ${hosted.deployment.deploymentId}; live journey remains separate.` }
      : gate),
    constraints: {
      verifierPerformedSigningOrBroadcast: false,
      reportIsGeneratedResult: true,
      localFrontendProductionBuildRun: false,
      simulatedResultsLabelledAsLive: false,
    },
  };

  mkdirSync(dirname(report), { recursive: true });
  const serialized = `${JSON.stringify(
    reportPayload,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  )}\n`;
  await Bun.write(report, serialized);

  const lines = [
    `loyal-vault-demo verifier — tier=${tier} verdict=${verdict} completionEligible=${completionEligible}`,
    `checks: ${findings
      .map((finding) => `${finding.id}=${finding.status}`)
      .join(" ")}`,
    `report: ${report}`,
  ];
  for (const finding of failures) {
    for (const failure of [...finding.missing, ...finding.failures])
      lines.push(`  ${finding.id} — ${failure}`);
  }
  for (const finding of blockedFindings) {
    for (const block of finding.blocks)
      lines.push(`  ${finding.id} BLOCKED — ${block.gate} (${block.owner})`);
  }
  console.log(lines.join("\n"));
  process.exitCode = verdict === "PASS" ? 0 : 1;
}

/* ------------------------------------------------------------- helpers */

type VoltrSdkProbe = Readonly<{
  available: boolean;
  version: string | null;
  userSurface: string[];
  reason?: string;
}>;

async function probeVoltrSdk(): Promise<VoltrSdkProbe> {
  try {
    const mod = (await import("@voltr/vault-sdk")) as Record<string, unknown>;
    const wanted = [
      "getDepositVaultInstructionAsync",
      "getRequestWithdrawVaultInstructionAsync",
      "getWithdrawVaultInstructionAsync",
      "findProtocolPda",
      "findVaultAssetIdleAuthPda",
      "findVaultLpMintPda",
      "findVaultLpMintAuthPda",
      "findAdaptorAddReceiptPda",
      "findStrategyInitReceiptPda",
      "findVaultStrategyAuthPda",
      "findRequestWithdrawVaultReceiptPda",
    ];
    const present = wanted.filter((name) => typeof mod[name] === "function");
    let version: string | null = null;
    for (const candidate of [
      resolve(APP_ROOT, "node_modules/@voltr/vault-sdk/package.json"),
      resolve(REPO_ROOT, "node_modules/@voltr/vault-sdk/package.json"),
    ]) {
      if (existsSync(candidate)) {
        version =
          (JSON.parse(readFileSync(candidate, "utf8")) as { version?: string })
            .version ?? null;
        break;
      }
    }
    return {
      available: present.length === wanted.length,
      version,
      userSurface: present,
    };
  } catch (error) {
    return {
      available: false,
      version: null,
      userSurface: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function readSourceIdentity() {
  const git = (args: string[]): string | null => {
    const proc = Bun.spawnSync(["git", "-C", REPO_ROOT, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return proc.exitCode === 0 ? proc.stdout.toString().trim() : null;
  };
  const commit = git(["rev-parse", "HEAD"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = git(["status", "--porcelain"]) ?? "";
  return {
    repoRoot: REPO_ROOT,
    branch,
    commit,
    commitSha256Short: commit ? sha256(utf8(commit)).slice(0, 16) : null,
    dirty: dirty.length > 0,
    dirtyPaths: dirty.split("\n").filter((line) => line.length > 0),
    baseCommitNote: "worktree created from origin/main at 81ea913f",
  };
}

async function runCommand(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs: number
) {
  try {
    const proc = Bun.spawn([file, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const exit = await proc.exited;
    clearTimeout(timer);
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    const tail = `${stdout}${stderr}`.trim().split("\n").slice(-3).join(" | ");
    return {
      exit,
      summary: exit === 0 ? "ok" : tail.slice(0, 400) || `exit ${exit}`,
    };
  } catch (error) {
    return {
      exit: -1,
      summary: `not runnable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

if (import.meta.main) await main();
