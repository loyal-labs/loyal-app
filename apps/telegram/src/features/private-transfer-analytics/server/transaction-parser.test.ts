import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const baseTransaction = {
  blockTime: 1773044821,
  meta: { err: null },
  slot: 405216472,
  transaction: {
    message: {
      instructions: [
        {
          accounts: [
            "payer",
            "user-1",
            "vault-1",
            "deposit-1",
            "user-token-ata",
            "vault-token-ata",
            "mint-1",
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
            "11111111111111111111111111111111",
          ],
          data: "2QADzM3syh9qn9DYFag3Uq6g",
          programId: {
            toBase58: () => "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV",
          },
        },
        {
          accounts: [
            "payer",
            "user-2",
            "vault-2",
            "deposit-2",
            "user-token-ata-2",
            "vault-token-ata-2",
            "mint-2",
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
            "11111111111111111111111111111111",
          ],
          data: "2QADzM3syh9qn9DYFag3Uq6f",
          programId: {
            toBase58: () => "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV",
          },
        },
      ],
    },
  },
} as unknown as ParsedTransactionWithMeta;

let parseModifyBalanceEventsFromTransaction: typeof import("./transaction-parser").parseModifyBalanceEventsFromTransaction;

describe("parseModifyBalanceEventsFromTransaction", () => {
  beforeAll(async () => {
    ({ parseModifyBalanceEventsFromTransaction } = await import(
      "./transaction-parser"
    ));
  });

  test("parses shield and unshield modify_balance instructions", () => {
    const result = parseModifyBalanceEventsFromTransaction(
      baseTransaction,
      "signature-1"
    );

    expect(result.skippedMissingBlockTime).toBe(0);
    expect(result.events).toEqual([
      {
        amountRaw: "1000000",
        flow: "shield",
        instructionIndex: 0,
        occurredAt: new Date("2026-03-09T08:27:01.000Z"),
        signature: "signature-1",
        slot: BigInt(405216472),
        tokenMint: "mint-1",
        userAddress: "user-1",
        vaultAddress: "vault-1",
      },
      {
        amountRaw: "1000000",
        flow: "unshield",
        instructionIndex: 1,
        occurredAt: new Date("2026-03-09T08:27:01.000Z"),
        signature: "signature-1",
        slot: BigInt(405216472),
        tokenMint: "mint-2",
        userAddress: "user-2",
        vaultAddress: "vault-2",
      },
    ]);
  });

  test("skips failed transactions", () => {
    const result = parseModifyBalanceEventsFromTransaction(
      {
        ...baseTransaction,
        meta: { err: { InstructionError: [0, "Custom"] } },
      } as ParsedTransactionWithMeta,
      "signature-2"
    );

    expect(result).toEqual({ events: [], skippedMissingBlockTime: 0 });
  });

  test("skips transactions without blockTime", () => {
    const result = parseModifyBalanceEventsFromTransaction(
      {
        ...baseTransaction,
        blockTime: null,
      } as ParsedTransactionWithMeta,
      "signature-3"
    );

    expect(result).toEqual({ events: [], skippedMissingBlockTime: 1 });
  });
});
