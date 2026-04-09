import {
  DELEGATION_PROGRAM_ID,
  findDepositPda,
  getErValidatorForSolanaEnv,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@loyal-labs/private-transactions";
import type { LoyalPrivateTransactionsClient as LoyalPrivateTransactionsClientType } from "@loyal-labs/private-transactions";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useRef, useState } from "react";

import {
  getConnection,
  getEndpoints,
  getPerEndpoints,
  getSolanaEnv,
} from "@/lib/solana/rpc/connection";
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

const TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
  BONK: 5,
};

export type ShieldResult = {
  signature?: string;
  success: boolean;
  error?: string;
};

async function waitForAccount(
  connection: Connection,
  pda: PublicKey,
  maxAttempts = 30,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const info = await connection.getAccountInfo(pda);
    if (info) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function useShield(): {
  executeShield: (params: {
    tokenSymbol: string;
    amount: number;
    tokenMint?: string;
  }) => Promise<ShieldResult>;
  executeUnshield: (params: {
    tokenSymbol: string;
    amount: number;
    tokenMint?: string;
  }) => Promise<ShieldResult>;
  loading: boolean;
  error: string | null;
} {
  const { signer } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<LoyalPrivateTransactionsClientType | null>(null);
  const perAuthTokenRef = useRef<PerAuthToken | null>(null);

  const solanaEnv = getSolanaEnv();
  const connection = getConnection();

  const getPerAuthToken = useCallback(
    async (perRpcEndpoint: string): Promise<PerAuthToken> => {
      const cached = perAuthTokenRef.current;
      if (cached && cached.expiresAt > Date.now() + 60_000) {
        return cached;
      }

      if (!signer) {
        throw new Error("Wallet signer is not available");
      }

      const walletAddress = signer.publicKey.toBase58();
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
      const signature = await signer.signMessage(challengeBytes);
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
    [signer],
  );

  const getClient = useCallback(
    async (): Promise<LoyalPrivateTransactionsClientType> => {
      if (clientRef.current) return clientRef.current;

      if (!signer) {
        throw new Error("Wallet signer is not available");
      }

      const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
      const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);
      const authToken =
        perRpcEndpoint.includes("tee")
          ? await getPerAuthToken(perRpcEndpoint)
          : undefined;

      const client = await LoyalPrivateTransactionsClient.fromConfig({
        signer,
        baseRpcEndpoint: rpcEndpoint,
        baseWsEndpoint: websocketEndpoint,
        ephemeralRpcEndpoint: perRpcEndpoint,
        ephemeralWsEndpoint: perWsEndpoint,
        authToken,
      });

      clientRef.current = client;
      return client;
    },
    [getPerAuthToken, signer, solanaEnv],
  );

  // Reset client when wallet changes
  const prevPubkey = useRef(signer?.publicKey.toBase58());
  if (signer?.publicKey.toBase58() !== prevPubkey.current) {
    clientRef.current = null;
    perAuthTokenRef.current = null;
    prevPubkey.current = signer?.publicKey.toBase58();
  }

  const executeShield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      tokenMint?: string;
    }): Promise<ShieldResult> => {
      if (!signer) {
        return {
          success: false,
          error: "Wallet not connected",
        };
      }

      setLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } =
          await getSplToken();
        const { wrapSolToWSol, closeWsolAta } = await getWsolAdapter();

        const resolvedMint =
          params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals =
          TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = signer.publicKey;
        const validator = getErValidatorForSolanaEnv(solanaEnv);
        const isNativeSol = tokenMint.equals(NATIVE_MINT);

        // Init deposit if needed
        const baseDeposit = await client.getBaseDeposit(user, tokenMint);
        if (!baseDeposit) {
          await client.initializeDeposit({
            tokenMint,
            user,
            payer: user,
          });
          const [depositPda] = findDepositPda(user, tokenMint);
          await waitForAccount(connection, depositPda);
        }

        // Wrap SOL -> wSOL if native
        let createdAta = false;
        if (isNativeSol) {
          const result = await wrapSolToWSol({
            connection,
            signer,
            lamports: rawAmount,
          });
          createdAta = result.createdAta;
        }

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

        // Move tokens into deposit vault (increase balance)
        await client.modifyBalance({
          tokenMint,
          amount: rawAmount,
          increase: true,
          user,
          payer: user,
          userTokenAccount,
        });

        // Close wSOL ATA if we created it
        if (isNativeSol && createdAta) {
          await closeWsolAta({
            connection,
            signer,
            wsolAta: userTokenAccount,
          });
        }

        // Create permission (may already exist)
        try {
          await client.createPermission({
            tokenMint,
            user,
            payer: user,
          });
        } catch {
          // Permission may already exist
        }

        // Delegate deposit
        try {
          await client.delegateDeposit({
            tokenMint,
            user,
            payer: user,
            validator,
          });
        } catch {
          // May already be delegated
        }

        setLoading(false);
        return { success: true };
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
        return { success: false, error: errorMessage };
      }
    },
    [signer, connection, getClient, solanaEnv],
  );

  const executeUnshield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      tokenMint?: string;
    }): Promise<ShieldResult> => {
      if (!signer) {
        return {
          success: false,
          error: "Wallet not connected",
        };
      }

      setLoading(true);
      setError(null);

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
        const decimals =
          TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
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

        // Move tokens out of deposit vault (decrease balance)
        await client.modifyBalance({
          tokenMint,
          amount: rawAmount,
          increase: false,
          user,
          payer: user,
          userTokenAccount,
        });

        // Unwrap wSOL if native SOL
        if (isNativeSol) {
          await closeWsolAta({
            connection,
            signer,
            wsolAta: userTokenAccount,
          });
        }

        // Re-delegate deposit
        try {
          const validator = getErValidatorForSolanaEnv(solanaEnv);
          await client.delegateDeposit({
            tokenMint,
            user,
            payer: user,
            validator,
          });
        } catch {
          // May already be delegated or deposit empty
        }

        setLoading(false);
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
        return { success: false, error: errorMessage };
      }
    },
    [signer, connection, getClient, solanaEnv],
  );

  return { executeShield, executeUnshield, loading, error };
}
