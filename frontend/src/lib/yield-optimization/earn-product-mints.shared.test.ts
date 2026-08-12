import { describe, expect, test } from "bun:test";
import { LoyalCluster, Stablecoin } from "@loyal-labs/actions";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { parseEarnDepositPrepareRequestBody } from "./earn-deposit-prepare-contracts.shared";
import {
  buildEarnDepositIntent,
  EARN_PRODUCT_STABLECOINS,
  EarnMintNotEnabledError,
  getEarnProductAssetsForCluster,
  getEnabledEarnProductAssetsForCluster,
  parseEnabledEarnStablecoins,
  resolveEarnProductAsset,
  resolveEnabledEarnProductAsset,
} from "./earn-product-mints.shared";

describe("Earn asset registry and public deposit intent", () => {
  test("contains exactly the six mainnet products with trusted programs", () => {
    const assets = getEarnProductAssetsForCluster(LoyalCluster.MainnetBeta);
    expect(assets.map((asset) => asset.symbol)).toEqual([
      Stablecoin.CASH,
      Stablecoin.USDG,
      Stablecoin.PYUSD,
      Stablecoin.USDC,
      Stablecoin.USDT,
      Stablecoin.USDS,
    ]);
    expect(assets.map((asset) => asset.tokenProgramId.toBase58())).toEqual([
      TOKEN_2022_PROGRAM_ID.toBase58(),
      TOKEN_2022_PROGRAM_ID.toBase58(),
      TOKEN_2022_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
      TOKEN_PROGRAM_ID.toBase58(),
    ]);
    expect(assets.every((asset) => asset.decimals === 6)).toBe(true);
  });

  test("browser intent contains only mint and raw amount", () => {
    for (const product of getEarnProductAssetsForCluster(
      LoyalCluster.MainnetBeta
    )) {
      const asset = resolveEarnProductAsset({
        cluster: LoyalCluster.MainnetBeta,
        mint: product.mint,
      });
      const intent = buildEarnDepositIntent({
        amountRaw: BigInt(1_000_000),
        mint: asset.mint,
      });
      expect(Object.keys(intent).sort()).toEqual(["amountRaw", "mint"]);
      expect(parseEarnDepositPrepareRequestBody(intent)).toEqual({
        amountRaw: BigInt(1_000_000),
        mint: asset.mint.toBase58(),
      });
    }
  });

  test("treats a missing mint as legacy USDC and rejects unsupported mints", () => {
    // Legacy mobile deposit bodies predate mint selection and always meant
    // USDC; requiring the field silently 400'd every mobile deposit (ASK-2099).
    expect(parseEarnDepositPrepareRequestBody({ amountRaw: "1" })).toEqual({
      amountRaw: BigInt(1),
      mint: null,
    });
    expect(
      resolveEarnProductAsset({ cluster: LoyalCluster.MainnetBeta, mint: null })
        .symbol
    ).toBe(Stablecoin.USDC);
    expect(() =>
      resolveEarnProductAsset({
        cluster: LoyalCluster.MainnetBeta,
        mint: "11111111111111111111111111111111",
      })
    ).toThrow("not a supported Earn product mint");
  });

  test("defaults missing or blank rollout configuration to USDC only", () => {
    expect(parseEnabledEarnStablecoins(undefined)).toEqual([Stablecoin.USDC]);
    expect(parseEnabledEarnStablecoins("  ")).toEqual([Stablecoin.USDC]);
  });

  test("resolves staged and all-product rollout subsets canonically", () => {
    expect(parseEnabledEarnStablecoins("USDT,USDC,PYUSD")).toEqual([
      Stablecoin.PYUSD,
      Stablecoin.USDC,
      Stablecoin.USDT,
    ]);
    expect(
      parseEnabledEarnStablecoins(EARN_PRODUCT_STABLECOINS.join(","))
    ).toEqual(EARN_PRODUCT_STABLECOINS);
  });

  test("rejects invalid and duplicate rollout configuration", () => {
    expect(() => parseEnabledEarnStablecoins("USDC,BOGUS")).toThrow(
      "unsupported stablecoin"
    );
    expect(() => parseEnabledEarnStablecoins("USDC,USDC")).toThrow(
      "duplicate stablecoin"
    );
    expect(() => parseEnabledEarnStablecoins("USDC,,USDT")).toThrow(
      "unsupported stablecoin"
    );
  });

  test("uses the same allowlist for selector options and deposit resolution", () => {
    const enabledStablecoins = parseEnabledEarnStablecoins("USDC,USDT");
    const options = getEnabledEarnProductAssetsForCluster({
      cluster: LoyalCluster.MainnetBeta,
      enabledStablecoins,
    });
    expect(options.map((asset) => asset.symbol)).toEqual([
      Stablecoin.USDC,
      Stablecoin.USDT,
    ]);
    const usdt = options.at(1);
    expect(usdt).toBeDefined();
    if (!usdt) {
      throw new Error("USDT rollout option is missing");
    }
    expect(
      resolveEnabledEarnProductAsset({
        cluster: LoyalCluster.MainnetBeta,
        enabledStablecoins,
        mint: usdt.mint,
      }).symbol
    ).toBe(Stablecoin.USDT);
    const pyusdAsset = getEarnProductAssetsForCluster(
      LoyalCluster.MainnetBeta
    ).find((asset) => asset.symbol === Stablecoin.PYUSD);
    expect(pyusdAsset).toBeDefined();
    if (!pyusdAsset) {
      throw new Error("PYUSD product is missing");
    }
    const pyusd = resolveEarnProductAsset({
      cluster: LoyalCluster.MainnetBeta,
      mint: pyusdAsset.mint,
    });
    expect(() =>
      resolveEnabledEarnProductAsset({
        cluster: LoyalCluster.MainnetBeta,
        enabledStablecoins,
        mint: pyusd.mint,
      })
    ).toThrow(EarnMintNotEnabledError);
  });
});
