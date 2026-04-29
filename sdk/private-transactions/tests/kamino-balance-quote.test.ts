import { describe, expect, it } from "bun:test";
import { Keypair } from "@solana/web3.js";

import { LoyalPrivateTransactionsClient } from "../index";
import {
  getKaminoModifyBalanceAccountsForTokenMint,
  USDC_MINT_MAINNET,
} from "../src/constants";

const KAMINO_RESERVE_DISCRIMINATOR = Buffer.from([
  43, 242, 204, 202, 26, 247, 59, 127,
]);
const KAMINO_FRACTION_BITS = 60n;

const OFFSET_AFTER_DISCRIMINATOR = {
  liquidityAvailableAmount: 216,
  liquidityBorrowedAmountSf: 224,
  liquidityMintDecimals: 264,
  liquidityAccumulatedProtocolFeesSf: 336,
  liquidityAccumulatedReferrerFeesSf: 352,
  liquidityPendingReferrerFeesSf: 368,
  collateralMintTotalSupply: 2584,
} as const;

function writeU64LE(buffer: Buffer, offset: number, value: bigint): void {
  buffer.writeBigUInt64LE(value, offset);
}

function writeU128LE(buffer: Buffer, offset: number, value: bigint): void {
  buffer.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  buffer.writeBigUInt64LE(value >> 64n, offset + 8);
}

function buildReserveAccountData(args: {
  liquidityAvailableAmountRaw: bigint;
  collateralMintSupplyRaw: bigint;
  liquidityDecimals: bigint;
}): Buffer {
  const accountData = Buffer.alloc(8 + OFFSET_AFTER_DISCRIMINATOR.collateralMintTotalSupply + 8);
  KAMINO_RESERVE_DISCRIMINATOR.copy(accountData, 0);

  const view = accountData.subarray(8);
  writeU64LE(
    view,
    OFFSET_AFTER_DISCRIMINATOR.liquidityAvailableAmount,
    args.liquidityAvailableAmountRaw
  );
  writeU128LE(
    view,
    OFFSET_AFTER_DISCRIMINATOR.liquidityBorrowedAmountSf,
    0n
  );
  writeU64LE(
    view,
    OFFSET_AFTER_DISCRIMINATOR.liquidityMintDecimals,
    args.liquidityDecimals
  );
  writeU128LE(
    view,
    OFFSET_AFTER_DISCRIMINATOR.liquidityAccumulatedProtocolFeesSf,
    0n
  );
  writeU128LE(
    view,
    OFFSET_AFTER_DISCRIMINATOR.liquidityAccumulatedReferrerFeesSf,
    0n
  );
  writeU128LE(
    view,
    OFFSET_AFTER_DISCRIMINATOR.liquidityPendingReferrerFeesSf,
    0n
  );
  writeU64LE(
    view,
    OFFSET_AFTER_DISCRIMINATOR.collateralMintTotalSupply,
    args.collateralMintSupplyRaw
  );

  return accountData;
}

function createReadonlyClient(): LoyalPrivateTransactionsClient {
  const client = Object.create(
    LoyalPrivateTransactionsClient.prototype
  ) as LoyalPrivateTransactionsClient & {
    baseProgram: {
      provider: {
        connection: {
          rpcEndpoint: string;
          getAccountInfo: (pubkey: { toBase58: () => string }) => Promise<{
            data: Buffer;
          } | null>;
        };
      };
    };
  };

  const kaminoAccounts =
    getKaminoModifyBalanceAccountsForTokenMint(USDC_MINT_MAINNET);

  if (!kaminoAccounts) {
    throw new Error("Expected mainnet Kamino accounts to be configured");
  }

  client.baseProgram = {
    provider: {
      connection: {
        rpcEndpoint: "https://api.mainnet-beta.solana.com",
        getAccountInfo: async (pubkey) => {
          if (pubkey.toBase58() !== kaminoAccounts.reserve.toBase58()) {
            throw new Error(`Unexpected reserve ${pubkey.toBase58()}`);
          }

          return {
            data: buildReserveAccountData({
              liquidityAvailableAmountRaw: 101_500_000n,
              collateralMintSupplyRaw: 100_000_000n,
              liquidityDecimals: 6n,
            }),
          };
        },
      },
    },
  };

  return client;
}

describe("Kamino shielded balance quotes", () => {
  it("returns null for token mints without configured Kamino reserves", async () => {
    const client = createReadonlyClient();
    const tokenMint = Keypair.generate().publicKey;

    expect(
      await client.getKaminoShieldedBalanceQuote({
        tokenMint,
        collateralSharesAmountRaw: 1_000_000n,
      })
    ).toBeNull();
    expect(
      await client.getKaminoCollateralSharesForLiquidityAmount({
        tokenMint,
        liquidityAmountRaw: 1_000_000n,
      })
    ).toBeNull();
  });

  it("quotes current liquidity and earned principal from Kamino collateral shares", async () => {
    const client = createReadonlyClient();

    const quote = await client.getKaminoShieldedBalanceQuote({
      tokenMint: USDC_MINT_MAINNET,
      collateralSharesAmountRaw: 100_000_000n,
      principalLiquidityAmountRaw: 100_000_000n,
    });

    expect(quote).not.toBeNull();
    expect(quote?.snapshot.collateralSupplyRaw).toBe(100_000_000n);
    expect(quote?.snapshot.totalLiquiditySupplyScaled).toBe(
      101_500_000n << KAMINO_FRACTION_BITS
    );
    expect(quote?.snapshot.collateralExchangeRateSf).toBeGreaterThan(0n);
    expect(quote?.redeemableLiquidityAmountRaw).toBe(101_500_000n);
    expect(quote?.earnedLiquidityAmountRaw).toBe(1_500_000n);
  });

  it("quotes the collateral shares required for a target liquidity amount", async () => {
    const client = createReadonlyClient();

    const collateralSharesAmountRaw =
      await client.getKaminoCollateralSharesForLiquidityAmount({
        tokenMint: USDC_MINT_MAINNET,
        liquidityAmountRaw: 101_500_000n,
      });

    expect(collateralSharesAmountRaw).toBe(100_000_000n);
  });
});
