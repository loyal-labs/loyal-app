import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";
import {
  createLoyalSmartAccountsClient,
  pda,
  type LoyalSmartAccountsClient,
} from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { getSolanaEndpoints } from "@loyal-labs/solana-rpc";

const connectionCache = new Map<SolanaEnv, Connection>();

function getSmartAccountsConnection(solanaEnv: SolanaEnv): Connection {
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

function isMissingAccountError(error: unknown, accountName: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes(`Unable to find ${accountName} account at`)
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

export async function findSettingsSignerAddresses(args: {
  solanaEnv: SolanaEnv;
  programId: string;
  settingsPda: string;
}): Promise<string[] | null> {
  const client = getSmartAccountsClient(args);

  try {
    const settings = await client.smartAccounts.queries.fetchSettings(
      new PublicKey(args.settingsPda)
    );

    return settings.signers.map((signer) => signer.key.toBase58());
  } catch (error) {
    if (isMissingAccountError(error, "Settings")) {
      return null;
    }

    throw error;
  }
}
