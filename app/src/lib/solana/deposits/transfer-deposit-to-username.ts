import {
  DELEGATION_PROGRAM_ID,
  findUsernameDepositPda,
  getErValidatorForSolanaEnv,
} from "@loyal-labs/private-transactions";
import { PublicKey } from "@solana/web3.js";

import { getSolanaEnv } from "../rpc/connection";
import { getWalletKeypair } from "../wallet/wallet-details";
import { waitForAccount } from "./loyal-deposits";
import { getPrivateClient } from "./private-client";

export async function transferTokensToUsername(params: {
  tokenMint: PublicKey;
  amount: number;
  destinationUsername: string;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> transferTokensToUsername");
  const keypair = await getWalletKeypair();
  const client = await getPrivateClient();
  const validator = getErValidatorForSolanaEnv(getSolanaEnv());
  const { tokenMint, amount, destinationUsername } = params;

  const existingBaseUsernameDeposit = await client.getBaseUsernameDeposit(
    destinationUsername,
    tokenMint
  );
  const existingEphemeralUsernameDeposit =
    await client.getEphemeralUsernameDeposit(destinationUsername, tokenMint);

  if (!existingBaseUsernameDeposit && !existingEphemeralUsernameDeposit) {
    console.log("initializeUsernameDeposit");
    const initializeUsernameDepositSig = await client.initializeUsernameDeposit(
      {
        tokenMint,
        username: destinationUsername,
        payer: keypair.publicKey,
      }
    );
    console.log("initializeUsernameDeposit sig", initializeUsernameDepositSig);
    const [depositPda] = await findUsernameDepositPda(destinationUsername, tokenMint);
    await waitForAccount(client, depositPda);
  }

  const [depositPda] = await findUsernameDepositPda(destinationUsername, tokenMint);
  const baseAccountInfo =
    await client.baseProgram.provider.connection.getAccountInfo(depositPda);
  const isDelegated = baseAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID);

  if (!isDelegated) {
    console.log("delegateUsernameDeposit");
    const delegateUsernameDepositSig = await client.delegateUsernameDeposit({
      tokenMint,
      username: destinationUsername,
      payer: keypair.publicKey,
      validator,
    });
    console.log("delegateUsernameDeposit sig", delegateUsernameDepositSig);
  }

  console.log("transferToUsernameDeposit");
  const transferToUsernameDepositSig = await client.transferToUsernameDeposit({
    username: destinationUsername,
    user: keypair.publicKey,
    tokenMint,
    amount,
    payer: keypair.publicKey,
  });
  console.log("transferToUsernameDeposit sig", transferToUsernameDepositSig);

  console.log(`< transferTokensToUsername (${Date.now() - startTime}ms)`);

  return transferToUsernameDepositSig;
}
