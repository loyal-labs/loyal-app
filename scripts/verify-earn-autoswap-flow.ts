import { mock } from "bun:test";
import bs58 from "bs58";
import { createHash, randomUUID } from "node:crypto";
import nacl from "tweetnacl";
import postgres from "postgres";
import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  sendPreparedWithWallet,
  type WalletAdapterLike,
} from "../packages/smart-account-vaults/src/index.ts";
import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "../packages/solana-rpc/src/index.ts";
import { compilePreparedOperation } from "../packages/loyal-smart-accounts-core/src/index.ts";
import {
  hydratePreparedOperation,
  type WirePreparedLoyalSmartAccountsOperation,
} from "../apps/web/src/lib/smart-accounts/prepared-operation-wire.shared.ts";

mock.module("server-only", () => ({}));

function createCanaryDatabase(
  url: string
): postgres.Sql<Record<string, postgres.PostgresType>> {
  return postgres(url, {
    connect_timeout: 8,
    connection: {
      application_name: CANARY_GATE_ACTOR,
      lock_timeout: 5_000,
      statement_timeout: 10_000,
    },
    max: 1,
  });
}

// Read-only API verification (default):
// AUTOSWAP_VERIFY_BASE_URL=http://localhost:3000 bun scripts/verify-earn-autoswap-flow.ts
//
// Disposable localhost database state verification (no on-chain writes):
// AUTOSWAP_VERIFY_MODE=local-state AUTOSWAP_VERIFY_LOCAL_AUTH_ACK=disposable-local-auth YIELD_OPTIMIZATION_LOCAL_DATABASE_URL=postgresql://localhost/loyal_autoswap_api_verify_<suffix> bun scripts/verify-earn-autoswap-flow.ts
//
// Explicitly approved mainnet lifecycle:
// AUTOSWAP_VERIFY_MODE=live AUTOSWAP_VERIFY_BASE_URL=http://localhost:3000 bun scripts/verify-earn-autoswap-flow.ts
// Use AUTOSWAP_VERIFY_LIVE_ACTION=install to leave the verified enrollment on
// for worker canaries, pause/resume around a controlled recovery check, and
// cleanup after terminalization. The default `full` action remains atomic.
// Use AUTOSWAP_VERIFY_LIVE_ACTION=canary only for the explicitly acknowledged
// production run. It installs policies, exercises two bounded movements,
// proves pause/recovery/delete behavior, and cleans up in one auth session.
// Use canary-existing to exercise one already-installed mint family and leave
// the enrollment paused, allowing inventory to be restaged before the other
// family is verified without reopening the global start gate in between.
// It requires NEON_DATABASE_URL and:
// AUTOSWAP_VERIFY_CANARY_ACK=mainnet-production-bounded-autoswap-canaries
// Set AUTOSWAP_VERIFY_EXPECTED_POLICY_CREATES=1 only to resume a deliberately
// interrupted setup; a clean-install live run requires two creates by default.
//
// Run inside the Loyal Apps 1Password environment. The script never prints
// the test key, auth cookie, RPC URL, or serialized transaction bytes. Live
// mode is the only mode that submits transactions. Local-state mode mutates
// only a name-guarded disposable localhost database and cleans its fixtures.

type VerifyMode = "live" | "local-state" | "read-only";
type LiveAction =
  | "canary"
  | "canary-existing"
  | "cleanup"
  | "full"
  | "install"
  | "pause"
  | "resume";
type JsonRecord = Record<string, unknown>;
type CanaryDatabase = ReturnType<typeof createCanaryDatabase>;
type CanaryGateLease = { generation: string | null };
type ApiResult<T> = {
  body: T;
  headers: Headers;
  status: number;
};
type AutoswapPolicyState = {
  account: string;
  seed: string;
  sourceShard: "classic" | "token_2022";
};
type AutoswapState = {
  boundPolicies: readonly [AutoswapPolicyState, AutoswapPolicyState];
  dailySourceMintSpendingCap: string;
  enabled: boolean;
  generation: string;
  maxSlippageBps: number;
  policies: AutoswapPolicyState[];
  status: "finalizing" | "on" | "paused";
};
type EarnState = {
  autoswap: AutoswapState | null;
  autoswapAvailable: boolean;
  position: unknown | null;
  settingsPda: string;
  vault: { accountIndex: number; pubkey: string };
};
type WirePolicy = {
  existing: boolean;
  policy: { account: string; id: string; seed: string };
  prepared?: WirePreparedLoyalSmartAccountsOperation;
  persistence: {
    cluster: string;
    delegatedSigner: string;
  };
  sourceShard: "classic" | "token_2022";
};
type WirePreparedPolicySet = {
  dailySourceMintSpendingCap: string;
  maxSlippageBps: number;
  policies: readonly [WirePolicy, WirePolicy];
  vault: { accountIndex: 1; pubkey: string };
};
type DeletePreparation = {
  expectedGeneration: string;
  policies: readonly [string, string];
  prepared?: WirePreparedLoyalSmartAccountsOperation;
  status: "off" | "prepared";
};
type Session = {
  cookie: string;
  settingsPda: string;
  smartAccountAddress: string;
};
type CanaryMovement = {
  amountRaw: string;
  custodyReconciledSlot: string | null;
  custodyVersion: string;
  id: string;
  sourceMint: string;
  sourceShard: "classic" | "token_2022";
  swapDailyCap: string | null;
  swapMaxSlippageBps: string | null;
  swapPolicyAccount: string | null;
  targetMint: string;
  terminalObservedSlot: string | null;
  terminalOutcome: string | null;
  terminalReason: string | null;
};
type CanarySubmission = {
  creditAmountRaw: string | null;
  creditMint: string | null;
  debitAmountRaw: string | null;
  debitMint: string | null;
  finalizedSlot: string | null;
  leg: "deposit" | "swap" | "withdraw";
  signature: string;
  state: string;
};

const BASE_URL = (
  process.env.AUTOSWAP_VERIFY_BASE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");
const MODE = (process.env.AUTOSWAP_VERIFY_MODE ?? "read-only") as VerifyMode;
const LIVE_ACTION = (process.env.AUTOSWAP_VERIFY_LIVE_ACTION ??
  "full") as LiveAction;
const DAILY_CAP_RAW = BigInt(
  process.env.AUTOSWAP_VERIFY_DAILY_CAP_RAW ?? "100000000"
);
const MAX_SLIPPAGE_BPS = 50;
const EXPECTED_LIVE_POLICY_CREATES = Number.parseInt(
  process.env.AUTOSWAP_VERIFY_EXPECTED_POLICY_CREATES ?? "2",
  10
);
const SOLANA_ENV = resolveSolanaEnv(
  process.env.NEXT_PUBLIC_SOLANA_ENV ?? process.env.SOLANA_ENV ?? "mainnet"
);
const RPC_URL =
  process.env.SOLANA_RPC_URL ??
  process.env.RPC_URL ??
  getSolanaEndpoints(SOLANA_ENV).rpcEndpoint;
const EARN_STATE_PATH =
  "/api/smart-accounts/yield-optimization/cross-mint/state";
const PREPARE_PATH =
  "/api/smart-accounts/yield-optimization/cross-mint/policies/prepare";
const CONFIRM_PATH =
  "/api/smart-accounts/yield-optimization/cross-mint/policies/confirm";
const TOGGLE_PATH = "/api/smart-accounts/yield-optimization/cross-mint/toggle";
const DELETE_PREPARE_PATH =
  "/api/smart-accounts/yield-optimization/cross-mint/delete/prepare";
const DELETE_CONFIRM_PATH =
  "/api/smart-accounts/yield-optimization/cross-mint/delete/confirm";
const FAKE_SIGNATURE = "1".repeat(88);
const SQUADS_MISSING_ACCOUNT_ERROR_CODE = 6024;
const CANARY_ACKNOWLEDGEMENT = "mainnet-production-bounded-autoswap-canaries";
const LOCAL_AUTH_ACKNOWLEDGEMENT = "disposable-local-auth";
const WALLET_SESSION_COOKIE_NAME = "loyal_wallet_session";
const CANARY_CLUSTER = "mainnet-beta";
const CANARY_GATE_ACTOR = "autoswap-user-rollout-verifier";
const CANARY_GATE_OWNER = `${CANARY_GATE_ACTOR}:${randomUUID()}`;
const CANARY_POLL_INTERVAL_MS = 1000;
const CANARY_TRANSITION_POLL_INTERVAL_MS = 250;
const POLICY_DISCOVERY_TIMEOUT_MS = 60_000;
const CANARY_PRODUCTION_DATABASE_HOST_SHA256 =
  "bf4fd3f4262f3de5fa1885a99ab89fb4d2a7e262868af85b44bcd9026ad03092";

function loadKeypair(envName: string): Keypair {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    throw new Error(`${envName} is not set.`);
  }
  if (raw.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0) {
    return Keypair.fromSecretKey(
      Uint8Array.from(
        raw.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
      )
    );
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function keypairWallet(keypair: Keypair): WalletAdapterLike {
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

function signAuthMessage(keypair: Keypair, message: string): string {
  return bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey)
  );
}

function extractCookieHeader(headers: Headers): string {
  const getSetCookie = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  let setCookies: string[] = [];
  if (getSetCookie && getSetCookie.length > 0) {
    setCookies = getSetCookie;
  } else {
    const cookie = headers.get("set-cookie");
    if (cookie) {
      setCookies = [cookie];
    }
  }
  const cookies = setCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));
  if (cookies.length === 0) {
    throw new Error("Wallet auth completed without a session cookie.");
  }
  return cookies.join("; ");
}

async function apiRequest<T>(args: {
  body?: unknown;
  cookie?: string;
  method: "GET" | "POST";
  path: string;
}): Promise<ApiResult<T>> {
  const response = await fetch(`${BASE_URL}${args.path}`, {
    ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
    headers: {
      ...(args.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...(args.cookie ? { cookie: args.cookie } : {}),
      origin: BASE_URL,
    },
    method: args.method,
  });
  const text = await response.text();
  return {
    body: (text ? JSON.parse(text) : null) as T,
    headers: response.headers,
    status: response.status,
  };
}

function apiError(result: ApiResult<unknown>): {
  code?: string;
  message?: string;
} {
  const body =
    result.body && typeof result.body === "object"
      ? (result.body as JsonRecord)
      : null;
  const error =
    body?.error && typeof body.error === "object"
      ? (body.error as JsonRecord)
      : null;
  return {
    code: typeof error?.code === "string" ? error.code : undefined,
    message: typeof error?.message === "string" ? error.message : undefined,
  };
}

function requireStatus(
  result: ApiResult<unknown>,
  expectedStatus: number,
  label: string,
  expectedCode?: string
): void {
  const error = apiError(result);
  if (
    result.status !== expectedStatus ||
    (expectedCode !== undefined && error.code !== expectedCode)
  ) {
    throw new Error(
      `${label} returned ${result.status}/${
        error.code ?? "no_code"
      }; expected ${expectedStatus}/${expectedCode ?? "any"}.`
    );
  }
}

function requireOk<T>(result: ApiResult<T>, label: string): T {
  if (result.status < 200 || result.status >= 300) {
    const error = apiError(result);
    throw new Error(
      `${label} failed with ${result.status}/${error.code ?? "no_code"}: ${
        error.message ?? "no message"
      }`
    );
  }
  return result.body;
}

async function authenticate(keypair: Keypair): Promise<Session> {
  const challengeBody = {
    ...(process.env.AUTOSWAP_VERIFY_CAPTCHA_TOKEN
      ? { captchaToken: process.env.AUTOSWAP_VERIFY_CAPTCHA_TOKEN }
      : {}),
    walletAddress: keypair.publicKey.toBase58(),
  };
  const challenge = requireOk(
    await apiRequest<{ challengeToken: string; message: string }>({
      body: challengeBody,
      method: "POST",
      path: "/api/auth/wallet/challenge",
    }),
    "wallet auth challenge"
  );
  const completion = await apiRequest<{
    user?: { settingsPda?: string; smartAccountAddress?: string };
  }>({
    body: {
      challengeToken: challenge.challengeToken,
      signature: signAuthMessage(keypair, challenge.message),
    },
    method: "POST",
    path: "/api/auth/wallet/complete",
  });
  const body = requireOk(completion, "wallet auth completion");
  const settingsPda = body.user?.settingsPda;
  const smartAccountAddress = body.user?.smartAccountAddress;
  if (!(settingsPda && smartAccountAddress)) {
    throw new Error("Wallet auth did not resolve a ready smart account.");
  }
  return {
    cookie: extractCookieHeader(completion.headers),
    settingsPda,
    smartAccountAddress,
  };
}

async function authenticateDisposableLocalFixture(
  keypair: Keypair
): Promise<Session> {
  if (
    process.env.AUTOSWAP_VERIFY_LOCAL_AUTH_ACK?.trim() !==
    LOCAL_AUTH_ACKNOWLEDGEMENT
  ) {
    throw new Error(
      `Local fixture auth requires AUTOSWAP_VERIFY_LOCAL_AUTH_ACK=${LOCAL_AUTH_ACKNOWLEDGEMENT}.`
    );
  }

  const database = postgres(requireDisposableLocalDatabaseUrl(), { max: 1 });
  try {
    const rows = await database<{ settings: string }[]>`
      select distinct settings
      from loyal_yield.user_yield_positions
      where wallet_address = ${keypair.publicKey.toBase58()}
        and status = 'active'
    `;
    if (rows.length !== 1) {
      throw new Error(
        "Disposable local auth requires exactly one active testing-wallet smart account."
      );
    }

    const secret = process.env.AUTH_JWT_SECRET?.trim();
    if (!secret) {
      throw new Error("Disposable local auth requires AUTH_JWT_SECRET.");
    }
    const [sessionTokenModule, derivationModule, configModule] =
      await Promise.all([
        import("../apps/web/src/features/identity/server/session-token.ts"),
        import("../apps/web/src/features/smart-accounts/derivation.ts"),
        import("../apps/web/src/lib/core/config/server.ts"),
      ]);
    const walletAddress = keypair.publicKey.toBase58();
    const smartAccountAddress =
      derivationModule.deriveCanonicalSmartAccountAddress({
        programId: configModule.getServerEnv().loyalSmartAccounts.programId,
        settingsPda: rows[0]!.settings,
      });
    const token = await sessionTokenModule.issueAuthSessionToken(
      {
        authMethod: "wallet",
        displayAddress: walletAddress,
        provider: "solana",
        settingsPda: rows[0]!.settings,
        smartAccountAddress,
        subjectAddress: walletAddress,
        walletAddress,
      },
      secret,
      15 * 60
    );
    return {
      cookie: `${WALLET_SESSION_COOKIE_NAME}=${token}`,
      settingsPda: rows[0]!.settings,
      smartAccountAddress,
    };
  } finally {
    await database.end({ timeout: 5 });
  }
}

async function getEarnState(session: Session): Promise<EarnState> {
  return requireOk(
    await apiRequest<EarnState>({
      cookie: session.cookie,
      method: "GET",
      path: EARN_STATE_PATH,
    }),
    "Earn state"
  );
}

async function verifyRouteBoundaries(session: Session): Promise<void> {
  const unauthenticated = await Promise.all([
    apiRequest({ method: "GET", path: EARN_STATE_PATH }),
    apiRequest({ body: {}, method: "POST", path: PREPARE_PATH }),
    apiRequest({ body: {}, method: "POST", path: CONFIRM_PATH }),
    apiRequest({ body: {}, method: "POST", path: TOGGLE_PATH }),
    apiRequest({ body: {}, method: "POST", path: DELETE_PREPARE_PATH }),
    apiRequest({ body: {}, method: "POST", path: DELETE_CONFIRM_PATH }),
  ]);
  for (const [index, result] of unauthenticated.entries()) {
    requireStatus(
      result,
      401,
      `unauthenticated route ${index + 1}`,
      "unauthenticated"
    );
  }

  const invalidRequests = await Promise.all([
    apiRequest({
      body: { dailySourceMintSpendingCap: "999999", maxSlippageBps: 50 },
      cookie: session.cookie,
      method: "POST",
      path: PREPARE_PATH,
    }),
    apiRequest({
      body: { dailySourceMintSpendingCap: "1000000001", maxSlippageBps: 50 },
      cookie: session.cookie,
      method: "POST",
      path: PREPARE_PATH,
    }),
    apiRequest({
      body: { dailySourceMintSpendingCap: "100000000", maxSlippageBps: 100 },
      cookie: session.cookie,
      method: "POST",
      path: PREPARE_PATH,
    }),
    apiRequest({
      body: {},
      cookie: session.cookie,
      method: "POST",
      path: CONFIRM_PATH,
    }),
    apiRequest({
      body: {},
      cookie: session.cookie,
      method: "POST",
      path: TOGGLE_PATH,
    }),
    apiRequest({
      body: {},
      cookie: session.cookie,
      method: "POST",
      path: DELETE_PREPARE_PATH,
    }),
    apiRequest({
      body: {},
      cookie: session.cookie,
      method: "POST",
      path: DELETE_CONFIRM_PATH,
    }),
  ]);
  for (const [index, result] of invalidRequests.entries()) {
    requireStatus(
      result,
      400,
      `invalid request ${index + 1}`,
      "invalid_request"
    );
  }
}

async function preparePolicies(
  session: Session
): Promise<WirePreparedPolicySet> {
  const response = requireOk(
    await apiRequest<{ preparedPolicies: WirePreparedPolicySet }>({
      body: {
        dailySourceMintSpendingCap: DAILY_CAP_RAW.toString(),
        maxSlippageBps: MAX_SLIPPAGE_BPS,
      },
      cookie: session.cookie,
      method: "POST",
      path: PREPARE_PATH,
    }),
    "Autoswap policy preparation"
  );
  const prepared = response.preparedPolicies;
  const shards = new Set(prepared.policies.map((policy) => policy.sourceShard));
  const accounts = new Set(
    prepared.policies.map((policy) => policy.policy.account)
  );
  const seeds = new Set(prepared.policies.map((policy) => policy.policy.seed));
  if (
    prepared.dailySourceMintSpendingCap !== DAILY_CAP_RAW.toString() ||
    prepared.maxSlippageBps !== MAX_SLIPPAGE_BPS ||
    prepared.vault.accountIndex !== 1 ||
    shards.size !== 2 ||
    !shards.has("classic") ||
    !shards.has("token_2022") ||
    accounts.size !== 2 ||
    seeds.size !== 2 ||
    prepared.policies.some((policy) => BigInt(policy.policy.seed) <= BigInt(0))
  ) {
    throw new Error(
      "Prepared Autoswap policies do not match the canonical two-shard contract."
    );
  }
  return prepared;
}

async function waitForFinalizedPolicyDiscovery(args: {
  session: Session;
  sourceShard: "classic" | "token_2022";
}): Promise<WirePreparedPolicySet> {
  const deadline = Date.now() + POLICY_DISCOVERY_TIMEOUT_MS;
  while (true) {
    const prepared = await preparePolicies(args.session);
    const policy = prepared.policies.find(
      (candidate) => candidate.sourceShard === args.sourceShard
    );
    if (policy?.existing && !policy.prepared) {
      return prepared;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Finalized ${args.sourceShard} policy was not discoverable within ${POLICY_DISCOVERY_TIMEOUT_MS}ms.`
      );
    }
    await Bun.sleep(CANARY_POLL_INTERVAL_MS);
  }
}

async function simulatePreparedTransaction(args: {
  connection: Connection;
  keypair: Keypair;
  wire: WirePreparedLoyalSmartAccountsOperation;
}) {
  const prepared = hydratePreparedOperation(args.wire);
  const latestBlockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedOperation({
    blockhash: latestBlockhash.blockhash,
    prepared,
  });
  transaction.sign([args.keypair]);
  return args.connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    sigVerify: false,
  });
}

function simulationCustomErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const instructionError = (error as { InstructionError?: unknown })
    .InstructionError;
  if (!Array.isArray(instructionError) || instructionError.length !== 2) {
    return null;
  }
  const detail = instructionError[1];
  if (!detail || typeof detail !== "object") {
    return null;
  }
  const custom = (detail as { Custom?: unknown }).Custom;
  return typeof custom === "number" ? custom : null;
}

async function simulatePrepared(args: {
  connection: Connection;
  keypair: Keypair;
  wire: WirePreparedLoyalSmartAccountsOperation;
}): Promise<number> {
  const simulation = await simulatePreparedTransaction(args);
  if (simulation.value.err) {
    throw new Error(
      `Autoswap transaction simulation failed: ${JSON.stringify(
        simulation.value.err
      )}`
    );
  }
  return simulation.value.logs?.length ?? 0;
}

async function assertPreparedAwaitsPreviousPolicy(args: {
  connection: Connection;
  keypair: Keypair;
  wire: WirePreparedLoyalSmartAccountsOperation;
}): Promise<number> {
  const simulation = await simulatePreparedTransaction(args);
  if (!simulation.value.err) {
    throw new Error(
      "A later Autoswap policy transaction simulated before its predecessor advanced the Squads policy seed."
    );
  }
  const errorCode = simulationCustomErrorCode(simulation.value.err);
  if (errorCode !== SQUADS_MISSING_ACCOUNT_ERROR_CODE) {
    throw new Error(
      `A later Autoswap policy transaction failed with custom error ${String(
        errorCode
      )}, not Squads MissingAccount.`
    );
  }
  return simulation.value.logs?.length ?? 0;
}

function pendingPolicies(prepared: WirePreparedPolicySet): WirePolicy[] {
  return prepared.policies
    .filter(
      (
        policy
      ): policy is WirePolicy & {
        prepared: WirePreparedLoyalSmartAccountsOperation;
      } => Boolean(policy.prepared)
    )
    .sort((left, right) =>
      BigInt(left.policy.seed) < BigInt(right.policy.seed) ? -1 : 1
    );
}

async function sendPrepared(args: {
  connection: Connection;
  keypair: Keypair;
  wire: WirePreparedLoyalSmartAccountsOperation;
}): Promise<string> {
  return sendPreparedWithWallet({
    confirm: true,
    connection: args.connection,
    prepared: hydratePreparedOperation(args.wire),
    wallet: keypairWallet(args.keypair),
  });
}

async function finalizedSlot(
  connection: Connection,
  signature: string
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (status && !status.err && status.confirmationStatus === "finalized") {
      return String(status.slot);
    }
    await Bun.sleep(1000);
  }
  throw new Error("Submitted Autoswap transaction did not reach finality.");
}

async function waitForAutoswap(
  session: Session,
  predicate: (state: AutoswapState | null) => boolean,
  label: string
): Promise<AutoswapState | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = (await getEarnState(session)).autoswap;
    if (predicate(current)) {
      return current;
    }
    await Bun.sleep(3000);
  }
  throw new Error(`Timed out waiting for Autoswap to become ${label}.`);
}

async function verifyReadOnly(args: {
  connection: Connection;
  initialState: EarnState;
  keypair: Keypair;
  session: Session;
}): Promise<JsonRecord> {
  const current = args.initialState.autoswap;
  if (current) {
    if (current.status !== "finalizing") {
      const idempotent = requireOk(
        await apiRequest<{ generation: string }>({
          body: {
            enabled: current.enabled,
            expectedGeneration: current.generation,
          },
          cookie: args.session.cookie,
          method: "POST",
          path: TOGGLE_PATH,
        }),
        "idempotent Autoswap toggle"
      );
      if (idempotent.generation !== current.generation) {
        throw new Error("An idempotent Autoswap toggle advanced generation.");
      }
    }
    const fakeDelete = await apiRequest({
      body: {
        expectedGeneration: current.generation,
        finalizedSlot: "1",
        policies: current.boundPolicies.map((policy) => policy.account),
        signature: FAKE_SIGNATURE,
      },
      cookie: args.session.cookie,
      method: "POST",
      path: DELETE_CONFIRM_PATH,
    });
    requireStatus(
      fakeDelete,
      409,
      "unfinalized delete confirmation",
      "delete_confirmation_failed"
    );
    return {
      existingState: current.status,
      generation: current.generation,
      idempotentToggle:
        current.status === "finalizing" ? "not_applicable" : "passed",
      unfinalizedDeleteRejected: true,
    };
  }

  if (!args.initialState.position) {
    const missingPosition = await apiRequest({
      body: {
        dailySourceMintSpendingCap: DAILY_CAP_RAW.toString(),
        maxSlippageBps: MAX_SLIPPAGE_BPS,
      },
      cookie: args.session.cookie,
      method: "POST",
      path: PREPARE_PATH,
    });
    requireStatus(
      missingPosition,
      409,
      "missing-position setup",
      "earn_position_required"
    );
    return { missingPositionRejected: true };
  }

  const prepared = await preparePolicies(args.session);
  if (prepared.vault.pubkey !== args.initialState.vault.pubkey) {
    throw new Error(
      "Prepared Autoswap policies target a different Earn vault."
    );
  }
  const simulationLogCounts: number[] = [];
  const pending = pendingPolicies(prepared);
  const nextPolicy = pending[0];
  if (nextPolicy?.prepared) {
    simulationLogCounts.push(
      await simulatePrepared({
        connection: args.connection,
        keypair: args.keypair,
        wire: nextPolicy.prepared,
      })
    );
  }
  const dependentSimulationLogCounts: number[] = [];
  for (const policy of pending.slice(1)) {
    if (policy.prepared) {
      dependentSimulationLogCounts.push(
        await assertPreparedAwaitsPreviousPolicy({
          connection: args.connection,
          keypair: args.keypair,
          wire: policy.prepared,
        })
      );
    }
  }
  const wrongSeedPolicies = prepared.policies.map((policy, index) => ({
    account: policy.policy.account,
    seed:
      index === 0
        ? (BigInt(policy.policy.seed) + BigInt(1)).toString()
        : policy.policy.seed,
    sourceShard: policy.sourceShard,
  })) as [AutoswapPolicyState, AutoswapPolicyState];
  const rejectedConfirmation = await apiRequest({
    body: {
      dailySourceMintSpendingCap: DAILY_CAP_RAW.toString(),
      maxSlippageBps: MAX_SLIPPAGE_BPS,
      policies: wrongSeedPolicies,
    },
    cookie: args.session.cookie,
    method: "POST",
    path: CONFIRM_PATH,
  });
  requireStatus(
    rejectedConfirmation,
    409,
    "mismatched policy confirmation",
    "confirmation_failed"
  );
  if ((await getEarnState(args.session)).autoswap !== null) {
    throw new Error("Rejected policy confirmation created an enrollment row.");
  }
  const [missingToggle, missingDelete] = await Promise.all([
    apiRequest({
      body: { enabled: false, expectedGeneration: "1" },
      cookie: args.session.cookie,
      method: "POST",
      path: TOGGLE_PATH,
    }),
    apiRequest({
      body: { expectedGeneration: "1" },
      cookie: args.session.cookie,
      method: "POST",
      path: DELETE_PREPARE_PATH,
    }),
  ]);
  requireStatus(missingToggle, 404, "off-state toggle", "autoswap_not_found");
  requireStatus(missingDelete, 404, "off-state delete", "autoswap_not_found");
  return {
    preparedPolicyCount: prepared.policies.length,
    preparedPolicies: prepared.policies.map((policy) => ({
      account: policy.policy.account,
      delegatedSigner: policy.persistence.delegatedSigner,
      existing: policy.existing,
      seed: policy.policy.seed,
      sourceShard: policy.sourceShard,
    })),
    dependentSimulationLogCounts,
    rejectedMismatchedConfirmation: true,
    simulationLogCounts,
  };
}

async function changeLiveAutoswapState(args: {
  enabled: boolean;
  initialState: EarnState;
  session: Session;
}): Promise<JsonRecord> {
  const current = args.initialState.autoswap;
  if (!current || current.status === "finalizing") {
    throw new Error(
      `Autoswap ${
        args.enabled ? "resume" : "pause"
      } requires a settled enrollment.`
    );
  }
  if (current.enabled === args.enabled) {
    return {
      action: args.enabled ? "resume" : "pause",
      finalState: current.status,
      generation: current.generation,
      idempotent: true,
    };
  }
  const changed = requireOk(
    await apiRequest<{
      enabled: boolean;
      generation: string;
      status: string;
    }>({
      body: {
        enabled: args.enabled,
        expectedGeneration: current.generation,
      },
      cookie: args.session.cookie,
      method: "POST",
      path: TOGGLE_PATH,
    }),
    `Autoswap ${args.enabled ? "resume" : "pause"}`
  );
  if (
    changed.enabled !== args.enabled ||
    BigInt(changed.generation) !== BigInt(current.generation) + BigInt(1)
  ) {
    throw new Error(
      `Autoswap ${
        args.enabled ? "resume" : "pause"
      } did not advance generation exactly once.`
    );
  }
  const expectedStatus = args.enabled ? "on" : "paused";
  await waitForAutoswap(
    args.session,
    (state) => state?.status === expectedStatus,
    expectedStatus
  );
  return {
    action: args.enabled ? "resume" : "pause",
    finalState: expectedStatus,
    generation: changed.generation,
    idempotent: false,
  };
}

async function cleanupLiveAutoswap(args: {
  connection: Connection;
  generation: string;
  keypair: Keypair;
  session: Session;
}): Promise<JsonRecord> {
  const canceledDelete = requireOk(
    await apiRequest<DeletePreparation>({
      body: { expectedGeneration: args.generation },
      cookie: args.session.cookie,
      method: "POST",
      path: DELETE_PREPARE_PATH,
    }),
    "Autoswap delete preparation"
  );
  if (canceledDelete.status !== "prepared" || !canceledDelete.prepared) {
    throw new Error(
      "Autoswap delete preparation did not return one revocation transaction."
    );
  }
  const pausedAfterCancel = await getEarnState(args.session);
  if (
    pausedAfterCancel.autoswap?.status !== "paused" ||
    pausedAfterCancel.autoswap.generation !== canceledDelete.expectedGeneration
  ) {
    throw new Error("Canceled deletion did not leave Autoswap durably paused.");
  }
  const retryDelete = requireOk(
    await apiRequest<DeletePreparation>({
      body: { expectedGeneration: canceledDelete.expectedGeneration },
      cookie: args.session.cookie,
      method: "POST",
      path: DELETE_PREPARE_PATH,
    }),
    "Autoswap delete retry"
  );
  if (retryDelete.status !== "prepared" || !retryDelete.prepared) {
    throw new Error(
      "Autoswap delete retry did not recover the revocation transaction."
    );
  }
  await simulatePrepared({
    connection: args.connection,
    keypair: args.keypair,
    wire: retryDelete.prepared,
  });
  const deleteSignature = await sendPrepared({
    connection: args.connection,
    keypair: args.keypair,
    wire: retryDelete.prepared,
  });
  const deleteSlot = await finalizedSlot(args.connection, deleteSignature);
  const recoveredAfterLostConfirm = requireOk(
    await apiRequest<DeletePreparation>({
      body: { expectedGeneration: retryDelete.expectedGeneration },
      cookie: args.session.cookie,
      method: "POST",
      path: DELETE_PREPARE_PATH,
    }),
    "Autoswap lost-confirmation recovery"
  );
  if (
    recoveredAfterLostConfirm.status !== "off" ||
    recoveredAfterLostConfirm.prepared
  ) {
    throw new Error(
      "Finalized policy removal did not recover to off without another transaction."
    );
  }
  requireOk(
    await apiRequest({
      body: {
        expectedGeneration: retryDelete.expectedGeneration,
        finalizedSlot: deleteSlot,
        policies: retryDelete.policies,
        signature: deleteSignature,
      },
      cookie: args.session.cookie,
      method: "POST",
      path: DELETE_CONFIRM_PATH,
    }),
    "Autoswap delete confirmation replay"
  );
  await waitForAutoswap(args.session, (state) => state === null, "off");
  return {
    action: "cleanup",
    canceledDeleteLeftPaused: true,
    deleteTransactionCount: 1,
    finalState: "off",
    lostDeleteConfirmationRecovered: true,
  };
}

function requireCanaryDatabaseUrl(): string {
  if (
    process.env.AUTOSWAP_VERIFY_CANARY_ACK?.trim() !== CANARY_ACKNOWLEDGEMENT
  ) {
    throw new Error(
      `Autoswap canaries require AUTOSWAP_VERIFY_CANARY_ACK=${CANARY_ACKNOWLEDGEMENT}.`
    );
  }
  const raw = process.env.NEON_DATABASE_URL?.trim();
  if (!raw) {
    throw new Error("Autoswap canaries require NEON_DATABASE_URL.");
  }
  const url = new URL(raw);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("NEON_DATABASE_URL must be a PostgreSQL URL.");
  }
  if (["127.0.0.1", "::1", "localhost"].includes(url.hostname)) {
    throw new Error("Autoswap canaries require the production database.");
  }
  const hostFingerprint = createHash("sha256")
    .update(url.hostname)
    .digest("hex");
  if (hostFingerprint !== CANARY_PRODUCTION_DATABASE_HOST_SHA256) {
    throw new Error(
      "NEON_DATABASE_URL is not the pinned Autoswap production database endpoint."
    );
  }
  return raw;
}

function requireProductionCanaryConfig(): void {
  const baseUrl = new URL(BASE_URL);
  const deployedApi =
    baseUrl.protocol === "https:" && baseUrl.hostname === "askloyal.com";
  const localApi =
    baseUrl.protocol === "http:" &&
    ["127.0.0.1", "::1", "localhost"].includes(baseUrl.hostname);
  if (!(deployedApi || localApi)) {
    throw new Error(
      "Autoswap canaries must use the deployed API or a loopback-local API."
    );
  }
  if (![1, 2].includes(EXPECTED_LIVE_POLICY_CREATES)) {
    throw new Error(
      "Autoswap canaries require a clean two-policy install or a one-policy interrupted-setup resume."
    );
  }
  requireCanaryDatabaseUrl();
}

async function verifyProductionCanaryDatabasePreflight(args: {
  initialState: EarnState;
  session: Session;
}): Promise<void> {
  const database = createCanaryDatabase(requireCanaryDatabaseUrl());
  try {
    const [identity] = await database<
      {
        activeMovementCount: string;
        continueOrRecoverExisting: boolean;
        enrollmentCount: string;
        queuedCrossMintCount: string;
        startNewMovements: boolean;
        vaultCount: string;
      }[]
    >`
      select
        (
          select count(*)::text
          from loyal_yield.managed_vaults
          where settings = ${args.session.settingsPda}
            and vault_index = ${args.initialState.vault.accountIndex}
            and vault_pubkey = ${args.initialState.vault.pubkey}
            and active
        ) as "vaultCount",
        (
          select count(*)::text
          from loyal_yield.cross_mint_vault_opt_ins
          where cluster = ${CANARY_CLUSTER}
        ) as "enrollmentCount",
        (
          select count(*)::text
          from loyal_yield.rebalance_decisions
          where movement_route = 'cross_mint_jupiter'
            and terminal_outcome is null
        ) as "activeMovementCount",
        (
          select count(*)::text
          from loyal_yield.rebalance_opportunities
          where execution_plan ->> 'kind' = 'cross_mint_jupiter'
            and opportunity_state in (
              'waiting_alt', 'revalidate', 'ready', 'leased', 'decision_created'
            )
        ) as "queuedCrossMintCount",
        control.start_new_movements as "startNewMovements",
        control.continue_or_recover_existing as "continueOrRecoverExisting"
      from loyal_yield.cross_mint_movement_controls control
      where control.cluster = ${CANARY_CLUSTER}
    `;
    if (
      identity?.vaultCount !== "1" ||
      identity.enrollmentCount !== "0" ||
      identity.activeMovementCount !== "0" ||
      identity.queuedCrossMintCount !== "0" ||
      identity.startNewMovements !== false ||
      !identity.continueOrRecoverExisting ||
      args.initialState.autoswap
    ) {
      throw new Error(
        "Autoswap production database preflight requires the exact testing vault and a clean fail-closed cross-mint baseline."
      );
    }
  } finally {
    await database.end({ timeout: 5 });
  }
}

function positiveRaw(value: string | null): boolean {
  return value !== null && BigInt(value) > BigInt(0);
}

async function setCanaryStartGate(
  database: CanaryDatabase,
  enabled: boolean,
  ownedGeneration: string | null = null
): Promise<string> {
  return database.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(
        hashtextextended(
          ${`loyal-yield-cross-mint-control:${CANARY_CLUSTER}`},
          0
        )
      )
    `;
    const [current] = await transaction<
      {
        continueOrRecoverExisting: boolean;
        generation: string;
        startNewMovements: boolean;
        updatedBy: string;
      }[]
    >`
      select
        continue_or_recover_existing as "continueOrRecoverExisting",
        generation::text as generation,
        start_new_movements as "startNewMovements",
        updated_by as "updatedBy"
      from loyal_yield.cross_mint_movement_controls
      where cluster = ${CANARY_CLUSTER}
      for update
    `;
    if (!current) {
      throw new Error("Cross-mint production control row is missing.");
    }
    if (enabled && !current.continueOrRecoverExisting) {
      throw new Error(
        "Cross-mint recovery must be enabled before opening canary starts."
      );
    }
    if (enabled && current.startNewMovements) {
      throw new Error(
        "Cross-mint start gate was opened by another operator or canary."
      );
    }
    if (!enabled && !current.startNewMovements) {
      return current.generation;
    }
    if (
      !enabled &&
      (current.updatedBy !== CANARY_GATE_OWNER ||
        (ownedGeneration !== null && current.generation !== ownedGeneration))
    ) {
      throw new Error(
        "Cross-mint start gate ownership changed; refusing to overwrite it."
      );
    }
    const [updated] = await transaction<{ generation: string }[]>`
      update loyal_yield.cross_mint_movement_controls
      set start_new_movements = ${enabled},
          generation = generation + 1,
          updated_by = ${CANARY_GATE_OWNER},
          updated_at = now()
      where cluster = ${CANARY_CLUSTER}
        and generation = ${current.generation}::bigint
      returning generation::text as generation
    `;
    if (!updated) {
      throw new Error("Cross-mint start gate lost its generation fence.");
    }
    return updated.generation;
  });
}

async function ensureCanaryStartGateClosed(
  database: CanaryDatabase,
  lease: CanaryGateLease
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await setCanaryStartGate(database, false, lease.generation);
      lease.generation = null;
      const [gate] = await database<
        {
          continueOrRecoverExisting: boolean;
          startNewMovements: boolean;
        }[]
      >`
        select
          continue_or_recover_existing as "continueOrRecoverExisting",
          start_new_movements as "startNewMovements"
        from loyal_yield.cross_mint_movement_controls
        where cluster = ${CANARY_CLUSTER}
      `;
      if (gate?.startNewMovements === false && gate.continueOrRecoverExisting) {
        return;
      }
      throw new Error(
        "Cross-mint control readback was not starts-closed and recovery-enabled."
      );
    } catch (error) {
      lastError = error;
      await Bun.sleep(CANARY_POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    "CRITICAL: failed to close and verify the production cross-mint start gate.",
    { cause: lastError }
  );
}

async function ensureAutoswapEnrollmentFailClosed(
  session: Session
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const state = await getEarnState(session);
      if (!state.autoswap || state.autoswap.status === "paused") {
        return;
      }
      if (state.autoswap.status === "on") {
        await changeLiveAutoswapState({
          enabled: false,
          initialState: state,
          session,
        });
      }
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(3_000);
  }
  throw new Error(
    "CRITICAL: failed to verify the Autoswap enrollment paused or off after a canary error.",
    { cause: lastError }
  );
}

async function maxCanaryDecisionId(
  database: CanaryDatabase,
  vaultId: string
): Promise<string> {
  const [row] = await database<{ id: string }[]>`
    select coalesce(max(id), 0)::text as id
    from loyal_yield.rebalance_decisions
    where vault_id = ${vaultId}::bigint
      and movement_route = 'cross_mint_jupiter'
  `;
  return row?.id ?? "0";
}

async function loadCanaryMovement(
  database: CanaryDatabase,
  decisionId: string
): Promise<CanaryMovement | null> {
  const [movement] = await database<CanaryMovement[]>`
    select
      amount_raw::text as "amountRaw",
      custody_reconciled_slot::text as "custodyReconciledSlot",
      custody_version::text as "custodyVersion",
      id::text as id,
      source_liquidity_mint as "sourceMint",
      execution_plan #>> '{policy_bindings,swap,source_shard}' as "sourceShard",
      execution_plan #>> '{policy_bindings,swap,daily_source_mint_spending_cap}' as "swapDailyCap",
      execution_plan #>> '{policy_bindings,swap,max_slippage_bps}' as "swapMaxSlippageBps",
      execution_plan #>> '{policy_bindings,swap,policy_account}' as "swapPolicyAccount",
      target_liquidity_mint as "targetMint",
      terminal_observed_slot::text as "terminalObservedSlot",
      terminal_outcome as "terminalOutcome",
      terminal_reason as "terminalReason"
    from loyal_yield.rebalance_decisions
    where id = ${decisionId}::bigint
      and movement_route = 'cross_mint_jupiter'
  `;
  if (
    movement &&
    movement.sourceShard !== "classic" &&
    movement.sourceShard !== "token_2022"
  ) {
    throw new Error(
      `Cross-mint canary ${movement.id} has no recognized source shard.`
    );
  }
  return movement ?? null;
}

function assertCanaryMovementPolicyBinding(
  movement: CanaryMovement,
  state: AutoswapState
): void {
  const policy = state.boundPolicies.find(
    (candidate) => candidate.sourceShard === movement.sourceShard
  );
  if (
    !policy ||
    movement.swapPolicyAccount !== policy.account ||
    movement.swapDailyCap !== state.dailySourceMintSpendingCap ||
    movement.swapMaxSlippageBps !== String(state.maxSlippageBps)
  ) {
    throw new Error(
      `Cross-mint canary ${movement.id} is not bound to the exact enrolled ${movement.sourceShard} policy.`
    );
  }
}

async function waitForNewCanaryMovement(args: {
  afterDecisionId: string;
  database: CanaryDatabase;
  vaultId: string;
}): Promise<CanaryMovement> {
  const maximumAttempts = Number.parseInt(
    process.env.AUTOSWAP_VERIFY_MOVEMENT_WAIT_ATTEMPTS ?? "180",
    10
  );
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("AUTOSWAP_VERIFY_MOVEMENT_WAIT_ATTEMPTS must be a positive integer.");
  }
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const [row] = await args.database<{ id: string }[]>`
      select id::text as id
      from loyal_yield.rebalance_decisions
      where vault_id = ${args.vaultId}::bigint
        and movement_route = 'cross_mint_jupiter'
        and id > ${args.afterDecisionId}::bigint
      order by id
      limit 1
    `;
    if (row) {
      const movement = await loadCanaryMovement(args.database, row.id);
      if (movement) {
        return movement;
      }
    }
    await Bun.sleep(CANARY_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for a new cross-mint canary movement.");
}

async function waitForFinalizedWithdrawal(
  database: CanaryDatabase,
  decisionId: string
): Promise<CanaryMovement> {
  for (let attempt = 0; attempt < 2_400; attempt += 1) {
    const movement = await loadCanaryMovement(database, decisionId);
    if (!movement) {
      throw new Error("The active cross-mint canary movement disappeared.");
    }
    if (movement.terminalOutcome) {
      throw new Error(
        `Cross-mint canary terminalized before finalized withdrawal evidence: ${
          movement.terminalOutcome
        }/${movement.terminalReason ?? "no_reason"}.`
      );
    }
    if (
      BigInt(movement.custodyVersion) >= BigInt(1) &&
      movement.custodyReconciledSlot
    ) {
      return movement;
    }
    await Bun.sleep(CANARY_TRANSITION_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for a finalized cross-mint withdrawal.");
}

async function waitForPublishedWithdrawal(
  database: CanaryDatabase,
  decisionId: string
): Promise<void> {
  for (let attempt = 0; attempt < 2_400; attempt += 1) {
    const [published] = await database<{ signature: string }[]>`
      select coalesce(transaction_signature, '') as signature
      from loyal_yield.signed_route_submissions
      where decision_id = ${decisionId}::bigint
        and movement_leg = 'withdraw'
        and submission_state not in ('expired', 'failed')
      order by leg_generation desc
      limit 1
    `;
    if (published?.signature) {
      return;
    }
    const movement = await loadCanaryMovement(database, decisionId);
    if (movement?.terminalOutcome) {
      throw new Error(
        `Cross-mint canary terminalized before withdrawal publication: ${movement.terminalOutcome}.`
      );
    }
    await Bun.sleep(CANARY_TRANSITION_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for cross-mint withdrawal publication.");
}

async function waitForTerminalCanaryMovement(
  database: CanaryDatabase,
  decisionId: string
): Promise<CanaryMovement> {
  for (let attempt = 0; attempt < 1800; attempt += 1) {
    const movement = await loadCanaryMovement(database, decisionId);
    if (!movement) {
      throw new Error("The cross-mint canary movement disappeared.");
    }
    if (movement.terminalOutcome) {
      return movement;
    }
    await Bun.sleep(CANARY_POLL_INTERVAL_MS);
  }
  throw new Error("Timed out waiting for cross-mint terminalization.");
}

async function verifyCanaryMovementEvidence(
  database: CanaryDatabase,
  movement: CanaryMovement
): Promise<JsonRecord> {
  if (
    movement.sourceMint === movement.targetMint ||
    BigInt(movement.amountRaw) <= BigInt(0) ||
    BigInt(movement.amountRaw) > DAILY_CAP_RAW
  ) {
    throw new Error("Cross-mint canary exceeded its immutable route bounds.");
  }
  if (movement.terminalOutcome !== "completed_target") {
    throw new Error(
      `Cross-mint canary ended ${movement.terminalOutcome}/${
        movement.terminalReason ?? "no_reason"
      }, not completed_target.`
    );
  }
  const submissions = await database<CanarySubmission[]>`
    select
      effect_credit_amount_raw::text as "creditAmountRaw",
      effect_credit_mint as "creditMint",
      effect_debit_amount_raw::text as "debitAmountRaw",
      effect_debit_mint as "debitMint",
      finalized_slot::text as "finalizedSlot",
      movement_leg as leg,
      coalesce(transaction_signature, '') as signature,
      submission_state as state
    from loyal_yield.signed_route_submissions
    where decision_id = ${movement.id}::bigint
      and movement_leg is not null
    order by movement_leg, leg_generation
  `;
  const finalized = (leg: CanarySubmission["leg"]) =>
    submissions.filter(
      (submission) =>
        submission.leg === leg &&
        submission.state === "reconciled" &&
        submission.finalizedSlot &&
        submission.signature
    );
  const withdraw = finalized("withdraw")[0];
  const swap = finalized("swap").find(
    (submission) =>
      submission.debitMint === movement.sourceMint &&
      positiveRaw(submission.debitAmountRaw) &&
      submission.creditMint === movement.targetMint &&
      positiveRaw(submission.creditAmountRaw)
  );
  const deposit = finalized("deposit").find(
    (submission) =>
      submission.debitMint === movement.targetMint &&
      positiveRaw(submission.debitAmountRaw)
  );
  if (!(withdraw && swap && deposit)) {
    throw new Error(
      "Cross-mint canary lacks movement-attributed finalized withdraw, swap debit/credit, or deposit debit evidence."
    );
  }
  return {
    amountRaw: movement.amountRaw,
    decisionId: movement.id,
    depositDebitRaw: deposit.debitAmountRaw,
    depositFinalizedSlot: deposit.finalizedSlot,
    depositSignature: deposit.signature,
    sourceDebitRaw: swap.debitAmountRaw,
    sourceMint: movement.sourceMint,
    sourceShard: movement.sourceShard,
    swapSignature: swap.signature,
    targetCreditRaw: swap.creditAmountRaw,
    targetMint: movement.targetMint,
    terminalObservedSlot: movement.terminalObservedSlot,
    withdrawSignature: withdraw.signature,
  };
}

async function assertCanaryProductionBaseline(args: {
  database: CanaryDatabase;
  session: Session;
  state: AutoswapState;
  vaultPubkey: string;
}): Promise<string> {
  const [gate] = await args.database<
    {
      continueOrRecoverExisting: boolean;
      startNewMovements: boolean;
    }[]
  >`
    select
      continue_or_recover_existing as "continueOrRecoverExisting",
      start_new_movements as "startNewMovements"
    from loyal_yield.cross_mint_movement_controls
    where cluster = ${CANARY_CLUSTER}
  `;
  if (gate?.startNewMovements !== false || !gate.continueOrRecoverExisting) {
    throw new Error(
      "Autoswap canaries require starts off and recovery on at baseline."
    );
  }
  const vaults = await args.database<{ id: string }[]>`
    select id::text as id
    from loyal_yield.managed_vaults
    where settings = ${args.session.settingsPda}
      and vault_index = 1
      and vault_pubkey = ${args.vaultPubkey}
      and active
  `;
  if (vaults.length !== 1) {
    throw new Error(
      "Autoswap canary smart account has no unique managed vault."
    );
  }
  const vaultId = vaults[0]!.id;
  const enrollments = await args.database<
    {
      dailyCap: string;
      enabled: boolean;
      settings: string;
      vaultPubkey: string;
    }[]
  >`
    select
      daily_source_mint_spending_cap::text as "dailyCap",
      enabled,
      settings,
      vault_pubkey as "vaultPubkey"
    from loyal_yield.cross_mint_vault_opt_ins
    where cluster = ${CANARY_CLUSTER}
  `;
  if (
    enrollments.length !== 1 ||
    !enrollments[0]?.enabled ||
    enrollments[0].settings !== args.session.settingsPda ||
    enrollments[0].vaultPubkey !== args.vaultPubkey ||
    enrollments[0].dailyCap !== DAILY_CAP_RAW.toString() ||
    args.state.status !== "on"
  ) {
    throw new Error(
      "Autoswap canaries require exactly one on enrollment bound to the testing vault."
    );
  }
  const [active] = await args.database<{ count: string }[]>`
    select count(*)::text as count
    from loyal_yield.rebalance_decisions
    where movement_route = 'cross_mint_jupiter'
      and terminal_outcome is null
  `;
  if (active?.count !== "0") {
    throw new Error(
      "Autoswap canaries require zero active cross-mint movements."
    );
  }
  const foreignOpportunities = await args.database<{ count: string }[]>`
    select count(*)::text as count
    from loyal_yield.rebalance_opportunities
    where execution_plan ->> 'kind' = 'cross_mint_jupiter'
      and opportunity_state in (
        'waiting_alt', 'revalidate', 'ready', 'leased', 'decision_created'
      )
      and vault_id <> ${vaultId}::bigint
  `;
  if (foreignOpportunities[0]?.count !== "0") {
    throw new Error(
      "Autoswap canaries refuse to open starts with foreign cross-mint work queued."
    );
  }
  return vaultId;
}

async function pauseAndExpectMovementBlockedDelete(args: {
  connection: Connection;
  keypair: Keypair;
  session: Session;
}): Promise<string> {
  const before = await getEarnState(args.session);
  if (before.autoswap?.status !== "on") {
    throw new Error("Movement-safe deletion proof requires Autoswap to be on.");
  }
  const blocked = await apiRequest<DeletePreparation>({
    body: { expectedGeneration: before.autoswap.generation },
    cookie: args.session.cookie,
    method: "POST",
    path: DELETE_PREPARE_PATH,
  });
  if (blocked.status !== 409) {
    const racedDelete = requireOk(
      blocked,
      "terminal-race Autoswap delete preparation"
    );
    if (racedDelete.status === "prepared" && racedDelete.prepared) {
      await simulatePrepared({
        connection: args.connection,
        keypair: args.keypair,
        wire: racedDelete.prepared,
      });
      const signature = await sendPrepared({
        connection: args.connection,
        keypair: args.keypair,
        wire: racedDelete.prepared,
      });
      const slot = await finalizedSlot(args.connection, signature);
      requireOk(
        await apiRequest({
          body: {
            expectedGeneration: racedDelete.expectedGeneration,
            finalizedSlot: slot,
            policies: racedDelete.policies,
            signature,
          },
          cookie: args.session.cookie,
          method: "POST",
          path: DELETE_CONFIRM_PATH,
        }),
        "terminal-race Autoswap delete confirmation"
      );
      await waitForAutoswap(args.session, (state) => state === null, "off");
    } else if (racedDelete.status !== "off") {
      throw new Error(
        "Terminal-race deletion returned no safe cleanup operation."
      );
    }
    throw new Error(
      "The canary movement terminalized before deletion-conflict observation; finalized policy cleanup completed safely."
    );
  }
  requireStatus(
    blocked,
    409,
    "active-movement Autoswap deletion",
    "movement_in_progress"
  );
  const paused = await waitForAutoswap(
    args.session,
    (state) => state?.status === "paused",
    "paused after movement-safe deletion rejection"
  );
  if (
    !paused ||
    BigInt(paused.generation) !== BigInt(before.autoswap.generation) + BigInt(1)
  ) {
    throw new Error(
      "Movement-safe deletion did not atomically commit exactly one pause generation."
    );
  }
  return paused.generation;
}

async function runProductionCanary(args: {
  connection: Connection;
  controlledPause: boolean;
  database: CanaryDatabase;
  gateLease: CanaryGateLease;
  keypair: Keypair;
  session: Session;
  state: AutoswapState;
  vaultId: string;
}): Promise<JsonRecord> {
  const afterDecisionId = await maxCanaryDecisionId(
    args.database,
    args.vaultId
  );
  let gateOpen = false;
  let movement: CanaryMovement | null = null;
  try {
    args.gateLease.generation = await setCanaryStartGate(args.database, true);
    gateOpen = true;
    movement = await waitForNewCanaryMovement({
      afterDecisionId,
      database: args.database,
      vaultId: args.vaultId,
    });
    assertCanaryMovementPolicyBinding(movement, args.state);
    // Initial withdrawal publication rechecks the activation gate generation.
    // Once signed bytes are durably published, user pause may race safely with
    // finality while recovery remains enabled and independent.
    await waitForPublishedWithdrawal(args.database, movement.id);
    if (args.controlledPause) {
      await pauseAndExpectMovementBlockedDelete({
        connection: args.connection,
        keypair: args.keypair,
        session: args.session,
      });
    }
    await setCanaryStartGate(args.database, false, args.gateLease.generation);
    args.gateLease.generation = null;
    gateOpen = false;
    movement = await waitForFinalizedWithdrawal(args.database, movement.id);
    if (args.controlledPause) {
      const resumed = await changeLiveAutoswapState({
        enabled: true,
        initialState: await getEarnState(args.session),
        session: args.session,
      });
      await changeLiveAutoswapState({
        enabled: false,
        initialState: await getEarnState(args.session),
        session: args.session,
      });
      if (resumed.finalState !== "on") {
        throw new Error(
          "Controlled post-withdrawal resume did not settle before the final pause."
        );
      }
    }
  } finally {
    if (gateOpen) {
      await ensureCanaryStartGateClosed(args.database, args.gateLease);
    }
  }
  if (!movement) {
    throw new Error("Cross-mint canary did not create a movement.");
  }
  const terminal = await waitForTerminalCanaryMovement(
    args.database,
    movement.id
  );
  return {
    ...(await verifyCanaryMovementEvidence(args.database, terminal)),
    controlledPauseAfterFinalizedWithdrawal: args.controlledPause,
  };
}

async function provePausedEnrollmentStartsNothing(args: {
  database: CanaryDatabase;
  gateLease: CanaryGateLease;
  session: Session;
  vaultId: string;
}): Promise<void> {
  const state = await getEarnState(args.session);
  if (state.autoswap?.status !== "paused") {
    throw new Error("Zero-start proof requires Autoswap to remain paused.");
  }
  const afterDecisionId = await maxCanaryDecisionId(
    args.database,
    args.vaultId
  );
  let gateOpen = false;
  try {
    args.gateLease.generation = await setCanaryStartGate(args.database, true);
    gateOpen = true;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const latest = await maxCanaryDecisionId(args.database, args.vaultId);
      if (BigInt(latest) > BigInt(afterDecisionId)) {
        throw new Error("Paused Autoswap started a new cross-mint movement.");
      }
      await Bun.sleep(CANARY_POLL_INTERVAL_MS);
    }
  } finally {
    if (gateOpen) {
      await ensureCanaryStartGateClosed(args.database, args.gateLease);
    }
  }
}

async function verifyProductionCanaries(args: {
  connection: Connection;
  keypair: Keypair;
  session: Session;
}): Promise<JsonRecord> {
  const database = createCanaryDatabase(requireCanaryDatabaseUrl());
  const gateLease: CanaryGateLease = { generation: null };
  let baselineVerified = false;
  try {
    const initialState = await getEarnState(args.session);
    const installed = initialState.autoswap;
    if (!installed) {
      throw new Error("Autoswap canaries require an installed enrollment.");
    }
    const vaultId = await assertCanaryProductionBaseline({
      database,
      session: args.session,
      state: installed,
      vaultPubkey: initialState.vault.pubkey,
    });
    baselineVerified = true;
    const first = await runProductionCanary({
      connection: args.connection,
      controlledPause: true,
      database,
      gateLease,
      keypair: args.keypair,
      session: args.session,
      state: installed,
      vaultId,
    });
    await provePausedEnrollmentStartsNothing({
      database,
      gateLease,
      session: args.session,
      vaultId,
    });
    await changeLiveAutoswapState({
      enabled: true,
      initialState: await getEarnState(args.session),
      session: args.session,
    });
    const resumed = (await getEarnState(args.session)).autoswap;
    if (resumed?.status !== "on") {
      throw new Error("Autoswap did not settle on before the second canary.");
    }
    const second = await runProductionCanary({
      connection: args.connection,
      controlledPause: false,
      database,
      gateLease,
      keypair: args.keypair,
      session: args.session,
      state: resumed,
      vaultId,
    });
    const current = (await getEarnState(args.session)).autoswap;
    if (!current) {
      throw new Error("Autoswap enrollment disappeared before cleanup.");
    }
    const cleanup = await cleanupLiveAutoswap({
      connection: args.connection,
      generation: current.generation,
      keypair: args.keypair,
      session: args.session,
    });
    const [remaining] = await database<{ count: string }[]>`
      select count(*)::text as count
      from loyal_yield.cross_mint_vault_opt_ins
      where cluster = ${CANARY_CLUSTER}
        and settings = ${args.session.settingsPda}
        and vault_index = 1
        and vault_pubkey = ${initialState.vault.pubkey}
    `;
    if (remaining?.count !== "0") {
      throw new Error("Autoswap enrollment remained after finalized cleanup.");
    }
    const shards = new Set([first.sourceShard, second.sourceShard]);
    if (
      shards.size !== 2 ||
      !shards.has("classic") ||
      !shards.has("token_2022")
    ) {
      throw new Error(
        "The two bounded canaries did not cover classic and Token-2022 sources."
      );
    }
    return {
      canaries: [first, second],
      cleanup,
      finalState: "off",
      pausedEnrollmentStartedNewMovements: false,
    };
  } catch (error) {
    try {
      await ensureAutoswapEnrollmentFailClosed(args.session);
    } catch (safetyError) {
      throw new AggregateError(
        [error, safetyError],
        "Autoswap canary failed and its enrollment safety state could not be verified."
      );
    }
    throw error;
  } finally {
    let gateError: unknown;
    if (baselineVerified) {
      try {
        await ensureCanaryStartGateClosed(database, gateLease);
      } catch (error) {
        gateError = error;
      }
    }
    await database.end({ timeout: 5 });
    if (gateError) {
      throw gateError;
    }
  }
}

async function verifyExistingProductionCanary(args: {
  connection: Connection;
  keypair: Keypair;
  session: Session;
}): Promise<JsonRecord> {
  const database = createCanaryDatabase(requireCanaryDatabaseUrl());
  const gateLease: CanaryGateLease = { generation: null };
  let baselineVerified = false;
  try {
    const initialState = await getEarnState(args.session);
    const installed = initialState.autoswap;
    if (installed?.status !== "on") {
      throw new Error(
        "Existing Autoswap canary requires an installed on enrollment."
      );
    }
    const vaultId = await assertCanaryProductionBaseline({
      database,
      session: args.session,
      state: installed,
      vaultPubkey: initialState.vault.pubkey,
    });
    baselineVerified = true;
    const canary = await runProductionCanary({
      connection: args.connection,
      controlledPause: true,
      database,
      gateLease,
      keypair: args.keypair,
      session: args.session,
      state: installed,
      vaultId,
    });
    await provePausedEnrollmentStartsNothing({
      database,
      gateLease,
      session: args.session,
      vaultId,
    });
    return {
      action: "canary-existing",
      canary,
      finalState: "paused",
      pausedEnrollmentStartedNewMovements: false,
    };
  } catch (error) {
    await ensureAutoswapEnrollmentFailClosed(args.session);
    throw error;
  } finally {
    let gateError: unknown;
    if (baselineVerified) {
      try {
        await ensureCanaryStartGateClosed(database, gateLease);
      } catch (error) {
        gateError = error;
      }
    }
    await database.end({ timeout: 5 });
    if (gateError) {
      throw gateError;
    }
  }
}

async function verifyLive(args: {
  action: LiveAction;
  connection: Connection;
  initialState: EarnState;
  keypair: Keypair;
  session: Session;
}): Promise<JsonRecord> {
  if (args.action === "pause" || args.action === "resume") {
    return changeLiveAutoswapState({
      enabled: args.action === "resume",
      initialState: args.initialState,
      session: args.session,
    });
  }
  if (args.action === "cleanup") {
    if (!args.initialState.autoswap) {
      throw new Error("Autoswap cleanup requires an existing enrollment.");
    }
    return cleanupLiveAutoswap({
      connection: args.connection,
      generation: args.initialState.autoswap.generation,
      keypair: args.keypair,
      session: args.session,
    });
  }
  if (args.initialState.autoswap) {
    throw new Error(
      `Live Autoswap verification requires off state; found ${args.initialState.autoswap.status}.`
    );
  }
  if (!args.initialState.position) {
    throw new Error(
      "Live Autoswap verification requires an active Earn position."
    );
  }

  let prepared = await preparePolicies(args.session);
  if (prepared.vault.pubkey !== args.initialState.vault.pubkey) {
    throw new Error(
      "Prepared Autoswap policies target a different Earn vault."
    );
  }
  const initiallyPending = pendingPolicies(prepared);
  if (initiallyPending.length !== EXPECTED_LIVE_POLICY_CREATES) {
    throw new Error(
      `Live Autoswap verification expected ${EXPECTED_LIVE_POLICY_CREATES} policy create transaction(s), but preparation returned ${initiallyPending.length}.`
    );
  }
  const initiallyExecutable = initiallyPending[0];
  if (initiallyExecutable?.prepared) {
    await simulatePrepared({
      connection: args.connection,
      keypair: args.keypair,
      wire: initiallyExecutable.prepared,
    });
  }
  for (const policy of initiallyPending.slice(1)) {
    if (policy.prepared) {
      await assertPreparedAwaitsPreviousPolicy({
        connection: args.connection,
        keypair: args.keypair,
        wire: policy.prepared,
      });
    }
  }

  const submitted = new Map<
    "classic" | "token_2022",
    { finalizedSlot: string; signature: string }
  >();
  const firstMissing = initiallyExecutable;
  if (firstMissing?.prepared) {
    const signature = await sendPrepared({
      connection: args.connection,
      keypair: args.keypair,
      wire: firstMissing.prepared,
    });
    submitted.set(firstMissing.sourceShard, {
      finalizedSlot: await finalizedSlot(args.connection, signature),
      signature,
    });

    const resumed = await waitForFinalizedPolicyDiscovery({
      session: args.session,
      sourceShard: firstMissing.sourceShard,
    });
    const resumedFirst = resumed.policies.find(
      (policy) => policy.sourceShard === firstMissing.sourceShard
    );
    if (!(resumedFirst?.existing && !resumedFirst.prepared)) {
      throw new Error(
        "Interrupted setup did not reuse its finalized first policy."
      );
    }
    prepared = resumed;
  }

  for (const policy of pendingPolicies(prepared)) {
    if (!policy.prepared) {
      throw new Error("Pending Autoswap policy is missing its transaction.");
    }
    await simulatePrepared({
      connection: args.connection,
      keypair: args.keypair,
      wire: policy.prepared,
    });
    const signature = await sendPrepared({
      connection: args.connection,
      keypair: args.keypair,
      wire: policy.prepared,
    });
    submitted.set(policy.sourceShard, {
      finalizedSlot: await finalizedSlot(args.connection, signature),
      signature,
    });
  }

  const finalPrepared = await preparePolicies(args.session);
  if (
    finalPrepared.policies.some((policy) => !policy.existing || policy.prepared)
  ) {
    throw new Error(
      "Autoswap setup did not converge to two existing policies."
    );
  }
  if (submitted.size !== EXPECTED_LIVE_POLICY_CREATES) {
    throw new Error(
      `Live Autoswap verification submitted ${submitted.size} policy create transaction(s), expected ${EXPECTED_LIVE_POLICY_CREATES}.`
    );
  }
  const policyEvidence = finalPrepared.policies.map((policy) => ({
    account: policy.policy.account,
    seed: policy.policy.seed,
    sourceShard: policy.sourceShard,
    ...(submitted.get(policy.sourceShard) ?? {}),
  })) as [
    AutoswapPolicyState & { finalizedSlot?: string; signature?: string },
    AutoswapPolicyState & { finalizedSlot?: string; signature?: string }
  ];
  requireOk(
    await apiRequest({
      body: {
        dailySourceMintSpendingCap: DAILY_CAP_RAW.toString(),
        maxSlippageBps: MAX_SLIPPAGE_BPS,
        policies: policyEvidence,
      },
      cookie: args.session.cookie,
      method: "POST",
      path: CONFIRM_PATH,
    }),
    "Autoswap policy confirmation"
  );

  const on = await waitForAutoswap(
    args.session,
    (state) => state?.status === "on",
    "on"
  );
  if (!on) {
    throw new Error("Autoswap enrollment disappeared after confirmation.");
  }
  const pause = requireOk(
    await apiRequest<{
      enabled: boolean;
      generation: string;
      status: string;
    }>({
      body: { enabled: false, expectedGeneration: on.generation },
      cookie: args.session.cookie,
      method: "POST",
      path: TOGGLE_PATH,
    }),
    "Autoswap pause"
  );
  if (
    pause.enabled ||
    BigInt(pause.generation) !== BigInt(on.generation) + BigInt(1)
  ) {
    throw new Error("Autoswap pause did not advance generation exactly once.");
  }
  const pauseRetry = requireOk(
    await apiRequest<{ generation: string }>({
      body: { enabled: false, expectedGeneration: on.generation },
      cookie: args.session.cookie,
      method: "POST",
      path: TOGGLE_PATH,
    }),
    "Autoswap pause retry"
  );
  if (pauseRetry.generation !== pause.generation) {
    throw new Error("Autoswap pause retry advanced generation.");
  }
  const staleResume = await apiRequest({
    body: {
      enabled: true,
      expectedGeneration: on.generation,
    },
    cookie: args.session.cookie,
    method: "POST",
    path: TOGGLE_PATH,
  });
  requireStatus(
    staleResume,
    409,
    "stale Autoswap resume",
    "autoswap_toggle_failed"
  );
  const resume = requireOk(
    await apiRequest<{
      enabled: boolean;
      generation: string;
      status: string;
    }>({
      body: { enabled: true, expectedGeneration: pause.generation },
      cookie: args.session.cookie,
      method: "POST",
      path: TOGGLE_PATH,
    }),
    "Autoswap resume"
  );
  if (
    !resume.enabled ||
    BigInt(resume.generation) !== BigInt(pause.generation) + BigInt(1)
  ) {
    throw new Error("Autoswap resume did not advance generation exactly once.");
  }
  if (args.action === "install") {
    return {
      action: "install",
      createdPolicyTransactions: submitted.size,
      finalState: "on",
      pauseGeneration: pause.generation,
      resumeGeneration: resume.generation,
    };
  }
  if (args.action === "canary") {
    return {
      action: "canary",
      createdPolicyTransactions: submitted.size,
      pauseGeneration: pause.generation,
      resumeGeneration: resume.generation,
      ...(await verifyProductionCanaries({
        connection: args.connection,
        keypair: args.keypair,
        session: args.session,
      })),
    };
  }
  const cleanup = await cleanupLiveAutoswap({
    connection: args.connection,
    generation: resume.generation,
    keypair: args.keypair,
    session: args.session,
  });
  return {
    ...cleanup,
    action: "full",
    createdPolicyTransactions: submitted.size,
    pauseGeneration: pause.generation,
    resumeGeneration: resume.generation,
  };
}

async function verifyProductionCanaryLifecycle(args: {
  action: LiveAction;
  connection: Connection;
  initialState: EarnState;
  keypair: Keypair;
  session: Session;
}): Promise<JsonRecord> {
  try {
    return await verifyLive(args);
  } catch (error) {
    const safetyErrors: unknown[] = [];
    try {
      await ensureAutoswapEnrollmentFailClosed(args.session);
    } catch (safetyError) {
      safetyErrors.push(safetyError);
    }
    const database = createCanaryDatabase(requireCanaryDatabaseUrl());
    try {
      await ensureCanaryStartGateClosed(database, { generation: null });
    } catch (safetyError) {
      safetyErrors.push(safetyError);
    } finally {
      await database.end({ timeout: 5 });
    }
    if (safetyErrors.length > 0) {
      throw new AggregateError(
        [error, ...safetyErrors],
        "Autoswap production lifecycle failed and one or more safety states could not be verified."
      );
    }
    throw error;
  }
}

function requireDisposableLocalDatabaseUrl(): string {
  const raw = process.env.YIELD_OPTIMIZATION_LOCAL_DATABASE_URL?.trim();
  if (!raw) {
    throw new Error(
      "local-state mode requires YIELD_OPTIMIZATION_LOCAL_DATABASE_URL."
    );
  }
  const databaseUrl = new URL(raw);
  const baseUrl = new URL(BASE_URL);
  const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  const databaseName = databaseUrl.pathname.replace(/^\//, "");
  if (
    !localHosts.has(databaseUrl.hostname) ||
    !localHosts.has(baseUrl.hostname) ||
    !databaseName.startsWith("loyal_autoswap_api_verify_")
  ) {
    throw new Error(
      "local-state mode only runs against localhost and a loyal_autoswap_api_verify_* database."
    );
  }
  return raw;
}

async function verifyLocalState(args: {
  connection: Connection;
  initialState: EarnState;
  keypair: Keypair;
  session: Session;
}): Promise<JsonRecord> {
  if (args.initialState.autoswap) {
    throw new Error("local-state verification requires Autoswap to be off.");
  }
  if (!args.initialState.position) {
    throw new Error(
      "local-state verification requires an active Earn fixture."
    );
  }

  const database = postgres(requireDisposableLocalDatabaseUrl(), { max: 1 });
  const prepared = await preparePolicies(args.session);
  const pending = pendingPolicies(prepared);
  const nextPolicy = pending[0];
  if (nextPolicy?.prepared) {
    await simulatePrepared({
      connection: args.connection,
      keypair: args.keypair,
      wire: nextPolicy.prepared,
    });
  }
  for (const policy of pending.slice(1)) {
    if (policy.prepared) {
      await assertPreparedAwaitsPreviousPolicy({
        connection: args.connection,
        keypair: args.keypair,
        wire: policy.prepared,
      });
    }
  }

  const walletAddress = args.keypair.publicKey.toBase58();
  const scope = {
    cluster: prepared.policies[0].persistence.cluster,
    settings: args.session.settingsPda,
    vaultIndex: prepared.vault.accountIndex,
    vaultPubkey: prepared.vault.pubkey,
  };
  let movementId: string | null = null;
  let positionIds: string[] = [];
  const policyAccounts = prepared.policies.map(
    (policy) => policy.policy.account
  );

  try {
    const activePositions = await database<{ id: string }[]>`
      select id::text
      from loyal_yield.user_yield_positions
      where settings = ${scope.settings}
        and vault_index = ${scope.vaultIndex}
        and wallet_address = ${walletAddress}
        and status = 'active'
    `;
    positionIds = activePositions.map((row) => row.id);
    if (positionIds.length === 0) {
      throw new Error("The disposable database has no active Earn positions.");
    }
    await database`
      update loyal_yield.user_yield_positions
      set status = 'closed'
      where id in ${database(positionIds)}
    `;

    const missingPositionPrepare = await apiRequest({
      body: {
        dailySourceMintSpendingCap: DAILY_CAP_RAW.toString(),
        maxSlippageBps: MAX_SLIPPAGE_BPS,
      },
      cookie: args.session.cookie,
      method: "POST",
      path: PREPARE_PATH,
    });
    requireStatus(
      missingPositionPrepare,
      409,
      "missing-position policy preparation",
      "earn_position_required"
    );
    const missingPositionConfirm = await apiRequest({
      body: {
        dailySourceMintSpendingCap: DAILY_CAP_RAW.toString(),
        maxSlippageBps: MAX_SLIPPAGE_BPS,
        policies: prepared.policies.map((policy) => ({
          account: policy.policy.account,
          seed: policy.policy.seed,
          sourceShard: policy.sourceShard,
        })),
      },
      cookie: args.session.cookie,
      method: "POST",
      path: CONFIRM_PATH,
    });
    requireStatus(
      missingPositionConfirm,
      409,
      "missing-position policy confirmation",
      "earn_position_required"
    );

    await database`
      update loyal_yield.user_yield_positions
      set status = 'active'
      where id in ${database(positionIds)}
    `;
    positionIds = [];

    await database.begin(async (transaction) => {
      await transaction`
        delete from loyal_yield.cross_mint_swap_policies
        where cluster = ${scope.cluster}
          and policy_account in ${transaction(policyAccounts)}
      `;
      for (const policy of prepared.policies) {
        await transaction`
          insert into loyal_yield.cross_mint_swap_policies (
            cluster,
            settings,
            authority,
            policy_seed,
            policy_account,
            vault_index,
            vault_pubkey,
            delegated_signer,
            source_shard,
            max_slippage_bps,
            daily_source_mint_spending_cap,
            manifest_fingerprint,
            active,
            start_eligible,
            last_mutation,
            source_commitment,
            last_seen_slot,
            last_seen_signature
          ) values (
            ${scope.cluster},
            ${scope.settings},
            ${walletAddress},
            ${policy.policy.seed},
            ${policy.policy.account},
            ${scope.vaultIndex},
            ${scope.vaultPubkey},
            ${policy.persistence.delegatedSigner},
            ${policy.sourceShard},
            ${MAX_SLIPPAGE_BPS},
            ${DAILY_CAP_RAW.toString()},
            'local-api-verifier',
            true,
            true,
            'create',
            'finalized',
            1,
            'local-api-verifier'
          )
        `;
      }
      const classic = prepared.policies.find(
        (policy) => policy.sourceShard === "classic"
      );
      const token2022 = prepared.policies.find(
        (policy) => policy.sourceShard === "token_2022"
      );
      if (!(classic && token2022)) {
        throw new Error("Prepared policy shards are incomplete.");
      }
      await transaction`
        insert into loyal_yield.cross_mint_vault_opt_ins (
          cluster,
          settings,
          vault_index,
          vault_pubkey,
          enabled,
          classic_policy_account,
          classic_policy_seed,
          token_2022_policy_account,
          token_2022_policy_seed,
          max_slippage_bps,
          daily_source_mint_spending_cap,
          generation
        ) values (
          ${scope.cluster},
          ${scope.settings},
          ${scope.vaultIndex},
          ${scope.vaultPubkey},
          true,
          ${classic.policy.account},
          ${classic.policy.seed},
          ${token2022.policy.account},
          ${token2022.policy.seed},
          ${MAX_SLIPPAGE_BPS},
          ${DAILY_CAP_RAW.toString()},
          1
        )
      `;
    });

    const on = (await getEarnState(args.session)).autoswap;
    if (on?.status !== "on" || on.generation !== "1") {
      throw new Error("The local enrollment fixture did not resolve to on.");
    }
    const duplicateSetup = await apiRequest({
      body: {
        dailySourceMintSpendingCap: DAILY_CAP_RAW.toString(),
        maxSlippageBps: MAX_SLIPPAGE_BPS,
      },
      cookie: args.session.cookie,
      method: "POST",
      path: PREPARE_PATH,
    });
    requireStatus(
      duplicateSetup,
      409,
      "duplicate Autoswap setup",
      "autoswap_already_installed"
    );

    const pause = requireOk(
      await apiRequest<{
        enabled: boolean;
        generation: string;
        status: string;
      }>({
        body: { enabled: false, expectedGeneration: "1" },
        cookie: args.session.cookie,
        method: "POST",
        path: TOGGLE_PATH,
      }),
      "local Autoswap pause"
    );
    if (
      pause.enabled ||
      pause.generation !== "2" ||
      pause.status !== "paused"
    ) {
      throw new Error("Autoswap pause did not advance generation to 2.");
    }
    const pauseRetry = requireOk(
      await apiRequest<{ generation: string }>({
        body: { enabled: false, expectedGeneration: "1" },
        cookie: args.session.cookie,
        method: "POST",
        path: TOGGLE_PATH,
      }),
      "local Autoswap pause retry"
    );
    if (pauseRetry.generation !== "2") {
      throw new Error("Autoswap pause retry advanced generation.");
    }

    const unsafeResume = await apiRequest({
      body: { enabled: true, expectedGeneration: "2" },
      cookie: args.session.cookie,
      method: "POST",
      path: TOGGLE_PATH,
    });
    requireStatus(
      unsafeResume,
      409,
      "resume without canonical on-chain policies",
      "autoswap_toggle_failed"
    );
    const stillPaused = (await getEarnState(args.session)).autoswap;
    if (stillPaused?.status !== "paused" || stillPaused.generation !== "2") {
      throw new Error("Failed resume did not leave Autoswap paused.");
    }

    await database`
      update loyal_yield.cross_mint_vault_opt_ins
      set enabled = true, generation = 3, updated_at = now()
      where cluster = ${scope.cluster}
        and settings = ${scope.settings}
        and vault_index = ${scope.vaultIndex}
        and vault_pubkey = ${scope.vaultPubkey}
    `;
    const [vault] = await database<{ id: string }[]>`
      select id::text
      from loyal_yield.managed_vaults
      where settings = ${scope.settings}
        and vault_index = ${scope.vaultIndex}
        and vault_pubkey = ${scope.vaultPubkey}
        and active = true
      order by last_seen_at desc, id desc
      limit 1
    `;
    if (!vault) {
      throw new Error("The disposable database has no managed Earn vault.");
    }
    const [movement] = await database<{ id: string }[]>`
      insert into loyal_yield.rebalance_decisions (
        vault_id,
        status,
        source_reserve,
        target_reserve,
        liquidity_mint,
        amount_raw,
        decision_reason,
        idempotency_key,
        source_liquidity_mint,
        target_liquidity_mint,
        movement_route,
        active_target_reserve,
        custody_mint,
        custody_amount_raw,
        custody_account,
        cross_mint_activation_control_generation
      ) values (
        ${vault.id},
        'planned',
        'local-source-reserve',
        'local-target-reserve',
        'local-source-mint',
        1000000,
        'target_supply_apy_exceeds_source',
        ${`autoswap-local-${crypto.randomUUID()}`},
        'local-source-mint',
        'local-target-mint',
        'cross_mint_jupiter',
        'local-target-reserve',
        'local-source-mint',
        1000000,
        'local-source-reserve',
        3
      )
      returning id::text
    `;
    if (!movement) {
      throw new Error("Failed to create the local movement fixture.");
    }
    movementId = movement.id;

    const blockedDelete = await apiRequest({
      body: { expectedGeneration: "3" },
      cookie: args.session.cookie,
      method: "POST",
      path: DELETE_PREPARE_PATH,
    });
    requireStatus(
      blockedDelete,
      409,
      "movement-safe Autoswap deletion",
      "movement_in_progress"
    );
    const pausedForDelete = (await getEarnState(args.session)).autoswap;
    if (
      pausedForDelete?.status !== "paused" ||
      pausedForDelete.generation !== "4"
    ) {
      throw new Error("Blocked deletion did not durably pause Autoswap.");
    }
    const stalePause = await apiRequest({
      body: { enabled: false, expectedGeneration: "1" },
      cookie: args.session.cookie,
      method: "POST",
      path: TOGGLE_PATH,
    });
    requireStatus(
      stalePause,
      409,
      "ABA-stale Autoswap pause",
      "autoswap_toggle_failed"
    );

    await database`
      delete from loyal_yield.rebalance_decisions where id = ${movementId}
    `;
    movementId = null;
    const recoveredDelete = requireOk(
      await apiRequest<DeletePreparation>({
        body: { expectedGeneration: "4" },
        cookie: args.session.cookie,
        method: "POST",
        path: DELETE_PREPARE_PATH,
      }),
      "lost-confirmation Autoswap cleanup"
    );
    if (recoveredDelete.status !== "off" || recoveredDelete.prepared) {
      throw new Error(
        "Absent policies did not reconcile directly to off without another transaction."
      );
    }
    if ((await getEarnState(args.session)).autoswap !== null) {
      throw new Error("Local Autoswap enrollment remained after cleanup.");
    }

    return {
      duplicateSetupRejected: true,
      failedResumeLeftPaused: true,
      lostConfirmationRecoveredOff: true,
      missingPositionConfirmRejected: true,
      missingPositionPrepareRejected: true,
      movementDeletePausedAndBlocked: true,
      pauseGeneration: pause.generation,
      pauseRetryGeneration: pauseRetry.generation,
      staleGenerationRejectedAfterAba: true,
    };
  } finally {
    if (positionIds.length > 0) {
      await database`
        update loyal_yield.user_yield_positions
        set status = 'active'
        where id in ${database(positionIds)}
      `.catch(() => undefined);
    }
    if (movementId) {
      await database`
        delete from loyal_yield.rebalance_decisions where id = ${movementId}
      `.catch(() => undefined);
    }
    await database`
      delete from loyal_yield.cross_mint_vault_opt_ins
      where cluster = ${scope.cluster}
        and settings = ${scope.settings}
        and vault_index = ${scope.vaultIndex}
        and vault_pubkey = ${scope.vaultPubkey}
    `.catch(() => undefined);
    await database`
      delete from loyal_yield.cross_mint_swap_policies
      where cluster = ${scope.cluster}
        and policy_account in ${database(policyAccounts)}
        and last_seen_signature = 'local-api-verifier'
    `.catch(() => undefined);
    await database.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  if (MODE !== "read-only" && MODE !== "local-state" && MODE !== "live") {
    throw new Error(
      "AUTOSWAP_VERIFY_MODE must be read-only, local-state, or live."
    );
  }
  if (
    MODE === "live" &&
    LIVE_ACTION !== "canary" &&
    LIVE_ACTION !== "canary-existing" &&
    LIVE_ACTION !== "cleanup" &&
    LIVE_ACTION !== "full" &&
    LIVE_ACTION !== "install" &&
    LIVE_ACTION !== "pause" &&
    LIVE_ACTION !== "resume"
  ) {
    throw new Error(
      "AUTOSWAP_VERIFY_LIVE_ACTION must be canary, canary-existing, cleanup, full, install, pause, or resume."
    );
  }
  if (SOLANA_ENV !== "mainnet") {
    throw new Error(
      "Autoswap API verification currently requires mainnet configuration."
    );
  }
  if (
    DAILY_CAP_RAW < BigInt(1_000_000) ||
    DAILY_CAP_RAW > BigInt(1_000_000_000)
  ) {
    throw new Error(
      "AUTOSWAP_VERIFY_DAILY_CAP_RAW must be between $1 and $1,000."
    );
  }
  if (
    MODE === "live" &&
    EXPECTED_LIVE_POLICY_CREATES !== 1 &&
    EXPECTED_LIVE_POLICY_CREATES !== 2
  ) {
    throw new Error(
      "AUTOSWAP_VERIFY_EXPECTED_POLICY_CREATES must be 1 or 2 in live mode."
    );
  }
  if (
    MODE === "live" &&
    (LIVE_ACTION === "canary" || LIVE_ACTION === "canary-existing")
  ) {
    requireProductionCanaryConfig();
  }

  const keypair = loadKeypair("SOLANA_TESTING_PK");
  const connection = new Connection(RPC_URL, "confirmed");
  const session =
    MODE === "local-state"
      ? await authenticateDisposableLocalFixture(keypair)
      : await authenticate(keypair);
  await verifyRouteBoundaries(session);
  const initialState = await getEarnState(session);
  if (
    initialState.settingsPda !== session.settingsPda ||
    initialState.vault.accountIndex !== 1
  ) {
    throw new Error(
      "Earn state is not bound to the authenticated smart account."
    );
  }
  if (!(initialState.autoswapAvailable || initialState.autoswap)) {
    throw new Error(
      "The authenticated testing wallet is not enabled by EARN_AUTOSWAP_ENABLED_WALLETS."
    );
  }
  if (MODE === "live" && LIVE_ACTION === "canary") {
    await verifyProductionCanaryDatabasePreflight({ initialState, session });
  }

  const lifecycle =
    MODE === "live"
      ? LIVE_ACTION === "canary"
        ? await verifyProductionCanaryLifecycle({
            action: LIVE_ACTION,
            connection,
            initialState,
            keypair,
            session,
          })
        : LIVE_ACTION === "canary-existing"
        ? await verifyExistingProductionCanary({
            connection,
            keypair,
            session,
          })
        : await verifyLive({
            action: LIVE_ACTION,
            connection,
            initialState,
            keypair,
            session,
          })
      : MODE === "local-state"
      ? await verifyLocalState({ connection, initialState, keypair, session })
      : await verifyReadOnly({ connection, initialState, keypair, session });
  console.log(
    JSON.stringify(
      {
        evidence: {
          authenticatedIdentityBound: true,
          lifecycle,
          routeBoundaries: "passed",
        },
        mode: MODE,
        verdict:
          MODE === "live"
            ? "PASS_AUTOSWAP_API_LIFECYCLE"
            : MODE === "local-state"
            ? "PASS_AUTOSWAP_API_LOCAL_STATE"
            : "PASS_AUTOSWAP_API_READ_ONLY",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      mode: MODE,
      verdict: "FAIL_AUTOSWAP_API_VERIFICATION",
    })
  );
  process.exitCode = 1;
});
