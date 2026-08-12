import "server-only";

import bs58 from "bs58";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  codecs,
  createLoyalSmartAccountsClient,
  pda,
  type LoyalSmartAccountsClient,
} from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import { getServerEnv } from "@/lib/core/config/server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { recordSmartAccountSponsorshipTransactionBySignature } from "./sponsorship-analytics";

const connectionCache = new Map<SolanaEnv, Connection>();
let cachedSponsorKeypair: Keypair | null = null;

function getSmartAccountsConnection(solanaEnv: SolanaEnv): Connection {
  const cachedConnection = connectionCache.get(solanaEnv);
  if (cachedConnection) {
    return cachedConnection;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getServerSolanaEndpoints(solanaEnv);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });

  connectionCache.set(solanaEnv, connection);
  return connection;
}

function getSmartAccountsClient(args: {
  solanaEnv: SolanaEnv;
  programId: string;
}): LoyalSmartAccountsClient {
  return createLoyalSmartAccountsClient({
    connection: getSmartAccountsConnection(args.solanaEnv),
    defaultCommitment: "confirmed",
    programId: new PublicKey(args.programId),
  });
}

function getSponsorKeypair(): Keypair {
  if (cachedSponsorKeypair) {
    return cachedSponsorKeypair;
  }

  const smartAccountSponsorPrivateKey =
    getServerEnv().smartAccountSponsorPrivateKey;
  if (!smartAccountSponsorPrivateKey) {
    throw new Error("SMART_ACCOUNT_SPONSOR_PK is not set");
  }

  cachedSponsorKeypair = Keypair.fromSecretKey(
    bs58.decode(smartAccountSponsorPrivateKey)
  );
  return cachedSponsorKeypair;
}

function isMissingAccountError(error: unknown, accountName: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes(`Unable to find ${accountName} account at`)
  );
}

async function isSettingsOwnedByProgram(args: {
  solanaEnv: SolanaEnv;
  programId: string;
  settingsPda: PublicKey;
}): Promise<boolean> {
  const accountInfo = await getSmartAccountsConnection(
    args.solanaEnv
  ).getAccountInfo(args.settingsPda, "confirmed");

  return (
    accountInfo !== null &&
    accountInfo.owner.equals(new PublicKey(args.programId))
  );
}

export async function fetchProgramConfigAccount(args: {
  solanaEnv: SolanaEnv;
  programId: string;
}) {
  const client = getSmartAccountsClient(args);
  const [programConfigPda] = pda.getProgramConfigPda({
    programId: new PublicKey(args.programId),
  });

  return client.programConfig.queries.fetchProgramConfig(programConfigPda);
}

// Settings signer sets change only through explicit settings-change flows,
// but the wallet-pairing guard reads them on every authenticated mobile Earn
// request (2 RPC calls per read) — far too hot for the 5 rps Helius budget.
// Cache successful non-null reads briefly. Null results (settings not visible
// yet) are never cached, so provisioning and promotion always see fresh
// state. On-chain signing stays the real enforcement — a stale entry can only
// let the read-model pairing check pass for up to the TTL.
const SETTINGS_SIGNERS_CACHE_TTL_MS = 120_000;
const SETTINGS_SIGNERS_CACHE_MAX_ENTRIES = 5_000;
const settingsSignersCache = new Map<
  string,
  { expiresAt: number; signers: string[] }
>();

export async function findSettingsSignerAddresses(args: {
  solanaEnv: SolanaEnv;
  programId: string;
  settingsPda: string;
}): Promise<string[] | null> {
  const cacheKey = `${args.solanaEnv}:${args.programId}:${args.settingsPda}`;
  const cached = settingsSignersCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return [...cached.signers];
  }

  const client = getSmartAccountsClient(args);
  const settingsPda = new PublicKey(args.settingsPda);

  if (
    !(await isSettingsOwnedByProgram({
      solanaEnv: args.solanaEnv,
      programId: args.programId,
      settingsPda,
    }))
  ) {
    return null;
  }

  try {
    const settings =
      await client.smartAccounts.queries.fetchSettings(settingsPda);

    const signers = settings.signers.map((signer) => signer.key.toBase58());
    if (settingsSignersCache.size >= SETTINGS_SIGNERS_CACHE_MAX_ENTRIES) {
      settingsSignersCache.clear();
    }
    settingsSignersCache.set(cacheKey, {
      expiresAt: Date.now() + SETTINGS_SIGNERS_CACHE_TTL_MS,
      signers,
    });
    return signers;
  } catch (error) {
    if (isMissingAccountError(error, "Settings")) {
      return null;
    }

    throw error;
  }
}

export async function fetchRootSettingsSigners(args: {
  solanaEnv: SolanaEnv;
  programId: string;
  settingsPda: string;
}): Promise<Array<{ address: string; permissionMask: number }> | null> {
  const client = getSmartAccountsClient(args);
  const settingsPda = new PublicKey(args.settingsPda);

  if (
    !(await isSettingsOwnedByProgram({
      solanaEnv: args.solanaEnv,
      programId: args.programId,
      settingsPda,
    }))
  ) {
    return null;
  }

  try {
    const settings =
      await client.smartAccounts.queries.fetchSettings(settingsPda);

    return settings.signers.map((signer) => ({
      address: signer.key.toBase58(),
      permissionMask: signer.permissions.mask,
    }));
  } catch (error) {
    if (isMissingAccountError(error, "Settings")) {
      return null;
    }

    throw error;
  }
}

// `client.send` resolves at "confirmed" commitment, which is not finality: a
// confirmed creation can be forked out and never land while the caller has
// already recorded the account as ready. That exact sequence poisoned 21
// `ready` rows on 2026-07-08 — the row kept a settings PDA that a concurrent
// creation from another app of the shared smart-account program later claimed
// with different signers, and every subsequent Earn deposit failed with
// NotASigner (0x1776). Creation is a durable product-state commitment, so it
// must not be reported successful until the transaction is finalized.
async function waitForFinalizedSignature(args: {
  connection: Connection;
  signature: string;
}): Promise<void> {
  const timeoutMs = 90_000;
  const pollIntervalMs = 2_500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { value } = await args.connection.getSignatureStatuses([
      args.signature,
    ]);
    const status = value[0];

    if (status?.err) {
      throw new Error(
        `Smart account creation ${args.signature} failed on-chain: ${JSON.stringify(status.err)}`
      );
    }
    if (status?.confirmationStatus === "finalized") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Smart account creation ${args.signature} was not finalized within ${timeoutMs}ms.`
  );
}

export async function createSponsoredSmartAccount(args: {
  solanaEnv: SolanaEnv;
  programId: string;
  settingsPda: string;
  treasury: PublicKey;
  walletAddress: string;
}): Promise<string> {
  const client = getSmartAccountsClient(args);
  const sponsor = getSponsorKeypair();
  const prepared = await client.features.smartAccounts.prepare.create({
    programId: new PublicKey(args.programId),
    treasury: args.treasury,
    creator: sponsor.publicKey,
    settings: new PublicKey(args.settingsPda),
    settingsAuthority: null,
    threshold: 1,
    signers: [
      {
        key: new PublicKey(args.walletAddress),
        permissions: codecs.Permissions.all(),
      },
    ],
    timeLock: 0,
    rentCollector: null,
  });

  const signature = await client.send(prepared, {
    confirm: true,
    signers: [sponsor],
  });

  await waitForFinalizedSignature({
    connection: getSmartAccountsConnection(args.solanaEnv),
    signature,
  });

  // Belt and braces on top of finality: the settings PDA seed is a global
  // counter shared by every app on this program, so confirm the account that
  // now exists at the PDA is OURS (wallet in the signer set) before the
  // caller marks the record ready. A throw here leaves the record
  // provisioning/failed, which the reconcile cron retries with a fresh PDA.
  const signerAddresses = await findSettingsSignerAddresses({
    solanaEnv: args.solanaEnv,
    programId: args.programId,
    settingsPda: args.settingsPda,
  });
  if (!signerAddresses?.includes(args.walletAddress)) {
    throw new Error(
      `Smart account creation ${signature} finalized but settings ${args.settingsPda} does not list ${args.walletAddress} as a signer.`
    );
  }

  const [smartAccountPda] = pda.getSmartAccountPda({
    accountIndex: 0,
    programId: new PublicKey(args.programId),
    settingsPda: new PublicKey(args.settingsPda),
  });

  void recordSmartAccountSponsorshipTransactionBySignature({
    connection: getSmartAccountsConnection(args.solanaEnv),
    payerAddress: sponsor.publicKey.toBase58(),
    settingsPda: args.settingsPda,
    signature,
    smartAccountAddress: smartAccountPda.toBase58(),
    solanaEnv: args.solanaEnv,
    userAddress: args.walletAddress,
  }).catch((error) => {
    console.error(
      "[smart-accounts][sponsorship-analytics] failed to record transaction",
      {
        error,
        settingsPda: args.settingsPda,
        signature,
      }
    );
  });

  return signature;
}
