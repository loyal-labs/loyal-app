import type {
  AssetBalance,
  AssetDescriptor,
  AssetProvider,
  AssetSnapshot,
  ResolvedAssetEntry,
} from "@loyal-labs/solana-wallet";
import {
  NATIVE_SOL_DECIMALS,
  NATIVE_SOL_MINT,
} from "@loyal-labs/solana-wallet";
import {
  Connection,
  type Commitment,
  type GetProgramAccountsFilter,
  PublicKey,
} from "@solana/web3.js";

import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
const COINGECKO_BASE_URL = "https://pro-api.coingecko.com/api/v3";
const SOLANA_NETWORK = "solana";
const DEFAULT_SUBSCRIPTION_DEBOUNCE_MS = 750;

type CoinGeckoTokenMarket = {
  mint: string;
  token: {
    decimals: number | null;
    logoUrl: string | null;
    name: string | null;
    symbol: string | null;
  };
  market: {
    priceUsd: number | null;
  };
};

type CoinGeckoTokenDataResponse = {
  data?: {
    attributes?: {
      name?: string;
      symbol?: string;
      decimals?: number;
      image_url?: string | null;
      price_usd?: string | number | null;
    };
  };
};

type ParsedTokenAccount = {
  account: {
    data:
      | Buffer
      | {
          parsed?: {
            info?: {
              mint?: unknown;
              tokenAmount?: {
                amount?: unknown;
                decimals?: unknown;
              };
            };
          };
        };
  };
};

type TokenAccumulator = {
  amountRaw: bigint;
  decimals: number;
  mint: string;
};

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<T> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

function toSafePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function getCoinGeckoApiKey(): string | null {
  if (typeof process === "undefined") {
    return null;
  }

  return (
    process.env.NEXT_COINGECKO_API_KEY ?? process.env.COINGECKO_API_KEY ?? null
  );
}

function getBrowserTokenMarketUrl(mint: string): string {
  return `/api/tokens/${encodeURIComponent(mint)}/market`;
}

function mapCoinGeckoTokenData(
  mint: string,
  response: CoinGeckoTokenDataResponse
): CoinGeckoTokenMarket {
  const attrs = response.data?.attributes ?? {};

  return {
    mint,
    token: {
      decimals: typeof attrs.decimals === "number" ? attrs.decimals : null,
      logoUrl: attrs.image_url ?? null,
      name: attrs.name ?? null,
      symbol: attrs.symbol ?? null,
    },
    market: {
      priceUsd: parseNumber(attrs.price_usd),
    },
  };
}

async function fetchCoinGeckoTokenMarket(
  fetchImpl: typeof fetch,
  mint: string
): Promise<CoinGeckoTokenMarket | null> {
  try {
    if (typeof window !== "undefined") {
      return await fetchJson<CoinGeckoTokenMarket>(
        fetchImpl,
        getBrowserTokenMarketUrl(mint),
        { method: "GET" }
      );
    }

    const apiKey = getCoinGeckoApiKey();
    if (!apiKey) {
      return null;
    }

    const response = await fetchJson<CoinGeckoTokenDataResponse>(
      fetchImpl,
      `${COINGECKO_BASE_URL}/onchain/networks/${SOLANA_NETWORK}/tokens/${mint}`,
      {
        headers: {
          "Content-Type": "application/json",
          "x-cg-pro-api-key": apiKey,
        },
        method: "GET",
      }
    );

    return mapCoinGeckoTokenData(mint, response);
  } catch {
    return null;
  }
}

function createNativeSolBalance(
  lamports: number,
  metadata: AssetDescriptor,
  priceUsd: number | null
): AssetBalance {
  const balance = lamports / Math.pow(10, NATIVE_SOL_DECIMALS);

  return {
    asset: metadata,
    balance,
    priceUsd,
    valueUsd: priceUsd === null ? null : balance * priceUsd,
  };
}

function mapParsedTokenAccount(
  tokenAccount: ParsedTokenAccount
): TokenAccumulator | null {
  const data = tokenAccount.account.data;
  if (Buffer.isBuffer(data)) {
    return null;
  }

  const info = data.parsed?.info;
  const mint = typeof info?.mint === "string" ? info.mint : null;
  const amount =
    typeof info?.tokenAmount?.amount === "string"
      ? info.tokenAmount.amount
      : null;
  const decimals =
    typeof info?.tokenAmount?.decimals === "number"
      ? info.tokenAmount.decimals
      : null;

  if (!mint || !amount || decimals === null) {
    return null;
  }

  const amountRaw = BigInt(amount);
  if (amountRaw <= BigInt(0)) {
    return null;
  }

  return {
    amountRaw,
    decimals,
    mint,
  };
}

export function createFrontendAssetProvider(args: {
  rpcEndpoint: string;
  websocketEndpoint: string;
  commitment: Commitment;
  fetchImpl: typeof fetch;
}): AssetProvider {
  let rpcConnection: Connection | null = null;
  let websocketConnection: Connection | null = null;
  const metadataCache = new Map<
    string,
    Promise<{
      descriptor: AssetDescriptor;
      priceUsd: number | null;
    }>
  >();

  const getConnection = () => {
    if (rpcConnection) {
      return rpcConnection;
    }

    rpcConnection = new Connection(args.rpcEndpoint, {
      commitment: args.commitment,
      disableRetryOnRateLimit: true,
      fetch: getFrontendSolanaRpcFetch(args.fetchImpl),
    });
    return rpcConnection;
  };

  const getWebsocketConnection = () => {
    if (websocketConnection) {
      return websocketConnection;
    }

    websocketConnection = new Connection(args.rpcEndpoint, {
      commitment: args.commitment,
      disableRetryOnRateLimit: true,
      fetch: getFrontendSolanaRpcFetch(args.fetchImpl),
      wsEndpoint: args.websocketEndpoint,
    });
    return websocketConnection;
  };

  const resolveTokenMetadata = (mint: string, decimals: number) => {
    const cached = metadataCache.get(mint);
    if (cached) {
      return cached;
    }

    const promise = (async () => {
      if (mint === NATIVE_SOL_MINT) {
        const market = await fetchCoinGeckoTokenMarket(args.fetchImpl, mint);
        const priceUsd = toSafePositiveNumber(market?.market.priceUsd);

        return {
          descriptor: {
            mint,
            symbol: "SOL",
            name: "Solana",
            decimals: NATIVE_SOL_DECIMALS,
            imageUrl: null,
            isNative: true,
          },
          priceUsd,
        };
      }

      const market = await fetchCoinGeckoTokenMarket(args.fetchImpl, mint);

      if (market) {
        const symbol = market.token.symbol?.trim() || "TOKEN";

        return {
          descriptor: {
            mint,
            symbol,
            name: market.token.name?.trim() || symbol,
            decimals: market.token.decimals ?? decimals,
            imageUrl: market.token.logoUrl ?? null,
            isNative: false,
          },
          priceUsd: toSafePositiveNumber(market.market.priceUsd),
        };
      }

      return {
        descriptor: {
          mint,
          symbol: "TOKEN",
          name: "Token",
          decimals,
          imageUrl: null,
          isNative: false,
        },
        priceUsd: null,
      };
    })();

    metadataCache.set(mint, promise);
    return promise;
  };

  return {
    getBalance: async (owner) =>
      getConnection().getBalance(owner, args.commitment),
    getAssetSnapshot: async (owner): Promise<AssetSnapshot> => {
      const connection = getConnection();
      const [lamports, tokenProgramAccounts, token2022ProgramAccounts] =
        await Promise.all([
          connection.getBalance(owner, args.commitment),
          connection.getParsedTokenAccountsByOwner(
            owner,
            { programId: TOKEN_PROGRAM_ID },
            args.commitment
          ),
          connection.getParsedTokenAccountsByOwner(
            owner,
            { programId: TOKEN_2022_PROGRAM_ID },
            args.commitment
          ),
        ]);

      const tokenBalances = new Map<string, TokenAccumulator>();
      for (const tokenAccount of [
        ...tokenProgramAccounts.value,
        ...token2022ProgramAccounts.value,
      ] as ParsedTokenAccount[]) {
        const parsed = mapParsedTokenAccount(tokenAccount);
        if (!parsed) {
          continue;
        }

        const existing = tokenBalances.get(parsed.mint);
        tokenBalances.set(parsed.mint, {
          amountRaw: (existing?.amountRaw ?? BigInt(0)) + parsed.amountRaw,
          decimals: existing?.decimals ?? parsed.decimals,
          mint: parsed.mint,
        });
      }

      const nativeMetadata = await resolveTokenMetadata(
        NATIVE_SOL_MINT,
        NATIVE_SOL_DECIMALS
      );
      const assets: AssetBalance[] = [
        createNativeSolBalance(
          lamports,
          nativeMetadata.descriptor,
          nativeMetadata.priceUsd
        ),
      ];

      const tokenAssets = await Promise.all(
        [...tokenBalances.values()].map(async (tokenBalance) => {
          const metadata = await resolveTokenMetadata(
            tokenBalance.mint,
            tokenBalance.decimals
          );
          const balance =
            Number(tokenBalance.amountRaw) /
            Math.pow(10, metadata.descriptor.decimals);

          return {
            asset: metadata.descriptor,
            balance,
            priceUsd: metadata.priceUsd,
            valueUsd:
              metadata.priceUsd === null ? null : balance * metadata.priceUsd,
          } satisfies AssetBalance;
        })
      );

      assets.push(...tokenAssets);

      return {
        owner: owner.toBase58(),
        nativeBalanceLamports: lamports,
        assets,
        fetchedAt: Date.now(),
      };
    },
    resolveAssets: async (mints) => {
      // Used by the wallet-data client to render shielded-only mints (no
      // public ATA on chain). Without this, the placeholder descriptor
      // collapses decimals to 0 and the row shows raw u64 lamports.
      const uniqueMints = [...new Set(mints)];
      const connection = getConnection();
      const results = await Promise.all(
        uniqueMints.map(async (mint) => {
          try {
            const mintPubkey = new PublicKey(mint);
            // Read decimals from chain for both Token and Token-2022 mints.
            const accountInfo = await connection.getAccountInfo(
              mintPubkey,
              args.commitment
            );
            if (!accountInfo) return null;
            const isToken =
              accountInfo.owner.equals(TOKEN_PROGRAM_ID) ||
              accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
            if (!isToken) return null;
            // SPL mint layout: decimals at byte offset 44 (1 byte).
            const decimals = accountInfo.data[44] ?? 0;
            const metadata = await resolveTokenMetadata(mint, decimals);
            return {
              descriptor: {
                ...metadata.descriptor,
                // On-chain decimals are authoritative; never let metadata override.
                decimals,
              },
              priceUsd: metadata.priceUsd,
            } satisfies ResolvedAssetEntry;
          } catch {
            return null;
          }
        })
      );
      return results.filter(
        (entry): entry is ResolvedAssetEntry => entry !== null
      );
    },
    subscribeAssetChanges: async (owner, onChange, options = {}) => {
      const connection = getWebsocketConnection();
      const debounceMs = options.debounceMs ?? DEFAULT_SUBSCRIPTION_DEBOUNCE_MS;
      const includeNative = options.includeNative ?? true;
      const subCommitment = options.commitment ?? "confirmed";

      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const emit = () => {
        if (closed) {
          return;
        }

        if (debounceMs <= 0) {
          onChange();
          return;
        }

        if (timer) {
          clearTimeout(timer);
        }

        timer = setTimeout(() => {
          timer = null;
          if (!closed) {
            onChange();
          }
        }, debounceMs);
      };

      const ownerFilter: GetProgramAccountsFilter = {
        memcmp: {
          offset: 32,
          bytes: owner.toBase58(),
        },
      };

      const tokenSubId = await connection.onProgramAccountChange(
        TOKEN_PROGRAM_ID,
        emit,
        subCommitment,
        [{ dataSize: 165 }, ownerFilter]
      );
      const token2022SubId = await connection.onProgramAccountChange(
        TOKEN_2022_PROGRAM_ID,
        emit,
        subCommitment,
        [ownerFilter]
      );
      // Native SOL transfers change the owner's lamports directly — they
      // don't touch the Associated Token Program — so we listen on the
      // owner pubkey itself. Without this, sending SOL from another wallet
      // (e.g. the extension) doesn't refresh the frontend balance.
      const nativeSubId = includeNative
        ? await connection.onAccountChange(owner, emit, subCommitment)
        : null;

      return async () => {
        closed = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        await Promise.all([
          connection.removeProgramAccountChangeListener(tokenSubId),
          connection.removeProgramAccountChangeListener(token2022SubId),
          nativeSubId === null
            ? Promise.resolve()
            : connection.removeAccountChangeListener(nativeSubId),
        ]);
      };
    },
  };
}
