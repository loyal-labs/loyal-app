/* eslint-disable import/first */
// fetch-secured-balances transitively imports the RPC connection module,
// which pulls in react-native-mmkv — Jest (node env) can't transform that
// native module. `buildScanList` only needs the pure exports, so stub the
// connection module before the import chain resolves. ts-jest does not
// hoist jest.mock automatically, so the mock call must precede the
// imports in source order.
jest.mock("../../rpc/connection", () => ({
  getConnection: jest.fn(),
  getSolanaEnv: jest.fn(() => "mainnet"),
}));

import {
  LOYAL_TOKEN_MINT,
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDT_MINT_MAINNET,
} from "../../constants";
import { buildScanList } from "../fetch-secured-balances";
import type { TokenHolding } from "../types";

const ORIGINAL_SOLANA_ENV = process.env.EXPO_PUBLIC_SOLANA_ENV;

afterEach(() => {
  if (ORIGINAL_SOLANA_ENV === undefined) {
    delete process.env.EXPO_PUBLIC_SOLANA_ENV;
  } else {
    process.env.EXPO_PUBLIC_SOLANA_ENV = ORIGINAL_SOLANA_ENV;
  }
});

describe("buildScanList", () => {
  it("includes USDT on mainnet even when the user holds no base USDT", () => {
    // Regression for ASK-1137: a user who swapped MAX USDT to another token
    // no longer has USDT in Helius's asset list, but their shielded USDT
    // deposit PDA still exists. The scan list must include USDT so the
    // shielded balance still surfaces in the portfolio.
    process.env.EXPO_PUBLIC_SOLANA_ENV = "mainnet";

    const holdings: TokenHolding[] = [
      {
        mint: NATIVE_SOL_MINT,
        symbol: "SOL",
        name: "Solana",
        balance: 1,
        decimals: 9,
        priceUsd: 150,
        valueUsd: 150,
        imageUrl: null,
      },
    ];

    const scanned = buildScanList(holdings);
    const mints = scanned.map((holding) => holding.mint);

    expect(mints).toEqual(
      expect.arrayContaining([
        NATIVE_SOL_MINT,
        SOLANA_USDC_MINT_MAINNET,
        LOYAL_TOKEN_MINT,
        SOLANA_USDT_MINT_MAINNET,
      ]),
    );
  });

  it("omits USDT on devnet (no canonical devnet USDT mint)", () => {
    process.env.EXPO_PUBLIC_SOLANA_ENV = "devnet";

    const scanned = buildScanList([]);
    const mints = scanned.map((holding) => holding.mint);

    expect(mints).not.toContain(SOLANA_USDT_MINT_MAINNET);
  });

  it("does not duplicate a mint the user already holds", () => {
    process.env.EXPO_PUBLIC_SOLANA_ENV = "mainnet";

    const existingUsdt: TokenHolding = {
      mint: SOLANA_USDT_MINT_MAINNET,
      symbol: "USDT",
      name: "Tether USD",
      balance: 5,
      decimals: 6,
      priceUsd: 1,
      valueUsd: 5,
      imageUrl: null,
    };

    const scanned = buildScanList([existingUsdt]);
    const usdtEntries = scanned.filter(
      (holding) => holding.mint === SOLANA_USDT_MINT_MAINNET,
    );

    expect(usdtEntries).toHaveLength(1);
    expect(usdtEntries[0].balance).toBe(5);
  });
});
