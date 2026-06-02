import {
  DELEGATION_PROGRAM_ID,
  findDepositPda,
  getErValidatorForSolanaEnv,
} from "@loyal-labs/private-transactions";
import { PublicKey } from "@solana/web3.js";

import { getSolanaEnv } from "../rpc/connection";
import { getWalletKeypair } from "../wallet/wallet-details";
import { resolveTrackedKaminoUsdcMint } from "./kamino-usdc-position";
import { prettyStringify, waitForAccount } from "./loyal-deposits";
import { getPrivateClient } from "./private-client";

export async function transferTokens(params: {
  tokenMint: PublicKey;
  amount: number;
  destination: PublicKey;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> transferTokens");
  const keypair = await getWalletKeypair();
  const client = await getPrivateClient();
  const solanaEnv = getSolanaEnv();
  const validator = getErValidatorForSolanaEnv(solanaEnv);
  const { tokenMint, amount, destination } = params;
  let transferAmount = BigInt(amount);

  if (tokenMint.toBase58() === resolveTrackedKaminoUsdcMint(solanaEnv)) {
    const quotedTransferAmount =
      await client.getKaminoCollateralSharesForLiquidityAmount({
        tokenMint,
        liquidityAmountRaw: BigInt(amount),
      });
    if (quotedTransferAmount === null) {
      throw new Error(
        "Could not quote the current USDC shielded exchange rate. Please retry."
      );
    }
    transferAmount = quotedTransferAmount;
  }

  const existingBaseDeposit = await client.getBaseDeposit(
    destination,
    tokenMint
  );
  console.log("existingBaseDeposit", prettyStringify(existingBaseDeposit));
  if (!existingBaseDeposit) {
    console.log("initializeDeposit for destination user");
    const initializeDepositSig = await client.initializeDeposit({
      tokenMint,
      user: destination,
      payer: keypair.publicKey,
    });
    console.log("initializeDeposit sig", initializeDepositSig);

    const [depositPda] = findDepositPda(destination, tokenMint);
    await waitForAccount(client, depositPda);
  }

  const [depositPda] = findDepositPda(destination, tokenMint);
  const depositPdaAccountInfo =
    await client.baseProgram.provider.connection.getAccountInfo(depositPda);
  const isDelegated = depositPdaAccountInfo?.owner.equals(
    DELEGATION_PROGRAM_ID
  );

  if (!isDelegated) {
    console.log("delegateDeposit for destination user");
    const delegateDepositSig = await client.delegateDeposit({
      tokenMint,
      user: destination,
      payer: keypair.publicKey,
      validator,
    });
    console.log("delegateDeposit sig", delegateDepositSig);
  }

  console.log("transferDeposit");
  const transferDepositSig = await client.transferDeposit({
    user: keypair.publicKey,
    tokenMint,
    destinationUser: destination,
    amount: transferAmount,
    payer: keypair.publicKey,
  });
  console.log("transferDeposit sig", transferDepositSig);

  console.log(`< transferTokens (${Date.now() - startTime}ms)`);

  return transferDepositSig;
}
