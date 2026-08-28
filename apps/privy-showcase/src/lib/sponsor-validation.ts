import {
  compilePreparedOperation,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts-core";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  DEMO_MOVE_ACTIONS,
  SPONSOR_SETUP_STAGES,
  type SponsorRequestBody,
} from "./sponsor-protocol";

const MAX_JSON_CHARS = 4_096;
const MAX_TRANSACTION_BASE64_CHARS = 1_800;

export class SponsorRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly signature?: string
  ) {
    super(message);
  }
}

export function badRequest(message: string): never {
  throw new SponsorRequestError(400, message);
}

export function parsePublicKey(value: unknown, label: string): PublicKey {
  if (typeof value !== "string") badRequest(`${label} is required.`);
  try {
    return new PublicKey(value);
  } catch {
    badRequest(`${label} is invalid.`);
  }
}

export function parseSponsorKey(
  value: string | undefined,
  label = "SMART_ACCOUNT_SPONSOR_PK"
): Keypair {
  if (!value) throw new Error(`${label} is not configured.`);
  let bytes: Uint8Array;
  try {
    const trimmed = value.trim();
    bytes = trimmed.startsWith("[")
      ? Uint8Array.from(JSON.parse(trimmed) as number[])
      : bs58.decode(trimmed);
  } catch {
    throw new Error(`${label} has an invalid encoding.`);
  }
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error(`${label} must contain 32 or 64 bytes.`);
}

export function parseSponsorBody(text: string): SponsorRequestBody {
  if (text.length > MAX_JSON_CHARS) badRequest("Request body is too large.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    badRequest("Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    badRequest("Request body must be an object.");
  }
  const body = value as Partial<SponsorRequestBody>;
  if (typeof body.wallet !== "string" || typeof body.settings !== "string") {
    badRequest("Wallet and Settings are required.");
  }
  if (body.kind === "setup") {
    if (
      typeof body.transaction !== "string" ||
      body.transaction.length === 0 ||
      body.transaction.length > MAX_TRANSACTION_BASE64_CHARS
    ) {
      badRequest("Transaction payload is invalid or too large.");
    }
    if (
      typeof body.stage !== "string" ||
      !SPONSOR_SETUP_STAGES.includes(body.stage)
    ) {
      badRequest("Unknown setup stage.");
    }
    if (
      body.autodepositPolicySeed !== undefined &&
      !/^\d+$/.test(body.autodepositPolicySeed)
    ) {
      badRequest("Autodeposit policy seed is invalid.");
    }
    return body as SponsorRequestBody;
  }
  if (body.kind === "prefund") {
    return body as SponsorRequestBody;
  }
  if (body.kind === "move") {
    if (
      typeof body.action !== "string" ||
      !DEMO_MOVE_ACTIONS.includes(body.action)
    ) {
      badRequest("Unknown money movement.");
    }
    if (!body.policies || !body.expected) {
      badRequest("Canonical policy references and expected balances are required.");
    }
    return body as SponsorRequestBody;
  }
  badRequest("Request kind must be setup, prefund, or move.");
}

export function assertSignedTransactionMatchesExpected(args: {
  transaction: VersionedTransaction;
  expected: PreparedLoyalSmartAccountsOperation<string>;
  sponsor: PublicKey;
  wallet: PublicKey;
}): void {
  if (args.transaction.version !== 0) badRequest("Only v0 transactions are accepted.");
  const expected = compilePreparedOperation({
    prepared: args.expected,
    blockhash: args.transaction.message.recentBlockhash,
  });
  const submittedMessage = args.transaction.message.serialize();
  const expectedMessage = expected.message.serialize();
  if (!Buffer.from(submittedMessage).equals(Buffer.from(expectedMessage))) {
    badRequest("Signed transaction does not exactly match the expected demo stage.");
  }
  const required = args.transaction.message.header.numRequiredSignatures;
  const signerKeys = args.transaction.message.staticAccountKeys.slice(0, required);
  const sponsorPays = args.expected.payer.equals(args.sponsor);
  const walletPays = args.expected.payer.equals(args.wallet);
  const signerSetIsExact = sponsorPays
    ? required === 2 &&
      signerKeys[0]?.equals(args.sponsor) &&
      signerKeys[1]?.equals(args.wallet) &&
      args.transaction.signatures.length === 2
    : walletPays
      ? required === 1 &&
        signerKeys[0]?.equals(args.wallet) &&
        args.transaction.signatures.length === 1
      : false;
  if (!signerSetIsExact) {
    badRequest(
      sponsorPays
        ? "Transaction signer set must be exactly sponsor plus Privy wallet."
        : "Transaction signer set must be exactly the prefunded Privy wallet."
    );
  }
  if (sponsorPays) {
    const sponsorSignature = args.transaction.signatures[0];
    if (!sponsorSignature || sponsorSignature.some((byte) => byte !== 0)) {
      badRequest("Sponsor signature slot must be empty.");
    }
  }
  const walletSignature = args.transaction.signatures[sponsorPays ? 1 : 0];
  if (
    !walletSignature ||
    walletSignature.every((byte) => byte === 0) ||
    !nacl.sign.detached.verify(submittedMessage, walletSignature, args.wallet.toBytes())
  ) {
    badRequest("Privy wallet signature is invalid.");
  }
}
