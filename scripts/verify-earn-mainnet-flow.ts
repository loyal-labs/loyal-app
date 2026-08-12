import { mock } from "bun:test";
import bs58 from "bs58";
import { and, desc, eq, or, sql } from "drizzle-orm";
import nacl from "tweetnacl";
import {
  getAssociatedTokenAddressSync,
  AccountLayout,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  getRiskBasketMarketsForCluster,
  getKaminoUsdcEarnTargetForCluster,
  getStablecoinMintsForCluster,
  KAMINO_VANILLA_OBLIGATION_ID,
  KAMINO_VANILLA_OBLIGATION_TAG,
  LoyalCluster,
  RiskBasket,
  Stablecoin,
} from "../packages/loyal-actions/src/index.ts";
import {
  createSmartAccountVaultsClient,
  sendPreparedWithWallet,
  type WalletAdapterLike,
} from "../packages/smart-account-vaults/src/index.ts";
import {
  hydratePreparedEarnUsdcDeposit,
  type EarnDepositPrepareResponse,
} from "../frontend/src/lib/yield-optimization/earn-deposit-prepare-contracts.shared.ts";
import {
  buildEarnDepositConfirmRequestBody,
  buildEarnWithdrawalConfirmRequestBody,
} from "../frontend/src/lib/yield-optimization/earn-confirm-contracts.shared.ts";
import {
  hydratePreparedEarnUsdcWithdraw,
  type EarnWithdrawPrepareRequestBody,
  type EarnWithdrawPrepareResponse,
} from "../frontend/src/lib/yield-optimization/earn-withdraw-prepare-contracts.shared.ts";
import type {
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcYieldRoutingPolicy,
  SmartAccountPreparedEarnUsdcWithdraw,
  SmartAccountEarnUsdcWithdrawInput,
} from "../packages/smart-account-vaults/src/types.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import {
  compilePreparedOperation,
  generated,
  Policy,
  Settings,
} from "../sdk/loyal-smart-accounts-core/src/index.ts";
import { pda, PROGRAM_ADDRESS } from "../sdk/loyal-smart-accounts/src/index.ts";
import BN from "bn.js";

mock.module("server-only", () => ({}));

// Usage:
// EARN_VERIFY_OFFLINE_POLICY=1 NEXT_PUBLIC_SOLANA_ENV=mainnet EARN_VERIFY_PHASE=initial-deposit-from-clean EARN_VERIFY_DRY_RUN=1 bun scripts/verify-earn-mainnet-flow.ts
//
// op run --env-file=.env.mainnet.1password -- sh -c 'NEXT_PUBLIC_SOLANA_ENV=mainnet EARN_VERIFY_PHASE=policy-resume-readiness EARN_VERIFY_DRY_RUN=1 EARN_VERIFY_WALLET_ADDRESS=DPGXnygHY5VpYqi8ceUK3rTNX8nKZ5N8fD3Hyd8pPFSS EARN_SETTINGS_PDA=EXKgiSsCERMNAAS46wvFkqUTMGb9FXvHYpfjryjLfLSr EARN_FIRST_DEPOSIT_RAW=700000000 bun scripts/verify-earn-mainnet-flow.ts'
// op run --env-file=.env.mainnet.1password -- sh -c 'NEXT_PUBLIC_SOLANA_ENV=mainnet EARN_VERIFY_PHASE=full-withdraw-cleanup EARN_VERIFY_DRY_RUN=1 bun scripts/verify-earn-mainnet-flow.ts'
// op run --env-file=.env.mainnet.1password -- sh -c 'NEXT_PUBLIC_SOLANA_ENV=mainnet EARN_VERIFY_PHASE=top-up-partial-smoke EARN_VERIFY_DRY_RUN=1 bun scripts/verify-earn-mainnet-flow.ts'
// op run --env-file=.env.mainnet.1password -- sh -c 'NEXT_PUBLIC_SOLANA_ENV=mainnet EARN_VERIFY_FRONTEND_BASE_URL=http://localhost:3000 EARN_VERIFY_PHASE=same-mint-frontend-sdk-live EARN_VERIFY_DRY_RUN=1 bun scripts/verify-earn-mainnet-flow.ts'
// NEXT_PUBLIC_SOLANA_ENV=mainnet EARN_VERIFY_PHASE=rpc-holdings-withdrawal-preview EARN_VERIFY_DRY_RUN=1 bun scripts/verify-earn-mainnet-flow.ts
//
// Approved live lifecycle:
// op run --env-file=.env.mainnet.1password -- sh -c 'NEXT_PUBLIC_SOLANA_ENV=mainnet EARN_VERIFY_PHASE=initial-deposit-then-withdraw-cleanup bun scripts/verify-earn-mainnet-flow.ts'
// op run --env-file=.env.mainnet.1password -- sh -c 'NEXT_PUBLIC_SOLANA_ENV=mainnet EARN_VERIFY_FRONTEND_BASE_URL=http://localhost:3000 EARN_VERIFY_PHASE=same-mint-frontend-sdk-live bun scripts/verify-earn-mainnet-flow.ts'
// op run --env-file=.env.mainnet.1password -- sh -c 'NEXT_PUBLIC_SOLANA_ENV=mainnet EARN_VERIFY_FRONTEND_BASE_URL=http://localhost:3000 EARN_VERIFY_PHASE=source-lifecycle-withdrawals bun scripts/verify-earn-mainnet-flow.ts'
//
// Keep SOLANA_TESTING_PK and database/RPC secrets inside the op run subprocess.
// Remove EARN_VERIFY_DRY_RUN only for an approved live lifecycle run. Dry-run
// "all" is intentionally rejected because simulated cleanup cannot make the
// current mainnet wallet clean for the following initial-deposit-from-clean
// phase.

type VerifyPhase =
  | "full-withdraw-cleanup"
  | "initial-deposit-from-clean"
  | "initial-deposit-then-withdraw-cleanup"
  | "policy-only-reconcile-dry-run"
  | "policy-resume-readiness"
  | "rpc-holdings-withdrawal-preview"
  | "same-mint-frontend-sdk-live"
  | "source-lifecycle-withdrawals"
  | "top-up-partial-smoke"
  | "all";

type CleanupCandidateEvidence = {
  account: string | null;
  action: "close" | "not_safely_closeable";
  kind: string;
  reason?: string;
};

type EvidenceStep = {
  amountRaw?: string;
  autodepositCloseConfirmedSlot?: string | null;
  autodepositCloseSignature?: string | null;
  cleanupCandidates?: CleanupCandidateEvidence[];
  confirmedSlot?: string;
  error?: string;
  exitCode?: number | null;
  duplicateConfirm?: unknown;
  instructionCount?: number;
  kaminoDeposit?: unknown;
  kaminoSetupAccountCount?: number;
  kaminoSetupRentLamports?: string;
  kaminoSetupRequired?: boolean;
  command?: string;
  packetLength?: number | null;
  policyUpdateInstructionCount?: number;
  policyUpdateSignature?: string;
  policyUpdateSimulationLogs?: string[];
  policyUpdateUnsignedSimulationLogs?: string[];
  confirmedFinalizeSlot?: string | null;
  routeConfirmedSlot?: string | null;
  routeSignature?: string | null;
  finalizeInstructionCount?: number;
  finalizePacketLength?: number | null;
  finalizeSignature?: string | null;
  finalizeSimulationLogs?: string[];
  setupConfirmedSlot?: string | null;
  setupPacketLength?: number | null;
  setupPolicy?: unknown;
  setupPolicyUnsignedSimulationLogs?: string[];
  policyUniverse?: unknown;
  postKaminoVaultUsdcRaw?: string | null;
  persistence?: unknown;
  reason?: string;
  negativeCases?: unknown;
  sendsTransactions?: boolean;
  signature?: string;
  preparedTarget?: unknown;
  simulationLogs?: string[];
  setupSignature?: string;
  stderr?: string;
  stdout?: string;
  unsignedSimulationLogs?: string[];
  status: "skipped" | "success" | "failed";
  kaminoWithdrawAmountRaw?: string;
  transactionFeeLamports?: string;
  vaultUsdcRemainderRaw?: string;
};

class FrontendRequestError extends Error {
  readonly body: unknown;
  readonly path: string | null;
  readonly status: number;

  constructor(args: { body: unknown; path?: string | null; status: number }) {
    super(
      `Frontend request${args.path ? ` ${args.path}` : ""} failed with ${
        args.status
      }: ${JSON.stringify(args.body)}`
    );
    this.name = "FrontendRequestError";
    this.body = args.body;
    this.path = args.path ?? null;
    this.status = args.status;
  }
}

const SOLANA_ENV = resolveSolanaEnv(
  process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV ?? "mainnet"
);
const VERIFY_PHASE = (process.env.EARN_VERIFY_PHASE ??
  "full-withdraw-cleanup") as VerifyPhase;
const DRY_RUN = process.env.EARN_VERIFY_DRY_RUN === "1";
const OFFLINE_POLICY_VERIFY = process.env.EARN_VERIFY_OFFLINE_POLICY === "1";
const FRONTEND_BASE_URL =
  process.env.EARN_VERIFY_FRONTEND_BASE_URL?.replace(/\/+$/, "") || null;
const FRONTEND_SESSION_COOKIE =
  process.env.EARN_VERIFY_FRONTEND_COOKIE?.trim() || null;
const FRONTEND_TURNSTILE_TOKEN =
  process.env.EARN_VERIFY_TURNSTILE_TOKEN?.trim() || "local-bypass";
const YIELD_ROUTING_REPO =
  process.env.EARN_YIELD_ROUTING_REPO?.trim() || "../loyal-yield-routing";
const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  process.env.RPC_URL ??
  getSolanaEndpoints(SOLANA_ENV).rpcEndpoint;
const PROGRAM_ID = new PublicKey(
  process.env.LOYAL_SMART_ACCOUNTS_PROGRAM_ID ?? PROGRAM_ADDRESS
);
const SETTINGS_PDA = new PublicKey(
  process.env.EARN_SETTINGS_PDA ??
    process.env.SMART_ACCOUNT_SETTINGS_PDA ??
    "6jgkucnbz1RuHq6NULqACQY3r2XegHaWhgPpaCEGPCA3"
);
const FIRST_DEPOSIT_RAW = parseRawAmount(
  process.env.EARN_FIRST_DEPOSIT_RAW ?? "10000"
);
const TOP_UP_DEPOSIT_RAW = parseRawAmount(
  process.env.EARN_TOP_UP_DEPOSIT_RAW ?? "5000"
);
const PARTIAL_WITHDRAW_RAW = parseRawAmount(
  process.env.EARN_PARTIAL_WITHDRAW_RAW ?? "7000"
);
const IDLE_FUNDING_RAW = parseRawAmount(
  process.env.EARN_IDLE_FUNDING_RAW ?? "2000"
);
const RESUME_FULL_WITHDRAW_SIGNATURE =
  process.env.EARN_FULL_WITHDRAW_SIGNATURE?.trim() || null;
const RESUME_FULL_WITHDRAW_SLOT =
  process.env.EARN_FULL_WITHDRAW_SLOT?.trim() || null;
const RESUME_INITIAL_DEPOSIT_SIGNATURE =
  process.env.EARN_INITIAL_DEPOSIT_SIGNATURE?.trim() || null;
const RESUME_INITIAL_DEPOSIT_SLOT =
  process.env.EARN_INITIAL_DEPOSIT_SLOT?.trim() || null;
const RESUME_INITIAL_POLICY_SIGNATURE =
  process.env.EARN_INITIAL_POLICY_SIGNATURE?.trim() || null;
const RESUME_INITIAL_POLICY_SLOT =
  process.env.EARN_INITIAL_POLICY_SLOT?.trim() || null;
const RESUME_INITIAL_POLICY_ACCOUNT =
  process.env.EARN_INITIAL_POLICY_ACCOUNT?.trim() || null;
const RESUME_INITIAL_POLICY_SEED =
  process.env.EARN_INITIAL_POLICY_SEED?.trim() || null;
const RESUME_INITIAL_SETUP_POLICY_SIGNATURE =
  process.env.EARN_INITIAL_SETUP_POLICY_SIGNATURE?.trim() || null;
const RESUME_INITIAL_SETUP_POLICY_SLOT =
  process.env.EARN_INITIAL_SETUP_POLICY_SLOT?.trim() || null;
const RESUME_INITIAL_SETUP_POLICY_ACCOUNT =
  process.env.EARN_INITIAL_SETUP_POLICY_ACCOUNT?.trim() || null;
const RESUME_INITIAL_SETUP_POLICY_SEED =
  process.env.EARN_INITIAL_SETUP_POLICY_SEED?.trim() || null;
const RESUME_TOP_UP_DEPOSIT_SIGNATURE =
  process.env.EARN_TOP_UP_DEPOSIT_SIGNATURE?.trim() || null;
const RESUME_TOP_UP_DEPOSIT_SLOT =
  process.env.EARN_TOP_UP_DEPOSIT_SLOT?.trim() || null;
const RESUME_PARTIAL_WITHDRAW_SIGNATURE =
  process.env.EARN_PARTIAL_WITHDRAW_SIGNATURE?.trim() || null;
const RESUME_PARTIAL_WITHDRAW_SLOT =
  process.env.EARN_PARTIAL_WITHDRAW_SLOT?.trim() || null;
const RESUME_IDLE_FUNDING_SIGNATURE =
  process.env.EARN_IDLE_FUNDING_SIGNATURE?.trim() || null;
const RESUME_IDLE_FUNDING_SLOT =
  process.env.EARN_IDLE_FUNDING_SLOT?.trim() || null;
const RESUME_IDLE_WITHDRAW_SIGNATURE =
  process.env.EARN_IDLE_WITHDRAW_SIGNATURE?.trim() || null;
const RESUME_IDLE_WITHDRAW_SLOT =
  process.env.EARN_IDLE_WITHDRAW_SLOT?.trim() || null;
const RESUME_RESERVE_WITHDRAW_SIGNATURE =
  process.env.EARN_RESERVE_WITHDRAW_SIGNATURE?.trim() || null;
const RESUME_RESERVE_WITHDRAW_SLOT =
  process.env.EARN_RESERVE_WITHDRAW_SLOT?.trim() || null;
const EVIDENCE_PATH =
  process.env.EARN_MAINNET_EVIDENCE_PATH ??
  `/private/tmp/loyal-earn-mainnet-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.json`;
const EARN_TARGET = getKaminoUsdcEarnTargetForCluster(LoyalCluster.MainnetBeta);
const EARN_POLICY_UNIVERSE = {
  kaminoLiquidityMints: getStablecoinMintsForCluster(
    LoyalCluster.MainnetBeta
  ).map((mint) => mint.toBase58()),
  kaminoMarkets: getRiskBasketMarketsForCluster(
    LoyalCluster.MainnetBeta,
    RiskBasket.Safe
  ).map((market) => market.toBase58()),
  riskProfile: RiskBasket.Safe,
  routeModes: ["same_mint_kamino"],
  stableMints: getStablecoinMintsForCluster(LoyalCluster.MainnetBeta).map(
    (mint) => mint.toBase58()
  ),
  universePreset: "canonical_stable_kamino",
};
const RENT_REFUND_ROUNDING_ALLOWANCE_LAMPORTS = 10_000;
const PACKET_DATA_SIZE = 1232;

function parseRawAmount(value: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`Invalid positive raw amount: ${value}`);
  }
  return BigInt(value);
}

function loadTestingKeypair(): Keypair {
  const raw = process.env.SOLANA_TESTING_PK;
  if (!raw) {
    throw new Error("SOLANA_TESTING_PK is not set.");
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Keypair.fromSecretKey(
      Uint8Array.from(
        trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
      )
    );
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

function loadDeploymentPolicySigner(): PublicKey {
  const publicSigner = process.env.EARN_YIELD_ROUTER_PUBLIC_KEY?.trim();
  if (publicSigner) {
    return new PublicKey(publicSigner);
  }

  const raw = process.env.DEPLOYMENT_PK;
  if (!raw) {
    throw new Error(
      "EARN_YIELD_ROUTER_PUBLIC_KEY or DEPLOYMENT_PK is not set."
    );
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    const bytes = Uint8Array.from(JSON.parse(trimmed));
    return (
      bytes.length === 32
        ? Keypair.fromSeed(bytes)
        : Keypair.fromSecretKey(bytes)
    ).publicKey;
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    const bytes = Uint8Array.from(
      trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
    );
    return (
      bytes.length === 32
        ? Keypair.fromSeed(bytes)
        : Keypair.fromSecretKey(bytes)
    ).publicKey;
  }
  const bytes = bs58.decode(trimmed);
  return (
    bytes.length === 32 ? Keypair.fromSeed(bytes) : Keypair.fromSecretKey(bytes)
  ).publicKey;
}

function assertMainnet(): void {
  if (SOLANA_ENV !== "mainnet") {
    throw new Error(
      `This verifier must run against mainnet, got ${SOLANA_ENV}. Set NEXT_PUBLIC_SOLANA_ENV=mainnet.`
    );
  }
}

function assertVerifyPhase(phase: string): asserts phase is VerifyPhase {
  if (
    phase !== "full-withdraw-cleanup" &&
    phase !== "initial-deposit-from-clean" &&
    phase !== "initial-deposit-then-withdraw-cleanup" &&
    phase !== "policy-only-reconcile-dry-run" &&
    phase !== "policy-resume-readiness" &&
    phase !== "rpc-holdings-withdrawal-preview" &&
    phase !== "same-mint-frontend-sdk-live" &&
    phase !== "source-lifecycle-withdrawals" &&
    phase !== "top-up-partial-smoke" &&
    phase !== "all"
  ) {
    throw new Error(`Unsupported EARN_VERIFY_PHASE: ${phase}`);
  }
}

function assertSupportedPhaseMode(): void {
  if (VERIFY_PHASE === "all" && DRY_RUN) {
    throw new Error(
      "EARN_VERIFY_PHASE=all requires a live approved run. Use dry-run phases full-withdraw-cleanup/top-up-partial-smoke plus EARN_VERIFY_OFFLINE_POLICY=1 for non-mutating verification."
    );
  }
  if (VERIFY_PHASE === "initial-deposit-then-withdraw-cleanup" && DRY_RUN) {
    throw new Error(
      "EARN_VERIFY_PHASE=initial-deposit-then-withdraw-cleanup requires a live approved run. Use EARN_VERIFY_PHASE=initial-deposit-from-clean EARN_VERIFY_DRY_RUN=1 for non-mutating policy/deposit preparation."
    );
  }
  if (VERIFY_PHASE === "source-lifecycle-withdrawals" && DRY_RUN) {
    throw new Error(
      "EARN_VERIFY_PHASE=source-lifecycle-withdrawals requires a live approved run because it must create, reconcile, withdraw, and clean up real source state."
    );
  }
}

function createWalletAdapter(keypair: Keypair): WalletAdapterLike {
  return {
    publicKey: keypair.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      transaction: T
    ) {
      if (transaction instanceof VersionedTransaction) {
        transaction.sign([keypair]);
      } else {
        transaction.sign(keypair);
      }
      return transaction;
    },
  };
}

type FrontendSession = {
  baseUrl: string;
  cookie: string;
  settingsPda: string;
  smartAccountAddress: string;
};

function bigintJson(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function signWalletAuthMessage(args: {
  keypair: Keypair;
  message: string;
}): string {
  const encodedMessage = new TextEncoder().encode(args.message);
  return bs58.encode(
    nacl.sign.detached(encodedMessage, args.keypair.secretKey)
  );
}

function extractCookieHeader(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  const setCookies =
    getSetCookie && getSetCookie.length > 0
      ? getSetCookie
      : response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie")!]
      : [];
  const cookies = setCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  if (cookies.length === 0) {
    throw new Error("Frontend auth did not return a session cookie.");
  }

  return cookies.join("; ");
}

async function readJsonResponse<T>(
  response: Response,
  path?: string
): Promise<T> {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new FrontendRequestError({ body, path, status: response.status });
  }

  return body as T;
}

async function frontendPostJson<T>(args: {
  body: unknown;
  cookie?: string;
  path: string;
  session: Pick<FrontendSession, "baseUrl">;
}): Promise<{ body: T; response: Response }> {
  const response = await fetch(`${args.session.baseUrl}${args.path}`, {
    body: JSON.stringify(args.body, bigintJson),
    headers: {
      "content-type": "application/json",
      origin: args.session.baseUrl,
      ...(args.cookie ? { cookie: args.cookie } : {}),
    },
    method: "POST",
  });

  return {
    body: await readJsonResponse<T>(response, args.path),
    response,
  };
}

async function frontendGetJson<T>(args: {
  cookie?: string;
  path: string;
  session: Pick<FrontendSession, "baseUrl">;
}): Promise<{ body: T; response: Response }> {
  const response = await fetch(`${args.session.baseUrl}${args.path}`, {
    headers: {
      origin: args.session.baseUrl,
      ...(args.cookie ? { cookie: args.cookie } : {}),
    },
    method: "GET",
  });

  return {
    body: await readJsonResponse<T>(response, args.path),
    response,
  };
}

async function frontendPostJsonRaw(args: {
  body: unknown;
  cookie?: string;
  path: string;
  session: Pick<FrontendSession, "baseUrl">;
}): Promise<{ body: unknown; response: Response; text: string }> {
  const response = await fetch(`${args.session.baseUrl}${args.path}`, {
    body: JSON.stringify(args.body, bigintJson),
    headers: {
      "content-type": "application/json",
      origin: args.session.baseUrl,
      ...(args.cookie ? { cookie: args.cookie } : {}),
    },
    method: "POST",
  });
  const text = await response.text();

  return {
    body: text ? JSON.parse(text) : null,
    response,
    text,
  };
}

async function authenticateFrontendSession(args: {
  keypair: Keypair;
  smartAccountAddress: PublicKey;
}): Promise<FrontendSession | null> {
  if (!FRONTEND_BASE_URL) {
    return null;
  }

  if (FRONTEND_SESSION_COOKIE) {
    return {
      baseUrl: FRONTEND_BASE_URL,
      cookie: FRONTEND_SESSION_COOKIE,
      settingsPda: SETTINGS_PDA.toBase58(),
      smartAccountAddress: args.smartAccountAddress.toBase58(),
    };
  }

  const challenge = await frontendPostJson<{
    challengeToken: string;
    message: string;
  }>({
    body: {
      turnstileToken: FRONTEND_TURNSTILE_TOKEN,
      walletAddress: args.keypair.publicKey.toBase58(),
    },
    path: "/api/auth/wallet/challenge",
    session: { baseUrl: FRONTEND_BASE_URL },
  });
  const signature = signWalletAuthMessage({
    keypair: args.keypair,
    message: challenge.body.message,
  });
  const completion = await frontendPostJson<{
    user?: { settingsPda?: string; smartAccountAddress?: string };
  }>({
    body: {
      challengeToken: challenge.body.challengeToken,
      signature,
    },
    path: "/api/auth/wallet/complete",
    session: { baseUrl: FRONTEND_BASE_URL },
  });

  return {
    baseUrl: FRONTEND_BASE_URL,
    cookie: extractCookieHeader(completion.response),
    settingsPda: completion.body.user?.settingsPda ?? SETTINGS_PDA.toBase58(),
    smartAccountAddress:
      completion.body.user?.smartAccountAddress ??
      args.smartAccountAddress.toBase58(),
  };
}

async function prepareEarnDepositViaFrontend(args: {
  amountRaw: bigint;
  session: FrontendSession;
}): Promise<SmartAccountPreparedEarnUsdcDeposit> {
  const response = await frontendPostJson<EarnDepositPrepareResponse>({
    body: {
      amountRaw: args.amountRaw.toString(),
      mint: EARN_TARGET.liquidityMint.toBase58(),
    },
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/deposits/prepare",
    session: args.session,
  });

  return hydratePreparedEarnUsdcDeposit(response.body.preparedDeposit);
}

function buildEarnDepositConfirmFrontendBody(args: {
  confirmedSlot: bigint;
  policyConfirmedSlot?: bigint;
  policySignature?: string;
  prepared: SmartAccountPreparedEarnUsdcDeposit;
  session: FrontendSession;
  setupPolicyConfirmedSlot?: bigint;
  setupPolicySignature?: string;
  signature: string;
}) {
  return buildEarnDepositConfirmRequestBody({
    confirmedSlot: args.confirmedSlot.toString(),
    policyConfirmedSlot: args.policyConfirmedSlot?.toString(),
    policySignature: args.policySignature,
    preparedDeposit: args.prepared,
    setupPolicyConfirmedSlot: args.setupPolicyConfirmedSlot?.toString(),
    setupPolicySignature: args.setupPolicySignature,
    signature: args.signature,
    smartAccountAddress: args.session.smartAccountAddress,
  });
}

async function confirmEarnDepositViaFrontend(args: {
  confirmedSlot: bigint;
  policyConfirmedSlot?: bigint;
  policySignature?: string;
  prepared: SmartAccountPreparedEarnUsdcDeposit;
  session: FrontendSession;
  setupPolicyConfirmedSlot?: bigint;
  setupPolicySignature?: string;
  signature: string;
}) {
  const response = await frontendPostJson<{ position: unknown }>({
    body: buildEarnDepositConfirmFrontendBody(args),
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/deposits/confirm",
    session: args.session,
  });

  return response.body.position;
}

async function prepareEarnWithdrawViaFrontend(args: {
  amountRaw: bigint;
  mode: "partial" | "full";
  session: FrontendSession;
  source?: EarnWithdrawPrepareRequestBody["source"];
}): Promise<SmartAccountPreparedEarnUsdcWithdraw> {
  const response = await frontendPostJson<EarnWithdrawPrepareResponse>({
    body: {
      amountRaw: args.amountRaw.toString(),
      mode: args.mode,
      ...(args.source ? { source: args.source } : {}),
    },
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/withdrawals/prepare",
    session: args.session,
  });

  return hydratePreparedEarnUsdcWithdraw(response.body.preparedWithdraw);
}

async function fetchEarnPositionViaFrontend(args: {
  session: FrontendSession;
}) {
  const response = await frontendGetJson<{ position: unknown }>({
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/position",
    session: args.session,
  });

  return response.body.position;
}

async function reconcileEarnPositionViaFrontend(args: {
  force?: boolean;
  session: FrontendSession;
}) {
  const response = await frontendPostJson<unknown>({
    body: args.force ? { force: true } : {},
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/position/reconcile",
    session: args.session,
  });

  return response.body;
}

function buildEarnWithdrawConfirmFrontendBody(args: {
  autodepositCloseConfirmedSlot?: bigint;
  autodepositCloseSignature?: string;
  confirmedSlot: bigint;
  prepared: SmartAccountPreparedEarnUsdcWithdraw;
  session: FrontendSession;
  signature: string;
}) {
  return buildEarnWithdrawalConfirmRequestBody({
    ...(args.autodepositCloseSignature
      ? { autodepositCloseSignature: args.autodepositCloseSignature }
      : {}),
    ...(args.autodepositCloseConfirmedSlot
      ? {
          autodepositCloseConfirmedSlot:
            args.autodepositCloseConfirmedSlot.toString(),
        }
      : {}),
    confirmedSlot: args.confirmedSlot.toString(),
    preparedWithdraw: args.prepared,
    signature: args.signature,
    smartAccountAddress: args.session.smartAccountAddress,
  });
}

async function confirmEarnWithdrawViaFrontend(args: {
  autodepositCloseConfirmedSlot?: bigint;
  autodepositCloseSignature?: string;
  confirmedSlot: bigint;
  prepared: SmartAccountPreparedEarnUsdcWithdraw;
  session: FrontendSession;
  signature: string;
}) {
  const response = await frontendPostJson<{ position: unknown }>({
    body: buildEarnWithdrawConfirmFrontendBody(args),
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/withdrawals/confirm",
    session: args.session,
  });

  return response.body.position;
}

function assertSafePolicyUniverse(
  persistence:
    | SmartAccountPreparedEarnUsdcDeposit["persistence"]
    | SmartAccountPreparedEarnUsdcYieldRoutingPolicy["persistence"]
): void {
  const actual = {
    kaminoLiquidityMints: persistence.kaminoLiquidityMints,
    kaminoMarkets: persistence.kaminoMarkets,
    riskProfile: persistence.riskProfile,
    routeModes: persistence.routeModes,
    stableMints: persistence.stableMints,
    universePreset: persistence.universePreset,
  };
  if (JSON.stringify(actual) !== JSON.stringify(EARN_POLICY_UNIVERSE)) {
    throw new Error(
      `Prepared Earn policy universe mismatch: ${JSON.stringify(actual)}`
    );
  }
}

function preparedTargetEvidence(
  prepared:
    | SmartAccountPreparedEarnUsdcDeposit
    | SmartAccountPreparedEarnUsdcYieldRoutingPolicy
    | SmartAccountPreparedEarnUsdcWithdraw
) {
  return {
    targetReserve: {
      reserve: prepared.targetReserve.reserve.toBase58(),
      market: prepared.targetReserve.market.toBase58(),
      liquidityMint: prepared.targetReserve.liquidityMint.toBase58(),
      obligation: prepared.targetReserve.obligation.toBase58(),
      ...("supplyApyBps" in prepared.targetReserve
        ? {
            supplyApyBps:
              prepared.targetReserve.supplyApyBps?.toString() ?? null,
          }
        : {}),
    },
    vault: {
      accountIndex: prepared.vault.accountIndex,
      pubkey: prepared.vault.pubkey.toBase58(),
      ...("usdcAta" in prepared.vault
        ? { usdcAta: prepared.vault.usdcAta.toBase58() }
        : {}),
      ...("collateralAta" in prepared.vault
        ? {
            collateralAta: prepared.vault.collateralAta?.toBase58() ?? null,
          }
        : {}),
    },
  };
}

function createSerializedSettingsAccount(policySeed: BN | null = null) {
  const [data] = Settings.fromArgs({
    accountUtilization: 0,
    archivalAuthority: null,
    archivableAfter: new BN(0),
    bump: 255,
    policySeed,
    reserved2: 0,
    seed: new BN(0),
    settingsAuthority: PublicKey.default,
    signers: [],
    staleTransactionIndex: new BN(0),
    threshold: 1,
    timeLock: 0,
    transactionIndex: new BN(0),
  }).serialize();

  return {
    data,
    executable: false,
    lamports: 1,
    owner: PROGRAM_ID,
    rentEpoch: 0,
  };
}

function preparedPacketLength(
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"]
): number {
  return compilePreparedOperation({
    blockhash: "11111111111111111111111111111111",
    prepared,
  }).serialize().length;
}

function generatedPubkeyConstraintValues(
  constraints: generated.AccountConstraint[],
  accountIndex: number
): string[] {
  const constraint = constraints.find(
    (candidate) => candidate.accountIndex === accountIndex
  );
  if (!constraint || constraint.accountConstraint.__kind !== "Pubkey") {
    throw new Error(`Expected pubkey account constraint ${accountIndex}.`);
  }
  return constraint.accountConstraint.fields[0].map((pubkey) =>
    pubkey.toBase58()
  );
}

function assertPolicyPayloadUsesSafeUniverse(args: {
  expectedStableMints?: readonly string[];
  label: string;
  payload: generated.PolicyCreationPayload;
}) {
  const expectedStableMints =
    args.expectedStableMints ?? EARN_POLICY_UNIVERSE.stableMints;
  const payload = args.payload;
  if (payload.__kind !== "ProgramInteraction") {
    throw new Error("Expected ProgramInteraction policy payload.");
  }
  const [field] = payload.fields;
  if (field.instructionsConstraints.length !== 2) {
    throw new Error("Expected combined withdraw and deposit constraints.");
  }
  const [withdrawConstraint, depositConstraint] = field.instructionsConstraints;
  const withdrawMarkets = generatedPubkeyConstraintValues(
    withdrawConstraint!.accountConstraints,
    2
  );
  const markets = generatedPubkeyConstraintValues(
    depositConstraint!.accountConstraints,
    2
  );
  const mints = generatedPubkeyConstraintValues(
    depositConstraint!.accountConstraints,
    5
  );
  if (
    JSON.stringify(withdrawMarkets) !==
    JSON.stringify(EARN_POLICY_UNIVERSE.kaminoMarkets)
  ) {
    throw new Error(
      `${args.label} Safe Kamino withdraw market constraint mismatch.`
    );
  }
  if (
    withdrawConstraint!.accountConstraints.some(
      (constraint) => constraint.accountIndex === 4
    )
  ) {
    throw new Error(
      `${args.label} withdraw constraint must not duplicate the stable mint allowlist.`
    );
  }
  if (
    withdrawConstraint!.accountConstraints.some(
      (constraint) => constraint.accountIndex === 1
    )
  ) {
    throw new Error(
      `${args.label} withdraw constraint must not allow obligation.`
    );
  }
  if (
    JSON.stringify(markets) !==
    JSON.stringify(EARN_POLICY_UNIVERSE.kaminoMarkets)
  ) {
    throw new Error(
      `${args.label} Safe Kamino deposit market constraint mismatch.`
    );
  }
  if (JSON.stringify(mints) !== JSON.stringify(expectedStableMints)) {
    throw new Error(`${args.label} deposit stable mint constraint mismatch.`);
  }
}

function assertPreparedPolicyCreateUsesSafeUniverse(args: {
  expectedStableMints?: readonly string[];
  prepared: SmartAccountPreparedEarnUsdcYieldRoutingPolicy["prepared"];
}) {
  const policyCreate = readPreparedPolicyCreate(args.prepared);
  assertPolicyPayloadUsesSafeUniverse({
    expectedStableMints: args.expectedStableMints,
    label: "PolicyCreate",
    payload: policyCreate.policyCreationPayload,
  });
}

function readPreparedPolicyCreate(
  prepared: SmartAccountPreparedEarnUsdcYieldRoutingPolicy["prepared"]
) {
  const [decoded] = generated.executeSettingsTransactionSyncStruct.deserialize(
    Buffer.from(prepared.instructions[0]?.data ?? [])
  );
  const policyCreate = decoded.args.actions.find(
    (action) => action.__kind === "PolicyCreate"
  );
  if (!policyCreate || policyCreate.__kind !== "PolicyCreate") {
    throw new Error("Expected a PolicyCreate action.");
  }
  return policyCreate;
}

function assertPreparedSetupPolicyCreateUsesInitObligation(
  prepared: SmartAccountPreparedEarnUsdcYieldRoutingPolicy["prepared"]
) {
  const [decoded] = generated.executeSettingsTransactionSyncStruct.deserialize(
    Buffer.from(prepared.instructions[0]?.data ?? [])
  );
  const policyCreate = decoded.args.actions.find(
    (action) => action.__kind === "PolicyCreate"
  );
  if (!policyCreate || policyCreate.__kind !== "PolicyCreate") {
    throw new Error("Expected an init-obligation PolicyCreate action.");
  }
  const payload = policyCreate.policyCreationPayload;
  if (payload.__kind !== "ProgramInteraction") {
    throw new Error("Expected ProgramInteraction setup policy payload.");
  }
  const [field] = payload.fields;
  if (field.accountIndex !== 1) {
    throw new Error("Expected setup policy to target Earn vault index 1.");
  }
  if (field.instructionsConstraints.length !== 1) {
    throw new Error("Expected exactly one init-obligation constraint.");
  }
  const [initObligationConstraint] = field.instructionsConstraints;
  if (!initObligationConstraint) {
    throw new Error("Expected init-obligation instruction constraint.");
  }
  const markets = generatedPubkeyConstraintValues(
    initObligationConstraint.accountConstraints,
    3
  );
  if (
    JSON.stringify(markets) !==
    JSON.stringify(EARN_POLICY_UNIVERSE.kaminoMarkets)
  ) {
    throw new Error("Setup policy Safe Kamino market constraint mismatch.");
  }
  const [dataConstraint] = initObligationConstraint.dataConstraints;
  if (
    !dataConstraint ||
    dataConstraint.operator !== generated.DataOperator.Equals ||
    dataConstraint.dataOffset.toString() !== "0" ||
    dataConstraint.dataValue.__kind !== "U8Slice"
  ) {
    throw new Error("Expected setup policy init-obligation data prefix check.");
  }
  const expectedPrefix = Uint8Array.from([
    ...EARN_TARGET.initObligationDiscriminator,
    KAMINO_VANILLA_OBLIGATION_TAG,
    KAMINO_VANILLA_OBLIGATION_ID,
  ]);
  const actualPrefix = dataConstraint.dataValue.fields[0];
  if (
    actualPrefix.length !== expectedPrefix.length ||
    !actualPrefix.every((value, index) => value === expectedPrefix[index])
  ) {
    throw new Error("Setup policy init-obligation discriminator mismatch.");
  }
}

function installOfflineKaminoWithdrawMock(args: {
  vaultPda: PublicKey;
  vaultUsdcAta: PublicKey;
}) {
  const originalFetch = globalThis.fetch;
  const reserveCollateralMint = new PublicKey(
    "11111111111111111111111111111115"
  );
  const reserveLiquiditySupply = new PublicKey(
    "11111111111111111111111111111114"
  );
  const vaultCollateralAta = getAssociatedTokenAddressSync(
    reserveCollateralMint,
    args.vaultPda,
    true,
    TOKEN_PROGRAM_ID
  );

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { amount?: string };
    const amountRaw = BigInt(
      Math.round(Number.parseFloat(body.amount ?? "0") * 1_000_000)
    );
    const instructionData = Buffer.alloc(16);
    Buffer.from(EARN_TARGET.withdrawDiscriminator).copy(instructionData, 0);
    instructionData.writeBigUInt64LE(amountRaw, 8);
    return new Response(
      JSON.stringify({
        instructions: [
          {
            accounts: [
              { address: args.vaultPda.toBase58(), role: "WRITABLE_SIGNER" },
              { address: EARN_TARGET.market.toBase58(), role: "READONLY" },
              { address: EARN_TARGET.reserve.toBase58(), role: "WRITABLE" },
              { address: PublicKey.default.toBase58(), role: "READONLY" },
              {
                address: EARN_TARGET.liquidityMint.toBase58(),
                role: "READONLY",
              },
              { address: reserveCollateralMint.toBase58(), role: "WRITABLE" },
              { address: reserveLiquiditySupply.toBase58(), role: "WRITABLE" },
              { address: vaultCollateralAta.toBase58(), role: "WRITABLE" },
              { address: args.vaultUsdcAta.toBase58(), role: "WRITABLE" },
              { address: TOKEN_PROGRAM_ID.toBase58(), role: "READONLY" },
              { address: TOKEN_PROGRAM_ID.toBase58(), role: "READONLY" },
              {
                address: "Sysvar1nstructions1111111111111111111111111",
                role: "READONLY",
              },
            ],
            data: instructionData.toString("base64"),
            programAddress: EARN_TARGET.lendProgramId.toBase58(),
          },
        ],
      }),
      { status: 200 }
    );
  }) as never;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function runOfflinePolicyVerifier(): Promise<void> {
  assertMainnet();
  assertVerifyPhase(VERIFY_PHASE);

  const walletAddress = new PublicKey("11111111111111111111111111111113");
  const policySigner = new PublicKey("11111111111111111111111111111119");
  const feePayer = walletAddress;
  const connection = {
    getAccountInfo: async (address: PublicKey) =>
      address.equals(SETTINGS_PDA)
        ? createSerializedSettingsAccount(new BN(6))
        : null,
  };
  const client = createSmartAccountVaultsClient({
    connection: connection as never,
    programId: PROGRAM_ID,
  });
  const preparedPolicy = await client.prepareEarnUsdcYieldRoutingPolicy({
    cluster: LoyalCluster.MainnetBeta,
    feePayer,
    settingsPda: SETTINGS_PDA,
    signer: policySigner,
    walletAddress,
  });
  assertSafePolicyUniverse(preparedPolicy.persistence);
  const finalizePrepared = preparedPolicy.finalizePrepared ?? null;
  if (!finalizePrepared) {
    throw new Error(
      "Earn policy verifier expected an init-obligation setup policy transaction."
    );
  }
  assertPreparedPolicyCreateUsesSafeUniverse({
    prepared: preparedPolicy.prepared,
  });
  assertPreparedSetupPolicyCreateUsesInitObligation(finalizePrepared);
  const policyPacketLength = preparedPacketLength(preparedPolicy.prepared);
  if (policyPacketLength > PACKET_DATA_SIZE) {
    throw new Error(`PolicyCreate packet too large: ${policyPacketLength}.`);
  }
  const finalizePacketLength = finalizePrepared
    ? preparedPacketLength(finalizePrepared)
    : null;
  if (
    finalizePacketLength !== null &&
    finalizePacketLength > PACKET_DATA_SIZE
  ) {
    throw new Error(
      `Init-obligation PolicyCreate packet too large: ${finalizePacketLength}.`
    );
  }

  const vaultPda = preparedPolicy.vault.pubkey;
  const vaultUsdcAta = getAssociatedTokenAddressSync(
    EARN_TARGET.liquidityMint,
    vaultPda,
    true,
    TOKEN_PROGRAM_ID
  );
  const restoreFetch = installOfflineKaminoWithdrawMock({
    vaultPda,
    vaultUsdcAta,
  });
  try {
    const preparedWithdraw = await client.prepareEarnUsdcWithdraw({
      amountRaw: PARTIAL_WITHDRAW_RAW,
      cluster: LoyalCluster.MainnetBeta,
      feePayer,
      mode: "partial",
      policySigner,
      settingsPda: SETTINGS_PDA,
      walletAddress,
      yieldRoutingPolicy: {
        account: preparedPolicy.policy.account,
        seed: preparedPolicy.policy.seed,
        setupPolicy: {
          account: preparedPolicy.setupPolicy.account,
          seed: preparedPolicy.setupPolicy.seed,
        },
      },
    });
    if ("policyUpdatePrepared" in preparedWithdraw) {
      throw new Error("Withdraw preparation must not include a policy update.");
    }
    await writeEvidence({
      cluster: LoyalCluster.MainnetBeta,
      dryRun: true,
      env: SOLANA_ENV,
      evidencePath: EVIDENCE_PATH,
      finalizePacketLength,
      mode: "offline-policy",
      phase: VERIFY_PHASE,
      policyAccount: preparedPolicy.policy.account.toBase58(),
      policyPacketLength,
      policyUniverse: EARN_POLICY_UNIVERSE,
    });
    console.log("[earn-mainnet] PASS offline policy verifier");
  } finally {
    restoreFetch();
  }
}

async function writeEvidence(evidence: unknown): Promise<void> {
  await Bun.write(
    EVIDENCE_PATH,
    `${JSON.stringify(evidence, bigintJson, 2)}\n`
  );
}

type CommandCapture = {
  command: readonly string[];
  cwd: string;
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

async function runCommandCapture(args: {
  command: readonly string[];
  cwd: string;
  env?: Record<string, string>;
}): Promise<CommandCapture> {
  const subprocess = Bun.spawn(args.command, {
    cwd: args.cwd,
    env: { ...process.env, ...args.env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);

  return {
    command: args.command,
    cwd: args.cwd,
    exitCode,
    stderr,
    stdout,
  };
}

function parseCommandJson(stdout: string, label: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`${label} did not print JSON.`);
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error(
      `${label} printed invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getRecordField(
  value: unknown,
  field: string
): Record<string, unknown> | null {
  return asRecord(asRecord(value)?.[field]);
}

function getArrayField(value: unknown, field: string): unknown[] {
  const candidate = asRecord(value)?.[field];
  return Array.isArray(candidate) ? candidate : [];
}

function getStringField(value: unknown, field: string): string | null {
  const candidate = asRecord(value)?.[field];
  return typeof candidate === "string" ? candidate : null;
}

function getBooleanField(value: unknown, field: string): boolean | null {
  const candidate = asRecord(value)?.[field];
  return typeof candidate === "boolean" ? candidate : null;
}

function getNumberField(value: unknown, field: string): number | null {
  const candidate = asRecord(value)?.[field];
  return typeof candidate === "number" ? candidate : null;
}

function getRawAmountField(value: unknown, field: string): bigint | null {
  const candidate = asRecord(value)?.[field];
  if (typeof candidate === "bigint") {
    return candidate;
  }
  if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
    return BigInt(candidate);
  }
  if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
    return BigInt(candidate);
  }
  return null;
}

type EarnSourceHoldingEvidence = {
  amountRaw: string;
  kind: "idle" | "kamino";
  liquidityMint: string;
  market: string | null;
  provenance: Record<string, unknown>;
  reserve: string | null;
};

function readEarnHoldings(position: unknown): EarnSourceHoldingEvidence[] {
  const holdings = getArrayField(position, "holdings");
  return holdings.map((holding, index) => {
    const record = asRecord(holding);
    if (!record) {
      throw new Error(`Earn holding ${index} is not an object.`);
    }
    const kind = record.kind;
    if (kind !== "idle" && kind !== "kamino") {
      throw new Error(`Earn holding ${index} has unsupported kind.`);
    }
    const amountRaw = getStringField(record, "amountRaw");
    const liquidityMint = getStringField(record, "liquidityMint");
    const provenance = getRecordField(record, "provenance");
    if (!amountRaw || !/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
      throw new Error(`Earn holding ${index} has invalid amountRaw.`);
    }
    if (!liquidityMint) {
      throw new Error(`Earn holding ${index} is missing liquidityMint.`);
    }
    if (!provenance) {
      throw new Error(`Earn holding ${index} is missing provenance.`);
    }

    return {
      amountRaw,
      kind,
      liquidityMint,
      market: getStringField(record, "market"),
      provenance,
      reserve: getStringField(record, "reserve"),
    };
  });
}

function requireSingleEarnHolding(args: {
  holdings: EarnSourceHoldingEvidence[];
  kind: "idle" | "kamino";
  label: string;
}): EarnSourceHoldingEvidence {
  const matching = args.holdings.filter(
    (holding) => holding.kind === args.kind
  );
  if (matching.length !== 1) {
    throw new Error(
      `${args.label} expected exactly one ${args.kind} holding, found ${matching.length}.`
    );
  }
  return matching[0]!;
}

function withdrawSourceFromHolding(
  holding: EarnSourceHoldingEvidence
): NonNullable<EarnWithdrawPrepareRequestBody["source"]> {
  if (holding.kind === "idle") {
    const tokenAccount = getStringField(holding.provenance, "tokenAccount");
    if (!tokenAccount) {
      throw new Error("Idle holding is missing tokenAccount provenance.");
    }
    return {
      amountRaw: holding.amountRaw,
      id: tokenAccount,
      mint: holding.liquidityMint,
      tokenAccount,
      type: "idle",
    };
  }

  if (!holding.reserve || !holding.market) {
    throw new Error("Kamino holding is missing reserve or market.");
  }
  return {
    amountRaw: holding.amountRaw,
    id: holding.reserve,
    liquidityMint: holding.liquidityMint,
    market: holding.market,
    reserve: holding.reserve,
    type: "reserve",
  };
}

function withdrawSourceFromCurrentRows(args: {
  holdingEvents?: unknown[];
  idleRows: unknown[];
  label: string;
  reserveRows: unknown[];
}): NonNullable<EarnWithdrawPrepareRequestBody["source"]> {
  const activeReserveRows = args.reserveRows.filter(
    (row) => (getRawAmountField(row, "amountRaw") ?? 0n) > 0n
  );
  const activeIdleRows = args.idleRows.filter(
    (row) => (getRawAmountField(row, "amountRaw") ?? 0n) > 0n
  );
  const activeSourceCount = activeReserveRows.length + activeIdleRows.length;
  if (activeSourceCount === 0) {
    const event = (args.holdingEvents ?? []).find(
      (row) =>
        (getRawAmountField(row, "amountRaw") ?? 0n) > 0n &&
        getStringField(row, "reserve") &&
        getStringField(row, "market")
    );
    if (event) {
      const amountRaw = getRawAmountField(event, "amountRaw");
      const reserve = getStringField(event, "reserve");
      const market = getStringField(event, "market");
      const liquidityMint =
        getStringField(event, "liquidityMint") ??
        EARN_TARGET.liquidityMint.toBase58();
      if (amountRaw && reserve && market) {
        return {
          amountRaw: amountRaw.toString(),
          id: reserve,
          liquidityMint,
          market,
          reserve,
          type: "reserve",
        };
      }
    }
  }
  if (activeSourceCount !== 1) {
    throw new Error(
      `${args.label} expected exactly one active source, found ${activeSourceCount}.`
    );
  }

  const reserveRow = activeReserveRows[0];
  if (reserveRow) {
    const amountRaw = getRawAmountField(reserveRow, "amountRaw");
    const reserve = getStringField(reserveRow, "reserve");
    const market = getStringField(reserveRow, "market");
    const liquidityMint =
      getStringField(reserveRow, "liquidityMint") ??
      EARN_TARGET.liquidityMint.toBase58();
    if (!amountRaw || !reserve || !market) {
      throw new Error(
        `${args.label} active reserve row is missing source metadata.`
      );
    }
    return {
      amountRaw: amountRaw.toString(),
      id: reserve,
      liquidityMint,
      market,
      reserve,
      type: "reserve",
    };
  }

  const idleRow = activeIdleRows[0];
  const amountRaw = getRawAmountField(idleRow, "amountRaw");
  const mint =
    getStringField(idleRow, "mint") ?? EARN_TARGET.liquidityMint.toBase58();
  const tokenAccount = getStringField(idleRow, "tokenAccount");
  if (!amountRaw || !tokenAccount) {
    throw new Error(
      `${args.label} active idle row is missing source metadata.`
    );
  }
  return {
    amountRaw: amountRaw.toString(),
    id: tokenAccount,
    mint,
    tokenAccount,
    type: "idle",
  };
}

function toClientWithdrawSource(
  source: NonNullable<EarnWithdrawPrepareRequestBody["source"]>
): SmartAccountEarnUsdcWithdrawInput["source"] {
  if (source.type === "idle") {
    return {
      amountRaw: BigInt(source.amountRaw),
      id: source.id,
      mint: new PublicKey(source.mint),
      tokenAccount: new PublicKey(source.tokenAccount),
      type: "idle",
    };
  }

  return {
    amountRaw: BigInt(source.amountRaw),
    id: source.id,
    liquidityMint: new PublicKey(source.liquidityMint),
    market: new PublicKey(source.market),
    reserve: new PublicKey(source.reserve),
    type: "reserve",
  };
}

function assertPreparedSourceMetadata(args: {
  label: string;
  prepared: SmartAccountPreparedEarnUsdcWithdraw;
  source: NonNullable<EarnWithdrawPrepareRequestBody["source"]>;
}) {
  const persistence = asRecord(args.prepared.persistence);
  if (!persistence) {
    throw new Error(`${args.label} withdrawal persistence is missing.`);
  }
  if (persistence.sourceType !== args.source.type) {
    throw new Error(`${args.label} sourceType mismatch.`);
  }
  if (persistence.sourceId !== args.source.id) {
    throw new Error(`${args.label} sourceId mismatch.`);
  }
  if (persistence.sourceAmountRaw !== args.source.amountRaw) {
    throw new Error(`${args.label} sourceAmountRaw mismatch.`);
  }
  const sourceMetadata = asRecord(persistence.sourceMetadata);
  if (!sourceMetadata) {
    throw new Error(`${args.label} sourceMetadata is missing.`);
  }
  if (args.source.type === "idle") {
    if (
      sourceMetadata.mint !== args.source.mint ||
      sourceMetadata.tokenAccount !== args.source.tokenAccount
    ) {
      throw new Error(`${args.label} idle source metadata mismatch.`);
    }
  } else if (
    sourceMetadata.reserve !== args.source.reserve ||
    sourceMetadata.market !== args.source.market ||
    sourceMetadata.liquidityMint !== args.source.liquidityMint
  ) {
    throw new Error(`${args.label} reserve source metadata mismatch.`);
  }
}

function decodeCustomProgramError(error: unknown): {
  code: number;
  name: string | null;
} | null {
  const text = error instanceof Error ? error.message : String(error);
  const match =
    text.match(/"Custom"\s*:\s*(\d+)/) ?? text.match(/Custom\((\d+)\)/);
  if (!match) {
    return null;
  }
  const code = Number(match[1]);
  const decoded = generated.errorFromCode(code);
  return {
    code,
    name: decoded?.name ?? null,
  };
}

function frontendRequestErrorEvidence(error: unknown): unknown {
  if (!(error instanceof FrontendRequestError)) {
    return null;
  }

  return {
    body: error.body,
    status: error.status,
  };
}

function extractSimulationLogEvidence(error: unknown): string[] {
  const text =
    error instanceof FrontendRequestError
      ? JSON.stringify(error.body)
      : error instanceof Error
      ? error.message
      : String(error);
  return text
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes("InstructionError") ||
        line.includes("Program ") ||
        line.includes("AnchorError") ||
        line.includes("custom program error")
    )
    .slice(-40);
}

function monitorResultMatchesSelectedVault(
  value: unknown,
  args: { settings: PublicKey; vaultPubkey: PublicKey; vaultIndex: number }
): boolean {
  const vault = getRecordField(value, "vault");
  return (
    getStringField(vault, "settings") === args.settings.toBase58() &&
    getStringField(vault, "vaultPubkey") === args.vaultPubkey.toBase58() &&
    getNumberField(vault, "vaultIndex") === args.vaultIndex
  );
}

function summarizeMonitorResult(value: unknown): unknown {
  const routeStdout = getRecordField(
    getRecordField(value, "routeExecution"),
    "stdout"
  );
  const plannedMove = getRecordField(value, "plannedMove");
  const executionPickup = getRecordField(routeStdout, "executionPickup");

  return {
    activeDecisionCount: getNumberField(value, "activeDecisionCount"),
    activeDecisionCountAfter: getNumberField(value, "activeDecisionCountAfter"),
    routeExecutionStatus: getStringField(routeStdout, "status"),
    signature: getStringField(executionPickup, "signature"),
    sourceReserve: getStringField(plannedMove, "sourceReserve"),
    status: getStringField(value, "status"),
    targetReserve: getStringField(plannedMove, "targetReserve"),
    vault: getRecordField(value, "vault"),
  };
}

function findSelectedFleetMonitorResult(
  stdoutJson: unknown,
  args: { settings: PublicKey; vaultPubkey: PublicKey; vaultIndex: number }
): unknown | null {
  return (
    getArrayField(stdoutJson, "results").find((result) =>
      monitorResultMatchesSelectedVault(result, args)
    ) ?? null
  );
}

function assertSelectedFleetMonitorExecuted(
  stdoutJson: unknown,
  args: { settings: PublicKey; vaultPubkey: PublicKey; vaultIndex: number }
): unknown {
  if (getStringField(stdoutJson, "status") !== "fleet_poll") {
    throw new Error(
      "same-mint-yield-monitor did not return fleet_poll output."
    );
  }

  const selected = findSelectedFleetMonitorResult(stdoutJson, args);
  if (!selected) {
    throw new Error(
      "same-mint-yield-monitor did not discover the selected Earn vault."
    );
  }

  const routeExecution = getRecordField(selected, "routeExecution");
  const routeStdout = getRecordField(routeExecution, "stdout");
  const executionPickup = getRecordField(routeStdout, "executionPickup");
  if (
    getStringField(selected, "status") !== "executed" ||
    getBooleanField(routeExecution, "success") !== true ||
    getStringField(routeStdout, "status") !== "executed" ||
    !getStringField(executionPickup, "signature")
  ) {
    throw new Error(
      `same-mint-yield-monitor did not execute the selected Earn vault: ${JSON.stringify(
        summarizeMonitorResult(selected),
        bigintJson
      )}`
    );
  }

  return selected;
}

async function readGitCommit(cwd: string): Promise<string | null> {
  const result = await runCommandCapture({
    command: ["git", "rev-parse", "HEAD"],
    cwd,
  }).catch(() => null);

  if (!result || result.exitCode !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

function opRunSiblingCargoCommand(args: readonly string[]): readonly string[] {
  return [
    "op",
    "run",
    "--env-file=.env.1password",
    "--",
    "sh",
    "-c",
    'YIELD_ROUTER_KEYPAIR="$DEPLOYMENT_PK" exec "$@"',
    "yield-router-cargo",
    ...args,
  ];
}

function sameMintMonitorCommand(options: {
  execute: boolean;
}): readonly string[] {
  return opRunSiblingCargoCommand([
    "cargo",
    "run",
    "-p",
    "loyal-yield-orchestrator",
    "--bin",
    "same-mint-yield-monitor",
    "--",
    "--once",
    "--all-active-vaults",
    ...(options.execute ? ["--execute"] : []),
  ]);
}

function sameMintReserveSwapSetupObligationCommand(args: {
  execute: boolean;
  reserve: string;
}): readonly string[] {
  return opRunSiblingCargoCommand([
    "cargo",
    "run",
    "-p",
    "loyal-yield-orchestrator",
    "--bin",
    "same-mint-reserve-swap",
    "--",
    "--settings",
    SETTINGS_PDA.toBase58(),
    "--vault-index",
    "1",
    "--setup-obligation-reserve",
    args.reserve,
    ...(args.execute ? ["--execute"] : []),
  ]);
}

async function loadTopSafeUsdcCandidateEvidence() {
  const { getCurrentBestApyReserveByStablecoin } = await import(
    "../frontend/src/lib/kamino/timescale-reserve-client.server.ts"
  );
  const safeMarkets = new Set(EARN_POLICY_UNIVERSE.kaminoMarkets);
  const usdcMint = EARN_TARGET.liquidityMint.toBase58();
  const rows = await getCurrentBestApyReserveByStablecoin({
    riskProfile: RiskBasket.Safe,
  });

  return rows
    .filter(
      (row) =>
        row.stablecoin === Stablecoin.USDC &&
        row.liquidityMint === usdcMint &&
        typeof row.market === "string" &&
        safeMarkets.has(row.market)
    )
    .map((row) => ({
      liquidityMint: row.liquidityMint,
      market: row.market,
      observedAt: row.observedAt,
      reserve: row.reserve,
      slot: row.slot,
      stablecoin: row.stablecoin,
      supplyApy: row.supplyApy,
    }));
}

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<bigint> {
  let lastStatus: unknown = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { value } = await args.connection.getSignatureStatuses(
      [args.signature],
      { searchTransactionHistory: true }
    );
    const status = value[0];
    lastStatus = status;
    if (status?.err) {
      throw new Error(
        `Transaction ${args.signature} failed: ${JSON.stringify(status.err)}`
      );
    }
    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized")
    ) {
      return BigInt(status.slot);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Transaction ${
      args.signature
    } is not confirmed. Last status: ${JSON.stringify(lastStatus)}`
  );
}

async function resolveTransactionFeeLamports(args: {
  connection: Connection;
  signature: string;
}): Promise<bigint> {
  const transaction = await args.connection.getTransaction(args.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const fee = transaction?.meta?.fee;
  if (typeof fee !== "number") {
    throw new Error(`Transaction ${args.signature} fee is unavailable.`);
  }
  return BigInt(fee);
}

async function loadKaminoDepositEvidence(args: {
  connection: Connection;
  signature: string;
}) {
  const transaction = await args.connection.getTransaction(args.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction) {
    throw new Error(`Transaction ${args.signature} is unavailable.`);
  }
  const logs = transaction.meta?.logMessages ?? [];
  const depositLog = logs.find((line) =>
    line.includes("Deposit reserve liquidity")
  );
  const amountMatch = depositLog?.match(
    /Deposit reserve liquidity (\d+) and obligation collateral (\d+)/
  );
  const staticKeys = transaction.transaction.message.staticAccountKeys;
  const loadedAddresses = transaction.meta?.loadedAddresses;
  const accountKeys = [
    ...staticKeys,
    ...(loadedAddresses?.writable ?? []),
    ...(loadedAddresses?.readonly ?? []),
  ];
  const collateralBalance = transaction.meta?.postTokenBalances?.find(
    (balance) =>
      balance.mint !== EARN_TARGET.liquidityMint.toBase58() &&
      BigInt(balance.uiTokenAmount.amount) > 0n
  );
  const reserveCollateralSupplyAccount =
    collateralBalance && accountKeys[collateralBalance.accountIndex]
      ? accountKeys[collateralBalance.accountIndex]
      : null;

  return {
    depositedLiquidityRaw: amountMatch?.[1] ?? null,
    initObligationLogged: logs.some((line) =>
      line.includes("Instruction: InitObligation")
    ),
    obligationCollateralRaw: amountMatch?.[2] ?? null,
    reserveCollateralMint: collateralBalance?.mint ?? null,
    reserveCollateralSupplyAccount:
      reserveCollateralSupplyAccount?.toBase58() ?? null,
  };
}

async function simulatePrepared(args: {
  connection: Connection;
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
  wallet: WalletAdapterLike;
}): Promise<string[]> {
  const blockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    blockhash: blockhash.blockhash,
    prepared: args.prepared,
  });
  const signed = await args.wallet.signTransaction(transaction);
  const simulation = await args.connection.simulateTransaction(signed, {
    commitment: "confirmed",
    sigVerify: true,
  });

  if (simulation.value.err) {
    throw new Error(
      `Simulation failed: ${JSON.stringify(simulation.value.err)}\n${(
        simulation.value.logs ?? []
      ).join("\n")}`
    );
  }

  return simulation.value.logs ?? [];
}

async function simulatePreparedUnsigned(args: {
  connection: Connection;
  label?: string;
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
}): Promise<string[]> {
  const blockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    blockhash: blockhash.blockhash,
    prepared: args.prepared,
  });
  const simulation = await args.connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    sigVerify: false,
  });

  if (simulation.value.err) {
    const label = args.label ? `${args.label}: ` : "";
    throw new Error(
      `${label}Unsigned simulation failed: ${JSON.stringify(
        simulation.value.err
      )}\n${(simulation.value.logs ?? []).join("\n")}`
    );
  }

  return simulation.value.logs ?? [];
}

async function simulatePreparedUnsignedWithFreshBlockhash(args: {
  connection: Connection;
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
}) {
  const latest = await args.connection.getLatestBlockhashAndContext(
    "confirmed"
  );
  const transaction = compilePreparedOperation({
    blockhash: latest.value.blockhash,
    prepared: args.prepared,
  });
  const simulation = await args.connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    minContextSlot: latest.context.slot,
    sigVerify: false,
  });

  if (simulation.value.err) {
    throw new Error(
      `Readiness unsigned simulation failed: ${JSON.stringify(
        simulation.value.err
      )}\n${(simulation.value.logs ?? []).join("\n")}`
    );
  }

  return {
    blockhashContextSlot: latest.context.slot,
    lastValidBlockHeight: latest.value.lastValidBlockHeight,
    logTail: (simulation.value.logs ?? []).slice(-12),
    unitsConsumed: simulation.value.unitsConsumed ?? null,
  };
}

async function simulatePreparedPrefixTokenBalance(args: {
  connection: Connection;
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
  tokenAccount: PublicKey;
  throughInstructionCount: number;
}): Promise<{ amountRaw: string | null; logs: string[] }> {
  const blockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    blockhash: blockhash.blockhash,
    prepared: {
      ...args.prepared,
      instructions: args.prepared.instructions.slice(
        0,
        args.throughInstructionCount
      ),
    },
  });
  const simulation = await args.connection.simulateTransaction(transaction, {
    accounts: {
      addresses: [args.tokenAccount.toBase58()],
      encoding: "base64",
    },
    commitment: "confirmed",
    sigVerify: false,
  });
  const account = simulation.value.accounts?.[0];
  const accountData = account?.data;
  if (!accountData || !Array.isArray(accountData)) {
    return {
      amountRaw: null,
      logs: simulation.value.logs ?? [],
    };
  }

  const data = Buffer.from(accountData[0] as string, "base64");
  if (data.length < AccountLayout.span) {
    return {
      amountRaw: null,
      logs: simulation.value.logs ?? [],
    };
  }
  return {
    amountRaw: AccountLayout.decode(data).amount.toString(),
    logs: simulation.value.logs ?? [],
  };
}

async function sendOrResumePrepared(args: {
  connection: Connection;
  prepared: SmartAccountPreparedEarnUsdcDeposit["prepared"];
  resumeSignature: string | null;
  resumeSlot: string | null;
  wallet: WalletAdapterLike;
}): Promise<{ signature: string; simulationLogs: string[]; slot: bigint }> {
  if (args.resumeSignature) {
    return {
      signature: args.resumeSignature,
      simulationLogs: [],
      slot: args.resumeSlot
        ? BigInt(args.resumeSlot)
        : await resolveConfirmedSignatureSlot({
            connection: args.connection,
            signature: args.resumeSignature,
          }),
    };
  }

  const simulationLogs = await simulatePrepared(args);
  const signature = await sendPreparedWithWallet({
    confirm: true,
    connection: args.connection,
    prepared: args.prepared,
    sendOptions: {
      maxRetries: 5,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    },
    wallet: args.wallet,
  });

  return {
    signature,
    simulationLogs,
    slot: await resolveConfirmedSignatureSlot({
      connection: args.connection,
      signature,
    }),
  };
}

async function sendOrResumeUsdcTransfer(args: {
  amountRaw: bigint;
  connection: Connection;
  destinationAta: PublicKey;
  mint: PublicKey;
  resumeSignature: string | null;
  resumeSlot: string | null;
  sourceAta: PublicKey;
  wallet: Keypair;
}): Promise<{ signature: string; simulationLogs: string[]; slot: bigint }> {
  if (args.resumeSignature) {
    return {
      signature: args.resumeSignature,
      simulationLogs: [],
      slot: args.resumeSlot
        ? BigInt(args.resumeSlot)
        : await resolveConfirmedSignatureSlot({
            connection: args.connection,
            signature: args.resumeSignature,
          }),
    };
  }

  const blockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: args.wallet.publicKey,
    recentBlockhash: blockhash.blockhash,
  }).add(
    createTransferCheckedInstruction(
      args.sourceAta,
      args.mint,
      args.destinationAta,
      args.wallet.publicKey,
      args.amountRaw,
      6,
      [],
      TOKEN_PROGRAM_ID
    )
  );
  const simulation = await args.connection.simulateTransaction(transaction, [
    args.wallet,
  ]);
  if (simulation.value.err) {
    throw new Error(
      `Idle funding simulation failed: ${JSON.stringify(
        simulation.value.err
      )}\n${(simulation.value.logs ?? []).join("\n")}`
    );
  }
  transaction.sign(args.wallet);
  const signature = await args.connection.sendRawTransaction(
    transaction.serialize(),
    {
      maxRetries: 5,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    }
  );
  await args.connection.confirmTransaction(
    {
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      signature,
    },
    "confirmed"
  );

  return {
    signature,
    simulationLogs: simulation.value.logs ?? [],
    slot: await resolveConfirmedSignatureSlot({
      connection: args.connection,
      signature,
    }),
  };
}

function depositInput(args: {
  prepared: SmartAccountPreparedEarnUsdcDeposit;
  policyConfirmedSlot?: bigint;
  policyInitialization?: "create" | "reuse";
  policySignature: string;
  setupPolicyConfirmedSlot?: bigint;
  setupPolicySignature?: string;
  signature: string;
  slot: bigint;
}) {
  const persistence = args.prepared.persistence;
  return {
    cluster: persistence.cluster,
    confirmedSlot: args.slot,
    depositMint: persistence.depositMint,
    depositSignature: args.signature,
    delegatedSigner: persistence.delegatedSigner,
    liquidityMint: persistence.liquidityMint,
    market: persistence.market,
    policyAccount: persistence.policyAccount,
    policyId: BigInt(persistence.policyId),
    policyInitialization:
      args.policyInitialization ?? persistence.policyInitialization,
    policySeed: BigInt(persistence.policySeed),
    policyConfirmedSlot: args.policyConfirmedSlot,
    policySignature: args.policySignature,
    principalAmountRaw: BigInt(persistence.principalAmountRaw),
    settings: persistence.settings,
    smartAccountAddress: persistence.vaultPubkey,
    setupPolicyAccount: persistence.setupPolicyAccount,
    setupPolicyConfirmedSlot: args.setupPolicyConfirmedSlot,
    setupPolicyId: persistence.setupPolicyId
      ? BigInt(persistence.setupPolicyId)
      : undefined,
    setupPolicySeed: persistence.setupPolicySeed
      ? BigInt(persistence.setupPolicySeed)
      : undefined,
    setupPolicySignature: args.setupPolicySignature,
    targetReserve: persistence.targetReserve,
    targetSupplyApyBps:
      persistence.targetSupplyApyBps === null
        ? null
        : BigInt(persistence.targetSupplyApyBps),
    vaultIndex: persistence.vaultIndex,
    vaultPubkey: persistence.vaultPubkey,
    walletAddress: persistence.walletAddress,
  };
}

function policyInput(args: {
  prepared: SmartAccountPreparedEarnUsdcYieldRoutingPolicy;
  setupSignature?: string;
  setupSlot?: bigint;
  signature: string;
  slot: bigint;
}) {
  return policyInputFromPersistence({
    persistence: args.prepared.persistence,
    setupSignature: args.setupSignature,
    setupSlot: args.setupSlot,
    signature: args.signature,
    slot: args.slot,
  });
}

function policyInputFromPersistence(args: {
  persistence: SmartAccountPreparedEarnUsdcYieldRoutingPolicy["persistence"];
  setupSignature?: string;
  setupSlot?: bigint;
  signature: string;
  slot: bigint;
}) {
  const persistence = args.persistence;
  return {
    cluster: persistence.cluster,
    confirmedSlot: args.slot,
    delegatedSigner: persistence.delegatedSigner,
    liquidityMint: persistence.liquidityMint,
    market: persistence.market,
    policyAccount: persistence.policyAccount,
    policyId: BigInt(persistence.policyId),
    policySeed: BigInt(persistence.policySeed),
    policyConfirmedSlot: args.slot,
    policySignature: args.signature,
    settings: persistence.settings,
    setupPolicyAccount: persistence.setupPolicyAccount,
    setupPolicyConfirmedSlot: args.setupSlot,
    setupPolicyId: BigInt(persistence.setupPolicyId),
    setupPolicySeed: BigInt(persistence.setupPolicySeed),
    setupPolicySignature: args.setupSignature,
    targetReserve: persistence.targetReserve,
    vaultIndex: persistence.vaultIndex,
    vaultPubkey: persistence.vaultPubkey,
    walletAddress: persistence.walletAddress,
  };
}

function withdrawalInput(args: {
  prepared: SmartAccountPreparedEarnUsdcWithdraw;
  signature: string;
  slot: bigint;
}) {
  const persistence = args.prepared.persistence;
  return {
    cluster: persistence.cluster,
    confirmedSlot: args.slot,
    delegatedSigner: persistence.delegatedSigner,
    liquidityMint: persistence.liquidityMint,
    market: persistence.market,
    mode: persistence.mode,
    policyAccount: persistence.policyAccount,
    policyId: BigInt(persistence.policyId),
    policySeed: BigInt(persistence.policySeed),
    settings: persistence.settings,
    smartAccountAddress: persistence.vaultPubkey,
    setupPolicyAccount: persistence.setupPolicyAccount,
    setupPolicyId: persistence.setupPolicyId
      ? BigInt(persistence.setupPolicyId)
      : undefined,
    setupPolicySeed: persistence.setupPolicySeed
      ? BigInt(persistence.setupPolicySeed)
      : undefined,
    targetReserve: persistence.targetReserve,
    vaultIndex: persistence.vaultIndex,
    vaultPubkey: persistence.vaultPubkey,
    walletAddress: persistence.walletAddress,
    withdrawalSignature: args.signature,
    withdrawnAmountRaw: BigInt(persistence.withdrawnAmountRaw),
  };
}

function compactPosition(position: unknown): unknown {
  if (!position || typeof position !== "object") {
    return position;
  }
  const record = position as Record<string, unknown>;
  return {
    currentAmountRaw: record.currentAmountRaw,
    firstDepositSignature: record.firstDepositSignature,
    id: record.id,
    lastConfirmedSlot: record.lastConfirmedSlot,
    lastDepositSignature: record.lastDepositSignature,
    lastHoldingEventId: record.lastHoldingEventId,
    principalAmountRaw: record.principalAmountRaw,
    status: record.status,
  };
}

function readPositionPrincipalAmountRaw(position: unknown): bigint {
  if (!position || typeof position !== "object") {
    throw new Error("Position principal amount is unavailable.");
  }

  const value = (position as { principalAmountRaw?: unknown })
    .principalAmountRaw;
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  throw new Error("Position principal amount is invalid.");
}

function accountSnapshot(
  account: Awaited<ReturnType<Connection["getAccountInfo"]>>
) {
  return account
    ? {
        lamports: account.lamports,
        owner: account.owner.toBase58(),
      }
    : null;
}

async function tokenAmount(
  connection: Connection,
  address: PublicKey
): Promise<string | null> {
  return (
    (
      await connection
        .getTokenAccountBalance(address, "confirmed")
        .catch(() => null)
    )?.value.amount ?? null
  );
}

async function loadState(args: {
  connection: Connection;
  policyAccount?: PublicKey | null;
  setupPolicyAccount?: PublicKey | null;
  vaultCollateralAta?: PublicKey | null;
  vaultPubkey: PublicKey;
  vaultUsdcAta: PublicKey;
  walletAddress: PublicKey;
  walletUsdcAta: PublicKey;
  yieldClient: Awaited<
    ReturnType<
      typeof import("../frontend/src/lib/yield-optimization/yield-neon-client.server.ts")["getYieldOptimizationClient"]
    >
  >;
  schema: typeof import("../frontend/src/lib/yield-optimization/yield-neon-client.server.ts");
}) {
  const {
    managedVaults,
    routePolicies,
    userYieldPositionDeposits,
    userYieldPositionHoldingEvents,
    userYieldPositionWithdrawals,
    userYieldPositions,
    vaultIdleTokenBalancesCurrent,
    vaultReservePositionsCurrent,
  } = args.schema;
  const settings = SETTINGS_PDA.toBase58();
  const wallet = args.walletAddress.toBase58();
  const [
    walletAccount,
    policyAccount,
    setupPolicyAccount,
    vaultUsdcAccount,
    vaultCollateralAccount,
  ] = await Promise.all([
    args.connection.getAccountInfo(args.walletAddress, "confirmed"),
    args.policyAccount
      ? args.connection.getAccountInfo(args.policyAccount, "confirmed")
      : null,
    args.setupPolicyAccount
      ? args.connection.getAccountInfo(args.setupPolicyAccount, "confirmed")
      : null,
    args.connection.getAccountInfo(args.vaultUsdcAta, "confirmed"),
    args.vaultCollateralAta
      ? args.connection.getAccountInfo(args.vaultCollateralAta, "confirmed")
      : null,
  ]);
  const [
    walletUsdcRaw,
    vaultUsdcRaw,
    vaultCollateralRaw,
    position,
    managedVault,
    deposits,
    withdrawals,
  ] = await Promise.all([
    tokenAmount(args.connection, args.walletUsdcAta),
    tokenAmount(args.connection, args.vaultUsdcAta),
    args.vaultCollateralAta
      ? tokenAmount(args.connection, args.vaultCollateralAta)
      : null,
    args.yieldClient.db.query.userYieldPositions.findFirst({
      orderBy: [desc(userYieldPositions.id)],
      where: and(
        eq(userYieldPositions.settings, settings),
        eq(userYieldPositions.vaultIndex, 1),
        eq(userYieldPositions.initialReserve, EARN_TARGET.reserve.toBase58()),
        eq(userYieldPositions.walletAddress, wallet)
      ),
    }),
    args.yieldClient.db.query.managedVaults.findFirst({
      orderBy: [desc(managedVaults.id)],
      where: and(
        eq(managedVaults.settings, settings),
        eq(managedVaults.vaultIndex, 1),
        eq(managedVaults.vaultPubkey, args.vaultPubkey.toBase58())
      ),
    }),
    args.yieldClient.db.query.userYieldPositionDeposits.findMany({
      limit: 3,
      orderBy: [desc(userYieldPositionDeposits.confirmedAt)],
      where: and(
        eq(userYieldPositionDeposits.settings, settings),
        eq(userYieldPositionDeposits.walletAddress, wallet)
      ),
    }),
    args.yieldClient.db.query.userYieldPositionWithdrawals.findMany({
      limit: 3,
      orderBy: [desc(userYieldPositionWithdrawals.confirmedAt)],
      where: and(
        eq(userYieldPositionWithdrawals.settings, settings),
        eq(userYieldPositionWithdrawals.walletAddress, wallet)
      ),
    }),
  ]);
  const holdingEvents = position
    ? await args.yieldClient.db.query.userYieldPositionHoldingEvents.findMany({
        limit: 5,
        orderBy: [desc(userYieldPositionHoldingEvents.observedAt)],
        where: eq(userYieldPositionHoldingEvents.positionId, position.id),
      })
    : [];
  const routePolicy =
    managedVault &&
    "activePolicyId" in managedVault &&
    typeof managedVault.activePolicyId === "bigint"
      ? await args.yieldClient.db.query.routePolicies.findFirst({
          where: eq(routePolicies.id, managedVault.activePolicyId),
        })
      : null;
  const setupPolicy =
    managedVault &&
    "setupPolicyId" in managedVault &&
    typeof managedVault.setupPolicyId === "bigint"
      ? await args.yieldClient.db.query.routePolicies.findFirst({
          where: eq(routePolicies.id, managedVault.setupPolicyId),
        })
      : null;
  const [reserveRows, idleRows] = managedVault
    ? await Promise.all([
        args.yieldClient.db
          .select()
          .from(vaultReservePositionsCurrent)
          .where(eq(vaultReservePositionsCurrent.vaultId, managedVault.id)),
        args.yieldClient.db
          .select()
          .from(vaultIdleTokenBalancesCurrent)
          .where(eq(vaultIdleTokenBalancesCurrent.vaultId, managedVault.id)),
      ])
    : [[], []];

  return {
    accounts: {
      policy: accountSnapshot(policyAccount),
      setupPolicy: accountSnapshot(setupPolicyAccount),
      vaultCollateralAta: accountSnapshot(vaultCollateralAccount),
      vaultUsdcAta: accountSnapshot(vaultUsdcAccount),
      wallet: accountSnapshot(walletAccount),
    },
    db: {
      deposits,
      holdingEvents,
      managedVault,
      position: compactPosition(position),
      currentIdleRows: idleRows,
      currentReserveRows: reserveRows,
      routePolicy,
      setupPolicy,
      withdrawals,
    },
    tokenBalances: {
      vaultCollateralRaw,
      vaultUsdcRaw,
      walletUsdcRaw,
    },
  };
}

function assertNoPositionActive(
  state: Awaited<ReturnType<typeof loadState>>,
  options: {
    allowActivePolicyRows?: boolean;
    allowActivePosition?: boolean;
  } = {}
) {
  const position = state.db.position as { status?: string } | null;
  if (position?.status === "active" && !options.allowActivePosition) {
    throw new Error("Expected no active Earn position.");
  }
  if (options.allowActivePolicyRows) {
    return;
  }
  const routePolicy = state.db.routePolicy as { active?: boolean } | null;
  if (routePolicy?.active) {
    throw new Error("Expected no active Earn route policy.");
  }
  const setupPolicy = state.db.setupPolicy as { active?: boolean } | null;
  if (setupPolicy?.active) {
    throw new Error("Expected no active Earn setup policy.");
  }
  const managedVault = state.db.managedVault as { active?: boolean } | null;
  if (managedVault?.active) {
    throw new Error("Expected no active Earn managed vault.");
  }
}

function requirePolicyResumePublicKey(name: string): PublicKey {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for policy-resume-readiness.`);
  }
  return new PublicKey(value);
}

function normalizeGeneratedValue(value: unknown): unknown {
  if (value instanceof PublicKey) {
    return value.toBase58();
  }
  if (BN.isBN(value)) {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return [...value];
  }
  if (Array.isArray(value)) {
    return value.map(normalizeGeneratedValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeGeneratedValue(nested)])
    );
  }
  return value;
}

function assertKnownEarnPolicyAccount(args: {
  account: NonNullable<Awaited<ReturnType<Connection["getAccountInfo"]>>>;
  accountAddress: PublicKey;
  expectedConstraintCount: 1 | 2;
  expectedState: generated.PolicyCreationPayload;
  expectedSeed: bigint;
  policySigner: PublicKey;
  settingsPda: PublicKey;
}) {
  if (!args.account.owner.equals(PROGRAM_ID)) {
    throw new Error(
      `Policy ${args.accountAddress.toBase58()} has unexpected owner ${args.account.owner.toBase58()}.`
    );
  }

  const [policy] = Policy.fromAccountInfo(args.account);
  const seed = BigInt(policy.seed.toString());
  if (!policy.settings.equals(args.settingsPda)) {
    throw new Error(`Policy seed ${seed} belongs to another Settings account.`);
  }
  if (seed !== args.expectedSeed) {
    throw new Error(
      `Policy ${args.accountAddress.toBase58()} has seed ${seed}, expected ${
        args.expectedSeed
      }.`
    );
  }
  if (policy.threshold !== 1 || policy.timeLock !== 0) {
    throw new Error(
      `Policy seed ${seed} must have threshold 1 and timelock 0.`
    );
  }
  if (
    policy.signers.length !== 1 ||
    !policy.signers[0]!.key.equals(args.policySigner) ||
    policy.signers[0]!.permissions.mask !== 7
  ) {
    throw new Error(
      `Policy seed ${seed} does not have the canonical deployment signer.`
    );
  }
  if (policy.policyState.__kind !== "ProgramInteraction") {
    throw new Error(`Policy seed ${seed} is not ProgramInteraction.`);
  }
  const interaction = policy.policyState.fields[0];
  if (interaction.accountIndex !== 1) {
    throw new Error(`Policy seed ${seed} does not target Earn vault index 1.`);
  }
  if (
    interaction.instructionsConstraints.length !== args.expectedConstraintCount
  ) {
    throw new Error(
      `Policy seed ${seed} has ${interaction.instructionsConstraints.length} instruction constraints, expected ${args.expectedConstraintCount}.`
    );
  }
  if (
    interaction.preHook !== null ||
    interaction.postHook !== null ||
    interaction.spendingLimits.length !== 0
  ) {
    throw new Error(`Policy seed ${seed} has unexpected hooks or limits.`);
  }
  if (
    interaction.instructionsConstraints.some(
      (constraint) => !constraint.programId.equals(EARN_TARGET.lendProgramId)
    )
  ) {
    throw new Error(`Policy seed ${seed} targets a non-canonical program.`);
  }
  if (
    JSON.stringify(normalizeGeneratedValue(policy.policyState)) !==
    JSON.stringify(normalizeGeneratedValue(args.expectedState))
  ) {
    throw new Error(
      `Policy seed ${seed} does not match the canonical Earn instruction constraints.`
    );
  }

  return {
    account: args.accountAddress.toBase58(),
    accountIndex: interaction.accountIndex,
    constraintCount: interaction.instructionsConstraints.length,
    canonicalConstraintsMatch: true,
    constraintShape: interaction.instructionsConstraints.map((constraint) => ({
      accountConstraintCount: constraint.accountConstraints.length,
      dataConstraintCount: constraint.dataConstraints.length,
      programId: constraint.programId.toBase58(),
    })),
    owner: args.account.owner.toBase58(),
    seed: seed.toString(),
    signer: policy.signers[0]!.key.toBase58(),
    signerPermissionsMask: policy.signers[0]!.permissions.mask,
    state: policy.policyState.__kind,
    threshold: policy.threshold,
    timeLock: policy.timeLock,
  };
}

function assertProjectedPolicy(args: {
  expectedAccount: PublicKey;
  expectedSeed: bigint;
  label: string;
  policySigner: PublicKey;
  policyValue: unknown;
  vaultPubkey: PublicKey;
  walletAddress: PublicKey;
}) {
  const policy = asRecord(args.policyValue);
  if (!policy) {
    throw new Error(`Yield Neon ${args.label} policy is missing.`);
  }
  if (
    policy.policyAccount !== args.expectedAccount.toBase58() ||
    getRawAmountField(policy, "policySeed") !== args.expectedSeed ||
    policy.authority !== args.walletAddress.toBase58() ||
    policy.vaultIndex !== 1 ||
    policy.vaultPubkey !== args.vaultPubkey.toBase58() ||
    policy.threshold !== 1 ||
    policy.active !== true
  ) {
    throw new Error(`Yield Neon ${args.label} policy projection is invalid.`);
  }
  const delegatedSigners = policy.delegatedSigners;
  if (
    !Array.isArray(delegatedSigners) ||
    delegatedSigners.length !== 1 ||
    delegatedSigners[0] !== args.policySigner.toBase58()
  ) {
    throw new Error(
      `Yield Neon ${args.label} policy signer projection is invalid.`
    );
  }

  return {
    active: true,
    account: args.expectedAccount.toBase58(),
    confirmedSlot:
      getRawAmountField(policy, "lastSeenSlot")?.toString() ?? null,
    seed: args.expectedSeed.toString(),
    signer: args.policySigner.toBase58(),
  };
}

async function runPolicyResumeReadiness(): Promise<void> {
  const evidence: Record<string, unknown> = {
    cluster: LoyalCluster.MainnetBeta,
    dryRun: true,
    env: SOLANA_ENV,
    evidencePath: EVIDENCE_PATH,
    phase: "policy-resume-readiness",
    sendsTransactions: false,
    status: "failed",
    writesDatabase: false,
  };

  try {
    if (!DRY_RUN) {
      throw new Error(
        "policy-resume-readiness is read-only. Set EARN_VERIFY_DRY_RUN=1."
      );
    }
    const walletAddress = requirePolicyResumePublicKey(
      "EARN_VERIFY_WALLET_ADDRESS"
    );
    const policySigner = requirePolicyResumePublicKey(
      "EARN_YIELD_ROUTER_PUBLIC_KEY"
    );
    const connection = new Connection(RPC_URL, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 90_000,
    });
    const routeSeed = 1n;
    const setupSeed = 2n;
    const routePolicyAccount = pda.getPolicyPda({
      policySeed: Number(routeSeed),
      programId: PROGRAM_ID,
      settingsPda: SETTINGS_PDA,
    })[0];
    const setupPolicyAccount = pda.getPolicyPda({
      policySeed: Number(setupSeed),
      programId: PROGRAM_ID,
      settingsPda: SETTINGS_PDA,
    })[0];
    const chainSnapshot = await connection.getMultipleAccountsInfoAndContext(
      [SETTINGS_PDA, routePolicyAccount, setupPolicyAccount],
      { commitment: "confirmed" }
    );
    const [settingsAccount, routeAccount, setupAccount] = chainSnapshot.value;
    if (!settingsAccount || !routeAccount || !setupAccount) {
      throw new Error(
        "Settings or the known seed-1/seed-2 Earn policy account is absent."
      );
    }
    if (!settingsAccount.owner.equals(PROGRAM_ID)) {
      throw new Error("Settings account has an unexpected owner.");
    }
    const [settings] = Settings.fromAccountInfo(settingsAccount);
    const currentPolicySeed = settings.policySeed
      ? BigInt(settings.policySeed.toString())
      : 0n;
    if (currentPolicySeed < setupSeed) {
      throw new Error(
        `Settings policy seed ${currentPolicySeed} is behind known setup seed ${setupSeed}.`
      );
    }
    const canonicalClient = createSmartAccountVaultsClient({
      connection: {
        getAccountInfo: async (address: PublicKey) =>
          address.equals(SETTINGS_PDA)
            ? createSerializedSettingsAccount(null)
            : null,
      } as never,
      programId: PROGRAM_ID,
    });
    const canonicalPolicy =
      await canonicalClient.prepareEarnUsdcYieldRoutingPolicy({
        cluster: LoyalCluster.MainnetBeta,
        feePayer: walletAddress,
        settingsPda: SETTINGS_PDA,
        signer: policySigner,
        walletAddress,
      });
    if (
      canonicalPolicy.policy.seed !== routeSeed ||
      canonicalPolicy.setupPolicy.seed !== setupSeed ||
      !canonicalPolicy.finalizePrepared
    ) {
      throw new Error("Could not build canonical seed-1/seed-2 policy pair.");
    }
    const expectedRouteState = readPreparedPolicyCreate(
      canonicalPolicy.prepared
    ).policyCreationPayload;
    const expectedSetupState = readPreparedPolicyCreate(
      canonicalPolicy.finalizePrepared
    ).policyCreationPayload;
    const routeChain = assertKnownEarnPolicyAccount({
      account: routeAccount,
      accountAddress: routePolicyAccount,
      expectedConstraintCount: 2,
      expectedSeed: routeSeed,
      expectedState: expectedRouteState,
      policySigner,
      settingsPda: SETTINGS_PDA,
    });
    const setupChain = assertKnownEarnPolicyAccount({
      account: setupAccount,
      accountAddress: setupPolicyAccount,
      expectedConstraintCount: 1,
      expectedSeed: setupSeed,
      expectedState: expectedSetupState,
      policySigner,
      settingsPda: SETTINGS_PDA,
    });
    evidence.chain = {
      contextSlot: chainSnapshot.context.slot,
      routePolicy: routeChain,
      settings: SETTINGS_PDA.toBase58(),
      settingsPolicySeed: currentPolicySeed.toString(),
      setupPolicy: setupChain,
    };

    const schema = await import(
      "../frontend/src/lib/yield-optimization/yield-neon-client.server.ts"
    );
    const yieldClient = schema.getYieldOptimizationClient();
    const vaultPubkey = pda.getSmartAccountPda({
      accountIndex: 1,
      programId: PROGRAM_ID,
      settingsPda: SETTINGS_PDA,
    })[0];
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      EARN_TARGET.liquidityMint,
      vaultPubkey,
      true,
      TOKEN_PROGRAM_ID
    );
    const walletUsdcAta = getAssociatedTokenAddressSync(
      EARN_TARGET.liquidityMint,
      walletAddress,
      false,
      TOKEN_PROGRAM_ID
    );
    const state = await loadState({
      connection,
      policyAccount: routePolicyAccount,
      schema,
      setupPolicyAccount,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress,
      walletUsdcAta,
      yieldClient,
    });
    const managedVault = asRecord(state.db.managedVault);
    if (
      !managedVault ||
      managedVault.settings !== SETTINGS_PDA.toBase58() ||
      managedVault.vaultIndex !== 1 ||
      managedVault.vaultPubkey !== vaultPubkey.toBase58() ||
      managedVault.active !== true ||
      typeof managedVault.activePolicyId !== "bigint" ||
      typeof managedVault.setupPolicyId !== "bigint"
    ) {
      throw new Error("Yield Neon managed-vault projection is incomplete.");
    }
    const routeProjection = assertProjectedPolicy({
      expectedAccount: routePolicyAccount,
      expectedSeed: routeSeed,
      label: "route",
      policySigner,
      policyValue: state.db.routePolicy,
      vaultPubkey,
      walletAddress,
    });
    const setupProjection = assertProjectedPolicy({
      expectedAccount: setupPolicyAccount,
      expectedSeed: setupSeed,
      label: "setup",
      policySigner,
      policyValue: state.db.setupPolicy,
      vaultPubkey,
      walletAddress,
    });
    const onboarding =
      await yieldClient.db.query.earnDepositOnboardingAttempts.findFirst({
        orderBy: [desc(schema.earnDepositOnboardingAttempts.updatedAt)],
        where: and(
          eq(
            schema.earnDepositOnboardingAttempts.settings,
            SETTINGS_PDA.toBase58()
          ),
          eq(schema.earnDepositOnboardingAttempts.vaultIndex, 1),
          eq(
            schema.earnDepositOnboardingAttempts.vaultPubkey,
            vaultPubkey.toBase58()
          ),
          eq(
            schema.earnDepositOnboardingAttempts.walletAddress,
            walletAddress.toBase58()
          )
        ),
      });
    if (
      !onboarding ||
      onboarding.policyAccount !== routePolicyAccount.toBase58() ||
      onboarding.policySeed !== routeSeed ||
      onboarding.routePolicyDbId !== managedVault.activePolicyId ||
      onboarding.setupPolicyAccount !== setupPolicyAccount.toBase58() ||
      onboarding.setupPolicySeed !== setupSeed ||
      onboarding.setupPolicyDbId !== managedVault.setupPolicyId ||
      !onboarding.routePolicySignature ||
      onboarding.routePolicyConfirmedSlot === null ||
      !onboarding.setupPolicySignature ||
      onboarding.setupPolicyConfirmedSlot === null ||
      (onboarding.status !== "setup_policy_confirmed" &&
        onboarding.status !== "complete")
    ) {
      throw new Error("Yield Neon policy onboarding projection is incomplete.");
    }
    evidence.yieldNeon = {
      activePositionPresent: asRecord(state.db.position)?.status === "active",
      confirmedDepositRows: state.db.deposits.length,
      managedVault: {
        active: true,
        routePolicyLinked: true,
        setupPolicyLinked: true,
        vaultIndex: 1,
        vaultPubkey: vaultPubkey.toBase58(),
      },
      onboarding: {
        routePolicyCitationRecorded: true,
        routePolicyRecorded: true,
        setupPolicyCitationRecorded: true,
        setupPolicyRecorded: true,
        status: onboarding.status,
      },
      routePolicy: routeProjection,
      setupPolicy: setupProjection,
    };

    const client = createSmartAccountVaultsClient({
      connection,
      programId: PROGRAM_ID,
    });
    const prepared = await client.prepareEarnUsdcDeposit({
      amountRaw: FIRST_DEPOSIT_RAW,
      cluster: LoyalCluster.MainnetBeta,
      feePayer: walletAddress,
      initializeYieldRoutingPolicy: true,
      policySigner,
      settingsPda: SETTINGS_PDA,
      walletAddress,
    });
    if (
      prepared.persistence.policyInitialization !== "reuse" ||
      prepared.policy.seed !== routeSeed ||
      prepared.policy.account.toBase58() !== routePolicyAccount.toBase58() ||
      prepared.setupPolicy?.seed !== setupSeed ||
      prepared.setupPolicy.account.toBase58() !== setupPolicyAccount.toBase58()
    ) {
      throw new Error(
        "Deposit preparation did not reuse the known seed-1/seed-2 pair."
      );
    }
    if (prepared.policySetupPrepared || prepared.policyFinalizePrepared) {
      throw new Error(
        "Readiness preparation unexpectedly included a policy operation."
      );
    }
    const policyRentItems = prepared.nativeSolRequirement.items.filter(
      (item) => item.kind === "policy_rent"
    );
    if (policyRentItems.length !== 0) {
      throw new Error(
        "Readiness preparation unexpectedly included policy rent."
      );
    }
    if (prepared.prepared.operation !== "earnUsdcDeposit") {
      throw new Error(
        "Readiness did not prepare exactly one deposit operation."
      );
    }
    assertSafePolicyUniverse(prepared.persistence);
    evidence.preparation = {
      amountRaw: FIRST_DEPOSIT_RAW.toString(),
      depositOperationCount: 1,
      instructionCount: prepared.prepared.instructions.length,
      nativeSolPolicyRentItemCount: policyRentItems.length,
      policyFinalizePrepared: false,
      policyInitialization: prepared.persistence.policyInitialization,
      policySetupPrepared: false,
      routePolicyAccount: prepared.policy.account.toBase58(),
      routePolicySeed: prepared.policy.seed.toString(),
      setupPolicyAccount: prepared.setupPolicy.account.toBase58(),
      setupPolicySeed: prepared.setupPolicy.seed.toString(),
    };
    evidence.simulation = await simulatePreparedUnsignedWithFreshBlockhash({
      connection,
      prepared: prepared.prepared,
    });
    evidence.status = "success";
    await writeEvidence(evidence);
    console.log("[earn-mainnet] PASS policy resume readiness");
    console.log(`[earn-mainnet] evidence ${EVIDENCE_PATH}`);
  } catch (error) {
    evidence.error =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    await writeEvidence(evidence);
    throw error;
  }
}

async function runPolicyOnlyReconcileDryRun(): Promise<void> {
  const evidence: Record<string, unknown> = {
    cluster: LoyalCluster.MainnetBeta,
    dryRun: true,
    env: SOLANA_ENV,
    evidencePath: EVIDENCE_PATH,
    phase: "policy-only-reconcile-dry-run",
    sendsTransactions: false,
    status: "failed",
    writesDatabase: false,
  };

  try {
    if (!DRY_RUN) {
      throw new Error(
        "policy-only-reconcile-dry-run is read-only. Set EARN_VERIFY_DRY_RUN=1."
      );
    }
    const { reconcileInvisibleEarnDeposits } = await import(
      "../frontend/src/lib/yield-optimization/earn-deposit-reconcile.server.ts"
    );
    const summary = await reconcileInvisibleEarnDeposits({
      dryRun: true,
      policyOnly: true,
    });
    evidence.summary = summary;
    if (summary.policyOnlyErrors > 0 || summary.truncated) {
      throw new Error(
        `Policy-only reconciliation dry-run was incomplete: ${summary.policyOnlyErrors} errors; truncated=${summary.truncated}.`
      );
    }
    if (summary.policyOnlyAdopted.length > 0) {
      throw new Error(
        "Policy-only reconciliation dry-run unexpectedly reported a database adoption."
      );
    }
    evidence.status = "success";
    await writeEvidence(evidence);
    console.log("[earn-mainnet] PASS policy-only reconciliation dry-run");
    console.log(`[earn-mainnet] evidence ${EVIDENCE_PATH}`);
  } catch (error) {
    evidence.error =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
    await writeEvidence(evidence);
    throw error;
  }
}

async function assertNoVerifierFailures(args: {
  settings: string;
  verifyUserYieldPositions: () => Promise<Array<{ settings: string }>>;
}) {
  const failures = (await args.verifyUserYieldPositions()).filter(
    (failure) => failure.settings === args.settings
  );
  if (failures.length > 0) {
    throw new Error(
      `Yield position verifier failures: ${JSON.stringify(
        failures,
        bigintJson
      )}`
    );
  }
  return failures;
}

function fullWithdrawCleanupCandidates(
  prepared: SmartAccountPreparedEarnUsdcWithdraw
): CleanupCandidateEvidence[] {
  const candidates: CleanupCandidateEvidence[] = [];
  if (prepared.persistence.vaultCollateralCleanupIncluded) {
    candidates.push({
      account: prepared.vault.collateralAta.toBase58(),
      action: "close",
      kind: "vault_kamino_collateral_ata",
    });
  } else {
    candidates.push({
      account: prepared.vault.collateralAta.toBase58(),
      action: "not_safely_closeable",
      kind: "vault_kamino_collateral_ata",
      reason:
        "Kamino collateral token account is not owned by the Earn vault PDA.",
    });
  }

  candidates.push(
    {
      account: prepared.vault.usdcAta.toBase58(),
      action: "close",
      kind: "earn_vault_usdc_ata",
    },
    {
      account: null,
      action: "not_safely_closeable",
      kind: "kamino_obligation_or_user_metadata",
      reason:
        "No validated Kamino close instruction/account relationship is available in the Earn withdraw bundle.",
    }
  );

  return [...candidates];
}

function commandText(command: readonly string[]): string {
  return command.join(" ");
}

function assertNoMatches(result: CommandCapture, label: string): void {
  if (result.exitCode === 0 || result.stdout.trim().length > 0) {
    throw new Error(
      `${label} had unexpected matches:\n${result.stdout || result.stderr}`
    );
  }
  if (result.exitCode !== 1) {
    throw new Error(
      `${label} failed to run (${result.exitCode}): ${result.stderr}`
    );
  }
}

function assertHasMatches(result: CommandCapture, label: string): void {
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    throw new Error(
      `${label} did not find required evidence (${result.exitCode}): ${result.stderr}`
    );
  }
}

async function runRpcHoldingsWithdrawalPreview(): Promise<void> {
  if (!DRY_RUN) {
    throw new Error(
      "EARN_VERIFY_PHASE=rpc-holdings-withdrawal-preview is read-only. Set EARN_VERIFY_DRY_RUN=1."
    );
  }

  const cwd = process.cwd();
  const negativePrepare = await runCommandCapture({
    command: [
      "rg",
      "-n",
      "prepareEarnWithdrawOnServer|/api/smart-accounts/yield-optimization/withdrawals/prepare|withdrawals/prepare",
      "apps/web/src/components",
      "apps/web/src/hooks",
      "apps/web/src/lib",
      "-S",
    ],
    cwd,
  });
  assertNoMatches(
    negativePrepare,
    "Loyal web withdrawal review/execution server prepare search"
  );

  const negativeReconcile = await runCommandCapture({
    command: [
      "rg",
      "-n",
      "position/reconcile|reconcileActiveEarnPosition",
      "apps/web/src/hooks/use-active-earn-position.ts",
      "apps/web/src/components/wallet-workspace/app-wallet-workspace.tsx",
      "-S",
    ],
    cwd,
  });
  assertNoMatches(
    negativeReconcile,
    "Loyal web active Earn first-open server reconcile search"
  );

  const rpcReaderEvidence = await runCommandCapture({
    command: [
      "rg",
      "-n",
      "getMultipleAccountsInfoAndContext|GET_MULTIPLE_ACCOUNTS_LIMIT|AccountLayout.decode|parseKaminoReserveSnapshot|parseKaminoReserveTokenAccounts|deriveKaminoVanillaObligation",
      "apps/web/src/lib/yield-optimization/earn-rpc-holdings.client.ts",
      "-S",
    ],
    cwd,
  });
  assertHasMatches(rpcReaderEvidence, "RPC holdings reader evidence");

  const validationEvidence = await runCommandCapture({
    command: [
      "rg",
      "-n",
      "not owned by the token program|unexpected mint|not owned by the Earn vault|unexpected owner|parseKaminoReserveSnapshot|parseKaminoReserveTokenAccounts",
      "apps/web/src/lib/yield-optimization/earn-rpc-holdings.client.ts",
      "-S",
    ],
    cwd,
  });
  assertHasMatches(
    validationEvidence,
    "RPC holdings account validation evidence"
  );

  const zeroAndStaleEvidence = await runCommandCapture({
    command: [
      "rg",
      "-n",
      "return BigInt\\(0\\)|!reserveAccount \\|\\| !hasObligation|totalAmountRaw <= BigInt\\(0\\)|return null",
      "apps/web/src/lib/yield-optimization/earn-rpc-holdings.client.ts",
      "apps/web/src/hooks/use-active-earn-position.ts",
      "-S",
    ],
    cwd,
  });
  assertHasMatches(
    zeroAndStaleEvidence,
    "RPC zero-account and stale-position evidence"
  );

  const hookEvidence = await runCommandCapture({
    command: [
      "rg",
      "-n",
      "fetchEarnRpcHoldingsSnapshot|applyEarnRpcSnapshotToPosition|createEarnRpcReserveCandidates|setPositionState\\(livePosition\\)",
      "apps/web/src/hooks/use-active-earn-position.ts",
      "-S",
    ],
    cwd,
  });
  assertHasMatches(hookEvidence, "first-open RPC reconciliation evidence");

  const browserPrepareEvidence = await runCommandCapture({
    command: [
      "rg",
      "-n",
      "prepareEarnWithdrawInBrowser|prepareEarnUsdcWithdraw|toEarnWithdrawVaultsSource|fullWithdrawalTargets|closePoliciesOnFullWithdrawal",
      "apps/web/src/components/wallet-workspace/app-wallet-workspace.tsx",
      "-S",
    ],
    cwd,
  });
  assertHasMatches(
    browserPrepareEvidence,
    "browser withdrawal prepare evidence"
  );

  await writeEvidence({
    cluster: LoyalCluster.MainnetBeta,
    dryRun: true,
    env: SOLANA_ENV,
    evidencePath: EVIDENCE_PATH,
    mode: "rpc-holdings-withdrawal-preview",
    phase: VERIFY_PHASE,
    sendsTransactions: false,
    status: "success",
    staticChecks: {
      browserPrepareEvidence: {
        command: commandText(browserPrepareEvidence.command),
        stdout: browserPrepareEvidence.stdout,
      },
      hookEvidence: {
        command: commandText(hookEvidence.command),
        stdout: hookEvidence.stdout,
      },
      negativePrepare: {
        command: commandText(negativePrepare.command),
        exitCode: negativePrepare.exitCode,
      },
      negativeReconcile: {
        command: commandText(negativeReconcile.command),
        exitCode: negativeReconcile.exitCode,
      },
      rpcReaderEvidence: {
        command: commandText(rpcReaderEvidence.command),
        stdout: rpcReaderEvidence.stdout,
      },
      validationEvidence: {
        command: commandText(validationEvidence.command),
        stdout: validationEvidence.stdout,
      },
      zeroAndStaleEvidence: {
        command: commandText(zeroAndStaleEvidence.command),
        stdout: zeroAndStaleEvidence.stdout,
      },
    },
  });

  console.log("[earn-mainnet] PASS rpc holdings withdrawal preview verifier");
  console.log(`[earn-mainnet] evidence ${EVIDENCE_PATH}`);
}

async function main() {
  if (OFFLINE_POLICY_VERIFY) {
    await runOfflinePolicyVerifier();
    return;
  }

  assertMainnet();
  assertVerifyPhase(VERIFY_PHASE);
  assertSupportedPhaseMode();

  if (VERIFY_PHASE === "rpc-holdings-withdrawal-preview") {
    await runRpcHoldingsWithdrawalPreview();
    return;
  }

  if (VERIFY_PHASE === "policy-resume-readiness") {
    await runPolicyResumeReadiness();
    return;
  }

  if (VERIFY_PHASE === "policy-only-reconcile-dry-run") {
    await runPolicyOnlyReconcileDryRun();
    return;
  }

  const walletKeypair = loadTestingKeypair();
  const policySigner = loadDeploymentPolicySigner();
  const wallet = createWalletAdapter(walletKeypair);
  const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 90_000,
  });
  const client = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });
  const repository = await import(
    "../frontend/src/lib/yield-optimization/yield-deposit-repository.server.ts"
  );
  const schema = await import(
    "../frontend/src/lib/yield-optimization/yield-neon-client.server.ts"
  );
  const yieldClient = schema.getYieldOptimizationClient();
  const vaultPubkey = pda.getSmartAccountPda({
    accountIndex: 1,
    programId: PROGRAM_ID,
    settingsPda: SETTINGS_PDA,
  })[0];
  const smartAccountPubkey = pda.getSmartAccountPda({
    accountIndex: 0,
    programId: PROGRAM_ID,
    settingsPda: SETTINGS_PDA,
  })[0];
  const frontendSession = await authenticateFrontendSession({
    keypair: walletKeypair,
    smartAccountAddress: smartAccountPubkey,
  });
  if (
    frontendSession &&
    frontendSession.settingsPda !== SETTINGS_PDA.toBase58()
  ) {
    throw new Error(
      `Frontend auth settings ${
        frontendSession.settingsPda
      } does not match verifier settings ${SETTINGS_PDA.toBase58()}.`
    );
  }
  const vaultUsdcAta = getAssociatedTokenAddressSync(
    EARN_TARGET.liquidityMint,
    vaultPubkey,
    true,
    TOKEN_PROGRAM_ID
  );
  const walletUsdcAta = getAssociatedTokenAddressSync(
    EARN_TARGET.liquidityMint,
    wallet.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  const evidence: {
    cluster: string;
    commits: {
      loyalApps: string | null;
      loyalYieldRouting: string | null;
    };
    dryRun: boolean;
    env: string;
    evidencePath: string;
    frontendBaseUrl: string | null;
    phase: VerifyPhase;
    postState?: unknown;
    preState?: unknown;
    routingRepo: string;
    sendsTransactions: boolean;
    steps: Record<string, EvidenceStep>;
    verifierFailures: unknown[];
  } = {
    cluster: LoyalCluster.MainnetBeta,
    commits: {
      loyalApps: await readGitCommit("."),
      loyalYieldRouting: await readGitCommit(YIELD_ROUTING_REPO),
    },
    dryRun: DRY_RUN,
    env: SOLANA_ENV,
    evidencePath: EVIDENCE_PATH,
    frontendBaseUrl: FRONTEND_BASE_URL,
    phase: VERIFY_PHASE,
    routingRepo: YIELD_ROUTING_REPO,
    sendsTransactions: !DRY_RUN,
    steps: {},
    verifierFailures: [],
  };

  function markDryRunStepsNoSend(): void {
    if (!DRY_RUN) {
      return;
    }

    for (const step of Object.values(evidence.steps)) {
      step.sendsTransactions = false;
    }
  }

  if (frontendSession) {
    evidence.steps.authenticatedSetup = {
      persistence: {
        settingsPda: frontendSession.settingsPda,
        smartAccountAddress: frontendSession.smartAccountAddress,
        walletAddress: wallet.publicKey.toBase58(),
      },
      sendsTransactions: false,
      status: "success",
    };
  } else if (
    VERIFY_PHASE === "same-mint-frontend-sdk-live" ||
    VERIFY_PHASE === "source-lifecycle-withdrawals"
  ) {
    throw new Error(
      `EARN_VERIFY_PHASE=${VERIFY_PHASE} requires EARN_VERIFY_FRONTEND_BASE_URL or EARN_VERIFY_FRONTEND_COOKIE.`
    );
  }

  async function findActiveVerifierPosition() {
    if (
      typeof repository.findReconciledActiveYieldPositionForVault === "function"
    ) {
      return repository.findReconciledActiveYieldPositionForVault({
        cluster: LoyalCluster.MainnetBeta,
        settings: SETTINGS_PDA.toBase58(),
        vaultIndex: 1,
        walletAddress: wallet.publicKey.toBase58(),
      });
    }

    return repository.findActiveYieldPosition({
      cluster: LoyalCluster.MainnetBeta,
      initialReserve: EARN_TARGET.reserve.toBase58(),
      settings: SETTINGS_PDA.toBase58(),
      vaultIndex: 1,
      walletAddress: wallet.publicKey.toBase58(),
    });
  }

  async function countRows(query: {
    from: unknown;
    where?: unknown;
  }): Promise<number> {
    const [row] = await yieldClient.db
      .select({ count: sql<number>`count(*)::int` })
      .from(query.from as never)
      .where(query.where as never);

    return Number(row?.count ?? 0);
  }

  async function loadVerifierRowCounts() {
    const settings = SETTINGS_PDA.toBase58();
    const walletAddress = wallet.publicKey.toBase58();
    const selectedVaultPubkey = vaultPubkey.toBase58();
    const positionIds = await yieldClient.db
      .select({ id: schema.userYieldPositions.id })
      .from(schema.userYieldPositions)
      .where(
        and(
          eq(schema.userYieldPositions.settings, settings),
          eq(schema.userYieldPositions.vaultIndex, 1),
          eq(schema.userYieldPositions.walletAddress, walletAddress)
        )
      );
    const positionIdList = positionIds.map((position) => position.id);

    return {
      activeManagedVaults: await countRows({
        from: schema.managedVaults,
        where: and(
          eq(schema.managedVaults.settings, settings),
          eq(schema.managedVaults.vaultIndex, 1),
          eq(schema.managedVaults.vaultPubkey, selectedVaultPubkey),
          eq(schema.managedVaults.active, true)
        ),
      }),
      activeRoutePolicies: Number(
        (
          await yieldClient.db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.routePolicies)
            .innerJoin(
              schema.managedVaults,
              and(
                eq(
                  schema.managedVaults.activePolicyId,
                  schema.routePolicies.id
                ),
                eq(schema.managedVaults.active, true),
                eq(schema.managedVaults.settings, settings),
                eq(schema.managedVaults.vaultIndex, 1),
                eq(schema.managedVaults.vaultPubkey, selectedVaultPubkey)
              )
            )
            .where(
              and(
                eq(schema.routePolicies.active, true),
                eq(schema.routePolicies.authority, walletAddress),
                eq(schema.routePolicies.settings, settings),
                eq(schema.routePolicies.vaultIndex, 1),
                eq(schema.routePolicies.vaultPubkey, selectedVaultPubkey)
              )
            )
        )[0]?.count ?? 0
      ),
      activePositions: await countRows({
        from: schema.userYieldPositions,
        where: and(
          eq(schema.userYieldPositions.settings, settings),
          eq(schema.userYieldPositions.vaultIndex, 1),
          eq(schema.userYieldPositions.walletAddress, walletAddress),
          eq(schema.userYieldPositions.status, "active")
        ),
      }),
      deposits: await countRows({
        from: schema.userYieldPositionDeposits,
        where: and(
          eq(schema.userYieldPositionDeposits.settings, settings),
          eq(schema.userYieldPositionDeposits.vaultIndex, 1),
          eq(schema.userYieldPositionDeposits.walletAddress, walletAddress)
        ),
      }),
      holdingEvents:
        positionIdList.length === 0
          ? 0
          : await countRows({
              from: schema.userYieldPositionHoldingEvents,
              where: or(
                ...positionIdList.map((positionId) =>
                  eq(
                    schema.userYieldPositionHoldingEvents.positionId,
                    positionId
                  )
                )
              ),
            }),
      positions: positionIdList.length,
      withdrawals: await countRows({
        from: schema.userYieldPositionWithdrawals,
        where: and(
          eq(schema.userYieldPositionWithdrawals.settings, settings),
          eq(schema.userYieldPositionWithdrawals.vaultIndex, 1),
          eq(schema.userYieldPositionWithdrawals.walletAddress, walletAddress)
        ),
      }),
    };
  }

  async function expectFrontendPostFailure(args: {
    body: unknown;
    cookie?: string;
    expectedStatus?: number;
    expectedStatuses?: number[];
    label: string;
    path: string;
    session: FrontendSession;
  }) {
    const expectedStatuses =
      args.expectedStatuses ??
      (args.expectedStatus === undefined ? [] : [args.expectedStatus]);
    if (expectedStatuses.length === 0) {
      throw new Error(`${args.label} must provide an expected HTTP status.`);
    }
    const response = await frontendPostJsonRaw({
      body: args.body,
      cookie: args.cookie,
      path: args.path,
      session: args.session,
    });
    if (!expectedStatuses.includes(response.response.status)) {
      throw new Error(
        `${args.label} expected HTTP ${expectedStatuses.join(" or ")}, got ${
          response.response.status
        }: ${response.text}`
      );
    }

    return {
      body: response.body,
      status: response.response.status,
    };
  }

  async function replayFrontendPostWithStableCounts(args: {
    body: unknown;
    cookie: string;
    label: string;
    path: string;
    session: FrontendSession;
  }) {
    const before = await loadVerifierRowCounts();
    const replay = await frontendPostJsonRaw({
      body: args.body,
      cookie: args.cookie,
      path: args.path,
      session: args.session,
    });
    if (!replay.response.ok) {
      throw new Error(
        `${args.label} replay failed with ${replay.response.status}: ${replay.text}`
      );
    }
    const after = await loadVerifierRowCounts();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(
        `${args.label} replay changed row counts: ${JSON.stringify({
          after,
          before,
        })}`
      );
    }

    return {
      after,
      before,
      body: replay.body,
      status: replay.response.status,
    };
  }

  async function verifyDepositConfirmReplayAndFailures(args: {
    confirmedSlot: bigint;
    label: string;
    policyConfirmedSlot?: bigint;
    policySignature?: string;
    prepared: SmartAccountPreparedEarnUsdcDeposit;
    session: FrontendSession;
    setupPolicyConfirmedSlot?: bigint;
    setupPolicySignature?: string;
    signature: string;
  }) {
    const body = buildEarnDepositConfirmFrontendBody(args);
    const replay = await replayFrontendPostWithStableCounts({
      body,
      cookie: args.session.cookie,
      label: args.label,
      path: "/api/smart-accounts/yield-optimization/deposits/confirm",
      session: args.session,
    });
    const missingSession = await expectFrontendPostFailure({
      body,
      expectedStatus: 401,
      label: `${args.label} missing session`,
      path: "/api/smart-accounts/yield-optimization/deposits/confirm",
      session: args.session,
    });
    const reserveMetadataMismatch = await expectFrontendPostFailure({
      body: {
        ...(body as Record<string, unknown>),
        targetReserve: PublicKey.default.toBase58(),
      },
      cookie: args.session.cookie,
      expectedStatuses: [400, 409],
      label: `${args.label} reserve metadata mismatch`,
      path: "/api/smart-accounts/yield-optimization/deposits/confirm",
      session: args.session,
    });
    const policyMetadataMismatch = await expectFrontendPostFailure({
      body: {
        ...(body as Record<string, unknown>),
        policyAccount: PublicKey.default.toBase58(),
      },
      cookie: args.session.cookie,
      expectedStatus: 400,
      label: `${args.label} policy metadata mismatch`,
      path: "/api/smart-accounts/yield-optimization/deposits/confirm",
      session: args.session,
    });

    return {
      metadataMismatch: {
        policy: policyMetadataMismatch,
        reserve: reserveMetadataMismatch,
      },
      missingSession,
      replay,
    };
  }

  async function verifyWithdrawConfirmReplayAndFailures(args: {
    autodepositCloseConfirmedSlot?: bigint;
    autodepositCloseSignature?: string;
    confirmedSlot: bigint;
    label: string;
    prepared: SmartAccountPreparedEarnUsdcWithdraw;
    session: FrontendSession;
    signature: string;
  }) {
    const body = buildEarnWithdrawConfirmFrontendBody(args);
    const replay = await replayFrontendPostWithStableCounts({
      body,
      cookie: args.session.cookie,
      label: args.label,
      path: "/api/smart-accounts/yield-optimization/withdrawals/confirm",
      session: args.session,
    });
    const missingSession = await expectFrontendPostFailure({
      body,
      expectedStatus: 401,
      label: `${args.label} missing session`,
      path: "/api/smart-accounts/yield-optimization/withdrawals/confirm",
      session: args.session,
    });
    const reserveMetadataMismatch = await expectFrontendPostFailure({
      body: {
        ...(body as Record<string, unknown>),
        targetReserve: PublicKey.default.toBase58(),
      },
      cookie: args.session.cookie,
      expectedStatuses: [400, 409],
      label: `${args.label} reserve metadata mismatch`,
      path: "/api/smart-accounts/yield-optimization/withdrawals/confirm",
      session: args.session,
    });
    const policyMetadataMismatch = await expectFrontendPostFailure({
      body: {
        ...(body as Record<string, unknown>),
        policyAccount: PublicKey.default.toBase58(),
      },
      cookie: args.session.cookie,
      expectedStatus: 400,
      label: `${args.label} policy metadata mismatch`,
      path: "/api/smart-accounts/yield-optimization/withdrawals/confirm",
      session: args.session,
    });

    return {
      metadataMismatch: {
        policy: policyMetadataMismatch,
        reserve: reserveMetadataMismatch,
      },
      missingSession,
      replay,
    };
  }

  async function verifyFrontendFailureCaseWithStableCounts(args: {
    body: unknown;
    cookie?: string;
    expectedStatus?: number;
    expectedStatuses?: number[];
    label: string;
    path: string;
    session: FrontendSession;
  }) {
    const before = await loadVerifierRowCounts();
    const failure = await expectFrontendPostFailure(args);
    const after = await loadVerifierRowCounts();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(
        `${args.label} changed row counts: ${JSON.stringify({
          after,
          before,
        })}`
      );
    }

    return {
      ...failure,
      after,
      before,
    };
  }

  async function verifyDryRunFrontendFailureCases(args: {
    prepared: SmartAccountPreparedEarnUsdcDeposit;
    session: FrontendSession;
  }) {
    const depositConfirmBody = buildEarnDepositConfirmFrontendBody({
      confirmedSlot: BigInt(1),
      prepared: args.prepared,
      session: args.session,
      signature: PublicKey.default.toBase58(),
    });

    return {
      depositConfirmLiquidityMintMismatch:
        await verifyFrontendFailureCaseWithStableCounts({
          body: {
            ...(depositConfirmBody as Record<string, unknown>),
            liquidityMint: PublicKey.default.toBase58(),
          },
          cookie: args.session.cookie,
          expectedStatus: 400,
          label: "dry-run deposit confirm liquidity mint mismatch",
          path: "/api/smart-accounts/yield-optimization/deposits/confirm",
          session: args.session,
        }),
      depositConfirmMissingSession:
        await verifyFrontendFailureCaseWithStableCounts({
          body: depositConfirmBody,
          expectedStatus: 401,
          label: "dry-run deposit confirm missing session",
          path: "/api/smart-accounts/yield-optimization/deposits/confirm",
          session: args.session,
        }),
      depositConfirmPolicyMetadataMismatch:
        await verifyFrontendFailureCaseWithStableCounts({
          body: {
            ...(depositConfirmBody as Record<string, unknown>),
            policyAccount: PublicKey.default.toBase58(),
          },
          cookie: args.session.cookie,
          expectedStatus: 400,
          label: "dry-run deposit confirm policy metadata mismatch",
          path: "/api/smart-accounts/yield-optimization/deposits/confirm",
          session: args.session,
        }),
      depositPrepareInvalidAmount:
        await verifyFrontendFailureCaseWithStableCounts({
          body: {
            amountRaw: "0",
            mint: EARN_TARGET.liquidityMint.toBase58(),
          },
          cookie: args.session.cookie,
          expectedStatus: 400,
          label: "dry-run deposit prepare invalid amount",
          path: "/api/smart-accounts/yield-optimization/deposits/prepare",
          session: args.session,
        }),
      depositPrepareMissingSession:
        await verifyFrontendFailureCaseWithStableCounts({
          body: {
            amountRaw: FIRST_DEPOSIT_RAW.toString(),
            mint: EARN_TARGET.liquidityMint.toBase58(),
          },
          expectedStatus: 401,
          label: "dry-run deposit prepare missing session",
          path: "/api/smart-accounts/yield-optimization/deposits/prepare",
          session: args.session,
        }),
      withdrawPrepareInvalidMode:
        await verifyFrontendFailureCaseWithStableCounts({
          body: { amountRaw: "1", mode: "unsupported" },
          cookie: args.session.cookie,
          expectedStatus: 400,
          label: "dry-run withdraw prepare invalid mode",
          path: "/api/smart-accounts/yield-optimization/withdrawals/prepare",
          session: args.session,
        }),
      withdrawPrepareMissingSession:
        await verifyFrontendFailureCaseWithStableCounts({
          body: { amountRaw: "1", mode: "full" },
          expectedStatus: 401,
          label: "dry-run withdraw prepare missing session",
          path: "/api/smart-accounts/yield-optimization/withdrawals/prepare",
          session: args.session,
        }),
    };
  }

  async function runFullWithdrawCleanup() {
    const activePosition = await findActiveVerifierPosition();
    if (!activePosition) {
      throw new Error(
        "full-withdraw-cleanup requires an active Earn position."
      );
    }
    if (activePosition.currentAmountRaw <= 0n) {
      throw new Error(
        "Active Earn position has no current holding to withdraw."
      );
    }
    const activePolicyPair = await repository.findActiveYieldRoutePolicyPair({
      authority: wallet.publicKey.toBase58(),
      cluster: LoyalCluster.MainnetBeta,
      settings: SETTINGS_PDA.toBase58(),
      vaultIndex: 1,
      vaultPubkey: vaultPubkey.toBase58(),
    });
    const activeRoutePolicy = activePolicyPair?.routePolicy ?? null;
    if (!activeRoutePolicy) {
      throw new Error("full-withdraw-cleanup requires an active Earn policy.");
    }

    let selectedSource: NonNullable<EarnWithdrawPrepareRequestBody["source"]>;
    if (frontendSession) {
      const position = await fetchEarnPositionViaFrontend({
        session: frontendSession,
      });
      let holdings = readEarnHoldings(position);
      let cleanupStepIndex = 0;
      while (holdings.length > 1) {
        const holding =
          holdings.find((entry) => entry.kind === "idle") ?? holdings[0]!;
        const source = withdrawSourceFromHolding(holding);
        const sourceAmountRaw = BigInt(source.amountRaw);
        const preparedSource = await prepareEarnWithdrawViaFrontend({
          amountRaw: sourceAmountRaw,
          mode: "full",
          session: frontendSession,
          source,
        });
        assertPreparedSourceMetadata({
          label: `full-withdraw-cleanup source ${cleanupStepIndex}`,
          prepared: preparedSource,
          source,
        });
        const sentSource = await sendOrResumePrepared({
          connection,
          prepared: preparedSource.prepared,
          resumeSignature: null,
          resumeSlot: null,
          wallet,
        });
        const confirmedPosition = await confirmEarnWithdrawViaFrontend({
          confirmedSlot: sentSource.slot,
          prepared: preparedSource,
          session: frontendSession,
          signature: sentSource.signature,
        });
        evidence.steps[`fullWithdrawalSource${cleanupStepIndex}`] = {
          amountRaw: source.amountRaw,
          confirmedSlot: sentSource.slot.toString(),
          instructionCount: preparedSource.prepared.instructions.length,
          preparedTarget: preparedTargetEvidence(preparedSource),
          persistence: {
            position: compactPosition(confirmedPosition),
            prepared: preparedSource.persistence,
            source,
          },
          sendsTransactions: true,
          signature: sentSource.signature,
          simulationLogs: sentSource.simulationLogs.slice(-12),
          status: "success",
        };
        await writeEvidence(evidence);
        holdings = readEarnHoldings(
          await fetchEarnPositionViaFrontend({
            session: frontendSession,
          })
        );
        cleanupStepIndex += 1;
      }
      if (holdings.length !== 1) {
        throw new Error(
          `full-withdraw-cleanup expected exactly one active frontend holding, found ${holdings.length}.`
        );
      }
      selectedSource = withdrawSourceFromHolding(holdings[0]!);
    } else {
      const sourceState = await loadState({
        connection,
        policyAccount: new PublicKey(activeRoutePolicy.policyAccount),
        setupPolicyAccount: activePolicyPair?.setupPolicy
          ? new PublicKey(activePolicyPair.setupPolicy.policyAccount)
          : null,
        schema,
        vaultCollateralAta: null,
        vaultPubkey,
        vaultUsdcAta,
        walletAddress: wallet.publicKey,
        walletUsdcAta,
        yieldClient,
      });
      selectedSource = withdrawSourceFromCurrentRows({
        holdingEvents: getArrayField(sourceState.db, "holdingEvents"),
        idleRows: getArrayField(sourceState.db, "currentIdleRows"),
        label: "full-withdraw-cleanup",
        reserveRows: getArrayField(sourceState.db, "currentReserveRows"),
      });
    }
    const selectedAmountRaw = BigInt(selectedSource.amountRaw);

    const prepared = frontendSession
      ? await prepareEarnWithdrawViaFrontend({
          amountRaw: selectedAmountRaw,
          mode: "full",
          session: frontendSession,
          source: selectedSource,
        })
      : await client.prepareEarnUsdcWithdraw({
          amountRaw: selectedAmountRaw,
          cluster: LoyalCluster.MainnetBeta,
          feePayer: wallet.publicKey,
          mode: "full",
          policySigner,
          source: toClientWithdrawSource(selectedSource),
          settingsPda: SETTINGS_PDA,
          walletAddress: wallet.publicKey,
          yieldRoutingPolicy: {
            account: new PublicKey(activeRoutePolicy.policyAccount),
            seed: activeRoutePolicy.policySeed,
            ...(activePolicyPair?.setupPolicy
              ? {
                  setupPolicy: {
                    account: new PublicKey(
                      activePolicyPair.setupPolicy.policyAccount
                    ),
                    seed: activePolicyPair.setupPolicy.policySeed,
                  },
                }
              : {}),
          },
        });
    const policyAccount = prepared.policy.account;
    const setupPolicyAccount = prepared.setupPolicy?.account ?? null;
    const vaultCollateralAta = prepared.vault.collateralAta;
    const preState = await loadState({
      connection,
      policyAccount,
      setupPolicyAccount,
      schema,
      vaultCollateralAta,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    evidence.preState = preState;
    await writeEvidence(evidence);

    if (DRY_RUN) {
      const postKaminoVaultUsdc = await simulatePreparedPrefixTokenBalance({
        connection,
        prepared: prepared.prepared,
        throughInstructionCount: 2,
        tokenAccount: vaultUsdcAta,
      });
      evidence.steps.fullWithdrawal = {
        amountRaw: selectedAmountRaw.toString(),
        cleanupCandidates: fullWithdrawCleanupCandidates(prepared),
        instructionCount: prepared.prepared.instructions.length,
        kaminoWithdrawAmountRaw:
          prepared.persistence.kaminoWithdrawAmountRaw ??
          selectedAmountRaw.toString(),
        preparedTarget: preparedTargetEvidence(prepared),
        persistence: prepared.persistence,
        postKaminoVaultUsdcRaw: postKaminoVaultUsdc.amountRaw,
        status: "skipped",
        unsignedSimulationLogs: postKaminoVaultUsdc.logs.slice(-12),
        vaultUsdcRemainderRaw:
          prepared.persistence.vaultUsdcRemainderRaw ??
          preState.tokenBalances.vaultUsdcRaw ??
          "0",
      };
      await writeEvidence(evidence);
      const unsignedSimulationLogs = await simulatePreparedUnsigned({
        connection,
        label: "full withdrawal",
        prepared: prepared.prepared,
      });
      evidence.steps.fullWithdrawal = {
        ...evidence.steps.fullWithdrawal,
        amountRaw: selectedAmountRaw.toString(),
        cleanupCandidates: fullWithdrawCleanupCandidates(prepared),
        instructionCount: prepared.prepared.instructions.length,
        kaminoWithdrawAmountRaw:
          prepared.persistence.kaminoWithdrawAmountRaw ??
          selectedAmountRaw.toString(),
        preparedTarget: preparedTargetEvidence(prepared),
        persistence: prepared.persistence,
        status: "skipped",
        unsignedSimulationLogs: unsignedSimulationLogs.slice(-12),
        vaultUsdcRemainderRaw:
          prepared.persistence.vaultUsdcRemainderRaw ??
          preState.tokenBalances.vaultUsdcRaw ??
          "0",
      };
      await writeEvidence(evidence);
      return;
    }

    const sentAutodepositClose =
      frontendSession && prepared.autodepositClosePrepared
        ? await sendOrResumePrepared({
            connection,
            prepared: prepared.autodepositClosePrepared.prepared,
            resumeSignature: null,
            resumeSlot: null,
            wallet,
          })
        : null;
    const sent = await sendOrResumePrepared({
      connection,
      prepared: prepared.prepared,
      resumeSignature: RESUME_FULL_WITHDRAW_SIGNATURE,
      resumeSlot: RESUME_FULL_WITHDRAW_SLOT,
      wallet,
    });
    const withdrawalConfirmArgs = {
      ...(sentAutodepositClose
        ? {
            autodepositCloseConfirmedSlot: sentAutodepositClose.slot,
            autodepositCloseSignature: sentAutodepositClose.signature,
          }
        : {}),
      confirmedSlot: sent.slot,
      prepared,
      session: frontendSession as FrontendSession,
      signature: sent.signature,
    };
    const position = frontendSession
      ? await confirmEarnWithdrawViaFrontend(withdrawalConfirmArgs)
      : await repository.recordConfirmedYieldWithdrawal(
          withdrawalInput({
            prepared,
            signature: sent.signature,
            slot: sent.slot,
          })
        );
    const idempotency =
      frontendSession &&
      (await verifyWithdrawConfirmReplayAndFailures({
        ...withdrawalConfirmArgs,
        label: "full withdrawal confirm",
      }));
    evidence.steps.fullWithdrawal = {
      amountRaw: selectedAmountRaw.toString(),
      cleanupCandidates: fullWithdrawCleanupCandidates(prepared),
      autodepositCloseConfirmedSlot:
        sentAutodepositClose?.slot.toString() ?? null,
      autodepositCloseSignature: sentAutodepositClose?.signature ?? null,
      confirmedSlot: sent.slot.toString(),
      duplicateConfirm: idempotency?.replay,
      instructionCount: prepared.prepared.instructions.length,
      kaminoWithdrawAmountRaw:
        prepared.persistence.kaminoWithdrawAmountRaw ??
        selectedAmountRaw.toString(),
      negativeCases: idempotency
        ? {
            metadataMismatch: idempotency.metadataMismatch,
            missingSession: idempotency.missingSession,
          }
        : undefined,
      preparedTarget: preparedTargetEvidence(prepared),
      persistence: { position: compactPosition(position) },
      signature: sent.signature,
      simulationLogs: sent.simulationLogs.slice(-12),
      status: "success",
      vaultUsdcRemainderRaw:
        prepared.persistence.vaultUsdcRemainderRaw ??
        preState.tokenBalances.vaultUsdcRaw ??
        "0",
    };

    const postState = await loadState({
      connection,
      policyAccount,
      setupPolicyAccount,
      schema,
      vaultCollateralAta,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    evidence.postState = postState;

    const preWalletUsdc = BigInt(preState.tokenBalances.walletUsdcRaw ?? "0");
    const postWalletUsdc = BigInt(postState.tokenBalances.walletUsdcRaw ?? "0");
    const expectedWalletUsdcDelta = BigInt(
      prepared.persistence.walletTransferAmountRaw ??
        prepared.persistence.kaminoWithdrawAmountRaw ??
        selectedAmountRaw.toString()
    );
    if (postWalletUsdc - preWalletUsdc !== expectedWalletUsdcDelta) {
      throw new Error(
        "Wallet USDC delta did not match full withdrawal plus vault remainder."
      );
    }
    const collateralCleanupIncluded =
      prepared.persistence.vaultCollateralCleanupIncluded === true;
    const expectedRent =
      BigInt(preState.accounts.policy?.lamports ?? 0) +
      BigInt(preState.accounts.setupPolicy?.lamports ?? 0) +
      (collateralCleanupIncluded
        ? BigInt(preState.accounts.vaultCollateralAta?.lamports ?? 0)
        : BigInt(0)) +
      BigInt(preState.accounts.vaultUsdcAta?.lamports ?? 0);
    const preSol = BigInt(preState.accounts.wallet?.lamports ?? 0);
    const postSol = BigInt(postState.accounts.wallet?.lamports ?? 0);
    const transactionFee = await resolveTransactionFeeLamports({
      connection,
      signature: sent.signature,
    });
    evidence.steps.fullWithdrawal.transactionFeeLamports =
      transactionFee.toString();
    if (
      postSol +
        transactionFee +
        BigInt(RENT_REFUND_ROUNDING_ALLOWANCE_LAMPORTS) <
      preSol + expectedRent
    ) {
      throw new Error("Wallet SOL balance does not show expected rent refund.");
    }
    if (postState.accounts.policy) {
      throw new Error(
        "Earn policy account still exists after full withdrawal."
      );
    }
    if (postState.accounts.setupPolicy) {
      throw new Error(
        "Earn setup policy account still exists after full withdrawal."
      );
    }
    if (collateralCleanupIncluded && postState.accounts.vaultCollateralAta) {
      throw new Error(
        "Vault Kamino collateral ATA still exists after cleanup."
      );
    }
    if (postState.accounts.vaultUsdcAta) {
      throw new Error("Earn vault USDC ATA still exists after cleanup.");
    }
    const postPosition = postState.db.position as {
      currentAmountRaw?: bigint;
      principalAmountRaw?: bigint;
      status?: string;
    } | null;
    if (
      postPosition?.status !== "closed" ||
      postPosition.principalAmountRaw !== 0n ||
      postPosition.currentAmountRaw !== 0n
    ) {
      throw new Error("Yield position was not closed to zero.");
    }
    assertNoPositionActive(postState);
    evidence.verifierFailures = await assertNoVerifierFailures({
      settings: SETTINGS_PDA.toBase58(),
      verifyUserYieldPositions: repository.verifyUserYieldPositions,
    });
    await writeEvidence(evidence);
  }

  async function runInitialDepositFromClean() {
    const preState = await loadState({
      connection,
      policyAccount: null,
      schema,
      vaultCollateralAta: null,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    assertNoPositionActive(preState, {
      allowActivePosition: Boolean(RESUME_INITIAL_DEPOSIT_SIGNATURE),
      allowActivePolicyRows: Boolean(RESUME_INITIAL_POLICY_SIGNATURE),
    });
    evidence.preState = preState;
    await writeEvidence(evidence);

    if (RESUME_INITIAL_DEPOSIT_SIGNATURE) {
      const resumedPosition = frontendSession
        ? await fetchEarnPositionViaFrontend({ session: frontendSession })
        : preState.db.position;
      const resumedPositionSummary = compactPosition(resumedPosition);
      if (resumedPositionSummary.status !== "active") {
        throw new Error(
          "Resumed initial deposit did not point at an active Earn position."
        );
      }
      evidence.steps.initialPolicy = {
        confirmedFinalizeSlot: RESUME_INITIAL_SETUP_POLICY_SLOT,
        confirmedSlot: RESUME_INITIAL_POLICY_SLOT,
        finalizeSignature: RESUME_INITIAL_SETUP_POLICY_SIGNATURE,
        routeConfirmedSlot: RESUME_INITIAL_POLICY_SLOT,
        routeSignature: RESUME_INITIAL_POLICY_SIGNATURE,
        setupConfirmedSlot: RESUME_INITIAL_SETUP_POLICY_SLOT,
        setupSignature: RESUME_INITIAL_SETUP_POLICY_SIGNATURE,
        signature: RESUME_INITIAL_POLICY_SIGNATURE ?? undefined,
        sendsTransactions: false,
        status: "success",
      };
      evidence.steps.initialDeposit = {
        amountRaw: FIRST_DEPOSIT_RAW.toString(),
        confirmedSlot: RESUME_INITIAL_DEPOSIT_SLOT ?? undefined,
        persistence: { position: resumedPositionSummary },
        reason:
          "Resumed from an already-confirmed initial deposit after a prior verifier attempt failed after deposit confirmation.",
        sendsTransactions: false,
        signature: RESUME_INITIAL_DEPOSIT_SIGNATURE,
        status: "success",
      };
      await writeEvidence(evidence);
      return;
    }

    if (frontendSession) {
      const prepared = await prepareEarnDepositViaFrontend({
        amountRaw: FIRST_DEPOSIT_RAW,
        session: frontendSession,
      });
      assertSafePolicyUniverse(prepared.persistence);
      const policySetupPrepared = prepared.policySetupPrepared ?? null;
      const policyFinalizePrepared = prepared.policyFinalizePrepared ?? null;
      if (
        !policySetupPrepared ||
        !policyFinalizePrepared ||
        !prepared.setupPolicy
      ) {
        throw new Error(
          "Frontend initial deposit did not return the required route and init-obligation policy setup transactions."
        );
      }
      assertPreparedPolicyCreateUsesSafeUniverse({
        prepared: policySetupPrepared,
      });
      assertPreparedSetupPolicyCreateUsesInitObligation(policyFinalizePrepared);

      if (DRY_RUN) {
        const unsignedPolicySimulationLogs = await simulatePreparedUnsigned({
          connection,
          label: "initial route policy setup",
          prepared: policySetupPrepared,
        });
        const setupPolicySimulationSkippedReason =
          "Dry-run does not send the route policy transaction, so the init-obligation setup policy transaction is not simulated against unadvanced settings state.";
        const depositSimulationSkippedReason =
          "Dry-run does not send the route/setup policy transactions, so the final deposit transaction is not simulated against non-existent policy accounts.";
        const frontendFailureCases = await verifyDryRunFrontendFailureCases({
          prepared,
          session: frontendSession,
        });
        evidence.steps.initialPolicy = {
          finalizeInstructionCount:
            policyFinalizePrepared?.instructions.length ?? 0,
          finalizePacketLength: policyFinalizePrepared
            ? preparedPacketLength(policyFinalizePrepared)
            : null,
          instructionCount: policySetupPrepared?.instructions.length ?? 0,
          packetLength: policySetupPrepared
            ? preparedPacketLength(policySetupPrepared)
            : null,
          policyUniverse: EARN_POLICY_UNIVERSE,
          preparedTarget: preparedTargetEvidence(prepared),
          persistence: prepared.persistence,
          status: "skipped",
          setupPolicy: prepared.setupPolicy,
          setupPacketLength: preparedPacketLength(policyFinalizePrepared),
          setupPolicyUnsignedSimulationSkippedReason:
            setupPolicySimulationSkippedReason,
          unsignedSimulationLogs: unsignedPolicySimulationLogs.slice(-12),
        };
        evidence.steps.initialDeposit = {
          amountRaw: FIRST_DEPOSIT_RAW.toString(),
          instructionCount: prepared.prepared.instructions.length,
          kaminoSetupAccountCount: prepared.kaminoSetupAccountCount,
          kaminoSetupRentLamports: prepared.kaminoSetupRentLamports,
          kaminoSetupRequired: prepared.kaminoSetupRequired,
          packetLength: preparedPacketLength(prepared.prepared),
          preparedTarget: preparedTargetEvidence(prepared),
          persistence: prepared.persistence,
          policyUniverse: EARN_POLICY_UNIVERSE,
          status: "skipped",
          unsignedSimulationSkippedReason: depositSimulationSkippedReason,
        };
        evidence.steps.frontendFailureCases = {
          negativeCases: frontendFailureCases,
          reason:
            "Dry-run frontend rejection probes verify invalid/missing-session requests leave row counts stable before any live send.",
          sendsTransactions: false,
          status: "success",
        };
        await writeEvidence(evidence);
        return;
      }

      let policySignature = RESUME_INITIAL_POLICY_SIGNATURE;
      let policySlot = RESUME_INITIAL_POLICY_SLOT
        ? BigInt(RESUME_INITIAL_POLICY_SLOT)
        : null;
      let setupPolicySignature = RESUME_INITIAL_SETUP_POLICY_SIGNATURE;
      let setupPolicySlot = RESUME_INITIAL_SETUP_POLICY_SLOT
        ? BigInt(RESUME_INITIAL_SETUP_POLICY_SLOT)
        : null;
      let sentPolicy: {
        signature: string;
        simulationLogs: string[];
        slot: bigint;
      } | null = null;
      let sentSetupPolicy: {
        signature: string;
        simulationLogs: string[];
        slot: bigint;
      } | null = null;

      if (!policySignature) {
        sentPolicy = await sendOrResumePrepared({
          connection,
          prepared: policySetupPrepared,
          resumeSignature: null,
          resumeSlot: null,
          wallet,
        });
        policySignature = sentPolicy.signature;
        policySlot = sentPolicy.slot;
      }

      if (!policySignature) {
        throw new Error("Frontend initial policy signature is unavailable.");
      }
      if (!policySlot) {
        policySlot = await resolveConfirmedSignatureSlot({
          connection,
          signature: policySignature,
        });
      }
      if (!setupPolicySignature) {
        sentSetupPolicy = await sendOrResumePrepared({
          connection,
          prepared: policyFinalizePrepared,
          resumeSignature: null,
          resumeSlot: null,
          wallet,
        });
        setupPolicySignature = sentSetupPolicy.signature;
        setupPolicySlot = sentSetupPolicy.slot;
      }
      if (!setupPolicySignature) {
        throw new Error("Frontend setup policy signature is unavailable.");
      }
      if (!setupPolicySlot) {
        setupPolicySlot = await resolveConfirmedSignatureSlot({
          connection,
          signature: setupPolicySignature,
        });
      }

      const sent = await sendOrResumePrepared({
        connection,
        prepared: prepared.prepared,
        resumeSignature: RESUME_INITIAL_DEPOSIT_SIGNATURE,
        resumeSlot: RESUME_INITIAL_DEPOSIT_SLOT,
        wallet,
      });
      const kaminoDeposit = await loadKaminoDepositEvidence({
        connection,
        signature: sent.signature,
      });
      if (
        !kaminoDeposit.initObligationLogged &&
        kaminoDeposit.depositedLiquidityRaw !== FIRST_DEPOSIT_RAW.toString()
      ) {
        throw new Error(
          "Initial deposit transaction did not show Kamino setup or deposit."
        );
      }
      const depositConfirmArgs = {
        confirmedSlot: sent.slot,
        policyConfirmedSlot: policySlot,
        policySignature,
        prepared,
        session: frontendSession,
        setupPolicyConfirmedSlot: setupPolicySlot,
        setupPolicySignature,
        signature: sent.signature,
      };
      const position = await confirmEarnDepositViaFrontend(depositConfirmArgs);
      const idempotency = await verifyDepositConfirmReplayAndFailures({
        ...depositConfirmArgs,
        label: "initial deposit confirm",
      });
      evidence.steps.initialPolicy = {
        confirmedFinalizeSlot: setupPolicySlot.toString(),
        confirmedSlot: policySlot.toString(),
        finalizeInstructionCount:
          policyFinalizePrepared?.instructions.length ?? 0,
        finalizeSignature: setupPolicySignature,
        instructionCount: policySetupPrepared?.instructions.length ?? 0,
        policyUniverse: EARN_POLICY_UNIVERSE,
        preparedTarget: preparedTargetEvidence(prepared),
        persistence: prepared.persistence,
        routeConfirmedSlot: policySlot.toString(),
        routeSignature: policySignature,
        setupConfirmedSlot: setupPolicySlot.toString(),
        setupPolicy: prepared.setupPolicy,
        signature: policySignature,
        setupSignature: setupPolicySignature,
        simulationLogs: sentPolicy?.simulationLogs.slice(-12) ?? [],
        finalizeSimulationLogs:
          sentSetupPolicy?.simulationLogs.slice(-12) ?? [],
        status: "success",
      };
      evidence.steps.initialDeposit = {
        amountRaw: FIRST_DEPOSIT_RAW.toString(),
        confirmedSlot: sent.slot.toString(),
        duplicateConfirm: idempotency.replay,
        instructionCount: prepared.prepared.instructions.length,
        kaminoDeposit,
        kaminoSetupAccountCount: prepared.kaminoSetupAccountCount,
        kaminoSetupRentLamports: prepared.kaminoSetupRentLamports,
        kaminoSetupRequired: prepared.kaminoSetupRequired,
        negativeCases: {
          metadataMismatch: idempotency.metadataMismatch,
          missingSession: idempotency.missingSession,
        },
        policyUniverse: EARN_POLICY_UNIVERSE,
        preparedTarget: preparedTargetEvidence(prepared),
        persistence: { position: compactPosition(position) },
        signature: sent.signature,
        simulationLogs: sent.simulationLogs.slice(-12),
        status: "success",
      };

      const postState = await loadState({
        connection,
        policyAccount: prepared.policy.account,
        setupPolicyAccount: prepared.setupPolicy?.account ?? null,
        schema,
        vaultCollateralAta:
          prepared.vault.collateralAta ??
          (kaminoDeposit.reserveCollateralSupplyAccount
            ? new PublicKey(kaminoDeposit.reserveCollateralSupplyAccount)
            : null),
        vaultPubkey,
        vaultUsdcAta,
        walletAddress: wallet.publicKey,
        walletUsdcAta,
        yieldClient,
      });
      evidence.postState = postState;
      const preWalletUsdc = BigInt(preState.tokenBalances.walletUsdcRaw ?? "0");
      const postWalletUsdc = BigInt(
        postState.tokenBalances.walletUsdcRaw ?? "0"
      );
      if (
        !RESUME_INITIAL_DEPOSIT_SIGNATURE &&
        preWalletUsdc - postWalletUsdc !== FIRST_DEPOSIT_RAW
      ) {
        throw new Error(
          "Wallet USDC delta did not match initial deposit amount."
        );
      }
      if (!postState.accounts.policy) {
        throw new Error("Earn policy account was not created.");
      }
      if (!postState.accounts.setupPolicy) {
        throw new Error("Earn setup policy account was not created.");
      }
      if (
        prepared.vault.collateralAta &&
        !postState.accounts.vaultCollateralAta
      ) {
        throw new Error("Vault Kamino collateral ATA was not created.");
      }
      const postPosition = postState.db.position as {
        currentAmountRaw?: bigint;
        principalAmountRaw?: bigint;
        status?: string;
      } | null;
      if (
        postPosition?.status !== "active" ||
        postPosition.principalAmountRaw !== FIRST_DEPOSIT_RAW ||
        postPosition.currentAmountRaw !== FIRST_DEPOSIT_RAW
      ) {
        throw new Error(
          "Initial deposit did not create the expected active position."
        );
      }
      const routePolicy = postState.db.routePolicy as {
        active?: boolean;
      } | null;
      const setupPolicy = postState.db.setupPolicy as {
        active?: boolean;
      } | null;
      const managedVault = postState.db.managedVault as {
        active?: boolean;
        setupPolicyId?: bigint | null;
      } | null;
      if (
        !routePolicy?.active ||
        !setupPolicy?.active ||
        !managedVault?.active ||
        typeof managedVault?.setupPolicyId !== "bigint"
      ) {
        throw new Error(
          "Initial deposit did not activate route/setup policy and vault DB rows."
        );
      }
      evidence.verifierFailures = await assertNoVerifierFailures({
        settings: SETTINGS_PDA.toBase58(),
        verifyUserYieldPositions: repository.verifyUserYieldPositions,
      });
      await writeEvidence(evidence);
      return;
    }

    let initialPolicy: {
      account: PublicKey;
      persistence: SmartAccountPreparedEarnUsdcYieldRoutingPolicy["persistence"];
      seed: bigint;
      signature: string;
      slot: bigint;
      setupPolicy: {
        account: PublicKey;
        seed: bigint;
        signature: string;
        slot: bigint;
      };
    } | null = null;

    if (RESUME_INITIAL_POLICY_SIGNATURE) {
      if (!RESUME_INITIAL_POLICY_ACCOUNT || !RESUME_INITIAL_POLICY_SEED) {
        throw new Error(
          "Resuming an initial policy requires EARN_INITIAL_POLICY_ACCOUNT and EARN_INITIAL_POLICY_SEED."
        );
      }
      const policyAccount = new PublicKey(RESUME_INITIAL_POLICY_ACCOUNT);
      const policySeed = BigInt(RESUME_INITIAL_POLICY_SEED);
      const setupPolicySeed = RESUME_INITIAL_SETUP_POLICY_SEED
        ? BigInt(RESUME_INITIAL_SETUP_POLICY_SEED)
        : policySeed + 1n;
      const setupPolicyAccount = RESUME_INITIAL_SETUP_POLICY_ACCOUNT
        ? new PublicKey(RESUME_INITIAL_SETUP_POLICY_ACCOUNT)
        : pda.getPolicyPda({
            programId: PROGRAM_ID,
            settingsPda: SETTINGS_PDA,
            policySeed: Number(setupPolicySeed),
          })[0];
      if (!RESUME_INITIAL_SETUP_POLICY_SIGNATURE) {
        throw new Error(
          "Resuming an initial policy requires EARN_INITIAL_SETUP_POLICY_SIGNATURE."
        );
      }
      const policyAccountInfo = await connection.getAccountInfo(
        policyAccount,
        "confirmed"
      );
      if (!policyAccountInfo) {
        throw new Error(
          `Resumed policy account ${policyAccount.toBase58()} does not exist.`
        );
      }
      const setupPolicyAccountInfo = await connection.getAccountInfo(
        setupPolicyAccount,
        "confirmed"
      );
      if (!setupPolicyAccountInfo) {
        throw new Error(
          `Resumed setup policy account ${setupPolicyAccount.toBase58()} does not exist.`
        );
      }
      const sentPolicy = {
        signature: RESUME_INITIAL_POLICY_SIGNATURE,
        slot: RESUME_INITIAL_POLICY_SLOT
          ? BigInt(RESUME_INITIAL_POLICY_SLOT)
          : await resolveConfirmedSignatureSlot({
              connection,
              signature: RESUME_INITIAL_POLICY_SIGNATURE,
            }),
      };
      const sentSetupPolicy = {
        signature: RESUME_INITIAL_SETUP_POLICY_SIGNATURE,
        slot: RESUME_INITIAL_SETUP_POLICY_SLOT
          ? BigInt(RESUME_INITIAL_SETUP_POLICY_SLOT)
          : await resolveConfirmedSignatureSlot({
              connection,
              signature: RESUME_INITIAL_SETUP_POLICY_SIGNATURE,
            }),
      };
      const persistence: SmartAccountPreparedEarnUsdcYieldRoutingPolicy["persistence"] =
        {
          cluster: LoyalCluster.MainnetBeta,
          walletAddress: wallet.publicKey.toBase58(),
          delegatedSigner: policySigner.toBase58(),
          settings: SETTINGS_PDA.toBase58(),
          vaultIndex: 1,
          vaultPubkey: vaultPubkey.toBase58(),
          policyId: policySeed.toString(),
          policyAccount: policyAccount.toBase58(),
          policySeed: policySeed.toString(),
          setupPolicyId: setupPolicySeed.toString(),
          setupPolicyAccount: setupPolicyAccount.toBase58(),
          setupPolicySeed: setupPolicySeed.toString(),
          targetReserve: EARN_TARGET.reserve.toBase58(),
          market: EARN_TARGET.market.toBase58(),
          liquidityMint: EARN_TARGET.liquidityMint.toBase58(),
          ...EARN_POLICY_UNIVERSE,
        };
      if (DRY_RUN) {
        evidence.steps.initialPolicy = {
          confirmedSlot: sentPolicy.slot.toString(),
          instructionCount: 0,
          policyUniverse: EARN_POLICY_UNIVERSE,
          persistence,
          signature: sentPolicy.signature,
          simulationLogs: [],
          status: "skipped",
        };
        await writeEvidence(evidence);
        return;
      }
      await repository.recordConfirmedYieldRoutePolicy(
        policyInputFromPersistence({
          persistence,
          setupSignature: sentSetupPolicy.signature,
          setupSlot: sentSetupPolicy.slot,
          signature: sentPolicy.signature,
          slot: sentPolicy.slot,
        })
      );
      initialPolicy = {
        account: policyAccount,
        persistence,
        seed: policySeed,
        signature: sentPolicy.signature,
        slot: sentPolicy.slot,
        setupPolicy: {
          account: setupPolicyAccount,
          seed: setupPolicySeed,
          signature: sentSetupPolicy.signature,
          slot: sentSetupPolicy.slot,
        },
      };
      evidence.steps.initialPolicy = {
        confirmedSlot: sentPolicy.slot.toString(),
        confirmedFinalizeSlot: sentSetupPolicy.slot.toString(),
        instructionCount: 0,
        policyUniverse: EARN_POLICY_UNIVERSE,
        persistence,
        routeConfirmedSlot: sentPolicy.slot.toString(),
        routeSignature: sentPolicy.signature,
        signature: sentPolicy.signature,
        setupConfirmedSlot: sentSetupPolicy.slot.toString(),
        setupPolicy: {
          account: setupPolicyAccount.toBase58(),
          seed: setupPolicySeed.toString(),
        },
        setupSignature: sentSetupPolicy.signature,
        simulationLogs: [],
        status: "success",
      };
      await writeEvidence(evidence);
    } else {
      const preparedPolicy = await client.prepareEarnUsdcYieldRoutingPolicy({
        cluster: LoyalCluster.MainnetBeta,
        feePayer: wallet.publicKey,
        settingsPda: SETTINGS_PDA,
        signer: policySigner,
        walletAddress: wallet.publicKey,
      });
      assertSafePolicyUniverse(preparedPolicy.persistence);
      const finalizePrepared = preparedPolicy.finalizePrepared ?? null;
      if (!finalizePrepared) {
        throw new Error(
          "Direct initial policy preparation did not return the required init-obligation setup policy transaction."
        );
      }
      assertPreparedPolicyCreateUsesSafeUniverse({
        prepared: preparedPolicy.prepared,
      });
      assertPreparedSetupPolicyCreateUsesInitObligation(finalizePrepared);
      if (DRY_RUN) {
        const unsignedPolicySimulationLogs = await simulatePreparedUnsigned({
          connection,
          label: "direct initial route policy setup",
          prepared: preparedPolicy.prepared,
        });
        const setupPolicySimulationSkippedReason =
          "Dry-run does not send the route policy transaction, so the init-obligation setup policy transaction is not simulated against unadvanced settings state.";
        evidence.steps.initialPolicy = {
          finalizeInstructionCount: finalizePrepared?.instructions.length ?? 0,
          finalizePacketLength: finalizePrepared
            ? preparedPacketLength(finalizePrepared)
            : null,
          instructionCount: preparedPolicy.prepared.instructions.length,
          packetLength: preparedPacketLength(preparedPolicy.prepared),
          policyUniverse: EARN_POLICY_UNIVERSE,
          preparedTarget: preparedTargetEvidence(preparedPolicy),
          persistence: preparedPolicy.persistence,
          status: "skipped",
          setupPolicy: preparedPolicy.setupPolicy,
          setupPacketLength: preparedPacketLength(finalizePrepared),
          setupPolicyUnsignedSimulationSkippedReason:
            setupPolicySimulationSkippedReason,
          unsignedSimulationLogs: unsignedPolicySimulationLogs.slice(-12),
        };
        await writeEvidence(evidence);
        return;
      }

      const sentPolicy = await sendOrResumePrepared({
        connection,
        prepared: preparedPolicy.prepared,
        resumeSignature: null,
        resumeSlot: null,
        wallet,
      });
      const sentFinalize = finalizePrepared
        ? await sendOrResumePrepared({
            connection,
            prepared: finalizePrepared,
            resumeSignature: null,
            resumeSlot: null,
            wallet,
          })
        : null;
      if (!sentFinalize) {
        throw new Error("Setup policy transaction was not sent.");
      }
      const policySignature = sentPolicy.signature;
      const policySlot = sentPolicy.slot;
      await repository.recordConfirmedYieldRoutePolicy(
        policyInput({
          prepared: preparedPolicy,
          setupSignature: sentFinalize.signature,
          setupSlot: sentFinalize.slot,
          signature: policySignature,
          slot: policySlot,
        })
      );
      initialPolicy = {
        account: preparedPolicy.policy.account,
        persistence: preparedPolicy.persistence,
        seed: preparedPolicy.policy.seed,
        signature: policySignature,
        slot: policySlot,
        setupPolicy: {
          account: preparedPolicy.setupPolicy.account,
          seed: preparedPolicy.setupPolicy.seed,
          signature: sentFinalize.signature,
          slot: sentFinalize.slot,
        },
      };
      evidence.steps.initialPolicy = {
        confirmedFinalizeSlot: sentFinalize?.slot.toString() ?? null,
        confirmedSlot: policySlot.toString(),
        finalizeInstructionCount: finalizePrepared?.instructions.length ?? 0,
        finalizeSignature: sentFinalize?.signature ?? null,
        instructionCount: preparedPolicy.prepared.instructions.length,
        policyUniverse: EARN_POLICY_UNIVERSE,
        preparedTarget: preparedTargetEvidence(preparedPolicy),
        persistence: preparedPolicy.persistence,
        routeConfirmedSlot: policySlot.toString(),
        routeSignature: policySignature,
        setupConfirmedSlot: sentFinalize.slot.toString(),
        setupPolicy: preparedPolicy.setupPolicy,
        signature: policySignature,
        setupSignature: sentFinalize.signature,
        simulationLogs: sentPolicy.simulationLogs.slice(-12),
        finalizeSimulationLogs: sentFinalize?.simulationLogs.slice(-12) ?? [],
        status: "success",
      };
      await writeEvidence(evidence);
    }

    if (!initialPolicy) {
      throw new Error("Initial policy was not prepared or resumed.");
    }

    const prepared = await client.prepareEarnUsdcDeposit({
      amountRaw: FIRST_DEPOSIT_RAW,
      cluster: LoyalCluster.MainnetBeta,
      feePayer: wallet.publicKey,
      initializeYieldRoutingPolicy: false,
      policySigner,
      settingsPda: SETTINGS_PDA,
      walletAddress: wallet.publicKey,
      yieldRoutingPolicy: {
        account: initialPolicy.account,
        seed: initialPolicy.seed,
        setupPolicy: {
          account: initialPolicy.setupPolicy.account,
          seed: initialPolicy.setupPolicy.seed,
        },
      },
    });
    assertSafePolicyUniverse(prepared.persistence);

    const sent = await sendOrResumePrepared({
      connection,
      prepared: prepared.prepared,
      resumeSignature: RESUME_INITIAL_DEPOSIT_SIGNATURE,
      resumeSlot: RESUME_INITIAL_DEPOSIT_SLOT,
      wallet,
    });
    const kaminoDeposit = await loadKaminoDepositEvidence({
      connection,
      signature: sent.signature,
    });
    if (
      !kaminoDeposit.initObligationLogged &&
      kaminoDeposit.depositedLiquidityRaw !== FIRST_DEPOSIT_RAW.toString()
    ) {
      throw new Error(
        "Initial deposit transaction did not show Kamino setup or deposit."
      );
    }
    const position = await repository.recordConfirmedYieldDeposit(
      depositInput({
        policyInitialization: "create",
        policyConfirmedSlot: initialPolicy.slot,
        policySignature: initialPolicy.signature,
        prepared,
        setupPolicyConfirmedSlot: initialPolicy.setupPolicy.slot,
        setupPolicySignature: initialPolicy.setupPolicy.signature,
        signature: sent.signature,
        slot: sent.slot,
      })
    );
    evidence.steps.initialDeposit = {
      amountRaw: FIRST_DEPOSIT_RAW.toString(),
      confirmedSlot: sent.slot.toString(),
      instructionCount: prepared.prepared.instructions.length,
      kaminoDeposit,
      kaminoSetupAccountCount: prepared.kaminoSetupAccountCount,
      kaminoSetupRentLamports: prepared.kaminoSetupRentLamports,
      kaminoSetupRequired: prepared.kaminoSetupRequired,
      policyUniverse: EARN_POLICY_UNIVERSE,
      preparedTarget: preparedTargetEvidence(prepared),
      persistence: { position: compactPosition(position) },
      signature: sent.signature,
      simulationLogs: sent.simulationLogs.slice(-12),
      status: "success",
    };

    const postState = await loadState({
      connection,
      policyAccount: prepared.policy.account,
      setupPolicyAccount: prepared.setupPolicy?.account ?? null,
      schema,
      vaultCollateralAta:
        prepared.vault.collateralAta ??
        (kaminoDeposit.reserveCollateralSupplyAccount
          ? new PublicKey(kaminoDeposit.reserveCollateralSupplyAccount)
          : null),
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    evidence.postState = postState;
    const preWalletUsdc = BigInt(preState.tokenBalances.walletUsdcRaw ?? "0");
    const postWalletUsdc = BigInt(postState.tokenBalances.walletUsdcRaw ?? "0");
    if (
      !RESUME_INITIAL_DEPOSIT_SIGNATURE &&
      preWalletUsdc - postWalletUsdc !== FIRST_DEPOSIT_RAW
    ) {
      throw new Error(
        "Wallet USDC delta did not match initial deposit amount."
      );
    }
    if (!postState.accounts.policy) {
      throw new Error("Earn policy account was not created.");
    }
    if (!postState.accounts.setupPolicy) {
      throw new Error("Earn setup policy account was not created.");
    }
    if (
      prepared.vault.collateralAta &&
      !postState.accounts.vaultCollateralAta
    ) {
      throw new Error("Vault Kamino collateral ATA was not created.");
    }
    if (
      !prepared.vault.collateralAta &&
      (!kaminoDeposit.initObligationLogged ||
        kaminoDeposit.depositedLiquidityRaw !== FIRST_DEPOSIT_RAW.toString())
    ) {
      throw new Error("Kamino deposit/setup evidence was not found.");
    }
    const postPosition = postState.db.position as {
      currentAmountRaw?: bigint;
      principalAmountRaw?: bigint;
      status?: string;
    } | null;
    if (
      postPosition?.status !== "active" ||
      postPosition.principalAmountRaw !== FIRST_DEPOSIT_RAW ||
      postPosition.currentAmountRaw !== FIRST_DEPOSIT_RAW
    ) {
      throw new Error(
        "Initial deposit did not create the expected active position."
      );
    }
    const routePolicy = postState.db.routePolicy as { active?: boolean } | null;
    const setupPolicy = postState.db.setupPolicy as { active?: boolean } | null;
    const managedVault = postState.db.managedVault as {
      active?: boolean;
      setupPolicyId?: bigint | null;
    } | null;
    if (
      !routePolicy?.active ||
      !setupPolicy?.active ||
      !managedVault?.active ||
      typeof managedVault?.setupPolicyId !== "bigint"
    ) {
      throw new Error(
        "Initial deposit did not activate route/setup policy and vault DB rows."
      );
    }
    evidence.verifierFailures = await assertNoVerifierFailures({
      settings: SETTINGS_PDA.toBase58(),
      verifyUserYieldPositions: repository.verifyUserYieldPositions,
    });
    await writeEvidence(evidence);
  }

  async function runSourceLifecycleWithdrawals() {
    if (!frontendSession) {
      throw new Error(
        "source-lifecycle-withdrawals requires an authenticated frontend session."
      );
    }

    await runInitialDepositFromClean();

    const initialPosition = await fetchEarnPositionViaFrontend({
      session: frontendSession,
    });
    const initialHoldings = readEarnHoldings(initialPosition);
    const initialKaminoHolding = requireSingleEarnHolding({
      holdings: initialHoldings,
      kind: "kamino",
      label: "after initial deposit",
    });
    evidence.steps.sourceLifecycleInitialHolding = {
      amountRaw: initialKaminoHolding.amountRaw,
      persistence: {
        holding: initialKaminoHolding,
        holdings: initialHoldings,
      },
      sendsTransactions: false,
      status: "success",
    };
    await writeEvidence(evidence);

    const preIdleFundingVaultUsdcRaw = await tokenAmount(
      connection,
      vaultUsdcAta
    );
    const idleFunding = await sendOrResumeUsdcTransfer({
      amountRaw: IDLE_FUNDING_RAW,
      connection,
      destinationAta: vaultUsdcAta,
      mint: EARN_TARGET.liquidityMint,
      resumeSignature: RESUME_IDLE_FUNDING_SIGNATURE,
      resumeSlot: RESUME_IDLE_FUNDING_SLOT,
      sourceAta: walletUsdcAta,
      wallet: walletKeypair,
    });
    const postIdleFundingVaultUsdcRaw = await tokenAmount(
      connection,
      vaultUsdcAta
    );
    const reconcileResult = await reconcileEarnPositionViaFrontend({
      force: true,
      session: frontendSession,
    });
    const positionAfterIdleFunding = await fetchEarnPositionViaFrontend({
      session: frontendSession,
    });
    const holdingsAfterIdleFunding = readEarnHoldings(positionAfterIdleFunding);
    const idleHolding = requireSingleEarnHolding({
      holdings: holdingsAfterIdleFunding,
      kind: "idle",
      label: "after idle funding",
    });
    const kaminoHoldingAfterIdleFunding = requireSingleEarnHolding({
      holdings: holdingsAfterIdleFunding,
      kind: "kamino",
      label: "after idle funding",
    });
    if (BigInt(idleHolding.amountRaw) !== IDLE_FUNDING_RAW) {
      throw new Error(
        `Idle holding mismatch: expected ${IDLE_FUNDING_RAW}, got ${idleHolding.amountRaw}.`
      );
    }
    evidence.steps.idleFunding = {
      amountRaw: IDLE_FUNDING_RAW.toString(),
      confirmedSlot: idleFunding.slot.toString(),
      persistence: {
        holdings: holdingsAfterIdleFunding,
        idleHolding,
        kaminoHolding: kaminoHoldingAfterIdleFunding,
        postVaultUsdcRaw: postIdleFundingVaultUsdcRaw,
        preVaultUsdcRaw: preIdleFundingVaultUsdcRaw,
        reconcileResult,
      },
      sendsTransactions: true,
      signature: idleFunding.signature,
      simulationLogs: idleFunding.simulationLogs.slice(-12),
      status: "success",
    };
    await writeEvidence(evidence);

    const idleSource = withdrawSourceFromHolding(idleHolding);
    let idlePrepared: SmartAccountPreparedEarnUsdcWithdraw;
    try {
      idlePrepared = await prepareEarnWithdrawViaFrontend({
        amountRaw: BigInt(idleHolding.amountRaw),
        mode: "full",
        session: frontendSession,
        source: idleSource,
      });
    } catch (error) {
      evidence.steps.idleWithdrawal = {
        amountRaw: idleHolding.amountRaw,
        error: error instanceof Error ? error.message : String(error),
        persistence: {
          customError: decodeCustomProgramError(error),
          frontendError: frontendRequestErrorEvidence(error),
          holdingsBeforeWithdraw: holdingsAfterIdleFunding,
          source: idleSource,
        },
        sendsTransactions: false,
        status: "failed",
        unsignedSimulationLogs: extractSimulationLogEvidence(error),
      };
      await writeEvidence(evidence);
      throw error;
    }
    assertPreparedSourceMetadata({
      label: "idle",
      prepared: idlePrepared,
      source: idleSource,
    });
    const idleSent = await sendOrResumePrepared({
      connection,
      prepared: idlePrepared.prepared,
      resumeSignature: RESUME_IDLE_WITHDRAW_SIGNATURE,
      resumeSlot: RESUME_IDLE_WITHDRAW_SLOT,
      wallet,
    });
    const idleConfirmArgs = {
      confirmedSlot: idleSent.slot,
      prepared: idlePrepared,
      session: frontendSession,
      signature: idleSent.signature,
    };
    const idleConfirmPosition = await confirmEarnWithdrawViaFrontend(
      idleConfirmArgs
    );
    const idleIdempotency = await verifyWithdrawConfirmReplayAndFailures({
      ...idleConfirmArgs,
      label: "idle source withdrawal confirm",
    });
    const postIdleState = await loadState({
      connection,
      policyAccount: idlePrepared.policy.account,
      setupPolicyAccount: idlePrepared.setupPolicy?.account ?? null,
      schema,
      vaultCollateralAta: idlePrepared.vault.collateralAta,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    const postIdleReserveRows = getArrayField(
      postIdleState.db,
      "currentReserveRows"
    );
    const postIdleIdleRows = getArrayField(postIdleState.db, "currentIdleRows");
    if (
      !postIdleReserveRows.some(
        (row) =>
          getStringField(row, "reserve") ===
            kaminoHoldingAfterIdleFunding.reserve &&
          (getRawAmountField(row, "amountRaw") ?? 0n) > 0n
      )
    ) {
      throw new Error(
        "Idle withdrawal did not preserve the Kamino reserve row."
      );
    }
    if (
      postIdleIdleRows.some(
        (row) => (getRawAmountField(row, "amountRaw") ?? 0n) > 0n
      )
    ) {
      throw new Error("Idle withdrawal did not zero idle vault USDC rows.");
    }
    const postIdleManagedVault = asRecord(postIdleState.db.managedVault);
    const postIdleRoutePolicy = asRecord(postIdleState.db.routePolicy);
    const postIdleSetupPolicy = asRecord(postIdleState.db.setupPolicy);
    if (
      postIdleManagedVault?.active !== true ||
      postIdleRoutePolicy?.active !== true ||
      postIdleSetupPolicy?.active !== true ||
      !postIdleState.accounts.vaultUsdcAta
    ) {
      throw new Error(
        "Idle source withdrawal incorrectly deactivated policies or closed the vault USDC ATA."
      );
    }
    evidence.steps.idleWithdrawal = {
      amountRaw: idleHolding.amountRaw,
      confirmedSlot: idleSent.slot.toString(),
      duplicateConfirm: idleIdempotency.replay,
      instructionCount: idlePrepared.prepared.instructions.length,
      negativeCases: {
        metadataMismatch: idleIdempotency.metadataMismatch,
        missingSession: idleIdempotency.missingSession,
      },
      persistence: {
        position: compactPosition(idleConfirmPosition),
        postState: postIdleState,
        prepared: idlePrepared.persistence,
        source: idleSource,
      },
      preparedTarget: preparedTargetEvidence(idlePrepared),
      sendsTransactions: true,
      signature: idleSent.signature,
      simulationLogs: idleSent.simulationLogs.slice(-12),
      status: "success",
    };
    await writeEvidence(evidence);

    const positionAfterIdleWithdrawal = await fetchEarnPositionViaFrontend({
      session: frontendSession,
    });
    const holdingsAfterIdleWithdrawal = readEarnHoldings(
      positionAfterIdleWithdrawal
    );
    const remainingReserveHolding = requireSingleEarnHolding({
      holdings: holdingsAfterIdleWithdrawal,
      kind: "kamino",
      label: "after idle withdrawal",
    });
    const reserveSource = withdrawSourceFromHolding(remainingReserveHolding);
    let reservePrepared: SmartAccountPreparedEarnUsdcWithdraw;
    try {
      reservePrepared = await prepareEarnWithdrawViaFrontend({
        amountRaw: BigInt(remainingReserveHolding.amountRaw),
        mode: "full",
        session: frontendSession,
        source: reserveSource,
      });
    } catch (error) {
      evidence.steps.reserveWithdrawal = {
        amountRaw: remainingReserveHolding.amountRaw,
        error: error instanceof Error ? error.message : String(error),
        persistence: {
          customError: decodeCustomProgramError(error),
          dbActiveFlags: {
            managedVaultActive: postIdleManagedVault?.active ?? null,
            routePolicyActive: postIdleRoutePolicy?.active ?? null,
            setupPolicyActive: postIdleSetupPolicy?.active ?? null,
          },
          holdingsBeforeWithdraw: holdingsAfterIdleWithdrawal,
          frontendError: frontendRequestErrorEvidence(error),
          policyAccount: postIdleRoutePolicy?.policyAccount ?? null,
          setupPolicyAccount: postIdleSetupPolicy?.policyAccount ?? null,
          settings: SETTINGS_PDA.toBase58(),
          source: reserveSource,
          vault: vaultPubkey.toBase58(),
          vaultUsdcAta: vaultUsdcAta.toBase58(),
        },
        sendsTransactions: false,
        status: "failed",
        unsignedSimulationLogs: extractSimulationLogEvidence(error),
      };
      await writeEvidence(evidence);
      throw error;
    }
    assertPreparedSourceMetadata({
      label: "reserve",
      prepared: reservePrepared,
      source: reserveSource,
    });
    const preReserveState = await loadState({
      connection,
      policyAccount: reservePrepared.policy.account,
      setupPolicyAccount: reservePrepared.setupPolicy?.account ?? null,
      schema,
      vaultCollateralAta: reservePrepared.vault.collateralAta,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    const reserveSent = await sendOrResumePrepared({
      connection,
      prepared: reservePrepared.prepared,
      resumeSignature: RESUME_RESERVE_WITHDRAW_SIGNATURE,
      resumeSlot: RESUME_RESERVE_WITHDRAW_SLOT,
      wallet,
    });
    const reserveConfirmArgs = {
      confirmedSlot: reserveSent.slot,
      prepared: reservePrepared,
      session: frontendSession,
      signature: reserveSent.signature,
    };
    const reserveConfirmPosition = await confirmEarnWithdrawViaFrontend(
      reserveConfirmArgs
    );
    const reserveIdempotency = await verifyWithdrawConfirmReplayAndFailures({
      ...reserveConfirmArgs,
      label: "reserve source withdrawal confirm",
    });
    const postReserveState = await loadState({
      connection,
      policyAccount: reservePrepared.policy.account,
      setupPolicyAccount: reservePrepared.setupPolicy?.account ?? null,
      schema,
      vaultCollateralAta: reservePrepared.vault.collateralAta,
      vaultPubkey,
      vaultUsdcAta,
      walletAddress: wallet.publicKey,
      walletUsdcAta,
      yieldClient,
    });
    const reserveTransactionFee = await resolveTransactionFeeLamports({
      connection,
      signature: reserveSent.signature,
    });
    const expectedRent =
      BigInt(preReserveState.accounts.policy?.lamports ?? 0) +
      BigInt(preReserveState.accounts.setupPolicy?.lamports ?? 0) +
      BigInt(preReserveState.accounts.vaultUsdcAta?.lamports ?? 0) +
      (reservePrepared.persistence.vaultCollateralCleanupIncluded
        ? BigInt(preReserveState.accounts.vaultCollateralAta?.lamports ?? 0)
        : 0n);
    const preReserveSol = BigInt(
      preReserveState.accounts.wallet?.lamports ?? 0
    );
    const postReserveSol = BigInt(
      postReserveState.accounts.wallet?.lamports ?? 0
    );
    if (
      postReserveSol +
        reserveTransactionFee +
        BigInt(RENT_REFUND_ROUNDING_ALLOWANCE_LAMPORTS) <
      preReserveSol + expectedRent
    ) {
      throw new Error(
        "Final reserve withdrawal did not show expected rent refund."
      );
    }
    if (
      postReserveState.accounts.policy ||
      postReserveState.accounts.setupPolicy ||
      postReserveState.accounts.vaultUsdcAta
    ) {
      throw new Error(
        "Final reserve withdrawal did not close policy/vault accounts."
      );
    }
    const postReservePosition = postReserveState.db.position as {
      currentAmountRaw?: bigint;
      principalAmountRaw?: bigint;
      status?: string;
    } | null;
    if (
      postReservePosition?.status !== "closed" ||
      postReservePosition.currentAmountRaw !== 0n ||
      postReservePosition.principalAmountRaw !== 0n
    ) {
      throw new Error(
        "Final reserve withdrawal did not close the Earn position."
      );
    }
    assertNoPositionActive(postReserveState);
    evidence.steps.reserveWithdrawal = {
      amountRaw: remainingReserveHolding.amountRaw,
      cleanupCandidates: fullWithdrawCleanupCandidates(reservePrepared),
      confirmedSlot: reserveSent.slot.toString(),
      duplicateConfirm: reserveIdempotency.replay,
      instructionCount: reservePrepared.prepared.instructions.length,
      negativeCases: {
        metadataMismatch: reserveIdempotency.metadataMismatch,
        missingSession: reserveIdempotency.missingSession,
      },
      persistence: {
        position: compactPosition(reserveConfirmPosition),
        postState: postReserveState,
        prepared: reservePrepared.persistence,
        preState: preReserveState,
        source: reserveSource,
      },
      preparedTarget: preparedTargetEvidence(reservePrepared),
      sendsTransactions: true,
      signature: reserveSent.signature,
      simulationLogs: reserveSent.simulationLogs.slice(-12),
      status: "success",
      rentRefundMath: {
        allowanceLamports: RENT_REFUND_ROUNDING_ALLOWANCE_LAMPORTS.toString(),
        expectedRentLamports: expectedRent.toString(),
        observedWalletDeltaLamports: (
          postReserveSol - preReserveSol
        ).toString(),
        postWalletLamports: postReserveSol.toString(),
        preWalletLamports: preReserveSol.toString(),
        transactionFeeLamports: reserveTransactionFee.toString(),
        walletDeltaPlusFeeLamports: (
          postReserveSol -
          preReserveSol +
          reserveTransactionFee
        ).toString(),
      },
      transactionFeeLamports: reserveTransactionFee.toString(),
    };
    evidence.postState = postReserveState;
    evidence.verifierFailures = await assertNoVerifierFailures({
      settings: SETTINGS_PDA.toBase58(),
      verifyUserYieldPositions: repository.verifyUserYieldPositions,
    });
    await writeEvidence(evidence);
  }

  async function runSameMintYieldMonitorPickup() {
    const command = sameMintMonitorCommand({ execute: !DRY_RUN });

    if (DRY_RUN) {
      evidence.steps.orchestratorPickup = {
        command: command.join(" "),
        reason:
          "Dry-run records the same-mint fleet monitor command but does not execute route transactions.",
        sendsTransactions: false,
        status: "skipped",
      };
      await writeEvidence(evidence);
      return;
    }

    const result = await runCommandCapture({
      command,
      cwd: YIELD_ROUTING_REPO,
      env: { SQLX_OFFLINE: "true" },
    });
    let stdoutJson: unknown = null;
    try {
      stdoutJson = parseCommandJson(result.stdout, "same-mint-yield-monitor");
    } catch (error) {
      evidence.steps.orchestratorPickup = {
        command: command.join(" "),
        compileEnv: { SQLX_OFFLINE: "true" },
        exitCode: result.exitCode,
        parseError: error instanceof Error ? error.message : String(error),
        sendsTransactions: true,
        status: "failed",
        stderr: result.stderr.slice(-8_000),
        stdout: result.stdout.slice(-12_000),
      };
      await writeEvidence(evidence);
      throw error;
    }
    const selectedResult =
      result.exitCode === 0
        ? (() => {
            try {
              return assertSelectedFleetMonitorExecuted(stdoutJson, {
                settings: SETTINGS_PDA,
                vaultIndex: 1,
                vaultPubkey,
              });
            } catch {
              return null;
            }
          })()
        : null;
    evidence.steps.orchestratorPickup = {
      command: command.join(" "),
      compileEnv: { SQLX_OFFLINE: "true" },
      exitCode: result.exitCode,
      sendsTransactions: true,
      selectedResult: selectedResult
        ? summarizeMonitorResult(selectedResult)
        : null,
      status: result.exitCode === 0 && selectedResult ? "success" : "failed",
      stderr: result.stderr.slice(-8_000),
      stdout: result.stdout.slice(-12_000),
      stdoutJson,
    };
    await writeEvidence(evidence);

    if (result.exitCode !== 0) {
      throw new Error(
        `same-mint-yield-monitor failed with exit ${result.exitCode}.`
      );
    }
    const executedResult = assertSelectedFleetMonitorExecuted(stdoutJson, {
      settings: SETTINGS_PDA,
      vaultIndex: 1,
      vaultPubkey,
    });

    const reconciled = await findActiveVerifierPosition();
    evidence.steps.orchestratorPickup = {
      ...evidence.steps.orchestratorPickup,
      selectedResult: summarizeMonitorResult(executedResult),
      persistence: { position: compactPosition(reconciled) },
    };
    await writeEvidence(evidence);
  }

  async function runTargetObligationSetup() {
    const candidateRanking = await loadTopSafeUsdcCandidateEvidence();
    const topCandidate = candidateRanking[0];
    if (!topCandidate) {
      throw new Error(
        "target obligation setup requires a Safe USDC candidate."
      );
    }

    if (topCandidate.reserve === EARN_TARGET.reserve.toBase58()) {
      evidence.steps.targetObligationSetup = {
        persistence: { candidateRanking, selectedReserve: topCandidate },
        reason:
          "The highest-ranked Safe USDC reserve is already the initial Main USDC reserve.",
        sendsTransactions: false,
        status: "skipped",
      };
      await writeEvidence(evidence);
      return;
    }

    const command = sameMintReserveSwapSetupObligationCommand({
      execute: !DRY_RUN,
      reserve: topCandidate.reserve,
    });
    if (DRY_RUN) {
      evidence.steps.targetObligationSetup = {
        command: command.join(" "),
        persistence: { candidateRanking, selectedReserve: topCandidate },
        reason:
          "Dry-run records the setup/admin command for the target Safe reserve but does not send it.",
        sendsTransactions: false,
        status: "skipped",
      };
      await writeEvidence(evidence);
      return;
    }

    const result = await runCommandCapture({
      command,
      cwd: YIELD_ROUTING_REPO,
      env: { SQLX_OFFLINE: "true" },
    });
    let stdoutJson: unknown = null;
    try {
      stdoutJson = parseCommandJson(
        result.stdout,
        "same-mint-reserve-swap setup obligation"
      );
    } catch (error) {
      evidence.steps.targetObligationSetup = {
        command: command.join(" "),
        compileEnv: { SQLX_OFFLINE: "true" },
        exitCode: result.exitCode,
        parseError: error instanceof Error ? error.message : String(error),
        persistence: { candidateRanking, selectedReserve: topCandidate },
        sendsTransactions: true,
        status: "failed",
        stderr: result.stderr.slice(-8_000),
        stdout: result.stdout.slice(-12_000),
      };
      await writeEvidence(evidence);
      throw error;
    }

    const setupStatus =
      typeof stdoutJson === "object" &&
      stdoutJson !== null &&
      "status" in stdoutJson
        ? String((stdoutJson as { status?: unknown }).status)
        : null;
    const setupSucceeded =
      result.exitCode === 0 &&
      (setupStatus === "setup_obligation_reserve_executed" ||
        setupStatus === "setup_obligation_reserve_skipped_existing");

    evidence.steps.targetObligationSetup = {
      command: command.join(" "),
      compileEnv: { SQLX_OFFLINE: "true" },
      exitCode: result.exitCode,
      persistence: { candidateRanking, selectedReserve: topCandidate },
      sendsTransactions: true,
      status: setupSucceeded ? "success" : "failed",
      stderr: result.stderr.slice(-8_000),
      stdout: result.stdout.slice(-12_000),
      stdoutJson,
    };
    await writeEvidence(evidence);

    if (!setupSucceeded) {
      throw new Error(
        `same-mint-reserve-swap setup obligation failed with status ${
          setupStatus ?? "unknown"
        } and exit ${result.exitCode}.`
      );
    }
  }

  async function runPostCleanupFleetPoll() {
    const command = sameMintMonitorCommand({ execute: false });
    const result = await runCommandCapture({
      command,
      cwd: YIELD_ROUTING_REPO,
      env: { SQLX_OFFLINE: "true" },
    });
    const stdoutJson =
      result.exitCode === 0
        ? parseCommandJson(
            result.stdout,
            "post-cleanup same-mint-yield-monitor"
          )
        : null;
    const discoveredSelectedVault = stdoutJson
      ? Boolean(
          findSelectedFleetMonitorResult(stdoutJson, {
            settings: SETTINGS_PDA,
            vaultIndex: 1,
            vaultPubkey,
          })
        )
      : false;
    evidence.steps.postCleanupFleetPoll = {
      command: command.join(" "),
      compileEnv: { SQLX_OFFLINE: "true" },
      exitCode: result.exitCode,
      reason: discoveredSelectedVault
        ? "Fleet poll still mentioned the selected Earn vault after cleanup."
        : "Fleet poll did not mention the selected Earn vault after cleanup.",
      sendsTransactions: false,
      status:
        result.exitCode === 0 && !discoveredSelectedVault
          ? "success"
          : "failed",
      stderr: result.stderr.slice(-8_000),
      stdout: result.stdout.slice(-12_000),
      stdoutJson,
    };
    await writeEvidence(evidence);

    if (result.exitCode !== 0) {
      throw new Error(
        `post-cleanup same-mint-yield-monitor poll failed with exit ${result.exitCode}.`
      );
    }
    if (discoveredSelectedVault) {
      throw new Error(
        "Post-cleanup fleet poll still discovered the selected Earn vault."
      );
    }
  }

  async function runTopUpPartialSmoke(
    options: { includePartialWithdrawal?: boolean } = {
      includePartialWithdrawal: true,
    }
  ) {
    const activePolicyPair = await repository.findActiveYieldRoutePolicyPair({
      authority: wallet.publicKey.toBase58(),
      cluster: LoyalCluster.MainnetBeta,
      settings: SETTINGS_PDA.toBase58(),
      vaultIndex: 1,
      vaultPubkey: vaultPubkey.toBase58(),
    });
    const activeRoutePolicy = activePolicyPair?.routePolicy ?? null;
    if (!activeRoutePolicy) {
      throw new Error("top-up-partial-smoke requires an active Earn policy.");
    }
    const before = await findActiveVerifierPosition();
    if (!before) {
      throw new Error("top-up-partial-smoke requires an active Earn position.");
    }
    if (!before.currentMarket) {
      throw new Error("Active Earn position is missing current market.");
    }
    const candidateRanking = await loadTopSafeUsdcCandidateEvidence();

    const topUp = frontendSession
      ? await prepareEarnDepositViaFrontend({
          amountRaw: TOP_UP_DEPOSIT_RAW,
          session: frontendSession,
        })
      : await client.prepareEarnUsdcDeposit({
          amountRaw: TOP_UP_DEPOSIT_RAW,
          cluster: LoyalCluster.MainnetBeta,
          feePayer: wallet.publicKey,
          initializeYieldRoutingPolicy: false,
          policySigner,
          settingsPda: SETTINGS_PDA,
          target: {
            liquidityMint: new PublicKey(before.currentLiquidityMint),
            market: new PublicKey(before.currentMarket),
            reserve: new PublicKey(before.currentReserve),
            supplyApyBps: null,
          },
          walletAddress: wallet.publicKey,
          yieldRoutingPolicy: {
            account: new PublicKey(activeRoutePolicy.policyAccount),
            seed: activeRoutePolicy.policySeed,
            ...(activePolicyPair?.setupPolicy
              ? {
                  setupPolicy: {
                    account: new PublicKey(
                      activePolicyPair.setupPolicy.policyAccount
                    ),
                    seed: activePolicyPair.setupPolicy.policySeed,
                  },
                }
              : {}),
          },
        });
    assertSafePolicyUniverse(topUp.persistence);
    if (DRY_RUN) {
      const unsignedSimulationLogs = await simulatePreparedUnsigned({
        connection,
        label: "top-up deposit",
        prepared: topUp.prepared,
      });
      evidence.steps.topUpDeposit = {
        amountRaw: TOP_UP_DEPOSIT_RAW.toString(),
        instructionCount: topUp.prepared.instructions.length,
        kaminoSetupAccountCount: topUp.kaminoSetupAccountCount,
        kaminoSetupRentLamports: topUp.kaminoSetupRentLamports,
        kaminoSetupRequired: topUp.kaminoSetupRequired,
        policyUniverse: EARN_POLICY_UNIVERSE,
        preparedTarget: preparedTargetEvidence(topUp),
        persistence: {
          candidateRanking,
          prepared: topUp.persistence,
        },
        sendsTransactions: false,
        status: "skipped",
        unsignedSimulationLogs: unsignedSimulationLogs.slice(-12),
      };
      await writeEvidence(evidence);
      if (!options.includePartialWithdrawal) {
        return;
      }
    } else {
      const topUpSent = await sendOrResumePrepared({
        connection,
        prepared: topUp.prepared,
        resumeSignature: RESUME_TOP_UP_DEPOSIT_SIGNATURE,
        resumeSlot: RESUME_TOP_UP_DEPOSIT_SLOT,
        wallet,
      });
      const topUpConfirmArgs = {
        confirmedSlot: topUpSent.slot,
        policySignature: activeRoutePolicy.lastSeenSignature,
        prepared: topUp,
        session: frontendSession as FrontendSession,
        signature: topUpSent.signature,
      };
      await (frontendSession
        ? confirmEarnDepositViaFrontend(topUpConfirmArgs)
        : repository.recordConfirmedYieldDeposit(
            depositInput({
              policySignature: activeRoutePolicy.lastSeenSignature,
              prepared: topUp,
              signature: topUpSent.signature,
              slot: topUpSent.slot,
            })
          ));
      const idempotency =
        frontendSession &&
        (await verifyDepositConfirmReplayAndFailures({
          ...topUpConfirmArgs,
          label: "top-up deposit confirm",
        }));
      evidence.steps.topUpDeposit = {
        amountRaw: TOP_UP_DEPOSIT_RAW.toString(),
        confirmedSlot: topUpSent.slot.toString(),
        duplicateConfirm: idempotency ? idempotency.replay : undefined,
        instructionCount: topUp.prepared.instructions.length,
        negativeCases: idempotency
          ? {
              metadataMismatch: idempotency.metadataMismatch,
              missingSession: idempotency.missingSession,
            }
          : undefined,
        policyUniverse: EARN_POLICY_UNIVERSE,
        preparedTarget: preparedTargetEvidence(topUp),
        persistence: {
          candidateRanking,
          prepared: topUp.persistence,
        },
        sendsTransactions: true,
        signature: topUpSent.signature,
        simulationLogs: topUpSent.simulationLogs.slice(-12),
        status: "success",
      };
      if (!options.includePartialWithdrawal) {
        evidence.verifierFailures = await assertNoVerifierFailures({
          settings: SETTINGS_PDA.toBase58(),
          verifyUserYieldPositions: repository.verifyUserYieldPositions,
        });
        await writeEvidence(evidence);
        return;
      }
    }

    const partial = frontendSession
      ? await prepareEarnWithdrawViaFrontend({
          amountRaw: PARTIAL_WITHDRAW_RAW,
          mode: "partial",
          session: frontendSession,
        })
      : await client.prepareEarnUsdcWithdraw({
          amountRaw: PARTIAL_WITHDRAW_RAW,
          cluster: LoyalCluster.MainnetBeta,
          feePayer: wallet.publicKey,
          mode: "partial",
          policySigner,
          settingsPda: SETTINGS_PDA,
          walletAddress: wallet.publicKey,
          yieldRoutingPolicy: {
            account: new PublicKey(activeRoutePolicy.policyAccount),
            seed: activeRoutePolicy.policySeed,
            ...(activePolicyPair?.setupPolicy
              ? {
                  setupPolicy: {
                    account: new PublicKey(
                      activePolicyPair.setupPolicy.policyAccount
                    ),
                    seed: activePolicyPair.setupPolicy.policySeed,
                  },
                }
              : {}),
          },
        });
    if (DRY_RUN) {
      const unsignedSimulationLogs = await simulatePreparedUnsigned({
        connection,
        label: "partial withdrawal",
        prepared: partial.prepared,
      });
      evidence.steps.partialWithdrawal = {
        amountRaw: PARTIAL_WITHDRAW_RAW.toString(),
        instructionCount: partial.prepared.instructions.length,
        preparedTarget: preparedTargetEvidence(partial),
        persistence: partial.persistence,
        sendsTransactions: false,
        status: "skipped",
        unsignedSimulationLogs: unsignedSimulationLogs.slice(-12),
      };
      await writeEvidence(evidence);
      return;
    }

    const partialSent = await sendOrResumePrepared({
      connection,
      prepared: partial.prepared,
      resumeSignature: RESUME_PARTIAL_WITHDRAW_SIGNATURE,
      resumeSlot: RESUME_PARTIAL_WITHDRAW_SLOT,
      wallet,
    });
    const partialConfirmArgs = {
      confirmedSlot: partialSent.slot,
      prepared: partial,
      session: frontendSession as FrontendSession,
      signature: partialSent.signature,
    };
    const after = frontendSession
      ? await confirmEarnWithdrawViaFrontend(partialConfirmArgs)
      : await repository.recordConfirmedYieldWithdrawal(
          withdrawalInput({
            prepared: partial,
            signature: partialSent.signature,
            slot: partialSent.slot,
          })
        );
    const idempotency =
      frontendSession &&
      (await verifyWithdrawConfirmReplayAndFailures({
        ...partialConfirmArgs,
        label: "partial withdrawal confirm",
      }));
    evidence.steps.partialWithdrawal = {
      amountRaw: PARTIAL_WITHDRAW_RAW.toString(),
      confirmedSlot: partialSent.slot.toString(),
      duplicateConfirm: idempotency ? idempotency.replay : undefined,
      instructionCount: partial.prepared.instructions.length,
      negativeCases: idempotency
        ? {
            metadataMismatch: idempotency.metadataMismatch,
            missingSession: idempotency.missingSession,
          }
        : undefined,
      preparedTarget: preparedTargetEvidence(partial),
      persistence: { position: compactPosition(after) },
      sendsTransactions: true,
      signature: partialSent.signature,
      simulationLogs: partialSent.simulationLogs.slice(-12),
      status: "success",
    };
    const expected =
      before.principalAmountRaw + TOP_UP_DEPOSIT_RAW - PARTIAL_WITHDRAW_RAW;
    const actualPrincipal = readPositionPrincipalAmountRaw(after);
    if (actualPrincipal !== expected) {
      throw new Error(
        `Top-up/partial principal mismatch: expected ${expected}, got ${actualPrincipal}`
      );
    }
    evidence.verifierFailures = await assertNoVerifierFailures({
      settings: SETTINGS_PDA.toBase58(),
      verifyUserYieldPositions: repository.verifyUserYieldPositions,
    });
    await writeEvidence(evidence);
  }

  async function runSameMintFrontendSdkLive() {
    if (!frontendSession) {
      throw new Error(
        "same-mint-frontend-sdk-live requires an authenticated frontend session."
      );
    }

    await runInitialDepositFromClean();

    if (DRY_RUN) {
      const candidateRanking = await loadTopSafeUsdcCandidateEvidence();
      const topCandidate = candidateRanking[0];
      evidence.steps.targetObligationSetup = topCandidate
        ? {
            command: sameMintReserveSwapSetupObligationCommand({
              execute: false,
              reserve: topCandidate.reserve,
            }).join(" "),
            persistence: { candidateRanking, selectedReserve: topCandidate },
            reason:
              "Dry-run records the target obligation setup command but does not send it.",
            sendsTransactions: false,
            status: "skipped",
          }
        : {
            persistence: { candidateRanking },
            reason:
              "Dry-run found no Safe USDC candidate for target obligation setup.",
            sendsTransactions: false,
            status: "failed",
          };
      evidence.steps.orchestratorPickup = {
        command: sameMintMonitorCommand({ execute: false }).join(" "),
        reason:
          "Dry-run does not send the initial deposit, so no frontend-created active vault can be picked up.",
        sendsTransactions: false,
        status: "skipped",
      };
      evidence.steps.topUpDeposit = {
        persistence: { candidateRanking },
        reason:
          "Dry-run does not mutate chain or Neon state, so top-up prepare is skipped until a live initial deposit exists.",
        sendsTransactions: false,
        status: "skipped",
      };
      evidence.steps.fullWithdrawal = {
        reason:
          "Dry-run does not mutate chain or Neon state, so full withdrawal is skipped until a live position exists.",
        sendsTransactions: false,
        status: "skipped",
      };
      evidence.steps.postCleanupFleetPoll = {
        command: sameMintMonitorCommand({ execute: false }).join(" "),
        reason:
          "Dry-run performs no cleanup because no live position was created.",
        sendsTransactions: false,
        status: "skipped",
      };
      markDryRunStepsNoSend();
      await writeEvidence(evidence);
      return;
    }

    await runTargetObligationSetup();
    await runSameMintYieldMonitorPickup();
    await runTopUpPartialSmoke({ includePartialWithdrawal: false });
    await runFullWithdrawCleanup();
    await runPostCleanupFleetPoll();
  }

  if (VERIFY_PHASE === "full-withdraw-cleanup" || VERIFY_PHASE === "all") {
    await runFullWithdrawCleanup();
  }
  if (VERIFY_PHASE === "source-lifecycle-withdrawals") {
    await runSourceLifecycleWithdrawals();
  }
  if (
    VERIFY_PHASE === "initial-deposit-from-clean" ||
    VERIFY_PHASE === "initial-deposit-then-withdraw-cleanup" ||
    VERIFY_PHASE === "all"
  ) {
    await runInitialDepositFromClean();
  }
  if (VERIFY_PHASE === "initial-deposit-then-withdraw-cleanup") {
    await runFullWithdrawCleanup();
  }
  if (VERIFY_PHASE === "same-mint-frontend-sdk-live") {
    await runSameMintFrontendSdkLive();
  }
  if (VERIFY_PHASE === "top-up-partial-smoke" || VERIFY_PHASE === "all") {
    await runTopUpPartialSmoke({
      includePartialWithdrawal:
        process.env.EARN_VERIFY_INCLUDE_PARTIAL_WITHDRAW !== "0",
    });
  }

  console.log("[earn-mainnet] PASS");
  console.log(JSON.stringify(evidence, bigintJson, 2));
}

main().catch((error) => {
  console.error("[earn-mainnet] FAIL", error);
  throw error;
});
