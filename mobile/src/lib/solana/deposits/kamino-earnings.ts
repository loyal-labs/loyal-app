import {
  findDepositPda,
  LoyalPrivateTransactionsClient,
} from "@loyal-labs/private-transactions";
import type { LoyalPrivateTransactionsClient as LoyalPrivateTransactionsClientType } from "@loyal-labs/private-transactions";
import { PublicKey } from "@solana/web3.js";

import {
  getConnection,
  getEndpoints,
  getPerEndpoints,
  getSolanaEnv,
} from "@/lib/solana/rpc/connection";
import type { Signer } from "@/lib/wallet/signer";

import {
  loadKaminoUsdcTrackedPosition,
  resolveKaminoPrincipalLiquidityAmountRaw,
  resolveTrackedKaminoUsdcMint,
} from "./kamino-usdc-position";

const USDC_DECIMALS = 6;
const USDC_SCALE = 10 ** USDC_DECIMALS;

/**
 * Aggregate Kamino-earned yield for the wallet's shielded USDC position.
 * Values are in USD — since only USDC is tracked today, "USD" ≈ "USDC"
 * 1:1 (price deviation is rounding error at the pill level).
 */
export type KaminoUsdcEarnings = {
  principalUsd: number;
  currentUsd: number;
  earnedUsd: number;
  earnedPct: number;
};

/**
 * Deposit account layout: 8-byte discriminator + 32 user + 32 tokenMint + 8 amount (u64 LE).
 * Mirrors fetch-secured-balances so we don't need to pay the cost of a full
 * Anchor decode just to read the shares count.
 */
const DEPOSIT_AMOUNT_OFFSET = 72;
function readDepositAmount(data: Uint8Array): bigint {
  if (data.length < DEPOSIT_AMOUNT_OFFSET + 8) return BigInt(0);
  let value = BigInt(0);
  for (let i = 0; i < 8; i++) {
    value += BigInt(data[DEPOSIT_AMOUNT_OFFSET + i]) << BigInt(i * 8);
  }
  return value;
}

// Lightweight module-level client cache keyed by wallet public key. The
// Kamino reserve snapshot fetch is cheap but building a full
// LoyalPrivateTransactionsClient is not, so we reuse one across refreshes.
let cachedClient: LoyalPrivateTransactionsClientType | null = null;
let cachedClientOwner: string | null = null;

async function getEarningsClient(
  signer: Signer,
): Promise<LoyalPrivateTransactionsClientType> {
  const owner = signer.publicKey.toBase58();
  if (cachedClient && cachedClientOwner === owner) return cachedClient;

  const solanaEnv = getSolanaEnv();
  const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
  const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);

  const client = await LoyalPrivateTransactionsClient.fromConfig({
    signer,
    baseRpcEndpoint: rpcEndpoint,
    baseWsEndpoint: websocketEndpoint,
    ephemeralRpcEndpoint: perRpcEndpoint,
    ephemeralWsEndpoint: perWsEndpoint,
  });

  cachedClient = client;
  cachedClientOwner = owner;
  return client;
}

export function clearKaminoEarningsClientCache(): void {
  cachedClient = null;
  cachedClientOwner = null;
}

/**
 * Compute the user's aggregate USDC earnings inside the Kamino reserve.
 *
 * Returns `null` when:
 *   - The current environment has no tracked USDC mint (e.g. localnet)
 *   - The user has no shielded USDC position
 *   - The position was shielded before tracking existed (no cost basis)
 *   - The reserve snapshot fails (network, etc.)
 *
 * On success, returns positive-only earnings — a bad tick that dips the
 * redeemable liquidity below the principal clamps to zero so the UI never
 * shows a scary red number for normal reserve jitter.
 */
export async function computeKaminoUsdcEarnings(args: {
  publicKey: string;
  signer: Signer;
}): Promise<KaminoUsdcEarnings | null> {
  const solanaEnv = getSolanaEnv();
  const trackedMint = resolveTrackedKaminoUsdcMint(solanaEnv);
  if (!trackedMint) return null;

  const trackedPosition = await loadKaminoUsdcTrackedPosition({
    publicKey: args.publicKey,
    solanaEnv,
  });
  if (!trackedPosition) return null;

  const ownerPk = new PublicKey(args.publicKey);
  const tokenMintPk = new PublicKey(trackedMint);
  const [depositPda] = findDepositPda(ownerPk, tokenMintPk);

  const connection = getConnection();
  const accountInfo = await connection.getAccountInfo(depositPda);
  if (!accountInfo?.data) return null;
  const actualShares = readDepositAmount(accountInfo.data);
  if (actualShares <= BigInt(0)) return null;

  const client = await getEarningsClient(args.signer);
  const quote = await client.getKaminoShieldedBalanceQuote({
    tokenMint: tokenMintPk,
    collateralSharesAmountRaw: actualShares,
  });
  if (!quote) return null;

  const currentLiquidity = quote.redeemableLiquidityAmountRaw;
  const principalLiquidity = resolveKaminoPrincipalLiquidityAmountRaw({
    trackedPosition,
    actualCollateralSharesAmountRaw: actualShares,
    currentLiquidityAmountRaw: currentLiquidity,
  });
  if (principalLiquidity === null) return null;

  const earnedLiquidity =
    currentLiquidity > principalLiquidity
      ? currentLiquidity - principalLiquidity
      : BigInt(0);

  const principalUsd = Number(principalLiquidity) / USDC_SCALE;
  const currentUsd = Number(currentLiquidity) / USDC_SCALE;
  const earnedUsd = Number(earnedLiquidity) / USDC_SCALE;
  const earnedPct = principalUsd > 0 ? (earnedUsd / principalUsd) * 100 : 0;

  return { principalUsd, currentUsd, earnedUsd, earnedPct };
}
