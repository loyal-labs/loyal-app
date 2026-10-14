import { describe, expect, mock, test } from "bun:test";
import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts-core";
import type {
  Connection,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

import type { WalletAdapterLike } from "./types";
import { sendPreparedBatchWithWallet, sendPreparedWithWallet } from "./wallet";

const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const settingsPda = new PublicKey("11111111111111111111111111111112");
const fixtureSigner = Keypair.generate();
const feePayer = fixtureSigner.publicKey;
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

function createSignAllTransactionsMock() {
  return mock(async (transactions: (Transaction | VersionedTransaction)[]) => {
    for (const transaction of transactions) {
      if ("version" in transaction) transaction.sign([fixtureSigner]);
      else transaction.partialSign(fixtureSigner);
    }
    return transactions;
  }) as unknown as NonNullable<WalletAdapterLike["signAllTransactions"]>;
}

function createConnection(args: {
  confirmTransaction?: ReturnType<typeof mock>;
  getAccountInfo?: ReturnType<typeof mock>;
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
      args.confirmTransaction ??
      mock(async () => ({ context: { slot: 1 }, value: { err: null } })),
    getAccountInfo: args.getAccountInfo,
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
    const sendError = new Error("second send failed");
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
    ).rejects.toMatchObject({
      transactionWasSubmitted: true,
      cause: sendError,
    });

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

test("fresh-wallet batch rejection cannot be replaced by dependent-account simulation", async () => {
  const rejection = Object.assign(new Error("User rejected the request"), {
    code: 4001,
  });
  const connection = createConnection({
    logs: ["Program failed: missing account"],
  });
  await expect(
    sendPreparedBatchWithWallet({
      connection,
      prepared: [createPrepared(), createPrepared()],
      wallet: {
        publicKey: feePayer,
        signAllTransactions: mock(async () => {
          throw rejection;
        }),
        signTransaction: mock(
          async <T extends VersionedTransaction>(transaction: T) => transaction
        ),
      },
    })
  ).rejects.toBe(rejection);
  expect(connection.simulateTransaction).not.toHaveBeenCalled();
  expect(connection.sendRawTransaction).not.toHaveBeenCalled();
});

test("fresh-wallet dependent batch simulation diagnoses setup accounts before any submission", async () => {
  let simulations = 0;
  const connection = createConnection({
    simulateTransaction: mock(async () => ({
      context: { slot: 1 },
      value:
        ++simulations === 1
          ? { err: null, logs: [] }
          : {
              err: { InstructionError: [0, { Custom: 0x1788 }] },
              logs: [
                `Program ${programId.toBase58()} failed: custom program error: 0x1788`,
              ],
            },
    })),
  });
  const dependent = createPrepared(undefined, {
    includedPolicyAccounts: [],
    kind: "earnPolicyCreateMissingAccount",
    policyAccount: recipient.toBase58(),
    policySeed: "3",
    policyStage: "setup",
    programId: programId.toBase58(),
    settingsPda: settingsPda.toBase58(),
  });
  await expect(
    sendPreparedBatchWithWallet({
      connection,
      prepared: [createPrepared(), dependent],
      wallet: {
        publicKey: feePayer,
        signAllTransactions: mock(async () => {
          throw new Error("Wallet simulation failed");
        }),
        signTransaction: mock(
          async <T extends VersionedTransaction>(transaction: T) => transaction
        ),
      },
    })
  ).rejects.toThrow("Missing policy account");
  expect(simulations).toBe(2);
  expect(connection.sendRawTransaction).not.toHaveBeenCalled();
});

test("dependent setup signs only after confirmation and recording, using real signed wire", async () => {
  const { createPublicKey, verify } = await import("node:crypto");
  const { VersionedTransaction } = await import("@solana/web3.js");
  let confirmed = 0;
  let recorded = 0;
  let sent = 0;
  let signed = 0;
  const stages = [createPrepared(), createPrepared(), createPrepared()];
  const connection = createConnection({
    sendRawTransaction: mock(async (wire: Uint8Array) => {
      const tx = VersionedTransaction.deserialize(wire);
      const key = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          feePayer.toBuffer(),
        ]),
        format: "der",
        type: "spki",
      });
      expect(verify(null, tx.message.serialize(), key, tx.signatures[0]!)).toBe(
        true
      );
      sent += 1;
      return `signature-${sent}`;
    }),
    confirmTransaction: mock(async () => {
      confirmed += 1;
      return { context: { slot: confirmed }, value: { err: null } };
    }),
    simulateTransaction: mock(async () => ({ value: { err: null, logs: [] } })),
  });
  const wallet: WalletAdapterLike = {
    publicKey: feePayer,
    signTransaction: async (tx) => {
      if (signed !== confirmed || signed !== recorded) {
        throw new Error(
          "Wallet simulation failed: missing predecessor setup account"
        );
      }
      expect(tx).toBeInstanceOf(VersionedTransaction);
      if ("version" in tx) tx.sign([fixtureSigner]);
      else tx.partialSign(fixtureSigner);
      signed += 1;
      return tx;
    },
    signAllTransactions: async (txs) => {
      for (const tx of txs) await wallet.signTransaction(tx);
      return txs;
    },
  };
  // The old ordering asks for the dependent signature before any setup lands.
  await expect(
    sendPreparedBatchWithWallet({ connection, wallet, prepared: stages })
  ).rejects.toThrow("missing predecessor setup account");
  expect(sent).toBe(0);
  signed = 0;
  const signatures = await sendPreparedBatchWithWallet({
    connection,
    wallet,
    prepared: stages,
    sendMode: "sign-and-confirm-each",
    onTransactionConfirmed: async ({ index }) => {
      expect(confirmed).toBe(index + 1);
      await Promise.resolve();
      recorded += 1;
    },
  });
  expect(signatures).toHaveLength(3);
  expect(recorded).toBe(3);
  expect(connection.getLatestBlockhash).toHaveBeenCalledTimes(4);
});

for (const failure of ["rejected", "confirmation", "recording"] as const) {
  test(`dependent setup stops before the next signature after ${failure}`, async () => {
    let approvals = 0;
    const rejection = Object.assign(new Error("User rejected"), { code: 4001 });
    const connection = createConnection({
      confirmTransaction: mock(async () => {
        if (failure === "confirmation") throw new Error("RPC timeout");
        return { context: { slot: 1 }, value: { err: null } };
      }),
      simulateTransaction: mock(async () => ({
        value: { err: null, logs: [] },
      })),
    });
    const wallet: WalletAdapterLike = {
      publicKey: feePayer,
      signTransaction: async (tx) => {
        approvals += 1;
        if (failure === "rejected") throw rejection;
        if ("version" in tx) tx.sign([fixtureSigner]);
        else tx.partialSign(fixtureSigner);
        return tx;
      },
    };
    const result = sendPreparedBatchWithWallet({
      connection,
      wallet,
      prepared: [createPrepared(), createPrepared()],
      sendMode: "sign-and-confirm-each",
      onTransactionConfirmed: async () => {
        if (failure === "recording") throw new Error("Recording failed");
      },
    });
    if (failure === "confirmation") {
      await expect(result).rejects.toMatchObject({
        transactionWasSubmitted: true,
      });
    } else {
      await expect(result).rejects.toThrow(
        failure === "rejected" ? "User rejected" : "Recording failed"
      );
    }
    expect(approvals).toBe(1);
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(
      failure === "rejected" ? 0 : 1
    );
  });
}
