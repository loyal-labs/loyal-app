import {
  type ShieldFlowExecutionResult,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@loyal-labs/private-transactions";
import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";
import { getPerEndpoints } from "@loyal-labs/solana-rpc";
import { TOKEN_DECIMALS, TOKEN_MINTS } from "@loyal-labs/wallet-core/constants";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { trackWalletShieldCompleted } from "@/lib/core/analytics";
import {
  recordKaminoUsdcShield,
  recordKaminoUsdcUnshield,
  resolveTrackedKaminoUsdcMint,
} from "@/lib/kamino/kamino-usdc-position";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";

function cleanSolanaErrorMessage(message: string): string {
  const logsIndex = message.indexOf("Logs:");
  if (logsIndex !== -1) {
    return message.slice(0, logsIndex).trim();
  }
  return message;
}

function getLastSignature(
  result: ShieldFlowExecutionResult
): string | undefined {
  return result.signatures.at(-1)?.signature;
}

async function getDepositAmount(params: {
  client: LoyalPrivateTransactionsClient;
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

export type ShieldResult = {
  signature?: string;
  success: boolean;
  error?: string;
};

export function useShield() {
  const wallet = useWallet();
  const publicEnv = usePublicEnv();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<LoyalPrivateTransactionsClient | null>(null);

  const getClient =
    useCallback(async (): Promise<LoyalPrivateTransactionsClient> => {
      if (clientRef.current) return clientRef.current;

      if (
        !wallet.publicKey ||
        !wallet.signTransaction ||
        !wallet.signAllTransactions ||
        !wallet.signMessage
      ) {
        throw new Error(
          "Wallet must support signTransaction, signAllTransactions, and signMessage"
        );
      }

      const { rpcEndpoint, websocketEndpoint } = getFrontendSolanaEndpoints(
        publicEnv.solanaEnv
      );
      const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(
        publicEnv.solanaEnv
      );

      const signer = {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions,
        signMessage: wallet.signMessage,
      } as unknown as import("@loyal-labs/private-transactions").WalletLike;

      const client = await LoyalPrivateTransactionsClient.fromConfig({
        signer,
        baseRpcEndpoint: rpcEndpoint,
        baseWsEndpoint: websocketEndpoint,
        ephemeralRpcEndpoint: perRpcEndpoint,
        ephemeralWsEndpoint: perWsEndpoint,
      });

      clientRef.current = client;
      return client;
    }, [
      wallet.publicKey,
      wallet.signTransaction,
      wallet.signAllTransactions,
      wallet.signMessage,
      publicEnv.solanaEnv,
    ]);

  // Reset client when wallet changes
  const prevPubkey = useRef(wallet.publicKey?.toBase58());
  if (wallet.publicKey?.toBase58() !== prevPubkey.current) {
    clientRef.current = null;
    prevPubkey.current = wallet.publicKey?.toBase58();
  }

  const executeShield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      tokenMint?: string;
      successTrackingProperties?: AnalyticsProperties;
    }): Promise<ShieldResult> => {
      if (!(wallet.connected && wallet.publicKey && wallet.signTransaction)) {
        return {
          success: false,
          error: "Wallet not connected or missing signing capability",
        };
      }

      setLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const resolvedMint =
          params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals = TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = wallet.publicKey;
        const trackedKaminoMint = resolveTrackedKaminoUsdcMint(
          publicEnv.solanaEnv
        );
        const isTrackedKaminoToken = trackedKaminoMint === tokenMint.toBase58();
        const collateralSharesBefore = isTrackedKaminoToken
          ? await getDepositAmount({ client, tokenMint, user })
          : BigInt(0);

        const plan = await client.buildShieldTokensTransactionPlan({
          tokenMint,
          amount: BigInt(rawAmount),
          user,
          payer: user,
        });
        const executionResult = await client.executeShieldTokensTransactionPlan(
          {
            plan,
          }
        );

        // Persist Kamino principal basis for tracked USDC so the "earned"
        // split on the portfolio can be computed without manual seeding.
        if (isTrackedKaminoToken) {
          const collateralSharesAfter = await getDepositAmount({
            client,
            tokenMint,
            user,
          });
          const addedCollateralSharesAmountRaw =
            collateralSharesAfter - collateralSharesBefore;

          if (addedCollateralSharesAmountRaw > BigInt(0)) {
            try {
              recordKaminoUsdcShield({
                publicKey: user.toBase58(),
                solanaEnv: publicEnv.solanaEnv,
                addedPrincipalLiquidityAmountRaw: BigInt(rawAmount),
                addedCollateralSharesAmountRaw,
              });
            } catch (persistError) {
              console.warn(
                "Failed to persist Kamino USDC shield basis",
                persistError
              );
            }
          }
        }

        setLoading(false);
        if (params.successTrackingProperties) {
          trackWalletShieldCompleted(
            publicEnv,
            params.successTrackingProperties
          );
        }
        return { success: true, signature: getLastSignature(executionResult) };
      } catch (err) {
        let errorMessage = "Shield failed";
        if (err instanceof Error) {
          errorMessage = err.message.includes("User rejected")
            ? "Transaction was rejected in your wallet."
            : cleanSolanaErrorMessage(err.message);
        }
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [
      wallet.connected,
      wallet.publicKey,
      wallet.signTransaction,
      getClient,
      publicEnv,
    ]
  );

  const executeUnshield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      tokenMint?: string;
    }): Promise<ShieldResult> => {
      if (!(wallet.connected && wallet.publicKey && wallet.signTransaction)) {
        return {
          success: false,
          error: "Wallet not connected or missing signing capability",
        };
      }

      setLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const resolvedMint =
          params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals = TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = wallet.publicKey;
        // For tracked Kamino positions, the vault stores collateral shares and
        // the SDK plan amount for unshield is denominated in shares. The user
        // supplies a liquidity amount (USDC), so convert via the Kamino reserve
        // exchange rate and clamp to the current shares balance.
        const trackedKaminoMint = resolveTrackedKaminoUsdcMint(
          publicEnv.solanaEnv
        );
        const isTrackedKaminoToken = trackedKaminoMint === tokenMint.toBase58();

        const collateralSharesBefore = isTrackedKaminoToken
          ? await getDepositAmount({ client, tokenMint, user })
          : BigInt(0);

        let planAmount: bigint = BigInt(rawAmount);
        if (isTrackedKaminoToken) {
          const quotedShares =
            await client.getKaminoCollateralSharesForLiquidityAmount({
              tokenMint,
              liquidityAmountRaw: BigInt(rawAmount),
            });
          if (quotedShares === null) {
            throw new Error(
              "Could not quote the current USDC shielded exchange rate. Please retry."
            );
          }
          planAmount = quotedShares;

          if (
            collateralSharesBefore > BigInt(0) &&
            planAmount > collateralSharesBefore
          ) {
            planAmount = collateralSharesBefore;
          }
        }

        const plan = await client.buildUnshieldTokensTransactionPlan({
          tokenMint,
          amount: planAmount,
          user,
          payer: user,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID,
        });
        const executionResult =
          await client.executeUnshieldTokensTransactionPlan({
            plan,
          });

        if (isTrackedKaminoToken) {
          const collateralSharesAfter = await getDepositAmount({
            client,
            tokenMint,
            user,
          });
          const burnedCollateralSharesAmountRaw =
            collateralSharesBefore - collateralSharesAfter;

          if (burnedCollateralSharesAmountRaw > BigInt(0)) {
            try {
              recordKaminoUsdcUnshield({
                publicKey: user.toBase58(),
                solanaEnv: publicEnv.solanaEnv,
                burnedCollateralSharesAmountRaw,
              });
            } catch (persistError) {
              console.warn(
                "Failed to persist Kamino USDC unshield basis",
                persistError
              );
            }
          }
        }

        setLoading(false);
        return { success: true, signature: getLastSignature(executionResult) };
      } catch (err) {
        let errorMessage = "Unshield failed";
        if (err instanceof Error) {
          errorMessage = err.message.includes("User rejected")
            ? "Transaction was rejected in your wallet."
            : cleanSolanaErrorMessage(err.message);
        }
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [
      wallet.connected,
      wallet.publicKey,
      wallet.signTransaction,
      getClient,
      publicEnv,
    ]
  );

  return {
    executeShield,
    executeUnshield,
    loading,
    error,
  };
}
