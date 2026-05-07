import type { SolanaSignInInput } from "@solana/wallet-standard-features";
import { NextResponse } from "next/server";

import { verifySIWSForEnv } from "@/lib/solana/sign-in";
import type {
  SerializedSolanaSignInOutput,
  SerializedWalletAccount,
} from "@/lib/solana/types";
import { getServerEnv } from "@/lib/core/config/server";

export const dynamic = "force-dynamic";

type VerifyRequestBody = {
  input: SolanaSignInInput;
  output: SerializedSolanaSignInOutput;
};

const isString = (value: unknown): value is string => typeof value === "string";

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === "string";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isOptionalStringArray = (value: unknown): value is string[] | undefined =>
  value === undefined || isStringArray(value);

const isByteArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);

const isSerializedWalletAccount = (
  value: unknown
): value is SerializedWalletAccount => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    isString(record.address) &&
    isStringArray(record.features) &&
    isStringArray(record.chains) &&
    isOptionalString(record.label) &&
    isOptionalString(record.icon) &&
    isByteArray(record.publicKey)
  );
};

const isSolanaSignInInput = (value: unknown): value is SolanaSignInInput => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    isString(record.domain) &&
    isOptionalString(record.address) &&
    isOptionalString(record.statement) &&
    isOptionalString(record.uri) &&
    isString(record.version) &&
    isOptionalString(record.chainId) &&
    isString(record.nonce) &&
    isString(record.issuedAt) &&
    isOptionalString(record.expirationTime) &&
    isOptionalString(record.notBefore) &&
    isOptionalString(record.requestId) &&
    isOptionalStringArray(record.resources)
  );
};

const isSerializedSolanaSignInOutput = (
  value: unknown
): value is SerializedSolanaSignInOutput => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (!isSerializedWalletAccount(record.account)) {
    return false;
  }
  if (!(isByteArray(record.signature) && isByteArray(record.signedMessage))) {
    return false;
  }
  if (
    record.signatureType !== undefined &&
    record.signatureType !== "ed25519"
  ) {
    return false;
  }

  return true;
};

const isVerifyRequestBody = (value: unknown): value is VerifyRequestBody => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    isSolanaSignInInput(record.input) &&
    isSerializedSolanaSignInOutput(record.output)
  );
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;

    if (!isVerifyRequestBody(body)) {
      return NextResponse.json(
        { error: "Invalid request payload" },
        { status: 400 }
      );
    }

    const { input, output } = body;
    const verified = verifySIWSForEnv(
      input,
      output,
      getServerEnv().solanaEnv
    );

    return NextResponse.json({ verified });
  } catch (error) {
    console.error("Failed to verify Solana sign-in payload", error);
    return NextResponse.json(
      { error: "Failed to verify sign-in payload" },
      { status: 500 }
    );
  }
}
