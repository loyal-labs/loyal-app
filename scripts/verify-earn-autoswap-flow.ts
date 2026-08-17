import { mock } from "bun:test";
import bs58 from "bs58";
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

// Read-only API verification (default):
// AUTOSWAP_VERIFY_BASE_URL=http://localhost:3000 bun scripts/verify-earn-autoswap-flow.ts
//
// Disposable localhost database state verification (no on-chain writes):
// AUTOSWAP_VERIFY_MODE=local-state YIELD_OPTIMIZATION_LOCAL_DATABASE_URL=postgresql://localhost/loyal_autoswap_api_verify_<suffix> bun scripts/verify-earn-autoswap-flow.ts
//
// Explicitly approved mainnet lifecycle:
// AUTOSWAP_VERIFY_MODE=live AUTOSWAP_VERIFY_BASE_URL=http://localhost:3000 bun scripts/verify-earn-autoswap-flow.ts
// Use AUTOSWAP_VERIFY_LIVE_ACTION=install to leave the verified enrollment on
// for worker canaries, pause/resume around a controlled recovery check, and
// cleanup after terminalization. The default `full` action remains atomic.
// Set AUTOSWAP_VERIFY_EXPECTED_POLICY_CREATES=1 only to resume a deliberately
// interrupted setup; a clean-install live run requires two creates by default.
//
// Run inside the Loyal Apps 1Password environment. The script never prints
// the test key, auth cookie, RPC URL, or serialized transaction bytes. Live
// mode is the only mode that submits transactions. Local-state mode mutates
// only a name-guarded disposable localhost database and cleans its fixtures.

type VerifyMode = "live" | "local-state" | "read-only";
type LiveAction = "cleanup" | "full" | "install" | "pause" | "resume";
type JsonRecord = Record<string, unknown>;
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
      `Autoswap ${args.enabled ? "resume" : "pause"} requires a settled enrollment.`
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
      `Autoswap ${args.enabled ? "resume" : "pause"} did not advance generation exactly once.`
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
    pausedAfterCancel.autoswap.generation !==
      canceledDelete.expectedGeneration
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

    const resumed = await preparePolicies(args.session);
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
    LIVE_ACTION !== "cleanup" &&
    LIVE_ACTION !== "full" &&
    LIVE_ACTION !== "install" &&
    LIVE_ACTION !== "pause" &&
    LIVE_ACTION !== "resume"
  ) {
    throw new Error(
      "AUTOSWAP_VERIFY_LIVE_ACTION must be cleanup, full, install, pause, or resume."
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

  const keypair = loadKeypair("SOLANA_TESTING_PK");
  const connection = new Connection(RPC_URL, "confirmed");
  const session = await authenticate(keypair);
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

  const lifecycle =
    MODE === "live"
      ? await verifyLive({
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
