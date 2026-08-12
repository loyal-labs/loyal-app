import "server-only";

import {
  appSmartAccountSponsorshipTransactions,
  type AppUserSmartAccountSolanaEnv,
} from "@loyal-labs/db-core/schema";
import type { Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { sql } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

const PARSED_TX_RETRIES = 6;
const PARSED_TX_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateSpentLamports(
  transaction: ParsedTransactionWithMeta,
  payerAddress: string
): string | null {
  if (!transaction.meta) {
    return null;
  }

  const accountKeys = transaction.transaction.message.accountKeys.map(
    (parsedMessageAccount) => parsedMessageAccount.pubkey.toString()
  );
  const payerIndex = accountKeys.indexOf(payerAddress);
  if (payerIndex < 0) {
    return null;
  }

  const preBalance = transaction.meta.preBalances[payerIndex];
  const postBalance = transaction.meta.postBalances[payerIndex];
  if (typeof preBalance !== "number" || typeof postBalance !== "number") {
    return null;
  }

  return String(Math.max(0, preBalance - postBalance));
}

async function fetchParsedTransactionWithRetry(
  connection: Connection,
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  for (let attempt = 0; attempt < PARSED_TX_RETRIES; attempt += 1) {
    try {
      const parsedTransaction = await connection.getParsedTransaction(
        signature,
        {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        }
      );

      if (parsedTransaction) {
        return parsedTransaction;
      }
    } catch (error) {
      if (attempt === PARSED_TX_RETRIES - 1) {
        throw error;
      }
    }

    await sleep(PARSED_TX_DELAY_MS * (attempt + 1));
  }

  return null;
}

async function waitForFinalizedTransaction(
  connection: Connection,
  signature: string
): Promise<void> {
  const confirmation = await connection.confirmTransaction(
    signature,
    "finalized"
  );

  if (confirmation.value.err) {
    throw new Error(
      `Smart account sponsorship transaction failed before finalization: ${JSON.stringify(
        confirmation.value.err
      )}`
    );
  }
}

export async function recordSmartAccountSponsorshipTransactionBySignature(args: {
  connection: Connection;
  payerAddress: string;
  settingsPda: string;
  signature: string;
  smartAccountAddress: string;
  solanaEnv: AppUserSmartAccountSolanaEnv;
  userAddress: string;
}): Promise<void> {
  await waitForFinalizedTransaction(args.connection, args.signature);

  const parsedTransaction = await fetchParsedTransactionWithRetry(
    args.connection,
    args.signature
  );
  if (!parsedTransaction) {
    throw new Error(
      `Unable to load parsed transaction for smart account sponsorship analytics: ${args.signature}`
    );
  }

  const spentLamports = calculateSpentLamports(
    parsedTransaction,
    args.payerAddress
  );
  if (!spentLamports || !parsedTransaction.blockTime) {
    throw new Error(
      `Unable to derive smart account sponsorship analytics row for signature ${args.signature}`
    );
  }

  const db = getDatabase();
  await db
    .insert(appSmartAccountSponsorshipTransactions)
    .values({
      occurredAt: new Date(parsedTransaction.blockTime * 1000),
      payerAddress: args.payerAddress,
      settingsPda: args.settingsPda,
      signature: args.signature,
      slot: BigInt(parsedTransaction.slot),
      smartAccountAddress: args.smartAccountAddress,
      solanaEnv: args.solanaEnv,
      spentLamports,
      userAddress: args.userAddress,
    })
    .onConflictDoUpdate({
      target: [
        appSmartAccountSponsorshipTransactions.solanaEnv,
        appSmartAccountSponsorshipTransactions.signature,
      ],
      set: {
        occurredAt: sql`excluded.occurred_at`,
        payerAddress: sql`excluded.payer_address`,
        settingsPda: sql`excluded.settings_pda`,
        slot: sql`excluded.slot`,
        smartAccountAddress: sql`excluded.smart_account_address`,
        spentLamports: sql`excluded.spent_lamports`,
        updatedAt: new Date(),
        userAddress: sql`excluded.user_address`,
      },
    });
}
