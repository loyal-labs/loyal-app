import type { ParsedTransactionWithMeta } from "@solana/web3.js";

import { NATIVE_SOL_MINT } from "../constants";
import { USDC_MINT, WALLET_ADDRESS } from "./asset-fixtures";

const COUNTERPARTY = "7vfCXTUXx5pPAtF5NCz7L3A5kZZgwyUrKvYzUKGwEuUq";
const SOURCE_TOKEN_ACCOUNT = "9xQeWvG816bUx9EPjHmaT23yvVMgF87mWyQExf1w7L5G";
const DESTINATION_TOKEN_ACCOUNT = "3Kwv3pEAuoe4WevPB8V1qX9q7m2RXf5sP4R2B8vfG8fX";

function baseParsedTransaction(): ParsedTransactionWithMeta {
  return {
    blockTime: 1_700_000_000,
    slot: 123,
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [2_000_000_000, 1_000_000_000],
      postBalances: [1_500_000_000, 1_500_000_000],
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: WALLET_ADDRESS, signer: true, writable: true },
          { pubkey: COUNTERPARTY, signer: false, writable: true },
        ],
        instructions: [
          {
            program: "system",
            parsed: {
              type: "transfer",
              info: {
                source: WALLET_ADDRESS,
                destination: COUNTERPARTY,
              },
            },
          },
        ],
      },
    },
  } as unknown as ParsedTransactionWithMeta;
}

export function solTransferFixture(): ParsedTransactionWithMeta {
  return baseParsedTransaction();
}

export function tokenTransferFixture(): ParsedTransactionWithMeta {
  const tx = baseParsedTransaction();
  tx.meta!.preBalances = [1_000_000_000, 1_000_000_000];
  tx.meta!.postBalances = [999_995_000, 1_000_000_000];
  tx.meta!.preTokenBalances = [
    {
      accountIndex: 2,
      mint: USDC_MINT,
      owner: WALLET_ADDRESS,
      uiTokenAmount: {
        amount: "5000000",
        decimals: 6,
      },
    },
    {
      accountIndex: 3,
      mint: USDC_MINT,
      owner: COUNTERPARTY,
      uiTokenAmount: {
        amount: "1000000",
        decimals: 6,
      },
    },
  ] as never;
  tx.meta!.postTokenBalances = [
    {
      accountIndex: 2,
      mint: USDC_MINT,
      owner: WALLET_ADDRESS,
      uiTokenAmount: {
        amount: "3000000",
        decimals: 6,
      },
    },
    {
      accountIndex: 3,
      mint: USDC_MINT,
      owner: COUNTERPARTY,
      uiTokenAmount: {
        amount: "3000000",
        decimals: 6,
      },
    },
  ] as never;
  (tx.transaction.message as { accountKeys: unknown[] }).accountKeys = [
    { pubkey: WALLET_ADDRESS, signer: true, writable: true },
    { pubkey: COUNTERPARTY, signer: false, writable: true },
    { pubkey: SOURCE_TOKEN_ACCOUNT, signer: false, writable: true },
    { pubkey: DESTINATION_TOKEN_ACCOUNT, signer: false, writable: true },
  ];
  tx.transaction.message.instructions = [
    {
      program: "spl-token",
      parsed: {
        type: "transferChecked",
        info: {
          source: SOURCE_TOKEN_ACCOUNT,
          destination: DESTINATION_TOKEN_ACCOUNT,
        },
      },
    },
  ] as never;
  return tx;
}

export function swapFixture(): ParsedTransactionWithMeta {
  const tx = tokenTransferFixture();
  tx.meta!.preBalances = [2_000_000_000, 1_000_000_000, 0, 0, 0];
  tx.meta!.postBalances = [1_000_000_000, 1_000_000_000, 0, 0, 0];
  tx.meta!.preTokenBalances = [
    {
      accountIndex: 2,
      mint: USDC_MINT,
      owner: WALLET_ADDRESS,
      uiTokenAmount: { amount: "5000000", decimals: 6 },
    },
    {
      accountIndex: 3,
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6nBoP4R2B8vfG8fX",
      owner: WALLET_ADDRESS,
      uiTokenAmount: { amount: "1000", decimals: 5 },
    },
  ] as never;
  tx.meta!.postTokenBalances = [
    {
      accountIndex: 2,
      mint: USDC_MINT,
      owner: WALLET_ADDRESS,
      uiTokenAmount: { amount: "3000000", decimals: 6 },
    },
    {
      accountIndex: 3,
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6nBoP4R2B8vfG8fX",
      owner: WALLET_ADDRESS,
      uiTokenAmount: { amount: "2000000", decimals: 5 },
    },
  ] as never;
  (tx.transaction.message as { instructions: unknown[] }).instructions = [
    {
      programId: {
        toBase58: () => "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      },
      data: "1111111111111111111111111",
    },
  ];
  return tx;
}

function modifyBalanceData(increase: boolean): string {
  const bytes = new Uint8Array(17);
  bytes.set([0x94, 0xe8, 0x07, 0xf0, 0x37, 0x33, 0x79, 0x73], 0);
  bytes[16] = increase ? 1 : 0;
  return encodeBase58(bytes);
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  let x = BigInt(0);
  for (const byte of bytes) {
    x = (x << BigInt(8)) + BigInt(byte);
  }

  let encoded = "";
  while (x > 0) {
    const remainder = Number(x % BigInt(58));
    encoded = alphabet[remainder] + encoded;
    x /= BigInt(58);
  }

  return encoded || "1";
}

function programActionData(discriminator: number[]): string {
  const bytes = new Uint8Array(8);
  bytes.set(discriminator, 0);
  return encodeBase58(bytes);
}

export function secureFixture(increase: boolean): ParsedTransactionWithMeta {
  const tx = tokenTransferFixture();
  (tx.transaction.message as { instructions: unknown[] }).instructions = [
    {
      programId: {
        toBase58: () => "97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV",
      },
      data: modifyBalanceData(increase),
    },
  ];
  return tx;
}

export function programActionFixture(): ParsedTransactionWithMeta {
  const tx = baseParsedTransaction();
  (tx.transaction.message as { instructions: unknown[] }).instructions = [
    {
      programId: {
        toBase58: () => "9yiphKYd4b69tR1ZPP8rNwtMeUwWgjYXaXdEzyNziNhz",
      },
      data: programActionData([0xdc, 0x1c, 0xcf, 0xeb, 0x00, 0xea, 0xc1, 0xf6]),
    },
  ];
  tx.meta!.preBalances = [1_000_000_000, 1_000_000_000];
  tx.meta!.postBalances = [999_995_000, 1_000_000_000];
  return tx;
}

export function nativeSwapFixture(): ParsedTransactionWithMeta {
  const tx = baseParsedTransaction();
  tx.meta!.preBalances = [2_000_000_000, 1_000_000_000];
  tx.meta!.postBalances = [1_000_000_000, 1_000_000_000];
  tx.meta!.preTokenBalances = [] as never;
  tx.meta!.postTokenBalances = [
    {
      accountIndex: 2,
      mint: USDC_MINT,
      owner: WALLET_ADDRESS,
      uiTokenAmount: { amount: "1000000", decimals: 6 },
    },
  ] as never;
  (tx.transaction.message as { accountKeys: unknown[] }).accountKeys = [
    { pubkey: WALLET_ADDRESS, signer: true, writable: true },
    { pubkey: COUNTERPARTY, signer: false, writable: true },
    { pubkey: DESTINATION_TOKEN_ACCOUNT, signer: false, writable: true },
  ];
  (tx.transaction.message as { instructions: unknown[] }).instructions = [
    {
      programId: {
        toBase58: () => "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      },
      data: "1111111111111111111111111",
    },
  ];
  return tx;
}

export {
  COUNTERPARTY,
  DESTINATION_TOKEN_ACCOUNT,
  NATIVE_SOL_MINT,
  USDC_MINT,
  WALLET_ADDRESS,
};
