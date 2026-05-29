import {
  enumerateDepositsByUser,
  LoyalPrivateTransactionsClient,
  type DepositData,
  type WalletLike,
} from "@loyal-labs/private-transactions";
import { Connection, PublicKey } from "@solana/web3.js";

import type { Signer } from "@/lib/wallet/signer";

import { resolveTrackedKaminoUsdcMint } from "../deposits/kamino-usdc-position";
import {
  LOYAL_TOKEN_MINT,
  NATIVE_SOL_DECIMALS,
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDT_MINT_MAINNET,
} from "../constants";
import {
  getConnection,
  getEndpoints,
  getPerEndpoints,
  getSolanaEnv,
} from "../rpc/connection";
import type { SolanaEnv } from "../rpc/types";
import {
  resolveTokenIcon,
  resolveTokenName,
  resolveTokenSymbol,
} from "./resolve-token-info";
import type { TokenHolding } from "./types";

const DEFAULT_TOKEN_DECIMALS = 6;
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

const signedClientPromises = new Map<
  string,
  Promise<LoyalPrivateTransactionsClient>
>();
const signedClients = new Map<string, LoyalPrivateTransactionsClient>();
const readClientPromises = new Map<
  SolanaEnv,
  Promise<LoyalPrivateTransactionsClient>
>();
const readClients = new Map<SolanaEnv, LoyalPrivateTransactionsClient>();

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

async function getSignedClient(
  signer: Signer | null | undefined,
  solanaEnv: SolanaEnv
): Promise<LoyalPrivateTransactionsClient | null> {
  if (!signer) return null;

  const key = `${solanaEnv}:${signer.publicKey.toBase58()}`;
  const cached = signedClients.get(key);
  if (cached) return cached;

  const pending = signedClientPromises.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
    const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);
    const client = await LoyalPrivateTransactionsClient.fromConfig({
      signer: signer as unknown as WalletLike,
      baseRpcEndpoint: rpcEndpoint,
      baseWsEndpoint: websocketEndpoint,
      ephemeralRpcEndpoint: perRpcEndpoint,
      ephemeralWsEndpoint: perWsEndpoint,
    });
    signedClients.set(key, client);
    signedClientPromises.delete(key);
    return client;
  })().catch((error) => {
    signedClientPromises.delete(key);
    throw error;
  });

  signedClientPromises.set(key, promise);
  return promise;
}

async function getReadClient(
  solanaEnv: SolanaEnv
): Promise<LoyalPrivateTransactionsClient> {
  const cached = readClients.get(solanaEnv);
  if (cached) return cached;

  const pending = readClientPromises.get(solanaEnv);
  if (pending) return pending;

  const promise = (async () => {
    const { Keypair } = await import("@solana/web3.js");
    const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
    const client = await LoyalPrivateTransactionsClient.fromConfig({
      signer: Keypair.generate(),
      baseRpcEndpoint: rpcEndpoint,
      baseWsEndpoint: websocketEndpoint,
      ephemeralRpcEndpoint: rpcEndpoint,
      ephemeralWsEndpoint: websocketEndpoint,
    });
    readClients.set(solanaEnv, client);
    readClientPromises.delete(solanaEnv);
    return client;
  })().catch((error) => {
    readClientPromises.delete(solanaEnv);
    throw error;
  });

  readClientPromises.set(solanaEnv, promise);
  return promise;
}

async function getDeposits(args: {
  owner: PublicKey;
  signer?: Signer | null;
  solanaEnv: SolanaEnv;
}): Promise<{
  client: LoyalPrivateTransactionsClient | null;
  deposits: DepositData[];
}> {
  const client = await getSignedClient(args.signer, args.solanaEnv).catch(
    (error) => {
      console.warn("Failed to create signed private balance client", error);
      return null;
    }
  );

  if (client) {
    return {
      client,
      deposits: await client.getAllDepositsByUser(args.owner),
    };
  }

  const connection = getConnection();
  const { perRpcEndpoint } = getPerEndpoints(args.solanaEnv);
  const ephemeralConnection = new Connection(perRpcEndpoint, "confirmed");

  return {
    client: null,
    deposits: await enumerateDepositsByUser({
      user: args.owner,
      baseConnection: connection,
      ephemeralConnection,
    }),
  };
}

async function resolveMintDecimals(mint: PublicKey): Promise<number | null> {
  const accountInfo = await getConnection().getAccountInfo(mint);
  if (!accountInfo) return null;
  const isSplMint =
    accountInfo.owner.equals(TOKEN_PROGRAM_ID) ||
    accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
  if (!isSplMint) return null;
  return accountInfo.data[44] ?? null;
}

async function resolveHoldingTemplate(
  mint: string,
  holdings: TokenHolding[]
): Promise<TokenHolding> {
  const existing = holdings.find((holding) => holding.mint === mint);
  if (existing) return existing;

  const known = getKnownShieldableTokens().find((token) => token.mint === mint);
  if (known) return synthesizeShieldableHolding(known);

  const decimals =
    (await resolveMintDecimals(new PublicKey(mint)).catch(() => null)) ??
    DEFAULT_TOKEN_DECIMALS;

  return {
    mint,
    symbol: resolveTokenSymbol({ mint }),
    name: resolveTokenName({ mint }),
    balance: 0,
    decimals,
    priceUsd: null,
    valueUsd: null,
    imageUrl: resolveTokenIcon({ mint, imageUrl: null }),
    isSecured: false,
  };
}

async function toDisplayRawAmount(args: {
  amount: bigint;
  tokenMint: PublicKey;
  solanaEnv: SolanaEnv;
  client: LoyalPrivateTransactionsClient | null;
}): Promise<bigint | null> {
  const trackedKaminoMint = resolveTrackedKaminoUsdcMint(args.solanaEnv);
  if (args.tokenMint.toBase58() !== trackedKaminoMint) return args.amount;

  const client = args.client ?? (await getReadClient(args.solanaEnv));
  const quote = await client
    .getKaminoShieldedBalanceQuote({
      tokenMint: args.tokenMint,
      collateralSharesAmountRaw: args.amount,
    })
    .catch((error) => {
      console.warn("Failed to convert Kamino USDC shares to liquidity", error);
      return null;
    });

  return quote?.redeemableLiquidityAmountRaw ?? null;
}

/**
 * Fetch shielded balances for all token mints the user holds.
 * Returns TokenHolding[] with isSecured=true for any mint with a non-zero deposit.
 */
export async function fetchSecuredBalances(
  owner: string,
  holdings: TokenHolding[],
  signer?: Signer | null
): Promise<TokenHolding[]> {
  const ownerPk = new PublicKey(owner);
  const solanaEnv = getSolanaEnv();
  const { client, deposits } = await getDeposits({
    owner: ownerPk,
    signer,
    solanaEnv,
  });

  const secured: TokenHolding[] = [];
  for (const deposit of deposits) {
    if (deposit.amount <= BigInt(0)) continue;

    const mint = deposit.tokenMint.toBase58();
    const holding = await resolveHoldingTemplate(mint, holdings);
    const displayRawAmount = await toDisplayRawAmount({
      amount: deposit.amount,
      tokenMint: deposit.tokenMint,
      solanaEnv,
      client,
    });
    if (displayRawAmount === null) continue;

    const balance = Number(displayRawAmount) / Math.pow(10, holding.decimals);

    secured.push({
      ...holding,
      balance,
      valueUsd: holding.priceUsd ? balance * holding.priceUsd : null,
      isSecured: true,
    });
  }

  return secured;
}
