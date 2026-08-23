import "server-only";

import { NextResponse } from "next/server";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { assertAuthenticatedWalletControlsSettings } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { serializePreparedOperation } from "@/lib/smart-accounts/prepared-operation-wire.shared";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";

import {
  EarnMaxWithdrawalConflict,
  readEarnMaxHistory,
  readEarnMaxState,
  requestEarnMaxWithdrawal,
} from "./repository.server";
import {
  deriveEarnMaxWalletClaimAta,
  prepareEarnMaxClaim,
  prepareEarnMaxClose,
  prepareEarnMaxDeposit,
  prepareEarnMaxInstall,
} from "./prepared.server";

const PREPARE_ACTIONS = [
  "install_policies",
  "deposit",
  "claim",
  "close_policies",
] as const;

type PrepareAction = (typeof PREPARE_ACTIONS)[number];
type ParsedPrepare = { action: PrepareAction; amountRaw: bigint | null };

const connectionCache = new Map<SolanaEnv, Connection>();

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "x-loyal-deployment-revision":
          process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "unknown",
        "x-loyal-earn-max-contract": "earn-max-v1",
      },
    }
  );
}

async function principal(request: Request) {
  const value = await resolveAuthenticatedPrincipalFromRequest(request);
  if (!value) return null;
  await assertAuthenticatedWalletControlsSettings({
    settingsPda: value.settingsPda,
    smartAccountAddress: value.smartAccountAddress,
    walletAddress: value.walletAddress,
  });
  return value;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("A JSON object is required.");
  }
  return value as Record<string, unknown>;
}

export async function getState(request: Request) {
  const authenticated = await principal(request);
  if (!authenticated) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }
  const state = await readEarnMaxState(authenticated.settingsPda);
  return NextResponse.json({ state });
}

export async function getHistory(request: Request) {
  const authenticated = await principal(request);
  if (!authenticated) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }
  return NextResponse.json(await readEarnMaxHistory(authenticated.settingsPda));
}

function parsePrepareAction(value: unknown): ParsedPrepare {
  const body = parseObject(value);
  const action = body.action;
  if (
    typeof action !== "string" ||
    !PREPARE_ACTIONS.includes(action as PrepareAction)
  ) {
    throw new Error("Unsupported Earn MAX transaction action.");
  }
  const forbidden = [
    "program",
    "seed",
    "route",
    "reserve",
    "strategy",
    "destination",
    "account",
  ];
  if (Object.keys(body).some((key) => forbidden.includes(key))) {
    throw new Error("Earn MAX transaction identities are server-derived.");
  }
  let amountRaw: bigint | null = null;
  if (action === "deposit") {
    if (typeof body.amountRaw !== "string" || !/^\d+$/.test(body.amountRaw)) {
      throw new Error("Deposit amountRaw must be a positive integer string.");
    }
    amountRaw = BigInt(body.amountRaw);
    if (amountRaw <= BigInt(0)) {
      throw new Error("Deposit amountRaw must be positive.");
    }
  } else if (body.amountRaw !== undefined) {
    throw new Error("amountRaw is only accepted for Earn MAX deposits.");
  }
  return { action: action as PrepareAction, amountRaw };
}

function getConnection(): Connection {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const cached = connectionCache.get(solanaEnv);
  if (cached) return cached;
  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(solanaEnv);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(solanaEnv, connection);
  return connection;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rawAmount(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function projectedPolicies(value: unknown): Array<{
  account: string;
  matches: boolean;
  seed: bigint;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const policy = record(entry);
    const seed = rawAmount(policy?.seed);
    return policy &&
      typeof policy.account === "string" &&
      typeof policy.matches === "boolean" &&
      seed !== null
      ? [{ account: policy.account, matches: policy.matches, seed }]
      : [];
  });
}

export async function prepareTransaction(request: Request) {
  const authenticated = await principal(request);
  if (!authenticated) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }
  let parsed: ParsedPrepare;
  try {
    parsed = parsePrepareAction(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }
  try {
    const feePayer = new PublicKey(authenticated.walletAddress);
    const settings = new PublicKey(authenticated.settingsPda);
    const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
    const connection = getConnection();
    if (parsed.action === "install_policies") {
      const projected = await readEarnMaxState(authenticated.settingsPda);
      const projectedBindings = projectedPolicies(projected?.policy_accounts);
      const matchingPolicyAccounts = new Set(
        projectedBindings
          .filter((binding) => binding.matches)
          .map((binding) => binding.account)
      );
      const firstPolicySeed = projectedBindings.length === 6
        ? projectedBindings.reduce(
            (minimum, binding) => binding.seed < minimum ? binding.seed : minimum,
            projectedBindings[0]!.seed
          )
        : undefined;
      const operations = await prepareEarnMaxInstall({
        connection,
        delegatedSigner: getDeploymentPolicySignerPublicKey(),
        feePayer,
        firstPolicySeed,
        matchingPolicyAccounts,
        programId,
        settings,
      });
      return NextResponse.json({
        action: parsed.action,
        preparedOperations: operations.map(serializePreparedOperation),
        status: operations.length === 0 ? "already_installed" : "prepared",
      });
    }

    const state = await readEarnMaxState(authenticated.settingsPda);
    if (!state || state.policy_status !== "ready") {
      return jsonError(
        409,
        "earn_max_not_ready",
        "The exact Earn MAX policy manifest has not been confirmed yet."
      );
    }
    const route = record(state.state);
    if (!route) {
      return jsonError(409, "earn_max_route_not_ready", "Earn MAX is still discovering the route.");
    }

    if (parsed.action === "deposit") {
      if (route.currentOperationId !== null) {
        return jsonError(409, "earn_max_busy", "Earn MAX is finishing another capital movement.");
      }
      const operations = await prepareEarnMaxDeposit({
        amountRaw: parsed.amountRaw!,
        connection,
        feePayer,
        programId,
        settings,
      });
      return NextResponse.json({
        action: parsed.action,
        preparedOperations: operations.map(serializePreparedOperation),
        status: "prepared",
      });
    }

    if (parsed.action === "claim") {
      const withdrawal = record(route.withdrawal);
      const amountRaw = rawAmount(withdrawal?.amountRaw);
      if (withdrawal?.status !== "claimable" || !amountRaw || amountRaw <= BigInt(0)) {
        return jsonError(409, "earn_max_not_claimable", "The withdrawal is not claimable yet.");
      }
      const claim = await prepareEarnMaxClaim({
        amountRaw,
        connection,
        feePayer,
        programId,
        settings,
      });
      if (withdrawal.destinationAccount !== claim.destination.toBase58()) {
        return jsonError(409, "earn_max_destination_drift", "The request-bound claim account changed.");
      }
      return NextResponse.json({
        action: parsed.action,
        preparedOperations: [serializePreparedOperation(claim.operation)],
        status: "prepared",
      });
    }

    const equity = rawAmount(state.equity_usd_micros) ?? BigInt(0);
    const claim = rawAmount(state.claim_raw) ?? BigInt(0);
    const collateral = rawAmount(state.collateral_raw) ?? BigInt(0);
    const debt = rawAmount(state.debt_raw) ?? BigInt(0);
    const withdrawal = record(route.withdrawal);
    if (
      route.currentOperationId !== null ||
      equity !== BigInt(0) ||
      claim !== BigInt(0) ||
      collateral !== BigInt(0) ||
      debt !== BigInt(0)
    ) {
      return jsonError(409, "earn_max_position_open", "Withdraw and claim the full Earn MAX position first.");
    }
    if (withdrawal && withdrawal.status !== "claimed") {
      return jsonError(409, "earn_max_withdrawal_open", "The Earn MAX withdrawal is not complete.");
    }
    const policyBindings = projectedPolicies(state.policy_accounts);
    if (policyBindings.length !== 6) {
      return jsonError(409, "earn_max_policy_projection_incomplete", "The exact Earn MAX policy set is unavailable.");
    }
    const operation = await prepareEarnMaxClose({
      connection,
      feePayer,
      policies: policyBindings.map((binding) => new PublicKey(binding.account)),
      programId,
      settings,
    });
    return NextResponse.json({
      action: parsed.action,
      preparedOperations: operation ? [serializePreparedOperation(operation)] : [],
      status: operation ? "prepared" : "already_closed",
    });
  } catch (error) {
    console.error("[earn-max] prepare failed", {
      action: parsed.action,
      errorMessage: error instanceof Error ? error.message : "Unknown prepare error.",
      settings: authenticated.settingsPda,
    });
    return jsonError(
      500,
      "earn_max_prepare_failed",
      error instanceof Error ? error.message : "Failed to prepare Earn MAX transaction."
    );
  }
}

function parseWithdrawal(value: unknown): {
  amountRaw: bigint | "max";
  idempotencyKey: string;
} {
  const body = parseObject(value);
  const idempotencyKey = body.idempotencyKey;
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length < 8 ||
    idempotencyKey.length > 128
  ) {
    throw new Error("A bounded idempotency key is required.");
  }
  const amount = body.amountRaw;
  if (amount === "max") {
    return { amountRaw: amount, idempotencyKey };
  }
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    throw new Error("amountRaw must be a positive integer string or max.");
  }
  const amountRaw = BigInt(amount);
  if (amountRaw <= BigInt(0)) {
    throw new Error("amountRaw must be positive.");
  }
  return { amountRaw, idempotencyKey };
}

export async function requestWithdrawal(request: Request) {
  const authenticated = await principal(request);
  if (!authenticated) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }
  try {
    const input = parseWithdrawal(await request.json());
    const destination = deriveEarnMaxWalletClaimAta(
      new PublicKey(authenticated.walletAddress)
    ).toBase58();
    const state = await requestEarnMaxWithdrawal({
      ...input,
      destination,
      settings: authenticated.settingsPda,
    });
    return NextResponse.json({ state }, { status: 202 });
  } catch (error) {
    if (error instanceof EarnMaxWithdrawalConflict) {
      return jsonError(409, "withdrawal_conflict", error.message);
    }
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid withdrawal request."
    );
  }
}
