import {
  NATIVE_SOL_MINT,
  SOLANA_USDT_MINT_MAINNET,
} from "../../constants";
import { DEFAULT_TOKEN_ICON, KNOWN_TOKEN_ICONS } from "../constants";
import { resolveTokenIcon } from "../resolve-token-info";

describe("resolveTokenIcon", () => {
  it("prefers the CoinGecko-backed detailLogoUrl when available", () => {
    // `detailLogoUrl` originates from /api/mobile/tokens/:mint which is
    // served by `fetchCoinGeckoTokenData` on the backend. This is the
    // authoritative source for any mint CoinGecko knows about.
    expect(
      resolveTokenIcon({
        mint: SOLANA_USDT_MINT_MAINNET,
        imageUrl: null,
        detailLogoUrl: "https://assets.coingecko.com/coins/images/325/abc.png",
      }),
    ).toBe("https://assets.coingecko.com/coins/images/325/abc.png");
  });

  it("uses Helius raster imageUrl when detailLogoUrl is absent", () => {
    expect(
      resolveTokenIcon({
        mint: "mint-x",
        imageUrl: "https://example.com/coin.png",
      }),
    ).toBe("https://example.com/coin.png");
  });

  it("rejects SVG imageUrls and falls through (RN Image cannot render remote SVG)", () => {
    expect(
      resolveTokenIcon({
        mint: "mint-x",
        imageUrl: "https://example.com/coin.svg",
      }),
    ).toBe(DEFAULT_TOKEN_ICON);
  });

  it("falls back to KNOWN_TOKEN_ICONS for the USDT mainnet mint (instant first paint)", () => {
    // ASK-1133: the instant-render fallback for USDT must point at a
    // working PNG so a user who opens the shield picker before CoinGecko
    // responds doesn't see the SOL-logo default.
    const result = resolveTokenIcon({
      mint: SOLANA_USDT_MINT_MAINNET,
      imageUrl: null,
    });
    expect(result).toBe(KNOWN_TOKEN_ICONS[SOLANA_USDT_MINT_MAINNET]);
    expect(result).toMatch(/\.png$/i);
    expect(result).not.toContain(NATIVE_SOL_MINT);
  });

  it("falls back to KNOWN_TOKEN_ICONS for the native SOL mint", () => {
    expect(
      resolveTokenIcon({ mint: NATIVE_SOL_MINT, imageUrl: null }),
    ).toBe(KNOWN_TOKEN_ICONS[NATIVE_SOL_MINT]);
  });

  it("returns DEFAULT_TOKEN_ICON for an unknown mint with no usable source", () => {
    expect(resolveTokenIcon({ mint: "unknown-mint", imageUrl: null })).toBe(
      DEFAULT_TOKEN_ICON,
    );
  });
});
