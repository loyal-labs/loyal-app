import { mock } from "bun:test";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  LoyalCluster,
  resolveLoyalClusterForSolanaEnv,
} from "../packages/loyal-actions/src/index.ts";
import {
  combineSmartAccountNativeSolRequirements,
  createSmartAccountVaultsClient,
  sendPreparedBatchWithWallet,
  sendPreparedWithWallet,
  type WalletAdapterLike,
} from "../packages/smart-account-vaults/src/index.ts";
import type {
  SmartAccountNativeSolRequirement,
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
} from "../packages/smart-account-vaults/src/types.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import {
  buildEarnAutodepositCloseConfirmRequestBody,
  buildEarnAutodepositSetupConfirmRequestBody,
  type EarnAutodepositCloseConfirmResponse,
  type EarnAutodepositSetupConfirmResponse,
} from "../frontend/src/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared.ts";
import { PROGRAM_ADDRESS } from "../sdk/loyal-smart-accounts/src/index.ts";

mock.module("server-only", () => ({}));

// Usage:
// op run --env-file=.env.mainnet.1password -- sh -c '\
//   EARN_VERIFY_SOLANA_TESTING_PK="$(cat /path/to/wallet.json)" \
//   EARN_VERIFY_EXPECTED_WALLET_ADDRESS=<wallet> \
//   NEXT_PUBLIC_SOLANA_ENV=mainnet \
//   EARN_VERIFY_FRONTEND_BASE_URL=http://localhost:3000 \
//   bun scripts/verify-earn-autodeposit-mainnet-flow.ts'
//
// This is a live mainnet lifecycle verifier. It mirrors the web UI flow:
// prepare client-side, send setup transactions, POST setup confirmations,
// prepare/send close, POST close confirmation, then verify account cleanup.

type EvidenceStep = {
  accounts?: Record<string, unknown>;
  amountRaw?: string;
  backend?: unknown;
  confirmedSlot?: string;
  endpoint?: string;
  error?: string;
  instructionCount?: number;
  nativeSolRequirement?: SmartAccountNativeSolRequirement | null;
  persistence?: unknown;
  reason?: string;
  signature?: string;
  stage?: SmartAccountPreparedEarnUsdcAutodepositSetup["stage"];
  status: "failed" | "skipped" | "success";
};

type FrontendSession = {
  baseUrl: string;
  cookie: string;
  settingsPda: string;
  smartAccountAddress: string | null;
};

class FrontendRequestError extends Error {
  readonly body: unknown;
  readonly path: string;
  readonly status: number;

  constructor(args: { body: unknown; path: string; status: number }) {
    super(
      `Frontend request ${args.path} failed with ${
        args.status
      }: ${JSON.stringify(args.body)}`
    );
    this.name = "FrontendRequestError";
    this.body = args.body;
    this.path = args.path;
    this.status = args.status;
  }
}

const SOLANA_ENV = resolveSolanaEnv(
  process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV ?? "mainnet"
);
const FRONTEND_BASE_URL =
  process.env.EARN_VERIFY_FRONTEND_BASE_URL?.replace(/\/+$/, "") || null;
const FRONTEND_SESSION_COOKIE =
  process.env.EARN_VERIFY_FRONTEND_COOKIE?.trim() || null;
const FRONTEND_TURNSTILE_TOKEN =
  process.env.EARN_VERIFY_TURNSTILE_TOKEN?.trim() || "local-bypass";
const DRY_RUN = process.env.EARN_AUTODEPOSIT_VERIFY_DRY_RUN === "1";
const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  process.env.RPC_URL ??
  getSolanaEndpoints(SOLANA_ENV).rpcEndpoint;
const PROGRAM_ID = new PublicKey(
  process.env.LOYAL_SMART_ACCOUNTS_PROGRAM_ID ?? PROGRAM_ADDRESS
);
const AMOUNT_RAW = parsePositiveRawAmount(
  process.env.EARN_AUTODEPOSIT_AMOUNT_RAW ?? "10000",
  "EARN_AUTODEPOSIT_AMOUNT_RAW"
);
const WALLET_BALANCE_FLOOR_RAW = parseNonNegativeRawAmount(
  process.env.EARN_AUTODEPOSIT_WALLET_BALANCE_FLOOR_RAW ?? "0",
  "EARN_AUTODEPOSIT_WALLET_BALANCE_FLOOR_RAW"
);
const NONCE =
  process.env.EARN_AUTODEPOSIT_NONCE === undefined
    ? BigInt(Date.now())
    : parsePositiveRawAmount(
        process.env.EARN_AUTODEPOSIT_NONCE,
        "EARN_AUTODEPOSIT_NONCE"
      );
const PERIOD_LENGTH_SECONDS =
  process.env.EARN_AUTODEPOSIT_PERIOD_LENGTH_SECONDS === undefined
    ? undefined
    : parsePositiveRawAmount(
        process.env.EARN_AUTODEPOSIT_PERIOD_LENGTH_SECONDS,
        "EARN_AUTODEPOSIT_PERIOD_LENGTH_SECONDS"
      );
const START_TIMESTAMP =
  process.env.EARN_AUTODEPOSIT_START_TIMESTAMP === undefined
    ? undefined
    : parseNonNegativeRawAmount(
        process.env.EARN_AUTODEPOSIT_START_TIMESTAMP,
        "EARN_AUTODEPOSIT_START_TIMESTAMP"
      );
const EXPIRY_TIMESTAMP =
  process.env.EARN_AUTODEPOSIT_EXPIRY_TIMESTAMP === undefined
    ? undefined
    : parseNonNegativeRawAmount(
        process.env.EARN_AUTODEPOSIT_EXPIRY_TIMESTAMP,
        "EARN_AUTODEPOSIT_EXPIRY_TIMESTAMP"
      );
const REQUESTED_POLICY_SEED =
  process.env.EARN_AUTODEPOSIT_POLICY_SEED === undefined
    ? undefined
    : parsePositiveRawAmount(
        process.env.EARN_AUTODEPOSIT_POLICY_SEED,
        "EARN_AUTODEPOSIT_POLICY_SEED"
      );

function parsePositiveRawAmount(value: string, name: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
    throw new Error(`${name} must be a positive integer raw amount.`);
  }
  return BigInt(value);
}

function parseNonNegativeRawAmount(value: string, name: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer raw amount.`);
  }
  return BigInt(value);
}

function bigintJson(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function loadSecretKeypair(raw: string): Keypair {
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

function loadTestingKeypair(): Keypair {
  const raw =
    process.env.EARN_VERIFY_SOLANA_TESTING_PK ?? process.env.SOLANA_TESTING_PK;
  if (!raw) {
    throw new Error(
      "EARN_VERIFY_SOLANA_TESTING_PK or SOLANA_TESTING_PK is required."
    );
  }

  const keypair = loadSecretKeypair(raw);
  const expectedWallet = process.env.EARN_VERIFY_EXPECTED_WALLET_ADDRESS;
  if (
    expectedWallet &&
    keypair.publicKey.toBase58() !== expectedWallet.trim()
  ) {
    throw new Error(
      `Verifier keypair resolves to ${keypair.publicKey.toBase58()}, expected ${expectedWallet.trim()}.`
    );
  }

  return keypair;
}

function loadDeploymentPolicySignerPublicKey(): PublicKey {
  const publicSigner = process.env.EARN_YIELD_ROUTER_PUBLIC_KEY?.trim();
  if (publicSigner) {
    return new PublicKey(publicSigner);
  }

  const raw = process.env.DEPLOYMENT_PK;
  if (!raw) {
    throw new Error(
      "EARN_YIELD_ROUTER_PUBLIC_KEY or DEPLOYMENT_PK is required."
    );
  }

  const trimmed = raw.trim();
  const bytes = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed))
    : /^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0
    ? Uint8Array.from(
        trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
      )
    : bs58.decode(trimmed);

  return (
    bytes.length === 32 ? Keypair.fromSeed(bytes) : Keypair.fromSecretKey(bytes)
  ).publicKey;
}

function createKeypairWallet(keypair: Keypair): WalletAdapterLike {
  const sign = <T extends Transaction | VersionedTransaction>(
    transaction: T
  ): T => {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([keypair]);
    } else {
      transaction.sign(keypair);
    }
    return transaction;
  };

  return {
    publicKey: keypair.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      transaction: T
    ): Promise<T> {
      return sign(transaction);
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      transactions: T[]
    ): Promise<T[]> {
      return transactions.map((transaction) => sign(transaction));
    },
  };
}

function signWalletAuthMessage(args: {
  keypair: Keypair;
  message: string;
}): string {
  return bs58.encode(
    nacl.sign.detached(
      new TextEncoder().encode(args.message),
      args.keypair.secretKey
    )
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
  path: string
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
  cookie: string;
  path: string;
  session: Pick<FrontendSession, "baseUrl">;
}): Promise<{ body: T; response: Response }> {
  const response = await fetch(`${args.session.baseUrl}${args.path}`, {
    headers: {
      origin: args.session.baseUrl,
      cookie: args.cookie,
    },
    method: "GET",
  });

  return {
    body: await readJsonResponse<T>(response, args.path),
    response,
  };
}

async function authenticateFrontendSession(
  keypair: Keypair
): Promise<FrontendSession> {
  if (!FRONTEND_BASE_URL) {
    throw new Error("EARN_VERIFY_FRONTEND_BASE_URL is required.");
  }

  if (FRONTEND_SESSION_COOKIE) {
    const settingsPda = process.env.EARN_SETTINGS_PDA?.trim();
    if (!settingsPda) {
      throw new Error(
        "EARN_SETTINGS_PDA is required when EARN_VERIFY_FRONTEND_COOKIE is provided."
      );
    }

    return {
      baseUrl: FRONTEND_BASE_URL,
      cookie: FRONTEND_SESSION_COOKIE,
      settingsPda,
      smartAccountAddress: null,
    };
  }

  const challenge = await frontendPostJson<{
    challengeToken: string;
    message: string;
  }>({
    body: {
      turnstileToken: FRONTEND_TURNSTILE_TOKEN,
      walletAddress: keypair.publicKey.toBase58(),
    },
    path: "/api/auth/wallet/challenge",
    session: { baseUrl: FRONTEND_BASE_URL },
  });
  const completion = await frontendPostJson<{
    user?: { settingsPda?: string; smartAccountAddress?: string };
  }>({
    body: {
      challengeToken: challenge.body.challengeToken,
      signature: signWalletAuthMessage({
        keypair,
        message: challenge.body.message,
      }),
    },
    path: "/api/auth/wallet/complete",
    session: { baseUrl: FRONTEND_BASE_URL },
  });

  const settingsPda =
    process.env.EARN_SETTINGS_PDA?.trim() ?? completion.body.user?.settingsPda;
  if (!settingsPda) {
    throw new Error(
      "Authenticated frontend session did not return settingsPda. Set EARN_SETTINGS_PDA."
    );
  }

  return {
    baseUrl: FRONTEND_BASE_URL,
    cookie: extractCookieHeader(completion.response),
    settingsPda,
    smartAccountAddress: completion.body.user?.smartAccountAddress ?? null,
  };
}

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<string> {
  let lastStatus: unknown = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { value } = await args.connection.getSignatureStatuses(
      [args.signature],
      { searchTransactionHistory: true }
    );
    const status = value[0] ?? null;
    lastStatus = status;
    if (status?.err) {
      throw new Error(
        `Transaction ${args.signature} failed: ${JSON.stringify(status.err)}`
      );
    }
    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized") &&
      typeof status.slot === "number"
    ) {
      return String(status.slot);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `Transaction ${
      args.signature
    } is not confirmed. Last status: ${JSON.stringify(lastStatus)}`
  );
}

async function accountStatus(connection: Connection, pubkey: string | null) {
  if (!pubkey) {
    return null;
  }
  const account = await connection.getAccountInfo(new PublicKey(pubkey));
  return account
    ? {
        exists: true,
        lamports: account.lamports,
        owner: account.owner.toBase58(),
      }
    : { exists: false };
}

async function waitForAccountStatus(args: {
  connection: Connection;
  exists: boolean;
  pubkey: string | null;
  attempts?: number;
  delayMs?: number;
}) {
  const attempts = args.attempts ?? 10;
  const delayMs = args.delayMs ?? 500;
  let latest = await accountStatus(args.connection, args.pubkey);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (Boolean(latest?.exists) === args.exists) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    latest = await accountStatus(args.connection, args.pubkey);
  }
  return latest;
}

function nativeSolRequirementError(
  requirement: SmartAccountNativeSolRequirement | null | undefined
): string | null {
  if (!requirement || requirement.canProceed) {
    return null;
  }
  if (BigInt(requirement.deficitLamports) <= BigInt(0)) {
    return null;
  }
  return `Native SOL requirement not met. Required lamports ${requirement.requiredLamports}, balance ${requirement.balanceLamports}, deficit ${requirement.deficitLamports}.`;
}

function validatePreparedCluster(args: {
  cluster: LoyalCluster;
  operation: string;
  preparedCluster: string;
}) {
  if (args.preparedCluster !== args.cluster) {
    throw new Error(
      `Prepared ${args.operation} cluster ${args.preparedCluster} does not match ${args.cluster}.`
    );
  }
}

function getRequestedStartTimestamp(args: {
  expiryTimestamp?: bigint;
  startTimestamp?: bigint;
}): bigint | undefined {
  if (args.startTimestamp === undefined) {
    return undefined;
  }
  if (
    args.startTimestamp === BigInt(0) &&
    args.expiryTimestamp !== undefined &&
    args.expiryTimestamp > BigInt(0)
  ) {
    return args.startTimestamp;
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  return args.startTimestamp > nowSeconds ? args.startTimestamp : undefined;
}

function isMatchingSetupBatch(args: {
  amountRaw: bigint;
  nextPreparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup | null;
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
}): args is {
  amountRaw: bigint;
  nextPreparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup & {
    stage: "create_recurring_delegation";
  };
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup & {
    stage: "create_policy";
  };
} {
  const { nextPreparedSetup, preparedSetup } = args;
  if (
    preparedSetup.stage !== "create_policy" ||
    nextPreparedSetup?.stage !== "create_recurring_delegation"
  ) {
    return false;
  }

  return (
    preparedSetup.persistence.amountPerPeriodRaw ===
      args.amountRaw.toString() &&
    nextPreparedSetup.persistence.amountPerPeriodRaw ===
      args.amountRaw.toString() &&
    nextPreparedSetup.persistence.cluster ===
      preparedSetup.persistence.cluster &&
    nextPreparedSetup.persistence.policyAccount ===
      preparedSetup.persistence.policyAccount &&
    nextPreparedSetup.persistence.policySeed ===
      preparedSetup.persistence.policySeed &&
    nextPreparedSetup.persistence.recurringDelegation ===
      preparedSetup.persistence.recurringDelegation &&
    nextPreparedSetup.persistence.expiryTimestamp ===
      preparedSetup.persistence.expiryTimestamp &&
    nextPreparedSetup.persistence.periodLengthSeconds ===
      preparedSetup.persistence.periodLengthSeconds &&
    nextPreparedSetup.persistence.settings ===
      preparedSetup.persistence.settings &&
    BigInt(nextPreparedSetup.persistence.startTimestamp) >=
      BigInt(preparedSetup.persistence.startTimestamp) &&
    nextPreparedSetup.persistence.vaultPubkey ===
      preparedSetup.persistence.vaultPubkey &&
    nextPreparedSetup.persistence.walletAddress ===
      preparedSetup.persistence.walletAddress &&
    nextPreparedSetup.persistence.walletUsdcAta ===
      preparedSetup.persistence.walletUsdcAta &&
    nextPreparedSetup.policy.account?.toBase58() ===
      preparedSetup.policy.account?.toBase58() &&
    nextPreparedSetup.policy.seed === preparedSetup.policy.seed &&
    nextPreparedSetup.subscription.nonce === preparedSetup.subscription.nonce &&
    nextPreparedSetup.subscription.recurringDelegation.toBase58() ===
      preparedSetup.subscription.recurringDelegation.toBase58() &&
    nextPreparedSetup.subscription.expiryTimestamp ===
      preparedSetup.subscription.expiryTimestamp &&
    nextPreparedSetup.subscription.periodLengthSeconds ===
      preparedSetup.subscription.periodLengthSeconds &&
    nextPreparedSetup.subscription.startTimestamp >=
      preparedSetup.subscription.startTimestamp &&
    nextPreparedSetup.vault.pubkey.toBase58() ===
      preparedSetup.vault.pubkey.toBase58()
  );
}

async function postConfirmedEarnAutodepositSetup(args: {
  confirmedSlot: string;
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
  session: FrontendSession;
  signature: string;
  walletBalanceFloorRaw: bigint;
}): Promise<EarnAutodepositSetupConfirmResponse> {
  const body = buildEarnAutodepositSetupConfirmRequestBody({
    confirmedSlot: args.confirmedSlot,
    preparedSetup: args.preparedSetup,
    signature: args.signature,
    walletBalanceFloorRaw: args.walletBalanceFloorRaw,
  });
  const response = await frontendPostJson<EarnAutodepositSetupConfirmResponse>({
    body,
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm",
    session: args.session,
  });

  return response.body;
}

async function postConfirmedEarnAutodepositClose(args: {
  confirmedSlot: string;
  preparedClose: SmartAccountPreparedEarnUsdcAutodepositClose;
  session: FrontendSession;
  signature: string;
}): Promise<EarnAutodepositCloseConfirmResponse> {
  const body = buildEarnAutodepositCloseConfirmRequestBody({
    confirmedSlot: args.confirmedSlot,
    preparedClose: args.preparedClose,
    signature: args.signature,
  });
  const response = await frontendPostJson<EarnAutodepositCloseConfirmResponse>({
    body,
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/autodeposit/close/confirm",
    session: args.session,
  });

  return response.body;
}

async function fetchEarnState(args: {
  session: FrontendSession;
}): Promise<unknown> {
  const response = await frontendGetJson<unknown>({
    cookie: args.session.cookie,
    path: "/api/smart-accounts/yield-optimization/earn-state",
    session: args.session,
  });

  return response.body;
}

function setupInput(args: {
  amountRaw: bigint;
  cluster: LoyalCluster;
  feePayer: PublicKey;
  policySeed?: bigint;
  policySigner: PublicKey;
  settingsPda: PublicKey;
  signer: PublicKey;
  startTimestamp?: bigint;
  walletAddress: PublicKey;
}) {
  return {
    amountRaw: args.amountRaw,
    cluster: args.cluster,
    expiryTimestamp: EXPIRY_TIMESTAMP,
    feePayer: args.feePayer,
    minimumDelegatorBalanceRaw: WALLET_BALANCE_FLOOR_RAW,
    nonce: NONCE,
    periodLengthSeconds: PERIOD_LENGTH_SECONDS,
    policySeed: args.policySeed,
    policySigner: args.policySigner,
    settingsPda: args.settingsPda,
    signer: args.signer,
    startTimestamp: args.startTimestamp,
    walletAddress: args.walletAddress,
  };
}

async function main() {
  if (SOLANA_ENV !== "mainnet") {
    throw new Error(
      `verify-earn-autodeposit-mainnet-flow requires NEXT_PUBLIC_SOLANA_ENV=mainnet, got ${SOLANA_ENV}.`
    );
  }
  if (DRY_RUN) {
    throw new Error(
      "EARN_AUTODEPOSIT_VERIFY_DRY_RUN=1 is not implemented for this endpoint verifier because the backend confirm endpoints require live confirmed signatures."
    );
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadTestingKeypair();
  const walletBridge = createKeypairWallet(wallet);
  const policySigner = loadDeploymentPolicySignerPublicKey();
  const session = await authenticateFrontendSession(wallet);
  const settingsPda = new PublicKey(session.settingsPda);
  const cluster = resolveLoyalClusterForSolanaEnv(SOLANA_ENV);
  const client = createSmartAccountVaultsClient({
    connection,
    programId: PROGRAM_ID,
  });
  const requestedStartTimestamp = getRequestedStartTimestamp({
    expiryTimestamp: EXPIRY_TIMESTAMP,
    startTimestamp: START_TIMESTAMP,
  });
  const evidence: {
    config: Record<string, unknown>;
    steps: Record<string, EvidenceStep>;
  } = {
    config: {
      amountRaw: AMOUNT_RAW.toString(),
      cluster,
      frontendBaseUrl: FRONTEND_BASE_URL,
      nonce: NONCE.toString(),
      periodLengthSeconds: PERIOD_LENGTH_SECONDS?.toString() ?? null,
      policySigner: policySigner.toBase58(),
      programId: PROGRAM_ID.toBase58(),
      requestedPolicySeed: REQUESTED_POLICY_SEED?.toString() ?? null,
      requestedStartTimestamp: requestedStartTimestamp?.toString() ?? null,
      settingsPda: settingsPda.toBase58(),
      smartAccountAddress: session.smartAccountAddress,
      walletAddress: wallet.publicKey.toBase58(),
      walletBalanceFloorRaw: WALLET_BALANCE_FLOOR_RAW.toString(),
    },
    steps: {},
  };

  let preparedSetup = await client.prepareEarnUsdcAutodepositSetup(
    setupInput({
      amountRaw: AMOUNT_RAW,
      cluster,
      feePayer: wallet.publicKey,
      policySeed: REQUESTED_POLICY_SEED,
      policySigner,
      settingsPda,
      signer: wallet.publicKey,
      startTimestamp: requestedStartTimestamp,
      walletAddress: wallet.publicKey,
    })
  );
  evidence.steps.initialPrepare = {
    amountRaw: AMOUNT_RAW.toString(),
    instructionCount: preparedSetup.prepared.instructions.length,
    nativeSolRequirement: preparedSetup.nativeSolRequirement,
    persistence: preparedSetup.persistence,
    stage: preparedSetup.stage,
    status: "success",
  };

  let finalSetup: SmartAccountPreparedEarnUsdcAutodepositSetup | null = null;
  const setupConfirmations: EvidenceStep[] = [];
  let setupIteration = 0;

  while (!finalSetup) {
    setupIteration += 1;
    if (setupIteration > 4) {
      throw new Error("Autodeposit setup did not complete within 4 stages.");
    }

    if (preparedSetup.stage === "create_policy") {
      const batchSetups =
        await client.prepareEarnUsdcAutodepositSetupBatchFromPrepared({
          ...setupInput({
            amountRaw: AMOUNT_RAW,
            cluster,
            feePayer: wallet.publicKey,
            policySeed: preparedSetup.policy.seed ?? REQUESTED_POLICY_SEED,
            policySigner,
            settingsPda,
            signer: wallet.publicKey,
            startTimestamp: requestedStartTimestamp,
            walletAddress: wallet.publicKey,
          }),
          expiryTimestamp: preparedSetup.subscription.expiryTimestamp,
          nonce: preparedSetup.subscription.nonce,
          periodLengthSeconds: preparedSetup.subscription.periodLengthSeconds,
          preparedSetup,
          refreshImmediateStartTimestamp: requestedStartTimestamp === undefined,
        });
      const batchPreparedSetup = batchSetups[0] ?? null;
      const batchNextPreparedSetup = batchSetups[1] ?? null;
      if (
        batchPreparedSetup &&
        isMatchingSetupBatch({
          amountRaw: AMOUNT_RAW,
          nextPreparedSetup: batchNextPreparedSetup,
          preparedSetup: batchPreparedSetup,
        })
      ) {
        const batchNativeSolError = nativeSolRequirementError(
          combineSmartAccountNativeSolRequirements(
            [batchPreparedSetup, batchNextPreparedSetup].map(
              (setup) => setup.nativeSolRequirement
            )
          )
        );
        if (batchNativeSolError) {
          throw new Error(batchNativeSolError);
        }
        for (const setup of [batchPreparedSetup, batchNextPreparedSetup]) {
          validatePreparedCluster({
            cluster,
            operation: `autodeposit setup ${setup.stage}`,
            preparedCluster: setup.persistence.cluster,
          });
        }

        await sendPreparedBatchWithWallet({
          connection,
          wallet: walletBridge,
          prepared: [
            batchPreparedSetup.prepared,
            batchNextPreparedSetup.prepared,
          ],
          confirm: true,
          sendMode: "send-all-before-confirm",
          onTransactionConfirmed: async ({ index, signature }) => {
            const confirmedSetup = [batchPreparedSetup, batchNextPreparedSetup][
              index
            ];
            if (!confirmedSetup) {
              throw new Error(
                "Confirmed transaction did not match a prepared Autodeposit setup."
              );
            }
            const confirmedSlot = await resolveConfirmedSignatureSlot({
              connection,
              signature,
            });
            const response = await postConfirmedEarnAutodepositSetup({
              confirmedSlot,
              preparedSetup: confirmedSetup,
              session,
              signature,
              walletBalanceFloorRaw: WALLET_BALANCE_FLOOR_RAW,
            });
            setupConfirmations.push({
              backend: response,
              confirmedSlot,
              endpoint:
                "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm",
              instructionCount: confirmedSetup.prepared.instructions.length,
              persistence: confirmedSetup.persistence,
              signature,
              stage: confirmedSetup.stage,
              status: "success",
            });
          },
        });

        finalSetup = batchNextPreparedSetup;
        evidence.steps.setupBatch = {
          instructionCount:
            batchPreparedSetup.prepared.instructions.length +
            batchNextPreparedSetup.prepared.instructions.length,
          persistence: {
            first: batchPreparedSetup.persistence,
            second: batchNextPreparedSetup.persistence,
          },
          stage: "create_recurring_delegation",
          status: "success",
        };
        break;
      }
    }

    validatePreparedCluster({
      cluster,
      operation: `autodeposit setup ${preparedSetup.stage}`,
      preparedCluster: preparedSetup.persistence.cluster,
    });
    const nativeSolError = nativeSolRequirementError(
      preparedSetup.nativeSolRequirement
    );
    if (nativeSolError) {
      throw new Error(nativeSolError);
    }

    const signature = await sendPreparedWithWallet({
      connection,
      wallet: walletBridge,
      prepared: preparedSetup.prepared,
      confirm: true,
    });
    const confirmedSlot = await resolveConfirmedSignatureSlot({
      connection,
      signature,
    });
    const response = await postConfirmedEarnAutodepositSetup({
      confirmedSlot,
      preparedSetup,
      session,
      signature,
      walletBalanceFloorRaw: WALLET_BALANCE_FLOOR_RAW,
    });
    setupConfirmations.push({
      backend: response,
      confirmedSlot,
      endpoint:
        "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm",
      instructionCount: preparedSetup.prepared.instructions.length,
      persistence: preparedSetup.persistence,
      signature,
      stage: preparedSetup.stage,
      status: "success",
    });

    if (preparedSetup.stage === "create_recurring_delegation") {
      finalSetup = preparedSetup;
      break;
    }

    if (preparedSetup.stage === "create_policy") {
      const nextSetups =
        await client.prepareEarnUsdcAutodepositSetupBatchFromPrepared({
          ...setupInput({
            amountRaw: AMOUNT_RAW,
            cluster,
            feePayer: wallet.publicKey,
            policySeed: preparedSetup.policy.seed ?? REQUESTED_POLICY_SEED,
            policySigner,
            settingsPda,
            signer: wallet.publicKey,
            startTimestamp: requestedStartTimestamp,
            walletAddress: wallet.publicKey,
          }),
          expiryTimestamp: preparedSetup.subscription.expiryTimestamp,
          nonce: preparedSetup.subscription.nonce,
          periodLengthSeconds: preparedSetup.subscription.periodLengthSeconds,
          preparedSetup,
          refreshImmediateStartTimestamp: requestedStartTimestamp === undefined,
        });
      preparedSetup = nextSetups[1] ?? nextSetups[0] ?? preparedSetup;
    } else {
      preparedSetup = await client.prepareEarnUsdcAutodepositSetup({
        ...setupInput({
          amountRaw: AMOUNT_RAW,
          cluster,
          feePayer: wallet.publicKey,
          policySeed: preparedSetup.policy.seed ?? REQUESTED_POLICY_SEED,
          policySigner,
          settingsPda,
          signer: wallet.publicKey,
          startTimestamp: requestedStartTimestamp,
          walletAddress: wallet.publicKey,
        }),
        expiryTimestamp:
          EXPIRY_TIMESTAMP ?? preparedSetup.subscription.expiryTimestamp,
        nonce: preparedSetup.subscription.nonce,
        periodLengthSeconds:
          PERIOD_LENGTH_SECONDS ??
          preparedSetup.subscription.periodLengthSeconds,
      });
    }
  }

  evidence.steps.setupConfirmations = {
    backend: setupConfirmations,
    endpoint:
      "/api/smart-accounts/yield-optimization/autodeposit/setup/confirm",
    status: "success",
  };
  evidence.steps.postSetupEarnState = {
    backend: await fetchEarnState({ session }),
    status: "success",
  };

  if (!finalSetup.policy.account) {
    throw new Error("Completed Autodeposit setup is missing policy account.");
  }

  const postSetupPolicy = await waitForAccountStatus({
    connection,
    exists: true,
    pubkey: finalSetup.persistence.policyAccount,
  });
  const postSetupRecurringDelegation = await waitForAccountStatus({
    connection,
    exists: true,
    pubkey: finalSetup.persistence.recurringDelegation,
  });
  evidence.steps.postSetupAccounts = {
    accounts: {
      policy: postSetupPolicy,
      recurringDelegation: postSetupRecurringDelegation,
      subscriptionAuthority: await accountStatus(
        connection,
        finalSetup.persistence.subscriptionAuthority
      ),
    },
    status: "success",
  };

  const preparedClose = await client.prepareEarnUsdcAutodepositClose({
    cluster,
    feePayer: wallet.publicKey,
    policy: finalSetup.policy.account,
    policySigner,
    recurringDelegation: finalSetup.subscription.recurringDelegation,
    settingsPda,
    signer: wallet.publicKey,
    walletAddress: wallet.publicKey,
  });
  validatePreparedCluster({
    cluster,
    operation: "autodeposit close",
    preparedCluster: preparedClose.persistence.cluster,
  });
  const closeSignature = await sendPreparedWithWallet({
    connection,
    wallet: walletBridge,
    prepared: preparedClose.prepared,
    confirm: true,
  });
  const closeConfirmedSlot = await resolveConfirmedSignatureSlot({
    connection,
    signature: closeSignature,
  });
  const closeResponse = await postConfirmedEarnAutodepositClose({
    confirmedSlot: closeConfirmedSlot,
    preparedClose,
    session,
    signature: closeSignature,
  });
  evidence.steps.closeConfirm = {
    backend: closeResponse,
    confirmedSlot: closeConfirmedSlot,
    endpoint:
      "/api/smart-accounts/yield-optimization/autodeposit/close/confirm",
    instructionCount: preparedClose.prepared.instructions.length,
    persistence: preparedClose.persistence,
    signature: closeSignature,
    status: "success",
  };
  evidence.steps.postCloseEarnState = {
    backend: await fetchEarnState({ session }),
    status: "success",
  };

  const postClosePolicy = await waitForAccountStatus({
    connection,
    exists: false,
    pubkey: finalSetup.persistence.policyAccount,
  });
  const postCloseRecurringDelegation = await waitForAccountStatus({
    connection,
    exists: false,
    pubkey: finalSetup.persistence.recurringDelegation,
  });
  evidence.steps.postCloseAccounts = {
    accounts: {
      policy: postClosePolicy,
      recurringDelegation: postCloseRecurringDelegation,
      subscriptionAuthority: await accountStatus(
        connection,
        finalSetup.persistence.subscriptionAuthority
      ),
    },
    status:
      postClosePolicy?.exists || postCloseRecurringDelegation?.exists
        ? "failed"
        : "success",
  };

  if (postClosePolicy?.exists || postCloseRecurringDelegation?.exists) {
    throw new Error("Autodeposit close did not clean up policy/delegation.");
  }

  console.log("[earn-autodeposit-mainnet] PASS");
  console.log(JSON.stringify(evidence, bigintJson, 2));
}

main().catch((error) => {
  console.error("[earn-autodeposit-mainnet] FAIL", error);
  process.exit(1);
});
