import {
  type AssetBalance,
  createSolanaWalletDataClient,
  NATIVE_SOL_MINT,
  type SecureBalanceMap,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { PublicKey } from "@solana/web3.js";

import { resolveTrackedKaminoUsdcMint } from "@/lib/solana/deposits/kamino-usdc-position";
import { fetchLoyalDeposits } from "@/lib/solana/deposits/loyal-deposits";
import { getPrivateClient } from "@/lib/solana/deposits/private-client";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";

const clients = new Map<string, SolanaWalletDataClient>();

async function fetchSecureHoldings(args: {
  owner: PublicKey;
  tokenMints: PublicKey[];
}): Promise<SecureBalanceMap> {
  const solanaEnv = getSolanaEnv();
  const nativeMint = new PublicKey(NATIVE_SOL_MINT);
  const trackedKaminoMint = resolveTrackedKaminoUsdcMint(solanaEnv);

  const [nativeDeposits, tokenDeposits, privateClient] = await Promise.all([
    fetchLoyalDeposits(args.owner, [nativeMint]),
    fetchLoyalDeposits(
      args.owner,
      args.tokenMints.filter((mint) => !mint.equals(nativeMint))
    ),
    getPrivateClient({ solanaEnv }),
  ]);

  const secureBalances = new Map<string, bigint>();

  for (const [mint, amount] of [...nativeDeposits, ...tokenDeposits]) {
    let secureAmountRaw = BigInt(Math.round(amount));

    if (
      trackedKaminoMint &&
      mint.toBase58() === trackedKaminoMint &&
      secureAmountRaw > BigInt(0)
    ) {
      try {
        const quote = await privateClient.getKaminoShieldedBalanceQuote({
          tokenMint: mint,
          collateralSharesAmountRaw: secureAmountRaw,
        });
        if (quote) {
          secureAmountRaw = quote.redeemableLiquidityAmountRaw;
        }
      } catch (error) {
        console.warn(
          "[wallet-data] Failed to convert Kamino USDC collateral shares to liquidity",
          error
        );
      }
    }

    secureBalances.set(mint.toBase58(), secureAmountRaw);
  }

  return secureBalances;
}

export function getTelegramWalletDataClient(): SolanaWalletDataClient {
  const solanaEnv = getSolanaEnv();
  const cached = clients.get(solanaEnv);
  if (cached) {
    return cached;
  }

  const client = createSolanaWalletDataClient({
    env: solanaEnv,
    secureBalanceProvider: async ({ owner, tokenMints, assetBalances }) =>
      fetchSecureHoldings({
        owner,
        tokenMints: tokenMints.filter((mint) =>
          assetBalances.some(
            (assetBalance: AssetBalance) => assetBalance.asset.mint === mint.toBase58()
          )
        ),
      })
  });

  clients.set(solanaEnv, client);
  return client;
}
