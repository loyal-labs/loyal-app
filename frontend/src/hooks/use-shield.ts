import {
  type ShieldFlowExecutionResult,
  findDepositPda,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@loyal-labs/private-transactions";
import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";
import { TOKEN_DECIMALS, TOKEN_MINTS } from "@loyal-labs/wallet-core/constants";
import {
  computeUnshieldModifyAmount,
  toRoundedTokenRawAmount,
} from "@loyal-labs/wallet-core/lib";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { trackWalletShieldCompleted } from "@/lib/core/analytics";
import {
  recordKaminoUsdcShield,
  recordKaminoUsdcUnshield,
  resolveTrackedKaminoUsdcMint,
} from "@/lib/kamino/kamino-usdc-position";
import {
  getFrontendPrivateClient,
  invalidateFrontendPrivateClientForError,
  type FrontendPrivateClientSigner,
} from "@/lib/solana/private-client-cache";
import {
  isRetryableUnshieldError,
  readDepositAmountFailClosed,
  runConfirmedUnshieldAttempt,
  UnshieldAttemptError,
} from "@/lib/solana/unshield-recovery";
import { runShieldAttemptWithOptionalAccounting } from "@/lib/solana/shield-recovery";

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
  const [depositPda] = findDepositPda(user, tokenMint);

  return readDepositAmountFailClosed({
    readEphemeral: () =>
      client.ephemeralProgram.account.deposit.fetchNullable(depositPda),
    readBase: () =>
      client.baseProgram.account.deposit.fetchNullable(depositPda),
  });
}

export type ShieldResult = {
  signature?: string;
  success: boolean;
  error?: string;
  retryable?: boolean;
};

export function useShield() {
  const wallet = useWallet();
  const publicEnv = usePublicEnv();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getClient =
    useCallback(async (): Promise<LoyalPrivateTransactionsClient> => {
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

      const signer = {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions,
        signMessage: wallet.signMessage,
      } as FrontendPrivateClientSigner;

      return getFrontendPrivateClient({
        signer,
        solanaEnv: publicEnv.solanaEnv,
      });
    }, [
      wallet.publicKey,
      wallet.signTransaction,
      wallet.signAllTransactions,
      wallet.signMessage,
      publicEnv.solanaEnv,
    ]);

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
        const rawAmount = toRoundedTokenRawAmount(params.amount, decimals);
        const user = wallet.publicKey;
        const trackedKaminoMint = resolveTrackedKaminoUsdcMint(
          publicEnv.solanaEnv
        );
        const isTrackedKaminoToken = trackedKaminoMint === tokenMint.toBase58();
        const { accountingBaseline, executionResult } =
          await runShieldAttemptWithOptionalAccounting({
            readAccountingBaseline: isTrackedKaminoToken
              ? () => getDepositAmount({ client, tokenMint, user })
              : undefined,
            buildPlan: () =>
              client.buildShieldTokensTransactionPlan({
                tokenMint,
                amount: rawAmount,
                user,
                payer: user,
              }),
            executePlan: (plan) =>
              client.executeShieldTokensTransactionPlan({
                plan,
              }),
            onAccountingReadError: (readError) => {
              console.warn(
                "Could not read Kamino USDC shield basis before execution; basis reconciliation will be skipped",
                readError
              );
            },
          });

        // Persist Kamino principal basis for tracked USDC so the "earned"
        // split on the portfolio can be computed without manual seeding.
        if (isTrackedKaminoToken && accountingBaseline !== null) {
          try {
            const collateralSharesAfter = await getDepositAmount({
              client,
              tokenMint,
              user,
            });
            const addedCollateralSharesAmountRaw =
              collateralSharesAfter - accountingBaseline;

            if (addedCollateralSharesAmountRaw > BigInt(0)) {
              recordKaminoUsdcShield({
                publicKey: user.toBase58(),
                solanaEnv: publicEnv.solanaEnv,
                addedPrincipalLiquidityAmountRaw: rawAmount,
                addedCollateralSharesAmountRaw,
              });
            }
          } catch (persistError) {
            console.warn(
              "Failed to reconcile Kamino USDC shield basis",
              persistError
            );
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
        if (wallet.publicKey) {
          invalidateFrontendPrivateClientForError({
            publicKey: wallet.publicKey.toBase58(),
            solanaEnv: publicEnv.solanaEnv,
            error: err,
          });
        }
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
      isMax?: boolean;
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
        const rawAmount = toRoundedTokenRawAmount(params.amount, decimals);
        const user = wallet.publicKey;
        // For tracked Kamino positions, the vault stores collateral shares.
        // Partial unshields quote user-entered liquidity into shares; Max burns
        // the live deposit shares directly so it can fully drain the account.
        const trackedKaminoMint = resolveTrackedKaminoUsdcMint(
          publicEnv.solanaEnv
        );
        const isTrackedKaminoToken = trackedKaminoMint === tokenMint.toBase58();
        const wantsMax = params.isMax === true;

        const requestedRawAmount = rawAmount;
        let collateralSharesBefore = BigInt(0);
        const attempt = await runConfirmedUnshieldAttempt({
          resolveAmount: async () => {
            collateralSharesBefore = isTrackedKaminoToken
              ? await getDepositAmount({ client, tokenMint, user })
              : BigInt(0);
            const quotedShares =
              isTrackedKaminoToken && !wantsMax
                ? await client.getKaminoCollateralSharesForLiquidityAmount({
                    tokenMint,
                    liquidityAmountRaw: requestedRawAmount,
                  })
                : null;

            return computeUnshieldModifyAmount({
              currentDepositRaw: collateralSharesBefore,
              isMax: wantsMax,
              isTrackedKaminoToken,
              kaminoQuotedShares: quotedShares,
              requestedRawAmount,
            });
          },
          buildPlan: (amount) =>
            client.buildUnshieldTokensTransactionPlan({
              tokenMint,
              amount,
              user,
              payer: user,
              magicProgram: MAGIC_PROGRAM_ID,
              magicContext: MAGIC_CONTEXT_ID,
            }),
          executePlan: (plan) =>
            client.executeUnshieldTokensTransactionPlan({
              plan,
            }),
        });

        if (isTrackedKaminoToken) {
          try {
            const collateralSharesAfter = await getDepositAmount({
              client,
              tokenMint,
              user,
            });
            const burnedCollateralSharesAmountRaw =
              collateralSharesBefore - collateralSharesAfter;

            if (burnedCollateralSharesAmountRaw > BigInt(0)) {
              recordKaminoUsdcUnshield({
                publicKey: user.toBase58(),
                solanaEnv: publicEnv.solanaEnv,
                burnedCollateralSharesAmountRaw,
              });
            }
          } catch (persistError) {
            console.warn(
              "Failed to reconcile Kamino USDC unshield basis",
              persistError
            );
          }
        }

        setLoading(false);
        return { success: true, signature: attempt.signature };
      } catch (err) {
        if (wallet.publicKey) {
          invalidateFrontendPrivateClientForError({
            publicKey: wallet.publicKey.toBase58(),
            solanaEnv: publicEnv.solanaEnv,
            error: err,
          });
        }
        const userRejected =
          err instanceof Error && /user rejected/i.test(err.message);
        const retryable = isRetryableUnshieldError(err);
        let errorMessage = "Unshield failed";
        if (userRejected) {
          errorMessage = "Transaction was rejected in your wallet.";
        } else if (retryable) {
          errorMessage =
            "Loyal could not confirm the unshield. Check your connection and try again; retry reads the live shielded balance first.";
        } else if (err instanceof Error) {
          errorMessage = cleanSolanaErrorMessage(err.message);
        }
        if (wallet.publicKey) {
          console.error("[wallet-unshield] attempt failed", {
            errorMessage,
            errorName: err instanceof Error ? err.name : "UnknownError",
            isMax: params.isMax === true,
            stage: err instanceof UnshieldAttemptError ? err.stage : "unknown",
            tokenMint: params.tokenMint ?? null,
            tokenSymbol: params.tokenSymbol,
            walletAddress: wallet.publicKey.toBase58(),
          });
        }
        setError(errorMessage);
        setLoading(false);
        return {
          success: false,
          error: errorMessage,
          retryable,
        };
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
