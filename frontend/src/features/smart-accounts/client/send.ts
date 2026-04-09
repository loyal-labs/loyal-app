import type { Connection, SendOptions, VersionedTransaction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import {
  codecs,
  createLoyalSmartAccountsClient,
  smartAccounts,
} from "@loyal-labs/loyal-smart-accounts";

import type { SmartAccountProvisioningResponse } from "@/features/smart-accounts/contracts";

export type WalletSendTransaction = (
  transaction: VersionedTransaction,
  connection: Connection,
  options?: SendOptions
) => Promise<string>;

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
  const client = createLoyalSmartAccountsClient({
    connection: args.connection,
    defaultCommitment: "confirmed",
    programId,
    sendPrepared: async (_prepared, _signers, context) =>
      args.sendTransaction(
        context.compileUnsignedTransaction(),
        args.connection,
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
