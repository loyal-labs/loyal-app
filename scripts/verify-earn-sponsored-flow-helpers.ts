import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  compilePreparedTransaction,
  type WalletAdapterLike,
} from "../packages/smart-account-vaults/src/index.ts";
import type {
  SmartAccountNativeSolRequirement,
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
  SmartAccountPreparedEarnUsdcYieldRoutingPolicy,
} from "../packages/smart-account-vaults/src/types.ts";

export type FrontendSession = {
  baseUrl: string;
  cookie: string;
  settingsPda: string;
  smartAccountAddress: string | null;
};

export type SponsoredTransactionConfirmation = {
  confirmedSlot: string;
  signature: string;
};

type SponsorablePreparedOperation =
  | SmartAccountPreparedEarnUsdcAutodepositClose["prepared"]
  | SmartAccountPreparedEarnUsdcAutodepositSetup["prepared"]
  | SmartAccountPreparedEarnUsdcDeposit["prepared"]
  | SmartAccountPreparedEarnUsdcWithdraw["prepared"]
  | SmartAccountPreparedEarnUsdcYieldRoutingPolicy["prepared"]
  | NonNullable<
      SmartAccountPreparedEarnUsdcYieldRoutingPolicy["finalizePrepared"]
    >;

class FrontendRequestError extends Error {
  readonly body: unknown;
  readonly path: string;
  readonly status: number;

  constructor(args: { body: unknown; path: string; status: number }) {
    super(
      `Frontend request ${args.path} failed with ${
        args.status
      }: ${JSON.stringify(args.body)}`
    );
    this.name = "FrontendRequestError";
    this.body = args.body;
    this.path = args.path;
    this.status = args.status;
  }
}

const SOLANA_TRANSACTION_PACKET_DATA_SIZE = 1232;

export function bigintJson(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function parsePositiveRawAmount(value: string, name: string): bigint {
  if (!/^\d+$/.test(value) || BigInt(value) <= BigInt(0)) {
    throw new Error(`${name} must be a positive integer raw amount.`);
  }
  return BigInt(value);
}

export function parseNonNegativeRawAmount(value: string, name: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer raw amount.`);
  }
  return BigInt(value);
}

function decodeKeypairBytes(value: string): Uint8Array {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed));
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Uint8Array.from(
      trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
    );
  }
  return bs58.decode(trimmed);
}

function keypairFromSecretOrSeed(value: string): Keypair {
  const bytes = decodeKeypairBytes(value);
  return bytes.length === 32
    ? Keypair.fromSeed(bytes)
    : Keypair.fromSecretKey(bytes);
}

export function loadTestingKeypair(): Keypair {
  const raw =
    process.env.EARN_VERIFY_SOLANA_TESTING_PK ?? process.env.SOLANA_TESTING_PK;
  if (!raw) {
    throw new Error(
      "EARN_VERIFY_SOLANA_TESTING_PK or SOLANA_TESTING_PK is required."
    );
  }

  const keypair = keypairFromSecretOrSeed(raw);
  const expectedWallet = process.env.EARN_VERIFY_EXPECTED_WALLET_ADDRESS;
  if (
    expectedWallet &&
    keypair.publicKey.toBase58() !== expectedWallet.trim()
  ) {
    throw new Error(
      `Verifier keypair resolves to ${keypair.publicKey.toBase58()}, expected ${expectedWallet.trim()}.`
    );
  }

  return keypair;
}

export function loadDeploymentPolicySignerPublicKey(): PublicKey {
  const publicSigner = process.env.EARN_YIELD_ROUTER_PUBLIC_KEY?.trim();
  if (publicSigner) {
    return new PublicKey(publicSigner);
  }

  const raw = process.env.DEPLOYMENT_PK;
  if (!raw) {
    throw new Error(
      "EARN_YIELD_ROUTER_PUBLIC_KEY or DEPLOYMENT_PK is required."
    );
  }

  return keypairFromSecretOrSeed(raw).publicKey;
}

export function loadSponsorFeePayer(): PublicKey {
  const publicSponsor = process.env.EARN_POLICY_SPONSOR_PUBKEY?.trim();
  if (publicSponsor) {
    return new PublicKey(publicSponsor);
  }

  const sponsorPrivateKey = process.env.EARN_POLICY_SPONSOR_PK;
  if (!sponsorPrivateKey) {
    throw new Error(
      "EARN_POLICY_SPONSOR_PUBKEY or EARN_POLICY_SPONSOR_PK is required."
    );
  }

  return keypairFromSecretOrSeed(sponsorPrivateKey).publicKey;
}

export function createKeypairWallet(keypair: Keypair): WalletAdapterLike {
  const sign = <T extends Transaction | VersionedTransaction>(
    transaction: T
  ): T => {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([keypair]);
    } else {
      transaction.sign(keypair);
    }
    return transaction;
  };

  return {
    publicKey: keypair.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      transaction: T
    ): Promise<T> {
      return sign(transaction);
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      transactions: T[]
    ): Promise<T[]> {
      return transactions.map((transaction) => sign(transaction));
    },
  };
}

function signWalletAuthMessage(args: {
  keypair: Keypair;
  message: string;
}): string {
  return bs58.encode(
    nacl.sign.detached(
      new TextEncoder().encode(args.message),
      args.keypair.secretKey
    )
  );
}

function extractCookieHeader(response: Response): string {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  const setCookies =
    getSetCookie && getSetCookie.length > 0
      ? getSetCookie
      : response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie")!]
      : [];
  const cookies = setCookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  if (cookies.length === 0) {
    throw new Error("Frontend auth did not return a session cookie.");
  }

  return cookies.join("; ");
}

async function readJsonResponse<T>(
  response: Response,
  path: string
): Promise<T> {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new FrontendRequestError({ body, path, status: response.status });
  }

  return body as T;
}

export async function frontendPostJson<T>(args: {
  body: unknown;
  cookie?: string;
  path: string;
  session: Pick<FrontendSession, "baseUrl">;
}): Promise<{ body: T; response: Response }> {
  const response = await fetch(`${args.session.baseUrl}${args.path}`, {
    body: JSON.stringify(args.body, bigintJson),
    headers: {
      "content-type": "application/json",
      origin: args.session.baseUrl,
      ...(args.cookie ? { cookie: args.cookie } : {}),
    },
    method: "POST",
  });

  return {
    body: await readJsonResponse<T>(response, args.path),
    response,
  };
}

export async function frontendGetJson<T>(args: {
  cookie: string;
  path: string;
  session: Pick<FrontendSession, "baseUrl">;
}): Promise<{ body: T; response: Response }> {
  const response = await fetch(`${args.session.baseUrl}${args.path}`, {
    headers: {
      cookie: args.cookie,
      origin: args.session.baseUrl,
    },
    method: "GET",
  });

  return {
    body: await readJsonResponse<T>(response, args.path),
    response,
  };
}

export async function authenticateFrontendSession(args: {
  baseUrl: string | null;
  keypair: Keypair;
  sessionCookie?: string | null;
  turnstileToken?: string | null;
}): Promise<FrontendSession> {
  if (!args.baseUrl) {
    throw new Error("EARN_VERIFY_FRONTEND_BASE_URL is required.");
  }

  if (args.sessionCookie) {
    const settingsPda = process.env.EARN_SETTINGS_PDA?.trim();
    if (!settingsPda) {
      throw new Error(
        "EARN_SETTINGS_PDA is required when EARN_VERIFY_FRONTEND_COOKIE is provided."
      );
    }

    return {
      baseUrl: args.baseUrl,
      cookie: args.sessionCookie,
      settingsPda,
      smartAccountAddress: null,
    };
  }

  const challenge = await frontendPostJson<{
    challengeToken: string;
    message: string;
  }>({
    body: {
      turnstileToken: args.turnstileToken ?? "local-bypass",
      walletAddress: args.keypair.publicKey.toBase58(),
    },
    path: "/api/auth/wallet/challenge",
    session: { baseUrl: args.baseUrl },
  });
  const completion = await frontendPostJson<{
    user?: { settingsPda?: string; smartAccountAddress?: string };
  }>({
    body: {
      challengeToken: challenge.body.challengeToken,
      signature: signWalletAuthMessage({
        keypair: args.keypair,
        message: challenge.body.message,
      }),
    },
    path: "/api/auth/wallet/complete",
    session: { baseUrl: args.baseUrl },
  });

  const settingsPda =
    process.env.EARN_SETTINGS_PDA?.trim() ?? completion.body.user?.settingsPda;
  if (!settingsPda) {
    throw new Error(
      "Authenticated frontend session did not return settingsPda. Set EARN_SETTINGS_PDA."
    );
  }

  return {
    baseUrl: args.baseUrl,
    cookie: extractCookieHeader(completion.response),
    settingsPda,
    smartAccountAddress: completion.body.user?.smartAccountAddress ?? null,
  };
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function serializedBase64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

export function assertSerializedTransactionFitsSolanaPacket(args: {
  operation: string;
  transaction: string;
}) {
  const byteLength = serializedBase64ByteLength(args.transaction);
  if (byteLength <= SOLANA_TRANSACTION_PACKET_DATA_SIZE) {
    return;
  }

  throw new Error(
    `${args.operation} transaction is ${byteLength} bytes, which exceeds Solana's ${SOLANA_TRANSACTION_PACKET_DATA_SIZE} byte packet limit.`
  );
}

export async function signPreparedEarnOperationForSponsorship(args: {
  connection: Connection;
  feePayer: PublicKey;
  operation: string;
  prepared: SponsorablePreparedOperation;
  wallet: WalletAdapterLike;
}): Promise<string> {
  const latestBlockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = compilePreparedTransaction({
    blockhash: latestBlockhash.blockhash,
    feePayer: args.feePayer,
    prepared: args.prepared,
  });
  const signedTransaction = await args.wallet.signTransaction(transaction);
  const serialized = encodeBase64(signedTransaction.serialize());
  assertSerializedTransactionFitsSolanaPacket({
    operation: args.operation,
    transaction: serialized,
  });
  return serialized;
}

export async function signPreparedEarnOperationsForSponsorship<
  TStage extends string
>(args: {
  connection: Connection;
  feePayer: PublicKey;
  preparedStages: ReadonlyArray<{
    operation: string;
    prepared: SponsorablePreparedOperation;
    stage: TStage;
  }>;
  wallet: WalletAdapterLike;
}): Promise<Map<TStage, string>> {
  if (!args.wallet.signAllTransactions) {
    throw new Error("Wallet does not support signAllTransactions.");
  }

  const latestBlockhash = await args.connection.getLatestBlockhash("confirmed");
  const transactions = args.preparedStages.map(({ prepared }) =>
    compilePreparedTransaction({
      blockhash: latestBlockhash.blockhash,
      feePayer: args.feePayer,
      prepared,
    })
  );
  const signedTransactions = await args.wallet.signAllTransactions(
    transactions
  );
  if (signedTransactions.length !== args.preparedStages.length) {
    throw new Error("Signed transaction count does not match prepared count.");
  }

  const transactionByStage = new Map<TStage, string>();
  for (const [index, transaction] of signedTransactions.entries()) {
    const stage = args.preparedStages[index];
    if (!stage) {
      throw new Error("Signed transaction did not match a prepared stage.");
    }
    const serialized = encodeBase64(transaction.serialize());
    assertSerializedTransactionFitsSolanaPacket({
      operation: stage.operation,
      transaction: serialized,
    });
    transactionByStage.set(stage.stage, serialized);
  }

  return transactionByStage;
}

export function preparedOperationRequiresSigner(args: {
  prepared: SponsorablePreparedOperation;
  signer: PublicKey;
}): boolean {
  return (
    args.prepared.payer.equals(args.signer) ||
    args.prepared.instructions.some((instruction) =>
      instruction.keys.some(
        (key) => key.isSigner && key.pubkey.equals(args.signer)
      )
    )
  );
}

export async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<string> {
  let lastStatus: unknown = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { value } = await args.connection.getSignatureStatuses(
      [args.signature],
      { searchTransactionHistory: true }
    );
    const status = value[0] ?? null;
    lastStatus = status;
    if (status?.err) {
      throw new Error(
        `Transaction ${args.signature} failed: ${JSON.stringify(status.err)}`
      );
    }
    if (
      status &&
      (status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized") &&
      typeof status.slot === "number"
    ) {
      return String(status.slot);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `Transaction ${
      args.signature
    } is not confirmed. Last status: ${JSON.stringify(lastStatus)}`
  );
}

export function nativeSolRequirementError(
  requirement: SmartAccountNativeSolRequirement | null | undefined
): string | null {
  if (!requirement || requirement.canProceed) {
    return null;
  }
  if (BigInt(requirement.deficitLamports) <= BigInt(0)) {
    return null;
  }
  return `Native SOL requirement not met. Required lamports ${requirement.requiredLamports}, balance ${requirement.balanceLamports}, deficit ${requirement.deficitLamports}.`;
}

export async function accountStatus(
  connection: Connection,
  pubkey: string | null
) {
  if (!pubkey) {
    return null;
  }
  const account = await connection.getAccountInfo(new PublicKey(pubkey));
  return account
    ? {
        exists: true,
        lamports: account.lamports,
        owner: account.owner.toBase58(),
      }
    : { exists: false };
}

export async function waitForAccountStatus(args: {
  connection: Connection;
  exists: boolean;
  pubkey: string | null;
  attempts?: number;
  delayMs?: number;
}) {
  const attempts = args.attempts ?? 10;
  const delayMs = args.delayMs ?? 500;
  let latest = await accountStatus(args.connection, args.pubkey);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (Boolean(latest?.exists) === args.exists) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    latest = await accountStatus(args.connection, args.pubkey);
  }
  return latest;
}
