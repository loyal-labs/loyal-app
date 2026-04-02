import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Ed25519Program,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { NextResponse } from "next/server";

import { RECIPIENT_TARGET_LAMPORTS } from "@/features/private-transfer-analytics/server/constants";
import {
  recordGaslessClaimTransactionBySignature,
} from "@/features/private-transfer-analytics/server/gasless-claims";
import { getEndpoints } from "@/lib/solana/rpc/connection";
import {
  getSessionPda,
  getTelegramVerificationProgram,
} from "@/lib/solana/solana-helpers";
import { getGaslessKeypair } from "@/lib/solana/wallet/gasless-keypair.server";
import { getGaslessPublicKey } from "@/lib/solana/wallet/wallet-details";
import { SimpleWallet } from "@/lib/solana/wallet/wallet-implementation";

import { TelegramVerification } from "../../../../../../target/types/telegram_verification";

const TELEGRAM_USERNAME_REGEX = /^[A-Za-z0-9_]{5,32}$/;

type TransactionSendResult =
  | { ok: true; signature: string }
  | { ok: false; message: string; logs?: string[] };

type ClaimSolanaEnv = "mainnet" | "devnet";

const parseClaimSolanaEnv = (value: unknown): ClaimSolanaEnv | null => {
  if (value === "mainnet" || value === "devnet") {
    return value;
  }
  return null;
};

const createProviderForEnv = (
  keypairWallet: Wallet,
  solanaEnv: ClaimSolanaEnv,
): AnchorProvider => {
  const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    wsEndpoint: websocketEndpoint,
  });
  return new AnchorProvider(connection, keypairWallet);
};

const normalizeBytes = (value: unknown): Uint8Array => {
  if (typeof value === "string") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([k, v]) => [Number(k), v as number])
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v);
    return Uint8Array.from(entries);
  }
  throw new Error("Invalid byte array format");
};

const extractUsernameFromValidationBytes = (
  validationBytes: Uint8Array,
): string => {
  const payload = new TextDecoder().decode(validationBytes);
  const userStart = payload.includes("\nuser=")
    ? payload.indexOf("\nuser=") + "\nuser=".length
    : payload.startsWith("user=")
      ? "user=".length
      : -1;

  if (userStart < 0) {
    throw new Error("Invalid Telegram init data: missing user payload");
  }

  const userRest = payload.slice(userStart);
  const userLineEnd = userRest.indexOf("\n");
  const userLine = userLineEnd >= 0 ? userRest.slice(0, userLineEnd) : userRest;

  let parsedUser: unknown;
  try {
    parsedUser = JSON.parse(userLine);
  } catch {
    throw new Error("Invalid Telegram init data: malformed user payload");
  }

  const username =
    parsedUser &&
    typeof parsedUser === "object" &&
    "username" in parsedUser &&
    typeof (parsedUser as { username?: unknown }).username === "string"
      ? (parsedUser as { username: string }).username
      : null;

  if (!username || !TELEGRAM_USERNAME_REGEX.test(username)) {
    throw new Error("Invalid Telegram username in init data");
  }

  return username.toLowerCase();
};

const parseTransactionError = async (
  error: unknown,
): Promise<{ message: string; logs?: string[] }> => {
  let message =
    error instanceof Error ? error.message : "Transaction simulation failed";
  let logs: string[] | undefined;

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      transactionMessage?: unknown;
      transactionLogs?: unknown;
      logs?: unknown;
      getLogs?: unknown;
    };

    if (typeof candidate.message === "string" && candidate.message) {
      message = candidate.message;
    }
    if (
      typeof candidate.transactionMessage === "string" &&
      candidate.transactionMessage
    ) {
      message = candidate.transactionMessage;
    }

    if (Array.isArray(candidate.transactionLogs)) {
      logs = candidate.transactionLogs.filter(
        (line): line is string => typeof line === "string",
      );
    } else if (Array.isArray(candidate.logs)) {
      logs = candidate.logs.filter(
        (line): line is string => typeof line === "string",
      );
    }

    if (
      (!logs || logs.length === 0) &&
      typeof candidate.getLogs === "function"
    ) {
      try {
        const fetchedLogs = await (
          candidate.getLogs as () => Promise<unknown>
        )();
        if (Array.isArray(fetchedLogs)) {
          logs = fetchedLogs.filter(
            (line): line is string => typeof line === "string",
          );
        }
      } catch {
        // Ignore log fetch errors and keep base message.
      }
    }
  }

  return { message, logs };
};

const isInvalidTelegramUsernameFailure = ({
  message,
  logs,
}: {
  message: string;
  logs?: string[];
}): boolean => {
  const fullText = [message, ...(logs ?? [])].join("\n");
  return (
    fullText.includes("InvalidTelegramUsername") ||
    fullText.includes("Invalid Telegram username") ||
    fullText.includes("Error Number: 6007") ||
    fullText.includes("0x1777")
  );
};

const deserializeTransaction = (
  serializedTx: string,
): Transaction | VersionedTransaction => {
  const buffer = Buffer.from(serializedTx, "base64");
  try {
    return VersionedTransaction.deserialize(buffer);
  } catch {
    return Transaction.from(buffer);
  }
};

const sendSignedTransaction = async (
  provider: AnchorProvider,
  transaction: Transaction | VersionedTransaction,
  payerWallet: Wallet,
): Promise<TransactionSendResult> => {
  await payerWallet.signTransaction(transaction);

  try {
    const sig = await provider.connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
      },
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
    return { ok: true, signature: sig };
  } catch (error) {
    const parsedError = await parseTransactionError(error);
    return {
      ok: false,
      message: parsedError.message,
      logs: parsedError.logs,
    };
  }
};

const verifyInitDataGasless = async (
  provider: AnchorProvider,
  verificationProgram: Program<TelegramVerification>,
  payerWallet: Wallet,
  recipientPubKey: PublicKey,
  telegramPublicKeyBytes: Uint8Array,
  telegramSignatureBytes: Uint8Array,
  processedInitDataBytes: Uint8Array,
): Promise<TransactionSendResult> => {
  const sessionPda = getSessionPda(recipientPubKey, verificationProgram);
  const payerPubKey = payerWallet.publicKey;
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: telegramPublicKeyBytes,
    message: processedInitDataBytes,
    signature: telegramSignatureBytes,
  });

  const verifyIx = await verificationProgram.methods
    .verifyTelegramInitData()
    .accountsPartial({
      session: sessionPda,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .transaction();

  const verifyTx = new Transaction().add(ed25519Ix, verifyIx);

  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash();
  verifyTx.feePayer = payerPubKey;
  verifyTx.recentBlockhash = blockhash;
  verifyTx.lastValidBlockHeight = lastValidBlockHeight;

  const verifyResult = await sendSignedTransaction(
    provider,
    verifyTx,
    payerWallet,
  );
  return verifyResult;
};

const ensureRecipientBalance = async (
  provider: AnchorProvider,
  payerWallet: Wallet,
  recipient: PublicKey,
): Promise<string | null> => {
  const balance = await provider.connection.getBalance(recipient);
  if (balance >= RECIPIENT_TARGET_LAMPORTS) {
    return null;
  }

  const deficit = RECIPIENT_TARGET_LAMPORTS - balance;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payerWallet.publicKey,
      toPubkey: recipient,
      lamports: deficit,
    }),
  );

  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash();
  tx.feePayer = payerWallet.publicKey;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  const result = await sendSignedTransaction(provider, tx, payerWallet);
  if (!result.ok) {
    throw new Error(`Failed to fund recipient: ${result.message}`);
  }

  return result.signature;
};

const verifyAndClaimDeposit = async (
  provider: AnchorProvider,
  payerWallet: Wallet,
  recipient: PublicKey,
  username: string,
  amount: number,
  processedInitDataBytes: Uint8Array,
  telegramSignatureBytes: Uint8Array,
  telegramPublicKeyBytes: Uint8Array,
) => {
  if (amount <= 0) {
    throw new Error("Amount must be greater than 0");
  }

  const verificationProgram = getTelegramVerificationProgram(provider);

  const verified = await verifyInitDataGasless(
    provider,
    verificationProgram,
    payerWallet,
    recipient,
    telegramPublicKeyBytes,
    telegramSignatureBytes,
    processedInitDataBytes,
  );
  if (!verified.ok) {
    return { ok: false as const };
  }

  // FIXME: `claimUsernameDeposit` is not working with PER, create gasless claim for PER
  // NOTE: we do send this transaction from other keypair and get 403 Auth error from MagicBlock
  // const claimed = await claimDepositGasless(
  //   provider,
  //   payerWallet,
  //   verificationProgram,
  //   recipient,
  //   amount,
  //   username,
  //   perAuthToken
  // );
  const topUpSignature = await ensureRecipientBalance(
    provider,
    payerWallet,
    recipient,
  );

  return {
    ok: true as const,
    topUpSignature,
    verifySignature: verified.signature,
  };
};

const recordGaslessClaimAnalyticsBestEffort = async (args: {
  connection: Connection;
  payerAddress: string;
  recipientAddress?: string | null;
  signature: string;
  solanaEnv: ClaimSolanaEnv;
  transactionType: "store" | "verify_telegram_init_data" | "top_up_to_0_01_sol";
}): Promise<void> => {
  try {
    await recordGaslessClaimTransactionBySignature(args);
  } catch (error) {
    console.error("[gasless][claim][analytics] failed to record transaction", {
      error,
      signature: args.signature,
      transactionType: args.transactionType,
    });
  }
};

export async function POST(req: Request) {
  try {
    const body = await req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      return NextResponse.json(
        { error: "initData bytes are required" },
        { status: 400 },
      );
    }
    const bodyString = new TextDecoder().decode(body);
    const bodyJson = JSON.parse(bodyString);

    const parsedSolanaEnv = parseClaimSolanaEnv(bodyJson.solanaEnv);
    if (!parsedSolanaEnv) {
      return NextResponse.json(
        { error: "Invalid solana env. Supported values: mainnet, devnet" },
        { status: 400 },
      );
    }

    const {
      storeTx,
      recipientPubKey,
      username,
      amount,
      processedInitDataBytes,
      telegramSignatureBytes,
      telegramPublicKeyBytes,
    } = bodyJson;
    const parsedAmountRaw =
      typeof amount === "string" ? Number.parseInt(amount, 10) : amount;
    const parsedAmount =
      typeof parsedAmountRaw === "number" &&
      Number.isFinite(parsedAmountRaw) &&
      parsedAmountRaw > 0
        ? parsedAmountRaw
        : null;

    if (
      !storeTx ||
      !recipientPubKey ||
      !username ||
      parsedAmount === null ||
      !processedInitDataBytes ||
      !telegramSignatureBytes ||
      !telegramPublicKeyBytes
    ) {
      console.log("transaction and payer are required", {
        storeTx: !!storeTx,
        recipientPubKey: !!recipientPubKey,
        username,
        parsedAmount: parsedAmount !== null,
        processedInitDataBytes: !!processedInitDataBytes,
        telegramSignatureBytes: !!telegramSignatureBytes,
        telegramPublicKeyBytes: !!telegramPublicKeyBytes,
      });
      return NextResponse.json(
        { error: "transaction and payer are required" },
        { status: 400 },
      );
    }

    if (typeof storeTx !== "string") {
      return NextResponse.json(
        { error: "Invalid transaction format" },
        { status: 400 },
      );
    }

    if (typeof recipientPubKey !== "string" || typeof username !== "string") {
      return NextResponse.json(
        { error: "Invalid recipient or username format" },
        { status: 400 },
      );
    }

    if (
      username.length < 5 ||
      username.length > 32 ||
      !/^[a-z0-9_]+$/.test(username)
    ) {
      return NextResponse.json(
        { error: "Invalid username" },
        { status: 400 },
      );
    }

    const payer = await getGaslessKeypair();
    const configuredGaslessPublicKey = await getGaslessPublicKey();
    if (!payer.publicKey.equals(configuredGaslessPublicKey)) {
      return NextResponse.json(
        { error: "Gasless keypair does not match configured public key" },
        { status: 500 },
      );
    }

    const payerWallet = new SimpleWallet(payer);
    const provider = createProviderForEnv(payerWallet, parsedSolanaEnv);

    const parsedStoreTx = deserializeTransaction(storeTx);
    const parsedRecipient = new PublicKey(recipientPubKey);
    const processedInitData = normalizeBytes(processedInitDataBytes);
    const telegramSignature = normalizeBytes(telegramSignatureBytes);
    const telegramPublicKey = normalizeBytes(telegramPublicKeyBytes);

    let initDataUsername: string;
    try {
      initDataUsername = extractUsernameFromValidationBytes(processedInitData);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Invalid Telegram init data payload";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (initDataUsername !== username) {
      return NextResponse.json(
        {
          error:
            "Telegram init-data username does not match the deposit username",
          details: `initData=${initDataUsername}, deposit=${username}`,
        },
        { status: 400 },
      );
    }

    const storeResult = await sendSignedTransaction(
      provider,
      parsedStoreTx,
      payerWallet,
    );
    if (!storeResult.ok) {
      const invalidUsername = isInvalidTelegramUsernameFailure(storeResult);
      return NextResponse.json(
        {
          error: invalidUsername
            ? "Invalid Telegram username in init data"
            : "Failed to store init data",
          details: storeResult.message,
        },
        { status: invalidUsername ? 400 : 500 },
      );
    }
    // fire and forget — errors are already caught inside the helper
    void recordGaslessClaimAnalyticsBestEffort({
      connection: provider.connection,
      payerAddress: payerWallet.publicKey.toBase58(),
      signature: storeResult.signature,
      solanaEnv: parsedSolanaEnv,
      transactionType: "store",
    });

    const result = await verifyAndClaimDeposit(
      provider,
      payerWallet,
      parsedRecipient,
      username,
      parsedAmount,
      processedInitData,
      telegramSignature,
      telegramPublicKey,
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: "Failed to claim deposit" },
        { status: 500 },
      );
    }

    // fire and forget — errors are already caught inside the helper
    void recordGaslessClaimAnalyticsBestEffort({
      connection: provider.connection,
      payerAddress: payerWallet.publicKey.toBase58(),
      signature: result.verifySignature,
      solanaEnv: parsedSolanaEnv,
      transactionType: "verify_telegram_init_data",
    });
    if (result.topUpSignature) {
      // fire and forget — errors are already caught inside the helper
      void recordGaslessClaimAnalyticsBestEffort({
        connection: provider.connection,
        payerAddress: payerWallet.publicKey.toBase58(),
        recipientAddress: parsedRecipient.toBase58(),
        signature: result.topUpSignature,
        solanaEnv: parsedSolanaEnv,
        transactionType: "top_up_to_0_01_sol",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[gasless][claim] failed to claim deposit", error);
    return NextResponse.json(
      { error: "Failed to claim deposit" },
      { status: 500 },
    );
  }
}
