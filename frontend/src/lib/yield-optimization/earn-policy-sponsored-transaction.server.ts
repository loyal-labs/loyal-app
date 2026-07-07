import "server-only";

import bs58 from "bs58";
import {
  type AddressLookupTableAccount,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaConnection } from "@/lib/solana/rpc-connection.server";

const SEND_ATTEMPTS = 3;
const STATUS_POLL_ATTEMPTS = 12;
const STATUS_POLL_DELAY_MS = 1_000;

let cachedSponsorKeypair: Keypair | null = null;
let cachedSponsorPrivateKey: string | null = null;

type SponsoredTransaction = Transaction | VersionedTransaction;

export type SponsoredTransactionConfirmation = {
  confirmedSlot: string;
  signature: string;
};

export class EarnPolicySponsoredTransactionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(args: { status: number; code: string; message: string }) {
    super(args.message);
    this.name = "EarnPolicySponsoredTransactionError";
    this.status = args.status;
    this.code = args.code;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodePrivateKey(value: string): Uint8Array {
  const trimmed = value.trim();

  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Uint8Array.from(
      trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
    );
  }

  return bs58.decode(trimmed);
}

function getEarnPolicySponsorKeypair(): Keypair {
  const privateKey = getServerEnv().earnPolicySponsorPrivateKey;
  if (!privateKey) {
    throw new EarnPolicySponsoredTransactionError({
      status: 500,
      code: "earn_policy_sponsor_not_configured",
      message: "EARN_POLICY_SPONSOR_PK is not set.",
    });
  }

  if (cachedSponsorKeypair && cachedSponsorPrivateKey === privateKey) {
    return cachedSponsorKeypair;
  }

  const privateKeyBytes = decodePrivateKey(privateKey);
  cachedSponsorKeypair =
    privateKeyBytes.length === 32
      ? Keypair.fromSeed(privateKeyBytes)
      : Keypair.fromSecretKey(privateKeyBytes);
  cachedSponsorPrivateKey = privateKey;
  return cachedSponsorKeypair;
}

function deserializeTransaction(value: string): SponsoredTransaction {
  const bytes = Buffer.from(value, "base64");

  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    try {
      return Transaction.from(bytes);
    } catch {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "invalid_transaction",
        message: "Sponsored transaction must be a base64 Solana transaction.",
      });
    }
  }
}

function getTransactionFeePayer(transaction: SponsoredTransaction): PublicKey {
  if (transaction instanceof VersionedTransaction) {
    const feePayer = transaction.message.staticAccountKeys[0];
    if (!feePayer) {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "invalid_fee_payer",
        message: "Sponsored transaction fee payer is missing.",
      });
    }
    return feePayer;
  }

  const feePayer =
    transaction.feePayer ?? transaction.compileMessage().accountKeys[0];
  if (!feePayer) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "invalid_fee_payer",
      message: "Sponsored transaction fee payer is missing.",
    });
  }
  return feePayer;
}

async function resolveAddressLookupTableAccounts(args: {
  connection: Connection;
  transaction: VersionedTransaction;
}): Promise<AddressLookupTableAccount[]> {
  const accounts: AddressLookupTableAccount[] = [];

  for (const lookup of args.transaction.message.addressTableLookups) {
    const { value } = await args.connection.getAddressLookupTable(
      lookup.accountKey
    );
    if (!value) {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "address_lookup_table_not_found",
        message: `Address lookup table not found: ${lookup.accountKey.toBase58()}`,
      });
    }
    accounts.push(value);
  }

  return accounts;
}

async function assertSponsorOnlyFeePayer(args: {
  connection: Connection;
  sponsor: PublicKey;
  transaction: SponsoredTransaction;
}) {
  const feePayer = getTransactionFeePayer(args.transaction);
  if (!feePayer.equals(args.sponsor)) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "fee_payer_mismatch",
      message: "Sponsored transaction fee payer does not match the sponsor.",
    });
  }

  if (args.transaction instanceof VersionedTransaction) {
    let accountKeys;
    try {
      accountKeys = args.transaction.message.getAccountKeys({
        addressLookupTableAccounts: await resolveAddressLookupTableAccounts({
          connection: args.connection,
          transaction: args.transaction,
        }),
      });
    } catch (error) {
      if (error instanceof EarnPolicySponsoredTransactionError) {
        throw error;
      }
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "invalid_address_lookup_table",
        message:
          error instanceof Error
            ? error.message
            : "Sponsored transaction address lookup tables are invalid.",
      });
    }

    const sponsorIndexes: number[] = [];
    for (let index = 0; index < accountKeys.length; index += 1) {
      const key = accountKeys.get(index);
      if (key?.equals(args.sponsor)) {
        sponsorIndexes.push(index);
      }
    }
    if (sponsorIndexes.some((index) => index !== 0)) {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "sponsor_not_fee_payer_only",
        message:
          "Earn policy sponsor must only appear as the transaction fee payer.",
      });
    }

    const sponsorInstructionReference =
      args.transaction.message.compiledInstructions.find((instruction) => {
        const programId = accountKeys.get(instruction.programIdIndex);
        return (
          programId?.equals(args.sponsor) ||
          instruction.accountKeyIndexes.some((index) =>
            accountKeys.get(index)?.equals(args.sponsor)
          )
        );
      });
    if (sponsorInstructionReference) {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "sponsor_not_fee_payer_only",
        message:
          "Earn policy sponsor must not be used by transaction instructions.",
      });
    }
    return;
  }

  const compiled = args.transaction.compileMessage();
  const sponsorIndexes = compiled.accountKeys
    .map((key, index) => (key.equals(args.sponsor) ? index : -1))
    .filter((index) => index >= 0);
  if (sponsorIndexes.some((index) => index !== 0)) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "sponsor_not_fee_payer_only",
      message:
        "Earn policy sponsor must only appear as the transaction fee payer.",
    });
  }
  if (
    compiled.instructions.some((instruction) =>
      instruction.programIdIndex === 0 || instruction.accounts.includes(0)
    )
  ) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "sponsor_not_fee_payer_only",
      message:
        "Earn policy sponsor must not be used as an instruction account.",
    });
  }
}

function signTransaction(args: {
  sponsor: Keypair;
  transaction: SponsoredTransaction;
}) {
  if (args.transaction instanceof VersionedTransaction) {
    args.transaction.sign([args.sponsor]);
    return;
  }

  args.transaction.partialSign(args.sponsor);
}

function getTransactionSignature(
  transaction: SponsoredTransaction
): string {
  const signature =
    transaction instanceof VersionedTransaction
      ? transaction.signatures[0]
      : transaction.signature;
  if (!signature || signature.every((byte) => byte === 0)) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "missing_sponsor_signature",
      message: "Sponsored transaction is missing the fee payer signature.",
    });
  }
  return bs58.encode(signature);
}

function assertFullySigned(transaction: SponsoredTransaction) {
  const missingSignature =
    transaction instanceof VersionedTransaction
      ? transaction.signatures.some((signature) =>
          signature.every((byte) => byte === 0)
        )
      : transaction.signatures.some((signaturePair) => !signaturePair.signature);
  if (missingSignature) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "missing_required_signature",
      message:
        "Sponsored transaction is missing a required non-sponsor signature.",
    });
  }
}

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<string | null> {
  const { value } = await args.connection.getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0];
  if (!status) {
    return null;
  }
  if (status.err) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "sponsored_transaction_failed",
      message: `Sponsored transaction failed: ${JSON.stringify(status.err)}`,
    });
  }
  if (
    status.confirmationStatus !== "confirmed" &&
    status.confirmationStatus !== "finalized"
  ) {
    return null;
  }
  return status.slot.toString();
}

async function sendAndConfirmSignedTransaction(args: {
  connection: Connection;
  transaction: SponsoredTransaction;
}): Promise<SponsoredTransactionConfirmation> {
  const rawTransaction = args.transaction.serialize();
  const signature = getTransactionSignature(args.transaction);
  let lastSendError: unknown = null;

  for (let sendAttempt = 0; sendAttempt < SEND_ATTEMPTS; sendAttempt += 1) {
    try {
      await args.connection.sendRawTransaction(rawTransaction, {
        maxRetries: 3,
        skipPreflight: false,
      });
    } catch (error) {
      lastSendError = error;
      const confirmedSlot = await resolveConfirmedSignatureSlot({
        connection: args.connection,
        signature,
      });
      if (confirmedSlot) {
        return { confirmedSlot, signature };
      }
    }

    for (
      let statusAttempt = 0;
      statusAttempt < STATUS_POLL_ATTEMPTS;
      statusAttempt += 1
    ) {
      const confirmedSlot = await resolveConfirmedSignatureSlot({
        connection: args.connection,
        signature,
      });
      if (confirmedSlot) {
        return { confirmedSlot, signature };
      }
      await sleep(STATUS_POLL_DELAY_MS);
    }
  }

  throw new EarnPolicySponsoredTransactionError({
    status: 502,
    code: "sponsored_transaction_not_confirmed",
    message:
      lastSendError instanceof Error
        ? lastSendError.message
        : "Sponsored transaction was not confirmed.",
  });
}

export function getEarnPolicySponsorPublicKey(): PublicKey {
  return getEarnPolicySponsorKeypair().publicKey;
}

export async function executeSponsoredEarnPolicyTransaction(
  serializedTransaction: string
): Promise<SponsoredTransactionConfirmation> {
  const sponsor = getEarnPolicySponsorKeypair();
  const transaction = deserializeTransaction(serializedTransaction);
  const connection = getServerSolanaConnection(
    resolveLoyalWebSolanaEnvFromEnv(process.env)
  );
  await assertSponsorOnlyFeePayer({
    connection,
    sponsor: sponsor.publicKey,
    transaction,
  });
  signTransaction({ sponsor, transaction });
  assertFullySigned(transaction);

  return sendAndConfirmSignedTransaction({
    connection,
    transaction,
  });
}
