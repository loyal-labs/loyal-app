import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { verifySignIn } from "@solana/wallet-standard-util";
import { PublicKey } from "@solana/web3.js";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import {
  DOMAIN_NAME,
  SIGN_IN_STATEMENT,
} from "@/lib/solana/constants";
import type { SerializedSolanaSignInOutput } from "@/lib/solana/types";

const NONCE_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const NONCE_LENGTH = 32;
const NONCE_REGEX = /^[A-Za-z0-9]{8,64}$/;
const SIGN_IN_VALIDITY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_SIGN_IN_ENV: SolanaEnv = "devnet";

const isByteArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);

const isCanonicalIsoTimestamp = (value: string): boolean => {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const generateNonce = (): string => {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(NONCE_LENGTH);
    cryptoObj.getRandomValues(bytes);
    return Array.from(
      bytes,
      (byte) => NONCE_CHARSET[byte % NONCE_CHARSET.length]
    ).join("");
  }
  let nonce = "";
  while (nonce.length < NONCE_LENGTH) {
    nonce += Math.random().toString(36).slice(2);
  }
  return nonce.slice(0, NONCE_LENGTH);
};

export const createSignInData = async (): Promise<SolanaSignInInput> => {
  return createSignInDataForEnv(DEFAULT_SIGN_IN_ENV);
};

export const createSignInDataForEnv = async (
  solanaEnv: SolanaEnv
): Promise<SolanaSignInInput> => {
  const now: Date = new Date();
  const domain = DOMAIN_NAME;
  const nonce = generateNonce();

  const currentDateTime = now.toISOString();

  const signInData: SolanaSignInInput = {
    domain,
    statement: SIGN_IN_STATEMENT,
    version: "1",
    nonce,
    chainId: solanaEnv,
    issuedAt: currentDateTime,
  };

  return signInData;
};

export function verifySIWS(
  input: SolanaSignInInput,
  output: SerializedSolanaSignInOutput
): boolean {
  return verifySIWSForEnv(input, output, DEFAULT_SIGN_IN_ENV);
}

export function verifySIWSForEnv(
  input: SolanaSignInInput,
  output: SerializedSolanaSignInOutput,
  solanaEnv: SolanaEnv
): boolean {
  if (input.domain !== DOMAIN_NAME) {
    return false;
  }
  if (input.version !== "1") {
    return false;
  }
  if (input.chainId !== solanaEnv) {
    return false;
  }
  if (input.statement !== SIGN_IN_STATEMENT) {
    return false;
  }
  if (!(input.nonce && NONCE_REGEX.test(input.nonce))) {
    return false;
  }
  if (!(input.issuedAt && isCanonicalIsoTimestamp(input.issuedAt))) {
    return false;
  }

  const issuedAtMs = Date.parse(input.issuedAt);
  if (Number.isNaN(issuedAtMs)) {
    return false;
  }
  if (Math.abs(Date.now() - issuedAtMs) > SIGN_IN_VALIDITY_WINDOW_MS) {
    return false;
  }

  if (output.signatureType && output.signatureType !== "ed25519") {
    return false;
  }

  const { publicKey, ...accountRest } = output.account;

  if (!isByteArray(publicKey)) {
    return false;
  }
  if (publicKey.length !== 32) {
    return false;
  }
  if (!(isByteArray(output.signature) && isByteArray(output.signedMessage))) {
    return false;
  }
  if (!(output.signature.length && output.signedMessage.length)) {
    return false;
  }

  const deserializedOutput: SolanaSignInOutput = {
    account: {
      ...accountRest,
      publicKey: new Uint8Array(publicKey),
    },
    signature: new Uint8Array(output.signature),
    signedMessage: new Uint8Array(output.signedMessage),
    signatureType: output.signatureType,
  };

  let derivedAddress: string;
  try {
    derivedAddress = new PublicKey(
      deserializedOutput.account.publicKey
    ).toBase58();
  } catch (error) {
    console.error("Invalid public key in Solana sign-in output", error);
    return false;
  }

  if (derivedAddress !== deserializedOutput.account.address) {
    return false;
  }
  if (input.address && input.address !== derivedAddress) {
    return false;
  }

  return verifySignIn(input, deserializedOutput);
}
