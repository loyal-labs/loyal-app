"use client";

import type { WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import { useAuthApiClient, useAuthSession } from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { AuthApiClientError } from "@/lib/auth/client";
import {
  initialWalletProofState,
  walletProofReducer,
} from "@/lib/auth/wallet-proof-state";
import { runWalletProofFlow } from "@/lib/auth/wallet-proof-flow";
import { WalletProofSignerError } from "@/lib/auth/wallet-proof-signer";

function mapWalletProofError(error: unknown): {
  status: "rejected" | "unsupported" | "error";
  message: string;
  details: string[];
} {
  if (error instanceof WalletProofSignerError) {
    if (error.code === "wallet_signature_rejected") {
      return {
        status: "rejected",
        message: error.message,
        details: [],
      };
    }

    return {
      status: "unsupported",
      message: error.message,
      details: [],
    };
  }

  if (error instanceof AuthApiClientError) {
    return {
      status: "error",
      message: error.message,
      details: error.details,
    };
  }

  return {
    status: "error",
    message:
      error instanceof Error ? error.message : "Wallet verification failed.",
    details: [],
  };
}

export function useWalletProofAuth({
  onFlowStart,
}: {
  onFlowStart?: () => void;
}) {
  const authApiClient = useAuthApiClient();
  const { refreshSession } = useAuthSession();
  const { close } = useSignInModal();
  const {
    connected,
    connecting,
    connect,
    publicKey,
    select,
    signMessage,
    wallet,
    wallets,
  } = useWallet();

  const [state, dispatch] = useReducer(
    walletProofReducer,
    initialWalletProofState
  );
  const connectAttemptedRef = useRef(false);
  const selectedWalletNameRef = useRef<WalletName | null>(null);
  const verifyAttemptedForAddressRef = useRef<string | null>(null);

  const installedWallets = useMemo(
    () =>
      wallets.filter(
        (candidate) =>
          candidate.readyState === "Installed" ||
          candidate.adapter.name === "WalletConnect"
      ),
    [wallets]
  );

  const handleFailure = useCallback((error: unknown) => {
    const nextError = mapWalletProofError(error);
    dispatch({
      type: "failed",
      status: nextError.status,
      message: nextError.message,
      details: nextError.details,
    });
  }, []);

  const verifyConnectedWallet = useCallback(async () => {
    if (!publicKey) {
      handleFailure(new Error("Wallet is not connected."));
      return;
    }

    const walletAddress = publicKey.toBase58();
    verifyAttemptedForAddressRef.current = walletAddress;

    try {
      await runWalletProofFlow({
        authApiClient,
        messageSigner: signMessage,
        onStatusChange: (status) => dispatch({ type: status }),
        walletAddress,
      });
      await refreshSession();
      dispatch({ type: "success" });
      close();
    } catch (error) {
      verifyAttemptedForAddressRef.current = null;
      handleFailure(error);
    }
  }, [authApiClient, close, handleFailure, publicKey, refreshSession, signMessage]);

  useEffect(() => {
    if (state.status !== "connecting") {
      return;
    }

    if (connected && publicKey) {
      if (verifyAttemptedForAddressRef.current === publicKey.toBase58()) {
        return;
      }

      void verifyConnectedWallet();
      return;
    }

    if (
      !wallet ||
      wallet.adapter.name !== selectedWalletNameRef.current ||
      connecting ||
      connectAttemptedRef.current
    ) {
      return;
    }

    connectAttemptedRef.current = true;
    void connect().catch((error) => {
      connectAttemptedRef.current = false;
      handleFailure(error);
    });
  }, [
    connect,
    connected,
    connecting,
    handleFailure,
    publicKey,
    state.status,
    verifyConnectedWallet,
    wallet,
  ]);

  const connectWallet = useCallback(
    (walletName: WalletName) => {
      connectAttemptedRef.current = false;
      verifyAttemptedForAddressRef.current = null;
      selectedWalletNameRef.current = walletName;
      onFlowStart?.();
      dispatch({ type: "connecting" });
      select(walletName);
    },
    [onFlowStart, select]
  );

  const retry = useCallback(() => {
    connectAttemptedRef.current = false;
    verifyAttemptedForAddressRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  const startConnectedWalletVerification = useCallback(() => {
    onFlowStart?.();
    void verifyConnectedWallet();
  }, [onFlowStart, verifyConnectedWallet]);

  return {
    connected,
    publicKey,
    installedWallets,
    state,
    connectWallet,
    retry,
    startConnectedWalletVerification,
  };
}
