"use client";

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { useCallback, useState } from "react";

import { fetchJson } from "@/lib/core/http";
import { SWAP_ERRORS } from "@/lib/jupiter/constants";
import type { SwapParams, SwapResult } from "@/lib/jupiter/types";

type OrderApiResponse = {
  transaction: string;
  requestId: string;
  expectedOutAmount: number;
  priceImpactPct: number;
  inAmount: number;
  outAmount: number;
  gasless: boolean;
  swapType: string;
  error?: string;
};

type ExecuteApiResponse = {
  status: "Success" | "Failed";
  signature: string;
  code: number;
  inputAmountResult?: string;
  outputAmountResult?: string;
  error?: string;
};

type SwapState = "idle" | "quoting" | "signing" | "confirming";

function signTransaction(base64Transaction: string, keypair: Keypair): string {
  const buffer = Buffer.from(base64Transaction, "base64");
  const transaction = VersionedTransaction.deserialize(buffer);
  transaction.sign([keypair]);
  return Buffer.from(transaction.serialize()).toString("base64");
}

export function useSwap(getKeypair: () => Promise<Keypair>) {
  const [state, setState] = useState<SwapState>("idle");
  const [error, setError] = useState<string | null>(null);

  const executeSwap = useCallback(
    async (params: SwapParams): Promise<SwapResult> => {
      setError(null);
      setState("quoting");

      try {
        const keypair = await getKeypair();
        const userPublicKey = keypair.publicKey.toBase58();

        // Step 1: Get order (quote + unsigned transaction)
        const orderResponse = await fetchJson<OrderApiResponse>(
          "/api/jupiter/order",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fromMint: params.fromMint,
              toMint: params.toMint,
              fromAmount: params.fromAmount,
              fromDecimals: params.fromDecimals,
              toDecimals: params.toDecimals,
              userPublicKey,
            }),
          }
        );

        if (orderResponse.error) {
          setError(orderResponse.error);
          setState("idle");
          return { success: false, error: orderResponse.error };
        }

        // Step 2: Sign transaction client-side
        setState("signing");
        const signedTransaction = signTransaction(
          orderResponse.transaction,
          keypair
        );

        // Step 3: Execute via Jupiter (handles broadcasting + confirmation)
        setState("confirming");
        const executeResponse = await fetchJson<ExecuteApiResponse>(
          "/api/jupiter/execute",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signedTransaction,
              requestId: orderResponse.requestId,
            }),
          }
        );

        setState("idle");

        if (executeResponse.status === "Success") {
          return {
            success: true,
            signature: executeResponse.signature,
            fromAmount: params.fromAmount,
            fromSymbol: params.fromSymbol,
            toAmount: orderResponse.expectedOutAmount,
            toSymbol: params.toSymbol,
          };
        }

        const errorMsg =
          executeResponse.error || SWAP_ERRORS.TRANSACTION_FAILED;
        setError(errorMsg);
        return { success: false, error: errorMsg };
      } catch (err) {
        console.error("[useSwap] Error:", err);
        const errorMessage =
          err instanceof Error ? err.message : SWAP_ERRORS.TRANSACTION_FAILED;
        setError(errorMessage);
        setState("idle");
        return { success: false, error: errorMessage };
      }
    },
    [getKeypair]
  );

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  return {
    executeSwap,
    state,
    isLoading: state !== "idle",
    isQuoting: state === "quoting",
    isSigning: state === "signing",
    isConfirming: state === "confirming",
    error,
    resetError,
  };
}
