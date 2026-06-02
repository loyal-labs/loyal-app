import { NextResponse } from "next/server";
import {
  KAMINO_MAIN_MARKET,
  KAMINO_MAIN_USDC_RESERVE,
  LoyalCluster,
  RiskBasket,
  STABLECOIN_MINTS,
  Stablecoin,
  createVaultYieldRoutingPolicyPlan,
} from "@loyal/actions";
import { resolveSolanaEnv, type SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";
import {
  recordConfirmedYieldDeposit,
  type ConfirmedYieldDepositInput,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_DEPOSIT_POLICY_SEED = BigInt(1);
const EARN_DEPOSIT_VAULT_INDEX = 1;
const SOLANA_ENV_ENV_NAME = "NEXT_PUBLIC_SOLANA_ENV";

const connectionCache = new Map<SolanaEnv, Connection>();

type ConfirmDepositRequestBody = {
  cluster?: unknown;
  walletAddress?: unknown;
  smartAccountAddress?: unknown;
  settings?: unknown;
  vaultIndex?: unknown;
  vaultPubkey?: unknown;
  policyId?: unknown;
  policyAccount?: unknown;
  policySeed?: unknown;
  policySignature?: unknown;
  depositSignature?: unknown;
  confirmedSlot?: unknown;
  targetReserve?: unknown;
  market?: unknown;
  liquidityMint?: unknown;
  targetSupplyApyBps?: unknown;
  depositMint?: unknown;
  principalAmountRaw?: unknown;
};

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function readRequiredString(
  body: ConfirmDepositRequestBody,
  key: keyof ConfirmDepositRequestBody
): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalString(
  body: ConfirmDepositRequestBody,
  key: keyof ConfirmDepositRequestBody
): string | null {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string when provided.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBigIntString(
  body: ConfirmDepositRequestBody,
  key: keyof ConfirmDepositRequestBody
): bigint {
  const value = readRequiredString(body, key);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be an unsigned integer string.`);
  }
  return BigInt(value);
}

function readOptionalBigIntString(
  body: ConfirmDepositRequestBody,
  key: keyof ConfirmDepositRequestBody
): bigint | null {
  const value = readOptionalString(body, key);
  if (value === null) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be an unsigned integer string.`);
  }
  return BigInt(value);
}

function readVaultIndex(body: ConfirmDepositRequestBody): number {
  const value = body.vaultIndex;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 32767
  ) {
    throw new Error("vaultIndex must be an integer between 0 and 32767.");
  }
  return value;
}

function parseLoyalCluster(cluster: string): LoyalCluster {
  if (cluster === LoyalCluster.Devnet) {
    return LoyalCluster.Devnet;
  }
  if (cluster === LoyalCluster.MainnetBeta || cluster === "mainnet") {
    return LoyalCluster.MainnetBeta;
  }
  throw new Error(`unsupported Loyal cluster: ${cluster}`);
}

function getConfiguredSolanaEnv(): SolanaEnv {
  return resolveSolanaEnv(process.env[SOLANA_ENV_ENV_NAME]);
}

function parseRequestBody(body: unknown): ConfirmedYieldDepositInput {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  const record = body as ConfirmDepositRequestBody;
  return {
    cluster: readRequiredString(record, "cluster"),
    confirmedSlot: readBigIntString(record, "confirmedSlot"),
    depositMint: readRequiredString(record, "depositMint"),
    depositSignature: readRequiredString(record, "depositSignature"),
    liquidityMint: readRequiredString(record, "liquidityMint"),
    market: readOptionalString(record, "market"),
    policyAccount: readRequiredString(record, "policyAccount"),
    policyId: readBigIntString(record, "policyId"),
    policySeed: readBigIntString(record, "policySeed"),
    policySignature: readRequiredString(record, "policySignature"),
    principalAmountRaw: readBigIntString(record, "principalAmountRaw"),
    settings: readRequiredString(record, "settings"),
    smartAccountAddress: readRequiredString(record, "smartAccountAddress"),
    targetReserve: readRequiredString(record, "targetReserve"),
    targetSupplyApyBps: readOptionalBigIntString(record, "targetSupplyApyBps"),
    vaultIndex: readVaultIndex(record),
    vaultPubkey: readRequiredString(record, "vaultPubkey"),
    walletAddress: readRequiredString(record, "walletAddress"),
  };
}

function assertCanonicalField(
  actual: string | bigint | number | null,
  expected: string | bigint | number | null,
  label: string
) {
  if (actual !== expected) {
    throw new Error(`${label} does not match the canonical earn deposit metadata.`);
  }
}

function createCanonicalDepositInput(
  requestInput: ConfirmedYieldDepositInput
): ConfirmedYieldDepositInput {
  const cluster = parseLoyalCluster(requestInput.cluster);
  const walletAddress = new PublicKey(requestInput.walletAddress);
  const settings = new PublicKey(requestInput.settings);
  const policyPlan = createVaultYieldRoutingPolicyPlan({
    cluster,
    risk: RiskBasket.Safe,
    smartAccount: {
      settings,
      authority: walletAddress,
      delegatedSigner: walletAddress,
    },
    vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
  });
  const usdcMint = STABLECOIN_MINTS[Stablecoin.USDC].toBase58();
  const canonicalInput = {
    ...requestInput,
    cluster,
    depositMint: usdcMint,
    liquidityMint: usdcMint,
    market: KAMINO_MAIN_MARKET.toBase58(),
    policyAccount: policyPlan.actionAccount.toBase58(),
    policyId: EARN_DEPOSIT_POLICY_SEED,
    policySeed: EARN_DEPOSIT_POLICY_SEED,
    policySignature: requestInput.depositSignature,
    targetReserve: KAMINO_MAIN_USDC_RESERVE.toBase58(),
    targetSupplyApyBps: null,
    vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
    vaultPubkey: policyPlan.metadata.vault.toBase58(),
  };

  assertCanonicalField(requestInput.cluster, canonicalInput.cluster, "cluster");
  assertCanonicalField(
    requestInput.depositMint,
    canonicalInput.depositMint,
    "depositMint"
  );
  assertCanonicalField(
    requestInput.liquidityMint,
    canonicalInput.liquidityMint,
    "liquidityMint"
  );
  assertCanonicalField(requestInput.market, canonicalInput.market, "market");
  assertCanonicalField(
    requestInput.policyAccount,
    canonicalInput.policyAccount,
    "policyAccount"
  );
  assertCanonicalField(requestInput.policyId, canonicalInput.policyId, "policyId");
  assertCanonicalField(
    requestInput.policySeed,
    canonicalInput.policySeed,
    "policySeed"
  );
  assertCanonicalField(
    requestInput.policySignature,
    canonicalInput.policySignature,
    "policySignature"
  );
  assertCanonicalField(
    requestInput.targetReserve,
    canonicalInput.targetReserve,
    "targetReserve"
  );
  assertCanonicalField(
    requestInput.targetSupplyApyBps,
    canonicalInput.targetSupplyApyBps,
    "targetSupplyApyBps"
  );
  assertCanonicalField(
    requestInput.vaultIndex,
    canonicalInput.vaultIndex,
    "vaultIndex"
  );
  assertCanonicalField(
    requestInput.vaultPubkey,
    canonicalInput.vaultPubkey,
    "vaultPubkey"
  );

  return canonicalInput;
}

function getConnection(cluster: SolanaEnv): Connection {
  const cached = connectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } = getFrontendSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

async function resolveConfirmedSignatureSlot(args: {
  cluster: SolanaEnv;
  signature: string;
}): Promise<bigint> {
  const { value } = await getConnection(args.cluster).getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0];

  if (!status || status.err) {
    throw new Error("Deposit transaction is not confirmed.");
  }

  if (
    status.confirmationStatus !== "confirmed" &&
    status.confirmationStatus !== "finalized"
  ) {
    throw new Error("Deposit transaction is not confirmed.");
  }

  if (typeof status.slot !== "number") {
    throw new Error("Confirmed transaction slot is unavailable.");
  }

  return BigInt(status.slot);
}

function serializePosition(position: UserYieldPositionRecord) {
  return {
    ...position,
    createdAt: position.createdAt.toISOString(),
    firstDepositSignature: position.firstDepositSignature,
    id: position.id.toString(),
    lastConfirmedSlot: position.lastConfirmedSlot.toString(),
    policyId: position.policyId.toString(),
    policySeed: position.policySeed.toString(),
    principalAmountRaw: position.principalAmountRaw.toString(),
    targetSupplyApyBps: position.targetSupplyApyBps?.toString() ?? null,
    updatedAt: position.updatedAt.toISOString(),
  };
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let input: ConfirmedYieldDepositInput;
  try {
    input = parseRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  if (
    input.walletAddress !== principal.walletAddress ||
    input.smartAccountAddress !== principal.smartAccountAddress ||
    input.settings !== principal.settingsPda
  ) {
    return jsonError(
      403,
      "principal_mismatch",
      "Confirmed yield deposit does not match the authenticated wallet session."
    );
  }

  try {
    input = createCanonicalDepositInput(input);
  } catch (error) {
    return jsonError(
      400,
      "metadata_mismatch",
      error instanceof Error
        ? error.message
        : "Confirmed yield deposit metadata is invalid."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  if (input.cluster !== solanaEnv) {
    return jsonError(
      400,
      "cluster_mismatch",
      "Confirmed yield deposit cluster does not match the configured Solana environment."
    );
  }

  let confirmedSlot: bigint;
  try {
    confirmedSlot = await resolveConfirmedSignatureSlot({
      cluster: solanaEnv,
      signature: input.depositSignature,
    });
  } catch (error) {
    return jsonError(
      400,
      "unconfirmed_signature",
      error instanceof Error
        ? error.message
        : "Deposit transaction is not confirmed."
    );
  }

  if (input.confirmedSlot !== confirmedSlot) {
    return jsonError(
      400,
      "slot_mismatch",
      "Confirmed yield deposit slot does not match the transaction status."
    );
  }

  const position = await recordConfirmedYieldDeposit(input);

  return NextResponse.json({
    position: serializePosition(position),
  });
}
