import { describe, expect, it } from "bun:test";
import {
  Keypair,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { estimatePlannedTransactionFees } from "../src/fee-estimate";
import { estimateDepositDelegationRentCreditLamports } from "../src/rent-estimate";

const blockhash = "11111111111111111111111111111111";
const feePayer = SystemProgram.programId;

function createMockConnection(feeLamports: number) {
  return {
    getLatestBlockhash: async () => ({
      blockhash,
      lastValidBlockHeight: 1,
    }),
    getFeeForMessage: async () => ({
      value: feeLamports,
    }),
  };
}

function createMockRentConnection(lamports: number[]) {
  return {
    getMultipleAccountsInfo: async () =>
      lamports.map((accountLamports) => ({ lamports: accountLamports })),
  };
}

const instruction = new TransactionInstruction({
  keys: [],
  programId: SystemProgram.programId,
});

describe("estimatePlannedTransactionFees", () => {
  it("includes native SOL principal movement in totalLamports", async () => {
    const estimate = await estimatePlannedTransactionFees({
      transactions: [
        {
          label: "shield",
          cluster: "base",
          connection: createMockConnection(5_000) as never,
          feePayer,
          instructions: [
            {
              label: "wrapSol:transfer",
              ix: instruction,
              nativeLamports: 1_000_000,
            },
            {
              label: "initializeDeposit",
              ix: instruction,
              rentLamports: 1_447_680,
            },
          ],
        },
      ],
    });

    expect(estimate.totalFeeLamports).toBe(5_000);
    expect(estimate.totalRentLamports).toBe(1_447_680);
    expect(estimate.totalNativeLamports).toBe(1_000_000);
    expect(estimate.transactions[0]?.totalLamports).toBe(2_452_680);
  });

  it("supports rent credits and native SOL credits", async () => {
    const estimate = await estimatePlannedTransactionFees({
      transactions: [
        {
          label: "unshield",
          cluster: "base",
          connection: createMockConnection(5_000) as never,
          feePayer,
          instructions: [
            {
              label: "modifyBalanceDecrease",
              ix: instruction,
              nativeLamports: -1_000_000,
            },
            {
              label: "closeDeposit",
              ix: instruction,
              rentLamports: -1_447_680,
            },
          ],
        },
      ],
    });

    expect(estimate.totalFeeLamports).toBe(5_000);
    expect(estimate.totalRentLamports).toBe(-1_447_680);
    expect(estimate.totalNativeLamports).toBe(-1_000_000);
    expect(estimate.transactions[0]?.totalLamports).toBe(-2_442_680);
  });
});

describe("estimateDepositDelegationRentCreditLamports", () => {
  it("subtracts the MagicBlock undelegate session fee from delegation rent credits", async () => {
    const rentCredit = await estimateDepositDelegationRentCreditLamports({
      connection: createMockRentConnection([1_858_320, 1_559_040]) as never,
      depositPda: Keypair.generate().publicKey,
    });

    expect(rentCredit).toBe(-3_117_360);
  });

  it("does not report a negative credit when only the retained fee is present", async () => {
    const rentCredit = await estimateDepositDelegationRentCreditLamports({
      connection: createMockRentConnection([300_000, 0]) as never,
      depositPda: Keypair.generate().publicKey,
    });

    expect(rentCredit).toBe(0);
  });
});
