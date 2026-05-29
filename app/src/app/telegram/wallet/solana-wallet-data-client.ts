import {
  createSolanaWalletDataClient,
  type SecureBalanceMap,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { PublicKey } from "@solana/web3.js";

import { resolveTrackedKaminoUsdcMint } from "@/lib/solana/deposits/kamino-usdc-position";
import { getPrivateClient } from "@/lib/solana/deposits/private-client";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";

const clients = new Map<string, SolanaWalletDataClient>();

async function fetchSecureHoldings(args: {
  owner: PublicKey;
}): Promise<SecureBalanceMap> {
  const solanaEnv = getSolanaEnv();
  const trackedKaminoMint = resolveTrackedKaminoUsdcMint(solanaEnv);
  const privateClient = await getPrivateClient({ solanaEnv });

  const deposits = await privateClient
    .getAllDepositsByUser(args.owner)
    .catch((error) => {
      console.warn(
        "[wallet-data] Failed to enumerate Loyal deposits; shielded balances will be hidden",
        error
      );
      return [] as Awaited<
        ReturnType<typeof privateClient.getAllDepositsByUser>
      >;
    });

  const secureBalances = new Map<string, bigint>();

  for (const deposit of deposits) {
    if (deposit.amount <= BigInt(0)) continue;

    const mintBase58 = deposit.tokenMint.toBase58();
    let secureAmountRaw = deposit.amount;

    if (
      trackedKaminoMint &&
      mintBase58 === trackedKaminoMint &&
      secureAmountRaw > BigInt(0)
    ) {
      try {
        const quote = await privateClient.getKaminoShieldedBalanceQuote({
          tokenMint: deposit.tokenMint,
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

    secureBalances.set(mintBase58, secureAmountRaw);
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
    secureBalanceProvider: async ({ owner }) => fetchSecureHoldings({ owner }),
  });

  clients.set(solanaEnv, client);
  return client;
}
