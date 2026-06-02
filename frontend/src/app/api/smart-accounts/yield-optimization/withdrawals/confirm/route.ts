import { NextResponse } from "next/server";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  recordConfirmedYieldWithdrawal,
  type ConfirmedYieldWithdrawalInput,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

type ConfirmWithdrawalRequestBody = {
  cluster?: unknown;
  walletAddress?: unknown;
  smartAccountAddress?: unknown;
  settings?: unknown;
  vaultIndex?: unknown;
  vaultPubkey?: unknown;
  policyId?: unknown;
  policyAccount?: unknown;
  policySeed?: unknown;
  withdrawalSignature?: unknown;
  confirmedSlot?: unknown;
  targetReserve?: unknown;
  market?: unknown;
  liquidityMint?: unknown;
  withdrawnAmountRaw?: unknown;
  mode?: unknown;
};

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function readRequiredString(
  body: ConfirmWithdrawalRequestBody,
  key: keyof ConfirmWithdrawalRequestBody
): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalString(
  body: ConfirmWithdrawalRequestBody,
  key: keyof ConfirmWithdrawalRequestBody
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
  body: ConfirmWithdrawalRequestBody,
  key: keyof ConfirmWithdrawalRequestBody
): bigint {
  const value = readRequiredString(body, key);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be an unsigned integer string.`);
  }
  return BigInt(value);
}

function readVaultIndex(body: ConfirmWithdrawalRequestBody): number {
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

function readMode(body: ConfirmWithdrawalRequestBody): "partial" | "full" {
  const mode = readRequiredString(body, "mode");
  if (mode !== "partial" && mode !== "full") {
    throw new Error("mode must be partial or full.");
  }
  return mode;
}

function parseRequestBody(body: unknown): ConfirmedYieldWithdrawalInput {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  const record = body as ConfirmWithdrawalRequestBody;
  return {
    cluster: readRequiredString(record, "cluster"),
    confirmedSlot: readBigIntString(record, "confirmedSlot"),
    liquidityMint: readRequiredString(record, "liquidityMint"),
    market: readOptionalString(record, "market"),
    mode: readMode(record),
    policyAccount: readRequiredString(record, "policyAccount"),
    policyId: readBigIntString(record, "policyId"),
    policySeed: readBigIntString(record, "policySeed"),
    settings: readRequiredString(record, "settings"),
    smartAccountAddress: readRequiredString(record, "smartAccountAddress"),
    targetReserve: readRequiredString(record, "targetReserve"),
    vaultIndex: readVaultIndex(record),
    vaultPubkey: readRequiredString(record, "vaultPubkey"),
    walletAddress: readRequiredString(record, "walletAddress"),
    withdrawalSignature: readRequiredString(record, "withdrawalSignature"),
    withdrawnAmountRaw: readBigIntString(record, "withdrawnAmountRaw"),
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

  let input: ConfirmedYieldWithdrawalInput;
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
      "Confirmed yield withdrawal does not match the authenticated wallet session."
    );
  }

  const position = await recordConfirmedYieldWithdrawal(input);

  return NextResponse.json({
    position: serializePosition(position),
  });
}
