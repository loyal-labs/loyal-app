import {
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  type LoyalPrivateTransactionsClient as LoyalPrivateTransactionsClientType,
  type ShieldFlowExecutionResult,
  shieldTokens,
} from "@loyal-labs/private-transactions";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  recordKaminoUsdcShield,
  recordKaminoUsdcUnshield,
  resolveTrackedKaminoUsdcMint,
} from "@/lib/solana/deposits/kamino-usdc-position";
import { mmkv } from "@/lib/storage";
import {
  getEndpoints,
  getPerEndpoints,
  getSolanaEnv,
} from "@/lib/solana/rpc/connection";
import {
  computeUnshieldModifyAmount,
  getShieldTokenDecimals,
} from "@/lib/solana/shielding";
import {
  useSignApproval,
  withConfirmation,
  type ConfirmLabels,
} from "@/lib/wallet/sign-approval";
import { useWallet } from "@/lib/wallet/wallet-provider";

type PerAuthToken = {
  token: string;
  expiresAt: number;
};

// PER auth is a 30-day token from a signed challenge. Persist it so the
// "Sign in to the ephemeral rollup" prompt only happens once per month
// per wallet, not on every cold app launch (or — critically — every
// time the shield sheet wants to preview a network fee).
const PER_AUTH_TOKEN_STORAGE_PREFIX = "per_auth_token_";
const PER_AUTH_REFRESH_WINDOW_MS = 60_000;

function perAuthStorageKey(walletAddress: string): string {
  return `${PER_AUTH_TOKEN_STORAGE_PREFIX}${walletAddress}`;
}

function loadCachedPerAuthToken(walletAddress: string): PerAuthToken | null {
  const raw = mmkv.getString(perAuthStorageKey(walletAddress));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PerAuthToken>;
    if (
      typeof parsed.token !== "string" ||
      !parsed.token ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    if (parsed.expiresAt <= Date.now() + PER_AUTH_REFRESH_WINDOW_MS) {
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

function persistPerAuthToken(walletAddress: string, token: PerAuthToken): void {
  mmkv.setString(perAuthStorageKey(walletAddress), JSON.stringify(token));
}

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const base = 58n;
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % base);
    encoded = alphabet[remainder] + encoded;
    value /= base;
  }

  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }

  return encoded || "1";
}

function getLastSignature(
  result: ShieldFlowExecutionResult
): string | undefined {
  return result.signatures.at(-1)?.signature;
}

async function getDepositAmount(params: {
  client: LoyalPrivateTransactionsClientType;
  tokenMint: PublicKey;
  user: PublicKey;
}): Promise<bigint> {
  const { client, tokenMint, user } = params;
  const [ephemeralDeposit, baseDeposit] = await Promise.all([
    client.getEphemeralDeposit(user, tokenMint).catch(() => null),
    client.getBaseDeposit(user, tokenMint).catch(() => null),
  ]);

  return ephemeralDeposit?.amount ?? baseDeposit?.amount ?? BigInt(0);
}

const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

export type ShieldResult = {
  signature?: string;
  success: boolean;
  error?: string;
};

type ShieldParams = {
  tokenSymbol: string;
  amount: number;
  tokenMint?: string;
  tokenDecimals?: number;
  // Set when the user tapped the MAX button. On unshield this drains
  // the on-chain deposit directly, bypassing float→raw→share rounding
  // that otherwise leaves dust behind (ASK-1135).
  isMax?: boolean;
};

export type ShieldDirectionKind = "shield" | "unshield";

export type ShieldFeeEstimate = {
  totalLamports: number;
  feeLamports: number;
  rentLamports: number;
};

export type EstimateShieldFeeParams = {
  direction: ShieldDirectionKind;
  tokenSymbol: string;
  amount: number;
  tokenMint?: string;
  tokenDecimals?: number;
  isMax?: boolean;
};

export function useShield(): {
  executeShield: (params: ShieldParams) => Promise<ShieldResult>;
  executeUnshield: (params: ShieldParams) => Promise<ShieldResult>;
  estimateFee: (
    params: EstimateShieldFeeParams
  ) => Promise<ShieldFeeEstimate | null>;
  loading: boolean;
  error: string | null;
} {
  const { signer } = useWallet();
  const signApproval = useSignApproval();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<LoyalPrivateTransactionsClientType | null>(null);
  // Separate client used only for fee previews. Built with a sentinel
  // auth token so fromConfig skips the "Sign in to the ephemeral
  // rollup" challenge. Never used to send transactions (writes require
  // real auth) — only for buildShield/UnshieldTokensTransactionPlan +
  // estimateShield/UnshieldTokensFee, which are pure reads.
  const estimateClientRef = useRef<LoyalPrivateTransactionsClientType | null>(
    null
  );
  const perAuthTokenRef = useRef<PerAuthToken | null>(null);
  const labelsRef = useRef<ConfirmLabels | undefined>(undefined);

  const solanaEnv = getSolanaEnv();
  // Stable wrapped signer: labels resolve per-op via `labelsRef`, so the
  // SDK client (built against this signer) can be cached across shield /
  // unshield calls without baking in stale titles.
  const confirmingSigner = useMemo(
    () =>
      signer
        ? withConfirmation(signer, signApproval, () => labelsRef.current)
        : null,
    [signer, signApproval]
  );

  // Rehydrate the in-memory ref from MMKV on mount / signer change so
  // getClient() can skip the signMessage challenge when a valid token
  // is already persisted. Running this inside render (guarded by a
  // pubkey mismatch below) keeps it synchronous — the auth-token cache
  // has to be ready before the first estimate or shield attempt.
  const prevPubkey = useRef<string | undefined>(undefined);
  const currentPubkey = signer?.publicKey.toBase58();
  if (currentPubkey !== prevPubkey.current) {
    clientRef.current = null;
    estimateClientRef.current = null;
    perAuthTokenRef.current = currentPubkey
      ? loadCachedPerAuthToken(currentPubkey)
      : null;
    prevPubkey.current = currentPubkey;
  }

  const getPerAuthToken = useCallback(
    async (perRpcEndpoint: string): Promise<PerAuthToken> => {
      const cached = perAuthTokenRef.current;
      if (
        cached &&
        cached.expiresAt > Date.now() + PER_AUTH_REFRESH_WINDOW_MS
      ) {
        return cached;
      }

      if (!confirmingSigner) {
        throw new Error("Wallet signer is not available");
      }

      const walletAddress = confirmingSigner.publicKey.toBase58();
      const challengeUrl = `${perRpcEndpoint}/auth/challenge?pubkey=${walletAddress}`;
      const challengeResponse = await fetch(challengeUrl);
      const challengeData = (await challengeResponse.json()) as {
        challenge?: unknown;
        error?: unknown;
      };

      if (!challengeResponse.ok) {
        const reason =
          typeof challengeData.error === "string" && challengeData.error
            ? challengeData.error
            : `status ${challengeResponse.status}`;
        throw new Error(`PER auth challenge failed: ${reason}`);
      }

      if (
        typeof challengeData.challenge !== "string" ||
        !challengeData.challenge
      ) {
        throw new Error("PER auth challenge is missing");
      }

      const challengeBytes = new TextEncoder().encode(challengeData.challenge);
      const previousLabels = labelsRef.current;
      labelsRef.current = {
        title: "Verify private transactions",
        subtitle: "Sign in to the ephemeral rollup",
      };
      let signature: Uint8Array;
      try {
        signature = await confirmingSigner.signMessage(challengeBytes);
      } finally {
        labelsRef.current = previousLabels;
      }
      const signatureBase58 = encodeBase58(signature);

      const loginResponse = await fetch(`${perRpcEndpoint}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pubkey: walletAddress,
          challenge: challengeData.challenge,
          signature: signatureBase58,
        }),
      });
      const loginData = (await loginResponse.json()) as {
        token?: unknown;
        expiresAt?: unknown;
        error?: unknown;
      };

      if (
        !loginResponse.ok ||
        typeof loginData.token !== "string" ||
        !loginData.token
      ) {
        const reason =
          typeof loginData.error === "string" && loginData.error
            ? loginData.error
            : `status ${loginResponse.status}`;
        throw new Error(`PER auth login failed: ${reason}`);
      }

      const expiresAt =
        typeof loginData.expiresAt === "number"
          ? loginData.expiresAt
          : Date.now() + 30 * 24 * 60 * 60 * 1000;
      const token = { token: loginData.token, expiresAt };
      perAuthTokenRef.current = token;
      persistPerAuthToken(walletAddress, token);
      return token;
    },
    [confirmingSigner]
  );

  const getClient =
    useCallback(async (): Promise<LoyalPrivateTransactionsClientType> => {
      if (clientRef.current) return clientRef.current;

      if (!confirmingSigner) {
        throw new Error("Wallet signer is not available");
      }

      const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
      const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);
      const authToken = perRpcEndpoint.includes("tee")
        ? await getPerAuthToken(perRpcEndpoint)
        : undefined;

      const client = await LoyalPrivateTransactionsClient.fromConfig({
        signer: confirmingSigner,
        baseRpcEndpoint: rpcEndpoint,
        baseWsEndpoint: websocketEndpoint,
        ephemeralRpcEndpoint: perRpcEndpoint,
        ephemeralWsEndpoint: perWsEndpoint,
        authToken,
      });

      clientRef.current = client;
      return client;
    }, [getPerAuthToken, confirmingSigner, solanaEnv]);

  const getEstimateClient =
    useCallback(async (): Promise<LoyalPrivateTransactionsClientType> => {
      // Prefer the fully-authed real client if we already have it (it
      // can estimate too, and reuses the cached auth token).
      if (clientRef.current) return clientRef.current;
      if (estimateClientRef.current) return estimateClientRef.current;

      if (!confirmingSigner) {
        throw new Error("Wallet signer is not available");
      }

      const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
      const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);

      // Pass a sentinel token when we don't already have a real one so
      // fromConfig skips the signMessage challenge. buildShield/Unshield
      // plans only read from the base connection, and fee estimates are
      // getLatestBlockhash + getFeeForMessage — both pure reads. If the
      // TEE endpoint rejects the sentinel on an ephemeral read the
      // estimate surfaces as null (hidden row), never as a popup.
      const needsPerAuth = perRpcEndpoint.includes("tee");
      const realAuth = needsPerAuth ? perAuthTokenRef.current : null;
      const validRealAuth =
        realAuth && realAuth.expiresAt > Date.now() + PER_AUTH_REFRESH_WINDOW_MS
          ? realAuth
          : null;
      const authToken =
        validRealAuth ??
        (needsPerAuth
          ? { token: "estimate-only", expiresAt: Date.now() + 60_000 }
          : undefined);

      const client = await LoyalPrivateTransactionsClient.fromConfig({
        signer: confirmingSigner,
        baseRpcEndpoint: rpcEndpoint,
        baseWsEndpoint: websocketEndpoint,
        ephemeralRpcEndpoint: perRpcEndpoint,
        ephemeralWsEndpoint: perWsEndpoint,
        authToken,
      });

      estimateClientRef.current = client;
      return client;
    }, [confirmingSigner, solanaEnv]);

  const executeShield = useCallback(
    async (params: ShieldParams): Promise<ShieldResult> => {
      if (!signer || !confirmingSigner) {
        return {
          success: false,
          error: "Wallet not connected",
        };
      }

      setLoading(true);
      setError(null);

      labelsRef.current = {
        title: `Shield ${params.amount} ${params.tokenSymbol.toUpperCase()}`,
        subtitle: "Move to your private balance",
      };

      try {
        const client = await getClient();

        const resolvedMint =
          params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals = getShieldTokenDecimals(params);
        const rawAmount = BigInt(Math.floor(params.amount * 10 ** decimals));
        const user = signer.publicKey;

        // Snapshot the ephemeral deposit before shield so we can compute
        // how many Kamino collateral shares this shield minted (USDC only).
        // After shieldTokens the deposit is delegated to PER, so we read
        // from the ephemeral layer on both sides.
        const depositBefore =
          (await client.getEphemeralDeposit(user, tokenMint))?.amount ??
          BigInt(0);

        const signature = await shieldTokens({
          user,
          payer: user,
          tokenMint,
          amount: rawAmount,
          baseProgram: client.baseProgram,
          perProgram: client.ephemeralProgram,
        });

        // Everything past this point is post-commit bookkeeping. The
        // shield already succeeded on-chain, so any failure must be
        // logged but not surfaced as "Shield Failed" to the user
        // (ASK-1134).
        try {
          const depositAfter =
            (await client.getEphemeralDeposit(user, tokenMint))?.amount ??
            BigInt(0);

          const trackedKaminoMint = resolveTrackedKaminoUsdcMint(solanaEnv);
          if (trackedKaminoMint === tokenMint.toBase58()) {
            const addedCollateralSharesAmountRaw = depositAfter - depositBefore;
            if (addedCollateralSharesAmountRaw > BigInt(0)) {
              try {
                await recordKaminoUsdcShield({
                  publicKey: signer.publicKey.toBase58(),
                  solanaEnv,
                  addedPrincipalLiquidityAmountRaw: rawAmount,
                  addedCollateralSharesAmountRaw,
                });
              } catch (err) {
                console.warn(
                  "[useShield] failed to persist Kamino USDC shield basis",
                  err
                );
              }
            }
          }
        } catch (err) {
          console.warn(
            `[useShield] post-shield bookkeeping failed (signature=${signature})`,
            err
          );
        }

        setLoading(false);
        labelsRef.current = undefined;
        return { success: true, signature };
      } catch (err) {
        console.error("[useShield] executeShield failed", err);
        let errorMessage = "Shield failed";
        if (err instanceof Error) {
          errorMessage = err.message.includes("User rejected")
            ? "Transaction was rejected."
            : err.message;
        }
        setError(errorMessage);
        setLoading(false);
        labelsRef.current = undefined;
        return { success: false, error: errorMessage };
      }
    },
    [signer, confirmingSigner, getClient, solanaEnv]
  );

  const executeUnshield = useCallback(
    async (params: ShieldParams): Promise<ShieldResult> => {
      if (!signer || !confirmingSigner) {
        return {
          success: false,
          error: "Wallet not connected",
        };
      }

      setLoading(true);
      setError(null);

      labelsRef.current = {
        title: `Unshield ${params.amount} ${params.tokenSymbol.toUpperCase()}`,
        subtitle: "Move back to your public balance",
      };

      try {
        const client = await getClient();

        const resolvedMint =
          params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals = getShieldTokenDecimals(params);
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = signer.publicKey;

        // For tracked Kamino USDC the deposit stores collateral shares,
        // so a user-specified USDC liquidity amount must be quoted into
        // shares. Skip the Kamino quote when the user chose MAX — we'll
        // burn the deposit directly from its on-chain amount instead.
        const trackedKaminoMint = resolveTrackedKaminoUsdcMint(solanaEnv);
        const isTrackedKaminoToken = trackedKaminoMint === tokenMint.toBase58();
        const wantsMax = params.isMax === true;

        const currentDepositRaw = await getDepositAmount({
          client,
          tokenMint,
          user,
        });

        let kaminoQuotedShares: bigint | null = null;
        if (!wantsMax && isTrackedKaminoToken) {
          kaminoQuotedShares =
            await client.getKaminoCollateralSharesForLiquidityAmount({
              tokenMint,
              liquidityAmountRaw: BigInt(rawAmount),
            });
          if (kaminoQuotedShares === null) {
            throw new Error(
              "Could not quote the current USDC shielded exchange rate. Please retry."
            );
          }
        }

        const modifyAmount = computeUnshieldModifyAmount({
          isMax: wantsMax,
          requestedRawAmount: BigInt(rawAmount),
          currentDepositRaw,
          isTrackedKaminoToken,
          kaminoQuotedShares,
        });

        const plan = await client.buildUnshieldTokensTransactionPlan({
          tokenMint,
          amount: modifyAmount,
          user,
          payer: user,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID,
        });
        const executionResult =
          await client.executeUnshieldTokensTransactionPlan({ plan });

        if (isTrackedKaminoToken) {
          const depositAfterModify = await getDepositAmount({
            client,
            tokenMint,
            user,
          });
          const burnedCollateralSharesAmountRaw =
            currentDepositRaw - depositAfterModify;
          if (burnedCollateralSharesAmountRaw > BigInt(0)) {
            try {
              await recordKaminoUsdcUnshield({
                publicKey: signer.publicKey.toBase58(),
                solanaEnv,
                burnedCollateralSharesAmountRaw,
              });
            } catch (err) {
              console.warn(
                "[useShield] failed to persist Kamino USDC unshield basis",
                err
              );
            }
          }
        }

        setLoading(false);
        labelsRef.current = undefined;
        return { success: true, signature: getLastSignature(executionResult) };
      } catch (err) {
        console.error("[useShield] executeUnshield failed", err);
        let errorMessage = "Unshield failed";
        if (err instanceof Error) {
          errorMessage = err.message.includes("User rejected")
            ? "Transaction was rejected."
            : err.message;
        }
        setError(errorMessage);
        setLoading(false);
        labelsRef.current = undefined;
        return { success: false, error: errorMessage };
      }
    },
    [signer, confirmingSigner, getClient, solanaEnv]
  );

  const estimateFee = useCallback(
    async (
      params: EstimateShieldFeeParams
    ): Promise<ShieldFeeEstimate | null> => {
      if (!signer || !confirmingSigner) return null;

      const resolvedMint =
        params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
      if (!resolvedMint) return null;

      const decimals = getShieldTokenDecimals(params);
      const requestedRawAmount = BigInt(
        Math.floor(params.amount * 10 ** decimals)
      );
      if (requestedRawAmount <= BigInt(0)) return null;

      try {
        // Use the estimate-only client to avoid triggering PER auth.
        // If the user has already authed (token persisted in MMKV or
        // from a prior op this session), getEstimateClient returns the
        // real client and benefits from the real endpoint.
        const client = await getEstimateClient();
        const user = signer.publicKey;
        const tokenMint = new PublicKey(resolvedMint);
        let planAmount = requestedRawAmount;

        if (params.direction === "unshield" && params.isMax) {
          const currentDepositRaw = await getDepositAmount({
            client,
            tokenMint,
            user,
          });
          planAmount =
            currentDepositRaw > BigInt(0)
              ? currentDepositRaw
              : requestedRawAmount;
        }

        const plan =
          params.direction === "shield"
            ? await client.buildShieldTokensTransactionPlan({
                user,
                tokenMint,
                amount: requestedRawAmount,
              })
            : await client.buildUnshieldTokensTransactionPlan({
                user,
                tokenMint,
                amount: planAmount,
                magicProgram: MAGIC_PROGRAM_ID,
                magicContext: MAGIC_CONTEXT_ID,
              });

        const estimate =
          params.direction === "shield"
            ? await client.estimateShieldTokensFee({ plan })
            : await client.estimateUnshieldTokensFee({ plan });

        return {
          totalLamports: estimate.totalLamports,
          feeLamports: estimate.totalFeeLamports,
          rentLamports: estimate.totalRentLamports,
        };
      } catch (err) {
        // Fee preview is informational; don't surface as a blocker for the
        // shield/unshield flow.
        console.warn("[useShield] estimateFee failed", err);
        return null;
      }
    },
    [signer, confirmingSigner, getEstimateClient]
  );

  return { executeShield, executeUnshield, estimateFee, loading, error };
}
