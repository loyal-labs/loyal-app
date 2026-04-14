import { shouldShowWalletTopUp } from "../wallet-screen-helpers";

describe("shouldShowWalletTopUp", () => {
  it("shows top up when the wallet has no SOL and no token balances", () => {
    expect(
      shouldShowWalletTopUp({
        totalSolLamports: 0,
        holdings: [
          {
            mint: "usdc",
            symbol: "USDC",
            name: "USD Coin",
            balance: 0,
            decimals: 6,
            priceUsd: 1,
            valueUsd: 0,
            imageUrl: null,
          },
        ],
        isLoading: false,
        networkLoading: false,
        walletError: null,
      }),
    ).toBe(true);
  });

  it("hides top up when any balance exists", () => {
    expect(
      shouldShowWalletTopUp({
        totalSolLamports: 1,
        holdings: [],
        isLoading: false,
        networkLoading: false,
        walletError: null,
      }),
    ).toBe(false);

    expect(
      shouldShowWalletTopUp({
        totalSolLamports: 0,
        holdings: [
          {
            mint: "usdc",
            symbol: "USDC",
            name: "USD Coin",
            balance: 2,
            decimals: 6,
            priceUsd: 1,
            valueUsd: 2,
            imageUrl: null,
          },
        ],
        isLoading: false,
        networkLoading: false,
        walletError: null,
      }),
    ).toBe(false);
  });

  it("hides top up while loading or when wallet errored", () => {
    expect(
      shouldShowWalletTopUp({
        totalSolLamports: 0,
        holdings: [],
        isLoading: true,
        networkLoading: false,
        walletError: null,
      }),
    ).toBe(false);

    expect(
      shouldShowWalletTopUp({
        totalSolLamports: 0,
        holdings: [],
        isLoading: false,
        networkLoading: true,
        walletError: null,
      }),
    ).toBe(false);

    expect(
      shouldShowWalletTopUp({
        totalSolLamports: 0,
        holdings: [],
        isLoading: false,
        networkLoading: false,
        walletError: "failed",
      }),
    ).toBe(false);
  });
});
