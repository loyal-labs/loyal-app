import { PublicKey } from "@solana/web3.js";

import {
  LOYAL_TOKEN_MINT,
  NATIVE_SOL_DECIMALS,
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDT_MINT_MAINNET,
} from "../constants";
import { getConnection } from "../rpc/connection";
import { resolveTokenIcon } from "./resolve-token-info";
import type { TokenHolding } from "./types";

const PROGRAM_ID = new PublicKey("97FzQdWi26mFNR21AbQNg4KqofiCLqQydQfAvRQMcXhV");
const DEPOSIT_SEED = new TextEncoder().encode("deposit_v2");
const DEFAULT_TOKEN_DECIMALS = 6;

type ShieldableToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
};

function isMainnet(): boolean {
  return (process.env.EXPO_PUBLIC_SOLANA_ENV ?? "devnet") === "mainnet";
}

function getEnvUsdcMint(): string {
  return isMainnet() ? SOLANA_USDC_MINT_MAINNET : SOLANA_USDC_MINT_DEVNET;
}

function getKnownShieldableTokens(): ShieldableToken[] {
  const tokens: ShieldableToken[] = [
    {
      mint: NATIVE_SOL_MINT,
      symbol: "SOL",
      name: "Solana",
      decimals: NATIVE_SOL_DECIMALS,
    },
    {
      mint: getEnvUsdcMint(),
      symbol: "USDC",
      name: "USD Coin",
      decimals: DEFAULT_TOKEN_DECIMALS,
    },
    {
      mint: LOYAL_TOKEN_MINT,
      symbol: "LOYAL",
      name: "Loyal",
      decimals: DEFAULT_TOKEN_DECIMALS,
    },
  ];

  // USDT has no canonical devnet mint; only scan it on mainnet so we don't
  // waste an RPC slot reading a PDA that can never exist on devnet.
  if (isMainnet()) {
    tokens.push({
      mint: SOLANA_USDT_MINT_MAINNET,
      symbol: "USDT",
      name: "Tether USD",
      decimals: DEFAULT_TOKEN_DECIMALS,
    });
  }

  return tokens;
}

function synthesizeShieldableHolding(token: ShieldableToken): TokenHolding {
  return {
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    balance: 0,
    decimals: token.decimals,
    priceUsd: null,
    valueUsd: null,
    imageUrl: resolveTokenIcon({ mint: token.mint, imageUrl: null }),
    isSecured: false,
  };
}

export function buildScanList(holdings: TokenHolding[]): TokenHolding[] {
  const byMint = new Map<string, TokenHolding>();
  for (const holding of holdings) {
    if (!byMint.has(holding.mint)) byMint.set(holding.mint, holding);
  }
  for (const token of getKnownShieldableTokens()) {
    if (!byMint.has(token.mint)) {
      byMint.set(token.mint, synthesizeShieldableHolding(token));
    }
  }
  return Array.from(byMint.values());
}

function findDepositPda(user: PublicKey, tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DEPOSIT_SEED, user.toBuffer(), tokenMint.toBuffer()],
    PROGRAM_ID,
  );
}

/** Deposit account layout: 8-byte discriminator + 32 user + 32 tokenMint + 8 amount (u64 LE) */
const DEPOSIT_AMOUNT_OFFSET = 72;

function readDepositAmount(data: Buffer): bigint {
  if (data.length < DEPOSIT_AMOUNT_OFFSET + 8) return BigInt(0);
  let value = BigInt(0);
  for (let i = 0; i < 8; i++) {
    value += BigInt(data[DEPOSIT_AMOUNT_OFFSET + i]) << BigInt(i * 8);
  }
  return value;
}

/**
 * Fetch shielded balances for all token mints the user holds.
 * Returns TokenHolding[] with isSecured=true for any mint with a non-zero deposit.
 */
export async function fetchSecuredBalances(
  owner: string,
  holdings: TokenHolding[],
): Promise<TokenHolding[]> {
  const connection = getConnection();
  const ownerPk = new PublicKey(owner);

  const scanList = buildScanList(holdings);
  if (scanList.length === 0) return [];

  const pdas = scanList.map(
    ({ mint }) => findDepositPda(ownerPk, new PublicKey(mint))[0],
  );

  const accountInfos = await connection.getMultipleAccountsInfo(pdas);

  const secured: TokenHolding[] = [];
  for (let i = 0; i < scanList.length; i++) {
    const info = accountInfos[i];
    if (!info?.data) continue;
    const rawAmount = readDepositAmount(info.data as Buffer);
    if (rawAmount <= BigInt(0)) continue;

    const holding = scanList[i];
    const balance = Number(rawAmount) / Math.pow(10, holding.decimals);

    secured.push({
      ...holding,
      balance,
      valueUsd: holding.priceUsd ? balance * holding.priceUsd : null,
      isSecured: true,
    });
  }

  return secured;
}
