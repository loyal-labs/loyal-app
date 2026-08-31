import { describe, expect, mock, test } from "bun:test";
import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts-core";
import type { Connection, Transaction } from "@solana/web3.js";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";

import type { WalletAdapterLike } from "./types";
import { sendPreparedBatchWithWallet, sendPreparedWithWallet } from "./wallet";

const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const settingsPda = new PublicKey("11111111111111111111111111111112");
const feePayerSigner = Keypair.fromSeed(new Uint8Array(32).fill(7));
const feePayer = feePayerSigner.publicKey;
const recipient = new PublicKey("11111111111111111111111111111114");
const recentBlockhash = "11111111111111111111111111111111";

function createPrepared(
  instructions = [
    SystemProgram.transfer({
      fromPubkey: feePayer,
      lamports: 1,
      toPubkey: recipient,
    }),
  ],
  simulationDiagnostics?: PreparedLoyalSmartAccountsOperation<string>["simulationDiagnostics"]
): PreparedLoyalSmartAccountsOperation<string> {
  return {
    instructions,
    lookupTableAccounts: [],
    operation: "testOperation",
    payer: feePayer,
    programId,
    requiresConfirmation: true,
    ...(simulationDiagnostics ? { simulationDiagnostics } : {}),
  };
}

function createRejectingWallet(error = new Error("wallet rejected")) {
  return {
    publicKey: feePayer,
    signTransaction: mock(async () => {
      throw error;
    }),
  } as unknown as WalletAdapterLike;
}

function signTestTransaction<T extends Transaction | VersionedTransaction>(
  transaction: T
): T {
  if (transaction instanceof VersionedTransaction) {
    transaction.sign([feePayerSigner]);
  } else {
    transaction.partialSign(feePayerSigner);
  }
  return transaction;
}

function createSignAllTransactionsMock() {
  return mock(async (transactions: (Transaction | VersionedTransaction)[]) =>
    transactions.map(signTestTransaction)
  ) as unknown as NonNullable<WalletAdapterLike["signAllTransactions"]>;
}

function createConnection(args: {
  confirmTransaction?: ReturnType<typeof mock>;
  getAccountInfo?: ReturnType<typeof mock>;
  getSignatureStatuses?: ReturnType<typeof mock>;
  logs?: string[];
  sendRawTransaction?: ReturnType<typeof mock>;
  simulateTransaction?: ReturnType<typeof mock>;
}) {
  const simulateTransaction =
    args.simulateTransaction ??
    mock(async () => ({
      context: { slot: 1 },
      value: {
        err: { InstructionError: [0, { Custom: 1 }] },
        logs: args.logs ?? [],
      },
    }));

  return {
    confirmTransaction:
      args.confirmTransaction ?? mock(async () => ({ value: { err: null } })),
    getAccountInfo: args.getAccountInfo,
    getSignatureStatuses: args.getSignatureStatuses,
    getLatestBlockhash: mock(async () => ({
      blockhash: recentBlockhash,
      lastValidBlockHeight: 123,
    })),
    sendRawTransaction:
      args.sendRawTransaction ?? mock(async () => "raw-signature"),
    simulateTransaction,
  } as unknown as Connection & {
    simulateTransaction: typeof simulateTransaction;
  };
}

describe("wallet prepared sends", () => {
  test("simulates once when an accepted signature never appears on chain", async () => {
    const sendTransaction = mock(async () => "missing-signature");
    const connection = createConnection({
      confirmTransaction: mock(async () => {
        throw new Error("block height exceeded");
      }),
      getSignatureStatuses: mock(async () => ({ value: [null] })),
      logs: [
        "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
        "Program 11111111111111111111111111111111 invoke [2]",
        "Transfer: insufficient lamports 236920, need 2268960",
        "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
      ],
    });

    await expect(
      sendPreparedWithWallet({
        connection,
        prepared: createPrepared(),
        wallet: {
          publicKey: feePayer,
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

  test("rebroadcasts identical signed bytes after a transient send failure", async () => {
    const sentPayloads: number[][] = [];
    const sendRawTransaction = mock(async (payload: Uint8Array) => {
      sentPayloads.push(Array.from(payload));
      if (sentPayloads.length === 1) {
        throw new TypeError("Failed to fetch");
      }
      return "raw-signature";
    });
    const getSignatureStatuses = mock(async () => ({ value: [null] }));
    const connection = createConnection({
      getSignatureStatuses,
      sendRawTransaction,
    });

    const signature = await sendPreparedWithWallet({
      connection,
      confirm: false,
      prepared: createPrepared(),
      wallet: {
        publicKey: feePayer,
        signTransaction: mock(
          async <T extends VersionedTransaction>(transaction: T) =>
            signTestTransaction(transaction)
        ),
      },
    });

    expect(signature).toBe("raw-signature");
    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(getSignatureStatuses).toHaveBeenCalledTimes(1);
    expect(sentPayloads[1]).toEqual(sentPayloads[0]);
  });

  test("does not rebroadcast when the first send is already visible", async () => {
    const sendRawTransaction = mock(async () => {
      throw new TypeError("Failed to fetch");
    });
    const getSignatureStatuses = mock(async () => ({
      value: [
        {
          confirmationStatus: "processed",
          confirmations: 1,
          err: null,
          slot: 321,
        },
      ],
    }));
    const connection = createConnection({
      getSignatureStatuses,
      sendRawTransaction,
    });

    const signature = await sendPreparedWithWallet({
      connection,
      confirm: false,
      prepared: createPrepared(),
      wallet: {
        publicKey: feePayer,
        signTransaction: mock(
          async <T extends VersionedTransaction>(transaction: T) =>
            signTestTransaction(transaction)
        ),
      },
    });

    expect(signature.length).toBeGreaterThan(0);
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(getSignatureStatuses).toHaveBeenCalledTimes(1);
  });

  test("polls a temporarily absent signature before declaring confirmation unresolved", async () => {
    const getSignatureStatuses = mock()
      .mockResolvedValueOnce({ value: [null] })
      .mockResolvedValueOnce({
        value: [
          {
            confirmationStatus: "finalized",
            confirmations: null,
            err: null,
            slot: 321,
          },
        ],
      });
    const connection = createConnection({
      confirmTransaction: mock(async () => {
        throw new Error("confirmation transport failed");
      }),
      getSignatureStatuses,
    });

    const signature = await sendPreparedWithWallet({
      connection,
      confirm: true,
      prepared: createPrepared(),
      wallet: {
        publicKey: feePayer,
        sendTransaction: mock(async () => "delayed-signature"),
        signTransaction: mock(
          async <T extends VersionedTransaction>(transaction: T) => transaction
        ),
      },
    });

    expect(signature).toBe("delayed-signature");
    expect(getSignatureStatuses).toHaveBeenCalledTimes(2);
  });

  test("simulates after wallet send failure and surfaces insufficient SOL top-up", async () => {
    const connection = createConnection({
      logs: [
        "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
        "Program 11111111111111111111111111111111 invoke [2]",
        "Transfer: insufficient lamports 236920, need 2268960",
        "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
      ],
    });
    const walletError = new Error("WalletSendTransactionError: failed");
    const sendTransaction = mock(async () => {
      throw walletError;
    });

    await expect(
      sendPreparedWithWallet({
        connection,
        prepared: createPrepared(),
        wallet: {
          publicKey: feePayer,
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
    const connection = createConnection({
      logs: [
        "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
        "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG failed: custom program error: 0x1788",
      ],
    });
    const walletError = new Error("WalletSendTransactionError: failed");

    try {
      await sendPreparedWithWallet({
        connection,
        prepared: createPrepared(),
        wallet: {
          publicKey: feePayer,
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

  test("keeps the wallet rejection when the diagnostic simulation succeeds", async () => {
    // A user denial leaves a perfectly valid transaction behind, so the
    // post-failure diagnostic simulation succeeds with clean logs. That must
    // never be reported as "Transaction simulation failed." in place of the
    // wallet's own rejection error.
    const connection = createConnection({
      simulateTransaction: mock(async () => ({
        context: { slot: 1 },
        value: {
          err: null,
          logs: [
            "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
            "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG success",
          ],
        },
      })),
    });
    const walletError = new Error("User rejected the request.");

    try {
      await sendPreparedWithWallet({
        connection,
        prepared: createPrepared(),
        wallet: {
          publicKey: feePayer,
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
    const connection = createConnection({
      logs: [
        "Program SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG invoke [1]",
        "Program 11111111111111111111111111111111 invoke [2]",
        "Transfer: insufficient lamports 236920, need 2268960",
        "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
      ],
    });
    const signAllTransactions = mock(async () => {
      throw new Error("WalletSignTransactionError: failed");
    });

    await expect(
      sendPreparedBatchWithWallet({
        connection,
        prepared: [createPrepared()],
        wallet: {
          publicKey: feePayer,
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

  test("can submit a prepared batch before waiting for confirmations", async () => {
    const events: string[] = [];
    let sendCount = 0;
    const sendRawTransaction = mock(async () => {
      sendCount += 1;
      const signature = `signature-${sendCount}`;
      events.push(`send:${signature}`);
      return signature;
    });
    const confirmTransaction = mock(async (strategy: { signature: string }) => {
      events.push(`confirm:${strategy.signature}`);
      return { context: { slot: 1 }, value: { err: null } };
    });
    const connection = createConnection({
      confirmTransaction,
      sendRawTransaction,
    });

    const signatures = await sendPreparedBatchWithWallet({
      connection,
      confirm: true,
      onTransactionConfirmed: ({ signature }) => {
        events.push(`callback:${signature}`);
      },
      prepared: [createPrepared(), createPrepared()],
      sendMode: "send-all-before-confirm",
      wallet: {
        publicKey: feePayer,
        signAllTransactions: createSignAllTransactionsMock(),
        signTransaction: mock(
          async <T extends VersionedTransaction>(transaction: T) => transaction
        ),
      },
    });

    expect(signatures).toEqual(["signature-1", "signature-2"]);
    expect(events.slice(0, 2)).toEqual([
      "send:signature-1",
      "send:signature-2",
    ]);
    expect(events.indexOf("confirm:signature-1")).toBeGreaterThan(1);
    expect(events.indexOf("confirm:signature-2")).toBeGreaterThan(1);
    expect(events).toContain("callback:signature-1");
    expect(events).toContain("callback:signature-2");
  });

  test("confirms already-sent batch transactions when a later send fails", async () => {
    const events: string[] = [];
    const sendError = new Error(
      "Transaction simulation failed: second send failed"
    );
    let sendCount = 0;
    const sendRawTransaction = mock(async () => {
      sendCount += 1;
      if (sendCount === 2) {
        events.push("send-failed:2");
        throw sendError;
      }
      events.push("send:signature-1");
      return "signature-1";
    });
    const confirmTransaction = mock(async (strategy: { signature: string }) => {
      events.push(`confirm:${strategy.signature}`);
      return { context: { slot: 1 }, value: { err: null } };
    });
    const connection = createConnection({
      confirmTransaction,
      sendRawTransaction,
      simulateTransaction: mock(async () => ({
        context: { slot: 1 },
        value: { err: null, logs: [] },
      })),
    });

    await expect(
      sendPreparedBatchWithWallet({
        connection,
        confirm: true,
        prepared: [createPrepared(), createPrepared()],
        sendMode: "send-all-before-confirm",
        wallet: {
          publicKey: feePayer,
          signAllTransactions: createSignAllTransactionsMock(),
          signTransaction: mock(
            async <T extends VersionedTransaction>(transaction: T) =>
              transaction
          ),
        },
      })
    ).rejects.toThrow("second send failed");

    expect(events).toEqual([
      "send:signature-1",
      "send-failed:2",
      "confirm:signature-1",
    ]);
  });

  test("simulates the same prepared transaction after wallet signing fails", async () => {
    const simulateTransaction = mock(async () => ({
      context: { slot: 1 },
      value: { err: null, logs: [] },
    }));
    const connection = createConnection({ simulateTransaction });

    await expect(
      sendPreparedWithWallet({
        connection,
        wallet: createRejectingWallet(),
        prepared: createPrepared(),
      })
    ).rejects.toThrow("wallet rejected");

    expect(simulateTransaction).toHaveBeenCalledTimes(1);
  });

  test("surfaces exact SOL top-up amount from simulation logs", async () => {
    const connection = createConnection({
      logs: ["Transfer: insufficient lamports 100, need 250"],
    });

    await expect(
      sendPreparedWithWallet({
        connection,
        wallet: createRejectingWallet(),
        prepared: createPrepared(),
      })
    ).rejects.toThrow("Top up at least 0.00000015 SOL");
  });

  test("uses prepared diagnostics for Squads MissingAccount", async () => {
    const missingPolicyAccount = recipient.toBase58();
    const simulateTransaction = mock(async () => ({
      context: { slot: 1 },
      value: {
        err: { InstructionError: [0, { Custom: 0x1788 }] },
        logs: [
          `Program ${programId.toBase58()} failed: custom program error: 0x1788`,
        ],
      },
    }));
    const connection = createConnection({
      simulateTransaction,
    });

    await expect(
      sendPreparedWithWallet({
        connection,
        wallet: createRejectingWallet(),
        prepared: createPrepared(undefined, {
          includedPolicyAccounts: [],
          kind: "earnPolicyCreateMissingAccount",
          policyAccount: missingPolicyAccount,
          policySeed: "3",
          policyStage: "setup",
          programId: programId.toBase58(),
          settingsPda: settingsPda.toBase58(),
        }),
      })
    ).rejects.toThrow(
      `Missing policy account ${missingPolicyAccount} for prepared setup policy seed 3`
    );
  });
});
