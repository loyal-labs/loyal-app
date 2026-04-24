import {
  DELEGATION_PROGRAM_ID,
  findDepositPda,
  getErValidatorForSolanaEnv,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  shieldTokens,
} from "@loyal-labs/private-transactions";
import type { LoyalPrivateTransactionsClient as LoyalPrivateTransactionsClientType } from "@loyal-labs/private-transactions";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  recordKaminoUsdcShield,
  recordKaminoUsdcUnshield,
  resolveTrackedKaminoUsdcMint,
} from "@/lib/solana/deposits/kamino-usdc-position";
import {
  getConnection,
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
// Lazy-loaded alongside the SDK to avoid top-level Buffer usage
async function getWsolAdapter() {
  return await import("@/lib/solana/wsol-adapter");
}

type PerAuthToken = {
  token: string;
  expiresAt: number;
};

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

async function getSplToken() {
  return await import("@solana/spl-token");
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

export function useShield(): {
  executeShield: (params: ShieldParams) => Promise<ShieldResult>;
  executeUnshield: (params: ShieldParams) => Promise<ShieldResult>;
  loading: boolean;
  error: string | null;
} {
  const { signer } = useWallet();
  const signApproval = useSignApproval();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<LoyalPrivateTransactionsClientType | null>(null);
  const perAuthTokenRef = useRef<PerAuthToken | null>(null);
  const labelsRef = useRef<ConfirmLabels | undefined>(undefined);

  const solanaEnv = getSolanaEnv();
  const connection = getConnection();

  // Stable wrapped signer: labels resolve per-op via `labelsRef`, so the
  // SDK client (built against this signer) can be cached across shield /
  // unshield calls without baking in stale titles.
  const confirmingSigner = useMemo(
    () =>
      signer
        ? withConfirmation(signer, signApproval, () => labelsRef.current)
        : null,
    [signer, signApproval],
  );

  const getPerAuthToken = useCallback(
    async (perRpcEndpoint: string): Promise<PerAuthToken> => {
      const cached = perAuthTokenRef.current;
      if (cached && cached.expiresAt > Date.now() + 60_000) {
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

      if (typeof challengeData.challenge !== "string" || !challengeData.challenge) {
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

      if (!loginResponse.ok || typeof loginData.token !== "string" || !loginData.token) {
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
      return token;
    },
    [confirmingSigner],
  );

  const getClient = useCallback(
    async (): Promise<LoyalPrivateTransactionsClientType> => {
      if (clientRef.current) return clientRef.current;

      if (!confirmingSigner) {
        throw new Error("Wallet signer is not available");
      }

      const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
      const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);
      const authToken =
        perRpcEndpoint.includes("tee")
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
    },
    [getPerAuthToken, confirmingSigner, solanaEnv],
  );

  // Reset client when wallet changes
  const prevPubkey = useRef(signer?.publicKey.toBase58());
  if (signer?.publicKey.toBase58() !== prevPubkey.current) {
    clientRef.current = null;
    perAuthTokenRef.current = null;
    prevPubkey.current = signer?.publicKey.toBase58();
  }

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
                  err,
                );
              }
            }
          }
        } catch (err) {
          console.warn(
            `[useShield] post-shield bookkeeping failed (signature=${signature})`,
            err,
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
    [signer, confirmingSigner, getClient, solanaEnv],
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
        const { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } =
          await getSplToken();
        const { closeWsolAta } = await getWsolAdapter();

        const resolvedMint =
          params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals = getShieldTokenDecimals(params);
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = signer.publicKey;
        const isNativeSol = tokenMint.equals(NATIVE_MINT);

        const userTokenAccount = getAssociatedTokenAddressSync(
          tokenMint,
          user,
          false,
          TOKEN_PROGRAM_ID,
        );

        // Undelegate if currently delegated
        const [depositPda] = findDepositPda(user, tokenMint);
        const depositInfo = await connection.getAccountInfo(depositPda);
        if (depositInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
          await client.undelegateDeposit({
            tokenMint,
            user,
            payer: user,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
          });
        }

        // For tracked Kamino USDC the deposit stores collateral shares,
        // so a user-specified USDC liquidity amount must be quoted into
        // shares. Skip the Kamino quote when the user chose MAX — we'll
        // burn the deposit directly from its on-chain amount instead.
        const trackedKaminoMint = resolveTrackedKaminoUsdcMint(solanaEnv);
        const isTrackedKaminoToken =
          trackedKaminoMint === tokenMint.toBase58();
        const wantsMax = params.isMax === true;

        const depositBeforeModify = await client.getBaseDeposit(user, tokenMint);
        const currentDepositRaw = depositBeforeModify?.amount ?? BigInt(0);

        let kaminoQuotedShares: bigint | null = null;
        if (!wantsMax && isTrackedKaminoToken) {
          kaminoQuotedShares =
            await client.getKaminoCollateralSharesForLiquidityAmount({
              tokenMint,
              liquidityAmountRaw: BigInt(rawAmount),
            });
        }

        const modifyAmount = computeUnshieldModifyAmount({
          isMax: wantsMax,
          requestedRawAmount: BigInt(rawAmount),
          currentDepositRaw,
          isTrackedKaminoToken,
          kaminoQuotedShares,
        });

        // Move tokens out of deposit vault (decrease balance)
        const { deposit: depositAfterModify } = await client.modifyBalance({
          tokenMint,
          amount: modifyAmount,
          increase: false,
          user,
          payer: user,
        });

        if (isTrackedKaminoToken) {
          const burnedCollateralSharesAmountRaw =
            currentDepositRaw - depositAfterModify.amount;
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
                err,
              );
            }
          }
        }

        // Unwrap wSOL if native SOL. Best-effort: the deposit already
        // drained via modifyBalance above, so a failure here must not be
        // surfaced as "Unshield Failed" (ASK-1134). If it fails, the user
        // may have residual WSOL in their ATA that they can unwrap later.
        if (isNativeSol) {
          // Cleanup: skip the preview sheet. Users already approved the
          // unshield intent; closing the wrapped-SOL account is a
          // housekeeping step that should feel like part of the same op.
          try {
            await closeWsolAta({
              connection,
              signer,
              wsolAta: userTokenAccount,
            });
          } catch (err) {
            console.warn(
              "[useShield] closeWsolAta failed after unshield — WSOL may remain in the user's ATA",
              err,
            );
          }
        }

        // Re-delegate deposit. Best-effort: may already be delegated or
        // the deposit may be empty after a full unshield.
        try {
          const validator = getErValidatorForSolanaEnv(solanaEnv);
          await client.delegateDeposit({
            tokenMint,
            user,
            payer: user,
            validator,
          });
        } catch (err) {
          console.warn(
            "[useShield] re-delegateDeposit failed (often benign: already delegated or empty deposit)",
            err,
          );
        }

        setLoading(false);
        labelsRef.current = undefined;
        return { success: true };
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
    [signer, confirmingSigner, connection, getClient, solanaEnv],
  );

  return { executeShield, executeUnshield, loading, error };
}
