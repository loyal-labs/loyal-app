import { describe, expect, mock, test } from "bun:test";
import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import type { Connection, VersionedTransaction } from "@solana/web3.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  sendPreparedBatchWithWallet,
  sendPreparedWithWallet,
} from "./wallet";

const payer = new PublicKey("11111111111111111111111111111112");
const recipient = new PublicKey("11111111111111111111111111111113");
const blockhash = "11111111111111111111111111111111";

function createPreparedOperation(): PreparedLoyalSmartAccountsOperation<string> {
  return {
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer,
        lamports: 1,
        toPubkey: recipient,
      }),
    ],
    lookupTableAccounts: [],
    operation: "testOperation",
    payer,
    programId: SystemProgram.programId,
    requiresConfirmation: false,
  };
}

function createConnectionMock(logs: string[]) {
  const simulateTransaction = mock(async () => ({
    value: {
      err: { InstructionError: [0, { Custom: 1 }] },
      logs,
    },
  }));

  return {
    confirmTransaction: mock(async () => ({ value: { err: null } })),
    getLatestBlockhash: mock(async () => ({
      blockhash,
      lastValidBlockHeight: 123,
    })),
    sendRawTransaction: mock(async () => "raw-signature"),
    simulateTransaction,
  } as unknown as Connection & {
    simulateTransaction: typeof simulateTransaction;
  };
}

describe("wallet prepared sends", () => {
  test("simulates after wallet send failure and surfaces insufficient SOL top-up", async () => {
    const connection = createConnectionMock([
      "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
      "Program 11111111111111111111111111111111 invoke [2]",
      "Transfer: insufficient lamports 236920, need 2268960",
      "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
    ]);
    const walletError = new Error("WalletSendTransactionError: failed");
    const sendTransaction = mock(async () => {
      throw walletError;
    });

    await expect(
      sendPreparedWithWallet({
        connection,
        prepared: createPreparedOperation(),
        wallet: {
          publicKey: payer,
          sendTransaction,
          signTransaction: mock(
            async <T extends VersionedTransaction>(transaction: T) =>
              transaction
          ),
        },
      })
    ).rejects.toThrow("Top up at least 0.00203204 SOL");

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  test("keeps the original wallet send failure when simulation is inconclusive", async () => {
    const connection = createConnectionMock([
      "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
      "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG failed: custom program error: 0x1788",
    ]);
    const walletError = new Error("WalletSendTransactionError: failed");

    try {
      await sendPreparedWithWallet({
        connection,
        prepared: createPreparedOperation(),
        wallet: {
          publicKey: payer,
          sendTransaction: mock(async () => {
            throw walletError;
          }),
          signTransaction: mock(
            async <T extends VersionedTransaction>(transaction: T) =>
              transaction
          ),
        },
      });
      throw new Error("expected sendPreparedWithWallet to throw");
    } catch (error) {
      expect(error).toBe(walletError);
    }

    expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  test("simulates prepared batch transactions after wallet signing failure", async () => {
    const connection = createConnectionMock([
      "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
      "Program 11111111111111111111111111111111 invoke [2]",
      "Transfer: insufficient lamports 236920, need 2268960",
      "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
    ]);
    const signAllTransactions = mock(async () => {
      throw new Error("WalletSignTransactionError: failed");
    });

    await expect(
      sendPreparedBatchWithWallet({
        connection,
        prepared: [createPreparedOperation()],
        wallet: {
          publicKey: payer,
          signAllTransactions,
          signTransaction: mock(
            async <T extends VersionedTransaction>(transaction: T) =>
              transaction
          ),
        },
      })
    ).rejects.toThrow("Top up at least 0.00203204 SOL");

    expect(signAllTransactions).toHaveBeenCalledTimes(1);
    expect(connection.simulateTransaction).toHaveBeenCalledTimes(1);
  });
});
