import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import type { MobileTokenDetailResponse } from "@/services/api";
import type { Transaction } from "@/types/wallet";

import { buildTokenDetailViewModel } from "../view-model";

const marketDetail: MobileTokenDetailResponse = {
  mint: "mint-sol",
  token: {
    decimals: 9,
    logoUrl: "https://market.example/sol.png",
    name: "Market Solana",
    symbol: "mSOL",
  },
  links: {
    website: "https://example.com",
    twitter: "https://x.com/example",
    explorer: "https://solscan.io/token/mint-sol",
  },
  market: {
    fdvUsd: 1000,
    holderCount: 42,
    liquidityUsd: 250,
    marketCapUsd: 750,
    priceChange24hPercent: 12.5,
    priceUsd: 1.5,
    updatedAt: "2026-04-13T00:00:00Z",
    volume24hUsd: 100,
  },
  chart: [
    {
      timestamp: 1,
      priceUsd: 1.25,
    },
  ],
};

describe("buildTokenDetailViewModel", () => {
  it("keeps local token identity and filters activity for a held token", () => {
    const holdings: TokenHolding[] = [
      {
        mint: "mint-sol",
        symbol: "SOL",
        name: "Solana",
        balance: 1.25,
        decimals: 9,
        priceUsd: 150,
        valueUsd: 187.5,
        imageUrl: "https://example.com/sol.png",
        isSecured: false,
      },
    ];
    const transactions: Transaction[] = [
      {
        id: "match",
        type: "incoming",
        amountLamports: 0,
        tokenMint: "mint-sol",
        timestamp: 1,
      },
      {
        id: "other",
        type: "incoming",
        amountLamports: 0,
        tokenMint: "mint-other",
        timestamp: 2,
      },
    ];

    const viewModel = buildTokenDetailViewModel({
      mint: "mint-sol",
      holdings,
      transactions,
      market: marketDetail,
    });

    expect(viewModel.token).toEqual({
      name: "Solana",
      symbol: "SOL",
      icon: "https://example.com/sol.png",
      decimals: 9,
    });
    expect(viewModel.activity.map((transaction) => transaction.id)).toEqual([
      "match",
    ]);
    expect(viewModel.canSend).toBe(true);
    expect(viewModel.canShield).toBe(true);
    expect(viewModel.canUnshield).toBe(false);
  });

  it("falls back to market identity for an unheld token", () => {
    const viewModel = buildTokenDetailViewModel({
      mint: "mint-sol",
      holdings: [],
      transactions: [],
      market: marketDetail,
    });

    expect(viewModel.position).toMatchObject({
      mint: "mint-sol",
      publicBalance: 0,
      shieldedBalance: 0,
      totalBalance: 0,
    });
    expect(viewModel.token).toEqual({
      name: "Market Solana",
      symbol: "mSOL",
      icon: "https://market.example/sol.png",
      decimals: 9,
    });
    expect(viewModel.canSend).toBe(false);
    expect(viewModel.canReceive).toBe(true);
    expect(viewModel.canSwap).toBe(true);
    expect(viewModel.canShield).toBe(false);
    expect(viewModel.canUnshield).toBe(false);
  });

  it("splits public and shielded balances into the action rules", () => {
    const holdings: TokenHolding[] = [
      {
        mint: "mint-sol",
        symbol: "SOL",
        name: "Solana",
        balance: 1.25,
        decimals: 9,
        priceUsd: 150,
        valueUsd: 187.5,
        imageUrl: "https://example.com/sol.png",
        isSecured: false,
      },
      {
        mint: "mint-sol",
        symbol: "SOL",
        name: "Solana",
        balance: 0.4,
        decimals: 9,
        priceUsd: 150,
        valueUsd: 60,
        imageUrl: "https://example.com/sol.png",
        isSecured: true,
      },
    ];

    const viewModel = buildTokenDetailViewModel({
      mint: "mint-sol",
      holdings,
      transactions: [],
      market: marketDetail,
    });

    expect(viewModel.position).toMatchObject({
      publicBalance: 1.25,
      shieldedBalance: 0.4,
      totalBalance: 1.65,
      totalValueUsd: 247.5,
    });
    expect(viewModel.canSend).toBe(true);
    expect(viewModel.canShield).toBe(true);
    expect(viewModel.canUnshield).toBe(true);
  });
});
