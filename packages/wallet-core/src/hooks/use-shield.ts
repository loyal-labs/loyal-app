import {
  type ShieldFlowExecutionResult,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  USDC_MINT_DEVNET,
  USDC_MINT_MAINNET,
} from "@loyal-labs/private-transactions";
import {
  type SolanaEnv,
  getPerEndpoints,
  getSolanaEndpoints,
} from "@loyal-labs/solana-rpc";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useRef, useState } from "react";

import { TOKEN_DECIMALS, TOKEN_MINTS } from "../constants/token-mints";
import { computeUnshieldModifyAmount } from "../lib/shielding";
import type { WalletSigner } from "../types/signer";

export type ShieldResult = {
  signature?: string;
  success: boolean;
  error?: string;
};

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
  return result.signatures[result.signatures.length - 1]?.signature;
}

function isKaminoUsdcMint(tokenMint: PublicKey, solanaEnv: SolanaEnv): boolean {
  const trackedMint =
    solanaEnv === "mainnet"
      ? USDC_MINT_MAINNET
      : solanaEnv === "devnet"
      ? USDC_MINT_DEVNET
      : null;
  return trackedMint ? tokenMint.equals(trackedMint) : false;
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

export function useShield(
  signer: WalletSigner | null,
  _connection: Connection,
  solanaEnv: SolanaEnv
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<LoyalPrivateTransactionsClient | null>(null);

  const getClient =
    useCallback(async (): Promise<LoyalPrivateTransactionsClient> => {
      if (clientRef.current) return clientRef.current;

      if (!signer || !signer.signMessage) {
        throw new Error(
          "Wallet must support signTransaction, signAllTransactions, and signMessage"
        );
      }

      const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(solanaEnv);
      const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);

      const walletLike = {
        publicKey: signer.publicKey,
        signTransaction: signer.signTransaction.bind(signer),
        signAllTransactions: signer.signAllTransactions.bind(signer),
        signMessage: signer.signMessage.bind(signer),
      } as unknown as import("@loyal-labs/private-transactions").WalletLike;

      const client = await LoyalPrivateTransactionsClient.fromConfig({
        signer: walletLike,
        baseRpcEndpoint: rpcEndpoint,
        baseWsEndpoint: websocketEndpoint,
        ephemeralRpcEndpoint: perRpcEndpoint,
        ephemeralWsEndpoint: perWsEndpoint,
      });

      clientRef.current = client;
      return client;
    }, [signer, solanaEnv]);

  // Reset client when wallet changes
  const prevPubkey = useRef(signer?.publicKey.toBase58());
  if (signer?.publicKey.toBase58() !== prevPubkey.current) {
    clientRef.current = null;
    prevPubkey.current = signer?.publicKey.toBase58();
  }

  const executeShield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      isMax?: boolean;
      tokenMint?: string;
    }): Promise<ShieldResult> => {
      if (!signer) {
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
        const user = signer.publicKey;

        const plan = await client.buildShieldTokensTransactionPlan({
          tokenMint,
          amount: BigInt(rawAmount),
          user,
          payer: user,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID,
        });
        const executionResult = await client.executeShieldTokensTransactionPlan(
          { plan }
        );

        setLoading(false);
        return {
          signature: getLastSignature(executionResult),
          success: true,
        };
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
    [signer, getClient]
  );

  const executeUnshield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      isMax?: boolean;
      tokenMint?: string;
    }): Promise<ShieldResult> => {
      if (!signer) {
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
        const user = signer.publicKey;
        const isTrackedKaminoToken = isKaminoUsdcMint(tokenMint, solanaEnv);
        const wantsMax = params.isMax === true;
        const currentDepositRaw =
          wantsMax || isTrackedKaminoToken
            ? await getDepositAmount({ client, tokenMint, user })
            : BigInt(0);
        const requestedRawAmount = BigInt(rawAmount);
        const kaminoQuotedShares =
          isTrackedKaminoToken && !wantsMax
            ? await client.getKaminoCollateralSharesForLiquidityAmount({
                tokenMint,
                liquidityAmountRaw: requestedRawAmount,
              })
            : null;
        const planAmount = computeUnshieldModifyAmount({
          currentDepositRaw,
          isMax: wantsMax,
          isTrackedKaminoToken,
          kaminoQuotedShares,
          requestedRawAmount,
        });

        const plan = await client.buildUnshieldTokensTransactionPlan({
          tokenMint,
          amount: planAmount,
          user,
          payer: user,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID,
        });
        const executionResult =
          await client.executeUnshieldTokensTransactionPlan({ plan });

        setLoading(false);
        return {
          signature: getLastSignature(executionResult),
          success: true,
        };
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
    [signer, getClient, solanaEnv]
  );

  return { executeShield, executeUnshield, loading, error };
}
