import { describe, expect, test } from "bun:test";

import {
  resolveKnownTokenMetadata,
  SOLANA_USDC_MINT_DEVNET,
  USDC_ICON_URL,
} from "../frontend-asset-provider";

describe("resolveKnownTokenMetadata", () => {
  test("maps official devnet USDC to stable metadata and price", () => {
    const metadata = resolveKnownTokenMetadata(SOLANA_USDC_MINT_DEVNET, 6);

    expect(metadata).toEqual({
      descriptor: {
        mint: SOLANA_USDC_MINT_DEVNET,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        imageUrl: USDC_ICON_URL,
        isNative: false,
      },
      priceUsd: 1,
    });
  });

  test("returns null for unknown mints", () => {
    expect(resolveKnownTokenMetadata("unknown-mint", 9)).toBeNull();
  });
});
