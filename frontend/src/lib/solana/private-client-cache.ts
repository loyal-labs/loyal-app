"use client";

import {
  LoyalPrivateTransactionsClient,
  type WalletLike,
} from "@loyal-labs/private-transactions";
import { getPerEndpoints, type SolanaEnv } from "@loyal-labs/solana-rpc";
import {
  getAuthToken,
  verifyTeeIntegrity,
} from "@magicblock-labs/ephemeral-rollups-sdk";

import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";

const AUTH_TOKEN_REFRESH_BUFFER_MS = 60_000;
const PRIVATE_AUTH_TOKEN_STORAGE_KEY_PREFIX = "private_auth_token_v1";

export type FrontendPrivateClientSigner = WalletLike & {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
};

type StoredPrivateAuthToken = {
  token: string;
  expiresAt: number;
  expiresInMs: number;
  endpoint: string;
};

type CachedPrivateClientEntry = {
  client: LoyalPrivateTransactionsClient;
  authToken: StoredPrivateAuthToken | null;
};

const cachedPrivateClients = new Map<string, CachedPrivateClientEntry>();
const cachedPrivateClientPromises = new Map<
  string,
  Promise<LoyalPrivateTransactionsClient>
>();

function getPrivateAuthTokenStorageKey(
  publicKey: string,
  solanaEnv: SolanaEnv
): string {
  return `${PRIVATE_AUTH_TOKEN_STORAGE_KEY_PREFIX}_${publicKey}_${solanaEnv}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseStoredPrivateAuthToken(
  value: string
): StoredPrivateAuthToken | null {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;

    const { token, expiresAt, expiresInMs, endpoint } = parsed as {
      token?: unknown;
      expiresAt?: unknown;
      expiresInMs?: unknown;
      endpoint?: unknown;
    };

    if (typeof token !== "string" || !token) return null;
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
      return null;
    }
    if (typeof expiresInMs !== "number" || !Number.isFinite(expiresInMs)) {
      return null;
    }
    if (typeof endpoint !== "string" || !endpoint) return null;

    return { token, expiresAt, expiresInMs, endpoint };
  } catch (error) {
    console.error("Failed to parse cached private auth token", error);
    return null;
  }
}

function isAuthTokenFresh(
  token: StoredPrivateAuthToken,
  solanaEnv: SolanaEnv
): boolean {
  const { perRpcEndpoint } = getPerEndpoints(solanaEnv);
  return (
    token.endpoint === perRpcEndpoint &&
    token.expiresAt > Date.now() + AUTH_TOKEN_REFRESH_BUFFER_MS
  );
}

function getCachedAuthToken(
  publicKey: string,
  solanaEnv: SolanaEnv
): StoredPrivateAuthToken | null {
  const storage = getStorage();
  if (!storage) return null;

  let cachedValue: string | null;
  try {
    cachedValue = storage.getItem(
      getPrivateAuthTokenStorageKey(publicKey, solanaEnv)
    );
  } catch (error) {
    console.error("Failed to read cached private auth token", error);
    return null;
  }
  if (!cachedValue) return null;

  const parsedToken = parseStoredPrivateAuthToken(cachedValue);
  if (!parsedToken) {
    deleteCachedAuthToken(publicKey, solanaEnv);
    return null;
  }
  if (!isAuthTokenFresh(parsedToken, solanaEnv)) {
    deleteCachedAuthToken(publicKey, solanaEnv);
    return null;
  }

  return parsedToken;
}

function cacheAuthToken(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
  token: string;
  expiresAt: number;
  expiresInMs: number;
}): void {
  const storage = getStorage();
  if (!storage) return;

  const { perRpcEndpoint } = getPerEndpoints(args.solanaEnv);
  try {
    storage.setItem(
      getPrivateAuthTokenStorageKey(args.publicKey, args.solanaEnv),
      JSON.stringify({
        token: args.token,
        expiresAt: args.expiresAt,
        expiresInMs: args.expiresInMs,
        endpoint: perRpcEndpoint,
      })
    );
  } catch (error) {
    console.error("Failed to persist private auth token", error);
  }
}

function deleteCachedAuthToken(publicKey: string, solanaEnv: SolanaEnv): void {
  try {
    getStorage()?.removeItem(
      getPrivateAuthTokenStorageKey(publicKey, solanaEnv)
    );
  } catch (error) {
    console.error("Failed to delete cached private auth token", error);
  }
}

function verifyTeeIntegrityAsync(solanaEnv: SolanaEnv): void {
  const { perRpcEndpoint } = getPerEndpoints(solanaEnv);
  window.setTimeout(() => {
    void verifyTeeIntegrity(perRpcEndpoint).catch((error) => {
      console.error("TEE RPC integrity verification error", error);
    });
  }, 10_000);
}

async function fetchAndCacheAuthToken(
  signer: FrontendPrivateClientSigner,
  solanaEnv: SolanaEnv
): Promise<StoredPrivateAuthToken | null> {
  const { perRpcEndpoint } = getPerEndpoints(solanaEnv);
  if (!perRpcEndpoint.includes("tee")) return null;

  try {
    verifyTeeIntegrityAsync(solanaEnv);

    const authToken = await getAuthToken(
      perRpcEndpoint,
      signer.publicKey,
      signer.signMessage
    );
    const expiresInMs = Math.max(0, authToken.expiresAt - Date.now());
    const storedAuthToken = {
      ...authToken,
      expiresInMs,
      endpoint: perRpcEndpoint,
    };
    cacheAuthToken({
      publicKey: signer.publicKey.toBase58(),
      solanaEnv,
      ...storedAuthToken,
    });
    return storedAuthToken;
  } catch (error) {
    console.error("Failed to fetch private auth token", error);
    return null;
  }
}

function getClientCacheKey(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
  rpcEndpoint: string;
  websocketEndpoint?: string;
  perRpcEndpoint: string;
  perWsEndpoint?: string;
}): string {
  return [
    args.publicKey,
    args.solanaEnv,
    args.rpcEndpoint,
    args.websocketEndpoint ?? "",
    args.perRpcEndpoint,
    args.perWsEndpoint ?? "",
  ].join("|");
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    const causeText = error.cause ? ` ${getErrorText(error.cause)}` : "";
    return `${error.name} ${error.message}${causeText}`;
  }

  if (typeof error === "string") return error;

  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
}

export function isFrontendPrivateClientAuthError(error: unknown): boolean {
  return /401|unauthorized|forbidden/i.test(getErrorText(error));
}

function isClientCacheEntryFresh(
  entry: CachedPrivateClientEntry,
  solanaEnv: SolanaEnv
): boolean {
  if (!entry.authToken) return true;
  return isAuthTokenFresh(entry.authToken, solanaEnv);
}

export function hasReusableFrontendPrivateClientAuth(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
}): boolean {
  const { perRpcEndpoint } = getPerEndpoints(args.solanaEnv);

  for (const [key, entry] of cachedPrivateClients) {
    if (
      key.startsWith(`${args.publicKey}|${args.solanaEnv}|`) &&
      isClientCacheEntryFresh(entry, args.solanaEnv)
    ) {
      return true;
    }
  }

  if (!perRpcEndpoint.includes("tee")) {
    return true;
  }

  return getCachedAuthToken(args.publicKey, args.solanaEnv) !== null;
}

export function invalidateFrontendPrivateClient(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
  removeAuthToken?: boolean;
}): void {
  for (const key of cachedPrivateClients.keys()) {
    if (key.startsWith(`${args.publicKey}|${args.solanaEnv}|`)) {
      cachedPrivateClients.delete(key);
    }
  }

  for (const key of cachedPrivateClientPromises.keys()) {
    if (key.startsWith(`${args.publicKey}|${args.solanaEnv}|`)) {
      cachedPrivateClientPromises.delete(key);
    }
  }

  if (args.removeAuthToken) {
    deleteCachedAuthToken(args.publicKey, args.solanaEnv);
  }
}

export function invalidateFrontendPrivateClientForError(args: {
  publicKey: string;
  solanaEnv: SolanaEnv;
  error: unknown;
}): boolean {
  if (!isFrontendPrivateClientAuthError(args.error)) return false;

  invalidateFrontendPrivateClient({
    publicKey: args.publicKey,
    solanaEnv: args.solanaEnv,
    removeAuthToken: true,
  });
  return true;
}

export function clearFrontendPrivateClientMemoryCache(): void {
  cachedPrivateClients.clear();
  cachedPrivateClientPromises.clear();
}

export async function getFrontendPrivateClient(args: {
  signer: FrontendPrivateClientSigner;
  solanaEnv: SolanaEnv;
  forceRecreate?: boolean;
}): Promise<LoyalPrivateTransactionsClient> {
  const { rpcEndpoint, websocketEndpoint } = getFrontendSolanaEndpoints(
    args.solanaEnv
  );
  const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(args.solanaEnv);
  const publicKey = args.signer.publicKey.toBase58();
  const cacheKey = getClientCacheKey({
    publicKey,
    solanaEnv: args.solanaEnv,
    rpcEndpoint,
    websocketEndpoint,
    perRpcEndpoint,
    perWsEndpoint,
  });

  if (args.forceRecreate) {
    invalidateFrontendPrivateClient({
      publicKey,
      solanaEnv: args.solanaEnv,
      removeAuthToken: true,
    });
  }

  const cachedPrivateClient = cachedPrivateClients.get(cacheKey);
  if (cachedPrivateClient) {
    if (isClientCacheEntryFresh(cachedPrivateClient, args.solanaEnv)) {
      return cachedPrivateClient.client;
    }

    invalidateFrontendPrivateClient({
      publicKey,
      solanaEnv: args.solanaEnv,
      removeAuthToken: true,
    });
  }

  const pendingClient = cachedPrivateClientPromises.get(cacheKey);
  if (pendingClient) return pendingClient;

  const clientPromise = (async () => {
    const cachedAuthToken = getCachedAuthToken(publicKey, args.solanaEnv);
    const authToken =
      cachedAuthToken ??
      (await fetchAndCacheAuthToken(args.signer, args.solanaEnv));
    if (perRpcEndpoint.includes("tee") && !authToken) {
      throw new Error("Failed to authorize private transactions");
    }

    const privateClient = await LoyalPrivateTransactionsClient.fromConfig({
      signer: args.signer,
      baseRpcEndpoint: rpcEndpoint,
      baseWsEndpoint: websocketEndpoint,
      ephemeralRpcEndpoint: perRpcEndpoint,
      ephemeralWsEndpoint: perWsEndpoint,
      authToken: authToken ?? undefined,
    });

    const ephemeralConn = privateClient.ephemeralProgram.provider
      .connection as unknown as {
      _wsOnError?: (err: Error) => void;
    };
    const prevEphemeralOnError = ephemeralConn._wsOnError?.bind(
      privateClient.ephemeralProgram.provider.connection
    );
    let invalidationScheduled = false;
    ephemeralConn._wsOnError = (err: Error) => {
      prevEphemeralOnError?.(err);
      if (!invalidationScheduled && isFrontendPrivateClientAuthError(err)) {
        invalidationScheduled = true;
        invalidateFrontendPrivateClient({
          publicKey,
          solanaEnv: args.solanaEnv,
          removeAuthToken: true,
        });
      }
    };

    cachedPrivateClients.set(cacheKey, {
      client: privateClient,
      authToken,
    });
    cachedPrivateClientPromises.delete(cacheKey);
    return privateClient;
  })().catch((error) => {
    cachedPrivateClientPromises.delete(cacheKey);
    if (isFrontendPrivateClientAuthError(error)) {
      invalidateFrontendPrivateClient({
        publicKey,
        solanaEnv: args.solanaEnv,
        removeAuthToken: true,
      });
    }
    throw error;
  });

  cachedPrivateClientPromises.set(cacheKey, clientPromise);
  return clientPromise;
}
