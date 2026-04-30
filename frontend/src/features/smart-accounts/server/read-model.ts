import "server-only";

import {
  createSmartAccountVaultsClient,
  type SmartAccountOverview,
} from "@loyal-labs/smart-account-vaults";
import { getSolanaEndpoints, type SolanaEnv } from "@loyal-labs/solana-rpc";
import { createSolanaWalletDataClient } from "@loyal-labs/solana-wallet";
import { Connection, PublicKey } from "@solana/web3.js";

import { getServerEnv } from "@/lib/core/config/server";

const connectionCache = new Map<SolanaEnv, Connection>();
const walletDataClientCache = new Map<
  SolanaEnv,
  ReturnType<typeof createSolanaWalletDataClient>
>();
const OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS = [250, 750, 1500, 2500];

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingSettingsAccountError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Unable to find Settings account at")
  );
}

function getConnection(solanaEnv: SolanaEnv) {
  const cachedConnection = connectionCache.get(solanaEnv);
  if (cachedConnection) {
    return cachedConnection;
  }

  const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(solanaEnv);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    wsEndpoint: websocketEndpoint,
  });

  connectionCache.set(solanaEnv, connection);
  return connection;
}

function getWalletDataClient(solanaEnv: SolanaEnv) {
  const cachedClient = walletDataClientCache.get(solanaEnv);
  if (cachedClient) {
    return cachedClient;
  }

  const client = createSolanaWalletDataClient({
    env: solanaEnv,
  });

  walletDataClientCache.set(solanaEnv, client);
  return client;
}

export async function fetchCurrentSmartAccountOverview(args: {
  settingsPda: string;
}): Promise<SmartAccountOverview> {
  const serverEnv = getServerEnv();
  const client = createSmartAccountVaultsClient({
    connection: getConnection(serverEnv.solanaEnv),
    walletDataClient: getWalletDataClient(serverEnv.solanaEnv),
    programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
  });

  const settingsPda = new PublicKey(args.settingsPda);
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt <= OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await client.fetchOverview({ settingsPda });
    } catch (error) {
      if (
        !isMissingSettingsAccountError(error) ||
        attempt === OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }

      lastError = error;
      await wait(OVERVIEW_MISSING_SETTINGS_RETRY_DELAYS_MS[attempt]!);
    }
  }

  throw lastError;
}
