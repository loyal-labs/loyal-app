import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  recordConfirmedYieldDeposit,
  type ConfirmedYieldDepositInput,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

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

  const position = await recordConfirmedYieldDeposit(input);

  return NextResponse.json({
    position: serializePosition(position),
  });
}
