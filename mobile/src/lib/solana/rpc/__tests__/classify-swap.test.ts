/* eslint-disable import/first */
// get-account-txn-history pulls in ../connection, which transitively
// imports react-native-mmkv — Jest (node env) can't transform that
// native module. `classifySwap` is pure, so stub the connection module
// to satisfy the import graph.
jest.mock("../connection", () => ({
  getConnection: jest.fn(),
  getWebsocketConnection: jest.fn(),
  getSolanaEnv: jest.fn(() => "mainnet"),
}));

import { NATIVE_SOL_MINT } from "../../constants";
import { classifySwap, type TokenChange } from "../get-account-txn-history";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const makeChange = (overrides: Partial<TokenChange>): TokenChange => ({
  mint: "mint-x",
  decimals: 6,
  rawDelta: BigInt(0),
  direction: "in",
  absRaw: BigInt(0),
  ...overrides,
});

describe("classifySwap", () => {
  it("MAX USDC → SOL still picks USDC when Jupiter unwraps pre-existing WSOL dust", () => {
    // Regression for ASK-1136: with Jupiter's wrapAndUnwrapSol the user's
    // pre-existing WSOL ATA gets closed during the swap, producing a WSOL
    // out-delta. Without filtering WSOL, the classifier picked WSOL as
    // tokenOut and rendered "Swap SOL → SOL" instead of "Swap USDC → SOL".
    const result = classifySwap({
      currentType: "transfer",
      allTokenChanges: [
        makeChange({
          mint: NATIVE_SOL_MINT, // WSOL shares the native SOL mint
          direction: "out",
          absRaw: BigInt(1_000), // dust
        }),
        makeChange({
          mint: USDC_MINT,
          direction: "out",
          absRaw: BigInt(4_000_000), // 4 USDC
        }),
      ],
      netChangeLamports: 500_000_000, // ~0.5 SOL received
      isSigner: true,
      isJupiterSwap: true,
    });

    expect(result.type).toBe("swap");
    expect(result.swapFields.swapFromMint).toBe(USDC_MINT);
    expect(result.swapFields.swapToMint).toBe(NATIVE_SOL_MINT);
    expect(result.swapFields.swapFromAmount).toBe("4");
  });

  it("SOL → USDC ignores an incidental WSOL token delta", () => {
    const result = classifySwap({
      currentType: "transfer",
      allTokenChanges: [
        makeChange({
          mint: NATIVE_SOL_MINT,
          direction: "in",
          absRaw: BigInt(2_000),
        }),
        makeChange({
          mint: USDC_MINT,
          direction: "in",
          absRaw: BigInt(10_000_000),
        }),
      ],
      netChangeLamports: -500_000_000,
      isSigner: true,
      isJupiterSwap: true,
    });

    expect(result.type).toBe("swap");
    expect(result.swapFields.swapFromMint).toBe(NATIVE_SOL_MINT);
    expect(result.swapFields.swapToMint).toBe(USDC_MINT);
  });

  it("classifies plain token-to-token swap unchanged", () => {
    const result = classifySwap({
      currentType: "transfer",
      allTokenChanges: [
        makeChange({
          mint: USDC_MINT,
          direction: "out",
          absRaw: BigInt(4_000_000),
        }),
        makeChange({
          mint: USDT_MINT,
          direction: "in",
          absRaw: BigInt(3_990_000),
        }),
      ],
      netChangeLamports: -5_000,
      isSigner: true,
      isJupiterSwap: true,
    });

    expect(result.type).toBe("swap");
    expect(result.swapFields.swapFromMint).toBe(USDC_MINT);
    expect(result.swapFields.swapToMint).toBe(USDT_MINT);
  });

  it("does not mislabel as swap when only WSOL moves (no real token side)", () => {
    // A SOL-only transaction with incidental WSOL dust shouldn't be
    // classified as a swap at all — after filtering WSOL, there are no
    // token sides left to classify.
    const result = classifySwap({
      currentType: "transfer",
      allTokenChanges: [
        makeChange({
          mint: NATIVE_SOL_MINT,
          direction: "out",
          absRaw: BigInt(500),
        }),
      ],
      netChangeLamports: -100_000_000,
      isSigner: true,
      isJupiterSwap: false,
    });

    expect(result.type).toBe("transfer");
    expect(result.swapFields).toEqual({});
  });
});
