/* eslint-disable import/first */
// fetch-secured-balances transitively imports the RPC connection module,
// which pulls in react-native-mmkv — Jest (node env) can't transform that
// native module. `buildScanList` only needs the pure exports, so stub the
// connection module before the import chain resolves. ts-jest does not
// hoist jest.mock automatically, so the mock call must precede the
// imports in source order.
const mockMainnetUsdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

jest.mock("../../rpc/connection", () => ({
  getConnection: jest.fn(() => ({})),
  getEndpoints: jest.fn(() => ({
    rpcEndpoint: "https://example.test",
    websocketEndpoint: "wss://example.test",
  })),
  getPerEndpoints: jest.fn(() => ({
    perRpcEndpoint: "https://per.example.test",
    perWsEndpoint: "wss://per.example.test",
  })),
  getSolanaEnv: jest.fn(() => "mainnet"),
}));

const mockEnumerateDepositsByUser = jest.fn();
const mockGetKaminoShieldedBalanceQuote = jest.fn();

jest.mock("@loyal-labs/private-transactions", () => ({
  enumerateDepositsByUser: (...args: unknown[]) =>
    mockEnumerateDepositsByUser(...args),
  LoyalPrivateTransactionsClient: {
    fromConfig: jest.fn(async () => ({
      getKaminoShieldedBalanceQuote: mockGetKaminoShieldedBalanceQuote,
    })),
  },
}));

jest.mock("../../deposits/kamino-usdc-position", () => ({
  resolveTrackedKaminoUsdcMint: jest.fn(() => mockMainnetUsdcMint),
}));

jest.mock("../resolve-token-info", () => ({
  resolveTokenIcon: jest.fn(({ imageUrl }) => imageUrl),
  resolveTokenName: jest.fn(({ mint }) => mint),
  resolveTokenSymbol: jest.fn(({ mint }) => mint),
}));

import {
  LOYAL_TOKEN_MINT,
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDT_MINT_MAINNET,
} from "../../constants";
import { buildScanList, fetchSecuredBalances } from "../fetch-secured-balances";
import type { TokenHolding } from "../types";

const ORIGINAL_SOLANA_ENV = process.env.EXPO_PUBLIC_SOLANA_ENV;

afterEach(() => {
  jest.clearAllMocks();
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

describe("fetchSecuredBalances", () => {
  it("does not display Kamino USDC collateral shares when the liquidity quote is unavailable", async () => {
    mockEnumerateDepositsByUser.mockResolvedValue([
      {
        amount: 1_006_000_000n,
        tokenMint: { toBase58: () => SOLANA_USDC_MINT_MAINNET },
      },
    ]);
    mockGetKaminoShieldedBalanceQuote.mockResolvedValue(null);

    const holdings: TokenHolding[] = [
      {
        mint: SOLANA_USDC_MINT_MAINNET,
        symbol: "USDC",
        name: "USD Coin",
        balance: 0,
        decimals: 6,
        priceUsd: 1,
        valueUsd: 0,
        imageUrl: null,
      },
    ];

    const secured = await fetchSecuredBalances(
      "3zGWNXCwtCrfyxss2egybLDA85TxjsJw3DMZQbmrBJrq",
      holdings
    );

    expect(secured).toEqual([]);
  });
});
