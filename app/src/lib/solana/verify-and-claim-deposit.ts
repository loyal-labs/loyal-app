import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  DELEGATION_PROGRAM_ID,
  findDepositPda,
  findUsernameDepositPda,
  getErValidatorForSolanaEnv,
  waitForAccountOwnerChange,
} from "@loyal-labs/private-transactions";
import {
  createCloseAccountInstruction,
  getAssociatedTokenAddress,
  NATIVE_MINT,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";

import { resolveEndpoint } from "../core/api";
import { prettyStringify, waitForAccount } from "./deposits/loyal-deposits";
import { getPrivateClient } from "./deposits/private-client";
import { getSolanaEnv } from "./rpc/connection";
import type { SolanaEnv } from "./rpc/types";
import {
  getSessionPda,
  getTelegramVerificationProgram,
} from "./solana-helpers";
import { getWalletKeypair, getWalletProvider } from "./wallet/wallet-details";

export const prepareCloseWsolTxn = async (
  provider: AnchorProvider,
  payer: PublicKey,
  userWallet: Wallet,
): Promise<Transaction | null> => {
  const userPublicKey = userWallet.publicKey;
  const recipientTokenAccount = await getAssociatedTokenAddress(
    NATIVE_MINT,
    userPublicKey,
  );
  const existingAta = await provider.connection.getAccountInfo(
    recipientTokenAccount,
  );
  if (!existingAta) {
    return null;
  }

  const closeTx = new Transaction().add(
    createCloseAccountInstruction(
      recipientTokenAccount,
      userPublicKey,
      userPublicKey,
    ),
  );

  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash();
  closeTx.feePayer = payer;
  closeTx.recentBlockhash = blockhash;
  closeTx.lastValidBlockHeight = lastValidBlockHeight;

  await userWallet.signTransaction(closeTx);

  return closeTx;
};

export async function claimTokens(params: {
  tokenMint: PublicKey;
  amount: number;
  username: string;
  destination: PublicKey;
  session: PublicKey;
  solanaEnv?: SolanaEnv;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> claimTokens");
  const {
    tokenMint,
    amount,
    username,
    destination,
    session,
    solanaEnv: selectedSolanaEnv = getSolanaEnv(),
  } = params;
  const client = await getPrivateClient({ solanaEnv: selectedSolanaEnv });
  const validator = getErValidatorForSolanaEnv(selectedSolanaEnv);

  const [usernameDepositPda] = await findUsernameDepositPda(username, tokenMint);
  const baseUsernameDepositPda =
    await client.baseProgram.provider.connection.getAccountInfo(
      usernameDepositPda,
    );
  const ephemeralUsernameDepositPda =
    await client.ephemeralProgram.provider.connection.getAccountInfo(
      usernameDepositPda,
    );
  console.log(
    "claimTokens baseUsernameDepositPda",
    prettyStringify(baseUsernameDepositPda),
  );
  console.log(
    "claimTokens ephemeralUsernameDepositPda",
    prettyStringify(ephemeralUsernameDepositPda),
  );

  const isUsernameDepositDelegated = baseUsernameDepositPda?.owner.equals(
    DELEGATION_PROGRAM_ID,
  );

  const keypair = await getWalletKeypair();

  if (!isUsernameDepositDelegated) {
    console.log("delegateUsernameDeposit (not delegated on base chain)");
    const delegationWatcher = waitForAccountOwnerChange(
      client.baseProgram.provider.connection,
      usernameDepositPda,
      DELEGATION_PROGRAM_ID,
    );
    try {
      const delegateUsernameDepositSig = await client.delegateUsernameDeposit({
        tokenMint,
        username,
        payer: keypair.publicKey,
        validator,
      });
      console.log("delegateUsernameDeposit sig", delegateUsernameDepositSig);
      console.log("waiting for usernameDeposit to be delegated...");
      await delegationWatcher.wait();
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }
  } else {
    console.log("delegateUsernameDeposit skipped (already delegated on base)");
  }

  const [depositPda] = findDepositPda(destination, tokenMint);
  const existingBaseDeposit = await client.getBaseDeposit(
    destination,
    tokenMint,
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

    await waitForAccount(client, depositPda);
  }

  const baseDepositPda =
    await client.baseProgram.provider.connection.getAccountInfo(depositPda);
  const ephemeralDepositPda =
    await client.ephemeralProgram.provider.connection.getAccountInfo(
      depositPda,
    );
  console.log("claimTokens baseDepositPda", prettyStringify(baseDepositPda));
  console.log(
    "claimTokens ephemeralDepositPda",
    prettyStringify(ephemeralDepositPda),
  );

  const isDepositDelegated = baseDepositPda?.owner.equals(
    DELEGATION_PROGRAM_ID,
  );

  if (!isDepositDelegated) {
    console.log("delegateDeposit (not delegated on base chain)");
    const delegationWatcher = waitForAccountOwnerChange(
      client.baseProgram.provider.connection,
      depositPda,
      DELEGATION_PROGRAM_ID,
    );
    try {
      const delegateDepositSig = await client.delegateDeposit({
        user: destination,
        tokenMint,
        payer: keypair.publicKey,
        validator,
      });
      console.log("delegateDepositSig sig", delegateDepositSig);
      console.log("waiting for deposit to be delegated...");
      await delegationWatcher.wait();
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }
  } else {
    console.log("delegateDeposit skipped (already delegated on base)");
  }

  console.log("claimUsernameDepositToDeposit");
  const claimUsernameDepositToDepositSig =
    await client.claimUsernameDepositToDeposit({
      username,
      tokenMint,
      amount,
      recipient: destination,
      session,
    });
  console.log(
    "claimUsernameDepositToDeposit sig",
    claimUsernameDepositToDepositSig,
  );

  console.log(`< claimTokens (${Date.now() - startTime}ms)`);

  return claimUsernameDepositToDepositSig;
}

export const sendStoreInitDataTxn = async (
  storeTx: Transaction,
  recipientPubKey: PublicKey,
  username: string,
  amount: number,
  processedInitDataBytes: Uint8Array,
  telegramSignatureBytes: Uint8Array,
  telegramPublicKeyBytes: Uint8Array,
) => {
  const serializedStoreTx = storeTx
    .serialize({ requireAllSignatures: false })
    .toString("base64");
  const encodeBytes = (bytes: Uint8Array) =>
    Buffer.from(bytes).toString("base64");
  const solanaEnv = getSolanaEnv();
  // `/api/gasless/claim` currently accepts only mainnet/devnet.
  // Keep non-mainnet environments on devnet semantics for this endpoint.
  const claimSolanaEnv = solanaEnv === "mainnet" ? "mainnet" : "devnet";

  const endpoint = resolveEndpoint("/api/gasless/claim");
  const response = await fetch(endpoint, {
    method: "POST",
    body: JSON.stringify({
      storeTx: serializedStoreTx,
      recipientPubKey,
      username,
      amount,
      solanaEnv: claimSolanaEnv,
      processedInitDataBytes: encodeBytes(processedInitDataBytes),
      telegramSignatureBytes: encodeBytes(telegramSignatureBytes),
      telegramPublicKeyBytes: encodeBytes(telegramPublicKeyBytes),
      closeTx: null,
    }),
  });
  if (!response.ok) {
    const rawResponseBody = await response.text();
    let errorDetails = `${response.status} ${response.statusText}`;

    if (rawResponseBody) {
      try {
        const parsedBody = JSON.parse(rawResponseBody) as {
          error?: unknown;
          details?: unknown;
        };
        const errorMessage =
          typeof parsedBody.error === "string" ? parsedBody.error : null;
        const detailMessage =
          typeof parsedBody.details === "string" ? parsedBody.details : null;

        if (errorMessage && detailMessage) {
          errorDetails = `${errorMessage}: ${detailMessage}`;
        } else if (errorMessage) {
          errorDetails = errorMessage;
        } else {
          errorDetails = rawResponseBody;
        }
      } catch {
        errorDetails = rawResponseBody;
      }
    }

    throw new Error(
      `Failed to send store init data transaction: ${errorDetails}`,
    );
  }

  const provider = await getWalletProvider();
  const verificationProgram = getTelegramVerificationProgram(provider);
  const sessionPda = getSessionPda(recipientPubKey, verificationProgram);
  // Claim tokens on client side
  const privateClient = await getPrivateClient({ solanaEnv: claimSolanaEnv });
  const balanceBefore =
    await privateClient.ephemeralProgram.provider.connection.getBalance(
      recipientPubKey,
    );
  await claimTokens({
    tokenMint: NATIVE_MINT,
    amount,
    username,
    destination: recipientPubKey,
    session: sessionPda,
    solanaEnv: claimSolanaEnv,
  });
  const balanceAfter =
    await privateClient.ephemeralProgram.provider.connection.getBalance(
      recipientPubKey,
    );
  console.log(
    `[claimTokens] recipient=${recipientPubKey.toBase58()} before=${balanceBefore} after=${balanceAfter} diff=${
      balanceAfter - balanceBefore
    }`,
  );

  return response.json();
};
