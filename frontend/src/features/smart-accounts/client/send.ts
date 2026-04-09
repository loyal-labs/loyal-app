import type { Connection, SendOptions, VersionedTransaction } from "@solana/web3.js";
import { Connection as SolanaConnection, PublicKey } from "@solana/web3.js";
import {
  codecs,
  createLoyalSmartAccountsClient,
  smartAccounts,
} from "@loyal-labs/loyal-smart-accounts";
import { getSolanaEndpoints, type SolanaEnv } from "@loyal-labs/solana-rpc";

import type { SmartAccountProvisioningResponse } from "@/features/smart-accounts/contracts";

export type WalletSendTransaction = (
  transaction: VersionedTransaction,
  connection: Connection,
  options?: SendOptions
) => Promise<string>;

const provisioningConnectionCache = new Map<SolanaEnv, Connection>();

function getProvisioningConnectionForEnv(solanaEnv: SolanaEnv): Connection {
  const cachedConnection = provisioningConnectionCache.get(solanaEnv);
  if (cachedConnection) {
    return cachedConnection;
  }

  const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(solanaEnv);
  const connection = new SolanaConnection(rpcEndpoint, {
    commitment: "confirmed",
    wsEndpoint: websocketEndpoint,
  });

  provisioningConnectionCache.set(solanaEnv, connection);
  return connection;
}

function resolveProvisioningConnection(args: {
  connection: Connection;
  solanaEnv: SolanaEnv;
}): Connection {
  const expectedRpcEndpoint = getSolanaEndpoints(args.solanaEnv).rpcEndpoint;

  return args.connection.rpcEndpoint === expectedRpcEndpoint
    ? args.connection
    : getProvisioningConnectionForEnv(args.solanaEnv);
}

export async function sendCreateSmartAccountTransaction(args: {
  connection: Connection;
  walletAddress: string;
  sendTransaction: WalletSendTransaction;
  response: SmartAccountProvisioningResponse;
}): Promise<string> {
  if (!args.response.treasury) {
    throw new Error("Missing treasury for smart account provisioning.");
  }

  const creator = new PublicKey(args.walletAddress);
  const programId = new PublicKey(args.response.programId);
  const provisioningConnection = resolveProvisioningConnection({
    connection: args.connection,
    solanaEnv: args.response.solanaEnv,
  });
  const client = createLoyalSmartAccountsClient({
    connection: provisioningConnection,
    defaultCommitment: "confirmed",
    programId,
    sendPrepared: async (_prepared, _signers, context) =>
      args.sendTransaction(
        context.compileUnsignedTransaction(),
        provisioningConnection,
        context.sendOptions
      ),
  });
  const prepared = await smartAccounts.prepare.create({
    creator,
    treasury: new PublicKey(args.response.treasury),
    settings: new PublicKey(args.response.settingsPda),
    settingsAuthority: null,
    threshold: 1,
    signers: [
      {
        key: creator,
        permissions: codecs.Permissions.all(),
      },
    ],
    timeLock: 0,
    rentCollector: null,
    programId,
  });

  return client.send(prepared, { signers: [] });
}
