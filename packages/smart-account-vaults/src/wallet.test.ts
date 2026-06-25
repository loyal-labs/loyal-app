import { describe, expect, mock, test } from "bun:test";
import {
  generated,
  pda,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts-core";
import type { Connection, VersionedTransaction } from "@solana/web3.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

import type { WalletAdapterLike } from "./types";
import { sendPreparedBatchWithWallet, sendPreparedWithWallet } from "./wallet";

const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const settingsPda = new PublicKey("11111111111111111111111111111112");
const feePayer = new PublicKey("11111111111111111111111111111113");
const recipient = new PublicKey("11111111111111111111111111111114");
const recentBlockhash = "11111111111111111111111111111111";

function createPrepared(
  instructions = [
    SystemProgram.transfer({
      fromPubkey: feePayer,
      lamports: 1,
      toPubkey: recipient,
    }),
  ]
): PreparedLoyalSmartAccountsOperation<string> {
  return {
    instructions,
    lookupTableAccounts: [],
    operation: "testOperation",
    payer: feePayer,
    programId,
    requiresConfirmation: true,
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

function createSettingsAccount(policySeed: BN | null) {
  const [data] = generated.Settings.fromArgs({
    accountUtilization: 0,
    archivalAuthority: null,
    archivableAfter: new BN(0),
    bump: 255,
    policySeed,
    reserved2: 0,
    seed: new BN(0),
    settingsAuthority: feePayer,
    signers: [],
    staleTransactionIndex: new BN(0),
    threshold: 1,
    timeLock: 0,
    transactionIndex: new BN(0),
  }).serialize();

  return {
    data,
    executable: false,
    lamports: 1,
    owner: programId,
    rentEpoch: 0,
  };
}

function createConnection(args: {
  getAccountInfo?: ReturnType<typeof mock>;
  logs?: string[];
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
    confirmTransaction: mock(async () => ({ value: { err: null } })),
    getAccountInfo: args.getAccountInfo,
    getLatestBlockhash: mock(async () => ({
      blockhash: recentBlockhash,
      lastValidBlockHeight: 123,
    })),
    sendRawTransaction: mock(async () => "raw-signature"),
    simulateTransaction,
  } as unknown as Connection & {
    simulateTransaction: typeof simulateTransaction;
  };
}

function createProgramInteractionPolicyPayload(
  instructionConstraintCount: number
): generated.PolicyCreationPayload {
  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: 1,
        instructionsConstraints: Array.from(
          { length: instructionConstraintCount },
          () => ({
            accountConstraints: [],
            dataConstraints: [],
            programId: SystemProgram.programId,
          })
        ),
        postHook: null,
        preHook: null,
        spendingLimits: [],
      },
    ],
  };
}

function createPolicyCreateInstruction(args: {
  actionSeed: number;
  includedPolicySeed: number;
  instructionConstraintCount?: number;
}) {
  const includedPolicyPda = pda.getPolicyPda({
    policySeed: args.includedPolicySeed,
    programId,
    settingsPda,
  })[0];
  const instruction = generated.createExecuteSettingsTransactionSyncInstruction(
    {
      consensusAccount: settingsPda,
      program: programId,
      rentPayer: feePayer,
      systemProgram: SystemProgram.programId,
    },
    {
      args: {
        actions: [
          {
            __kind: "PolicyCreate",
            expirationArgs: null,
            policyCreationPayload: createProgramInteractionPolicyPayload(
              args.instructionConstraintCount ?? 1
            ),
            seed: new BN(args.actionSeed),
            signers: [],
            startTimestamp: null,
            threshold: 1,
            timeLock: 0,
          },
        ],
        memo: null,
        numSigners: 1,
      },
    },
    programId
  );
  instruction.keys.push(
    { isSigner: true, isWritable: false, pubkey: feePayer },
    { isSigner: false, isWritable: true, pubkey: includedPolicyPda }
  );
  return instruction;
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

  test("identifies the missing policy PDA for Squads MissingAccount", async () => {
    const expectedPolicyPda = pda.getPolicyPda({
      policySeed: 2,
      programId,
      settingsPda,
    })[0];
    const includedPolicyPda = pda.getPolicyPda({
      policySeed: 3,
      programId,
      settingsPda,
    })[0];
    const simulateTransaction = mock(async () => ({
      context: { slot: 1 },
      value: {
        err: { InstructionError: [0, { Custom: 0x1788 }] },
        logs: [
          `Program ${programId.toBase58()} failed: custom program error: 0x1788`,
        ],
      },
    }));
    const getAccountInfo = mock(async () => createSettingsAccount(new BN(1)));
    const connection = createConnection({
      getAccountInfo,
      simulateTransaction,
    });

    let thrown: unknown;
    try {
      await sendPreparedWithWallet({
        connection,
        wallet: createRejectingWallet(),
        prepared: createPrepared([
          createPolicyCreateInstruction({
            actionSeed: 3,
            includedPolicySeed: 3,
          }),
        ]),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(
      `Missing policy account ${expectedPolicyPda.toBase58()} for expected next policy seed 2`
    );
    expect((thrown as Error).message).toContain(
      `includes policy account(s): ${includedPolicyPda.toBase58()}`
    );
    expect(getAccountInfo).toHaveBeenCalledWith(settingsPda, "confirmed");
  });
});
