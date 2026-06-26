"use client";

import type { WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  useAuthApiClient,
  useAuthSession,
} from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { AuthApiClientError } from "@/lib/auth/client";
import {
  initialWalletProofState,
  walletProofReducer,
} from "@/lib/auth/wallet-proof-state";
import {
  runWalletMessageProofFlow,
  runWalletSiwsProofFlow,
  runWalletTransactionProofFlow,
} from "@/lib/auth/wallet-proof-flow";
import { WalletProofSignerError } from "@/lib/auth/wallet-proof-signer";
import { useExplicitWalletConnectIntent } from "@/components/solana/wallet-provider";

const WALLET_CONNECTION_SETTLE_MS = 2500;
const WALLET_SELECTION_SETTLE_MS = 7000;

function isRejectedWalletRequest(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  return (
    message.includes("rejected") ||
    message.includes("declined") ||
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("user denied")
  );
}

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

  if (isRejectedWalletRequest(error)) {
    return {
      status: "rejected",
      message: "You cancelled the wallet request.",
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
  onTurnstileConsumed,
  turnstileToken,
  useLedgerProof = false,
}: {
  onFlowStart?: () => void;
  onTurnstileConsumed?: () => void;
  turnstileToken?: string;
  useLedgerProof?: boolean;
}) {
  const authApiClient = useAuthApiClient();
  const { refreshSession } = useAuthSession();
  const { close } = useSignInModal();
  const {
    connected,
    connecting,
    connect,
    disconnect,
    publicKey,
    select,
    signIn,
    signMessage,
    signTransaction,
    wallet,
    wallets,
  } = useWallet();
  const { beginExplicitWalletConnect, endExplicitWalletConnect } =
    useExplicitWalletConnectIntent();

  const [state, dispatch] = useReducer(
    walletProofReducer,
    initialWalletProofState
  );
  const connectAttemptedRef = useRef(false);
  const staleAdapterRecoveryAttemptedRef = useRef(false);
  const selectedWalletNameRef = useRef<WalletName | null>(null);
  const siwsAttemptedForWalletRef = useRef<string | null>(null);
  const verifyAttemptedForAddressRef = useRef<string | null>(null);
  const [walletNameToReselect, setWalletNameToReselect] =
    useState<WalletName | null>(null);
  const turnstileTokenRef = useRef(turnstileToken);
  turnstileTokenRef.current = turnstileToken;
  const onTurnstileConsumedRef = useRef(onTurnstileConsumed);
  onTurnstileConsumedRef.current = onTurnstileConsumed;

  const installedWallets = useMemo(
    () => wallets.filter((candidate) => candidate.readyState === "Installed"),
    [wallets]
  );

  const handleFailure = useCallback(
    (error: unknown) => {
      endExplicitWalletConnect(selectedWalletNameRef.current);
      const nextError = mapWalletProofError(error);
      dispatch({
        type: "failed",
        status: nextError.status,
        message: nextError.message,
        details: nextError.details,
      });
    },
    [endExplicitWalletConnect]
  );

  const recoverStaleSelectedWallet = useCallback(
    (walletName: WalletName) => {
      staleAdapterRecoveryAttemptedRef.current = true;
      connectAttemptedRef.current = false;
      siwsAttemptedForWalletRef.current = null;
      verifyAttemptedForAddressRef.current = null;
      setWalletNameToReselect(walletName);
      void disconnect()
        .catch(() => undefined)
        .finally(() => select(null));
    },
    [disconnect, select]
  );

  const verifySelectedWalletWithSiws = useCallback(async () => {
    if (!wallet) {
      handleFailure(new Error("Wallet is not selected."));
      return;
    }

    if (!signIn) {
      handleFailure(
        new WalletProofSignerError(
          "This wallet does not support Sign In With Solana.",
          "wallet_signing_unsupported"
        )
      );
      return;
    }

    const walletName = wallet.adapter.name;
    siwsAttemptedForWalletRef.current = walletName;
    dispatch({ type: "awaiting_signature" });

    try {
      await runWalletSiwsProofFlow({
        authApiClient,
        onStatusChange: (status) => dispatch({ type: status }),
        signIn,
        turnstileToken: turnstileTokenRef.current,
        walletName,
      });
      await refreshSession();
      dispatch({ type: "success" });
      close();
    } catch (error) {
      siwsAttemptedForWalletRef.current = null;
      handleFailure(error);
    } finally {
      endExplicitWalletConnect(selectedWalletNameRef.current);
      // The Turnstile token is single-use once the challenge consumes it, so
      // ask the modal to issue a fresh one before any subsequent attempt.
      onTurnstileConsumedRef.current?.();
    }
  }, [
    authApiClient,
    close,
    endExplicitWalletConnect,
    handleFailure,
    refreshSession,
    signIn,
    wallet,
  ]);

  const verifyConnectedWallet = useCallback(async () => {
    if (!useLedgerProof && signIn && wallet) {
      await verifySelectedWalletWithSiws();
      return;
    }

    if (!connected || !publicKey) {
      handleFailure(new Error("Wallet is not connected."));
      return;
    }

    const walletAddress = publicKey.toBase58();

    if (useLedgerProof) {
      if (!signTransaction) {
        handleFailure(
          new WalletProofSignerError(
            "This wallet does not support transaction signing.",
            "wallet_signing_unsupported"
          )
        );
        return;
      }

      verifyAttemptedForAddressRef.current = `transaction:${walletAddress}`;

      try {
        await runWalletTransactionProofFlow({
          authApiClient,
          onStatusChange: (status) => dispatch({ type: status }),
          signTransaction,
          turnstileToken: turnstileTokenRef.current,
          walletAddress,
        });
        await refreshSession();
        dispatch({ type: "success" });
        close();
      } catch (error) {
        verifyAttemptedForAddressRef.current = null;
        handleFailure(error);
      } finally {
        endExplicitWalletConnect(selectedWalletNameRef.current);
        // The Turnstile token is single-use once the challenge consumes it, so
        // ask the modal to issue a fresh one before any subsequent attempt.
        onTurnstileConsumedRef.current?.();
      }
      return;
    }

    if (!signMessage) {
      handleFailure(
        new WalletProofSignerError(
          "This wallet does not support message signing.",
          "wallet_signing_unsupported"
        )
      );
      return;
    }

    verifyAttemptedForAddressRef.current = `message:${walletAddress}`;

    try {
      await runWalletMessageProofFlow({
        authApiClient,
        messageSigner: signMessage,
        onStatusChange: (status) => dispatch({ type: status }),
        turnstileToken: turnstileTokenRef.current,
        walletAddress,
      });
      await refreshSession();
      dispatch({ type: "success" });
      close();
    } catch (error) {
      verifyAttemptedForAddressRef.current = null;
      handleFailure(error);
    } finally {
      endExplicitWalletConnect(selectedWalletNameRef.current);
      // The Turnstile token is single-use once the challenge consumes it, so
      // ask the modal to issue a fresh one before any subsequent attempt.
      onTurnstileConsumedRef.current?.();
    }
  }, [
    authApiClient,
    close,
    connected,
    endExplicitWalletConnect,
    handleFailure,
    publicKey,
    refreshSession,
    signIn,
    signMessage,
    signTransaction,
    useLedgerProof,
    verifySelectedWalletWithSiws,
    wallet,
  ]);

  useEffect(() => {
    if (state.status !== "connecting" || !walletNameToReselect) {
      return;
    }

    if (wallet?.adapter.name === walletNameToReselect) {
      return;
    }

    select(walletNameToReselect);
    setWalletNameToReselect(null);
  }, [select, state.status, wallet, walletNameToReselect]);

  useEffect(() => {
    if (state.status !== "connecting") {
      return;
    }

    const selectedWalletName = selectedWalletNameRef.current;

    if (
      !useLedgerProof &&
      wallet?.adapter.name === selectedWalletName &&
      signIn
    ) {
      if (siwsAttemptedForWalletRef.current === wallet.adapter.name) {
        return;
      }

      void verifySelectedWalletWithSiws();
      return;
    }

    if (connected && publicKey) {
      if (selectedWalletName && wallet?.adapter.name !== selectedWalletName) {
        return;
      }

      const walletAddress = publicKey.toBase58();

      if (useLedgerProof) {
        if (!signTransaction) {
          handleFailure(
            new WalletProofSignerError(
              "This wallet does not support transaction signing.",
              "wallet_signing_unsupported"
            )
          );
          return;
        }

        if (
          verifyAttemptedForAddressRef.current ===
          `transaction:${walletAddress}`
        ) {
          return;
        }

        void verifyConnectedWallet();
        return;
      }

      if (!signMessage) {
        handleFailure(
          new WalletProofSignerError(
            "This wallet does not support message signing.",
            "wallet_signing_unsupported"
          )
        );
        return;
      }

      if (verifyAttemptedForAddressRef.current === `message:${walletAddress}`) {
        return;
      }

      void verifyConnectedWallet();
      return;
    }

    if (
      walletNameToReselect ||
      !wallet ||
      wallet.adapter.name !== selectedWalletName ||
      connecting ||
      connectAttemptedRef.current
    ) {
      return;
    }

    if (wallet.adapter.connected && selectedWalletName) {
      if (!staleAdapterRecoveryAttemptedRef.current) {
        recoverStaleSelectedWallet(selectedWalletName);
        return;
      }

      handleFailure(
        new Error(
          `Could not refresh ${selectedWalletName}. Disconnect it in the extension, then try again.`
        )
      );
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
    recoverStaleSelectedWallet,
    signIn,
    signMessage,
    signTransaction,
    state.status,
    useLedgerProof,
    verifyConnectedWallet,
    verifySelectedWalletWithSiws,
    wallet,
    walletNameToReselect,
  ]);

  useEffect(() => {
    return () => {
      endExplicitWalletConnect(selectedWalletNameRef.current);
    };
  }, [endExplicitWalletConnect]);

  useEffect(() => {
    if (state.status !== "connecting") {
      return;
    }

    const selectedWalletName = selectedWalletNameRef.current;
    const isWaitingForSelection =
      !connectAttemptedRef.current &&
      (!selectedWalletName || wallet?.adapter.name !== selectedWalletName);
    const settleDelay = isWaitingForSelection
      ? WALLET_SELECTION_SETTLE_MS
      : WALLET_CONNECTION_SETTLE_MS;

    const timeout = window.setTimeout(() => {
      const selectedWalletName = selectedWalletNameRef.current;
      if (
        !selectedWalletName ||
        connected ||
        connecting ||
        walletNameToReselect
      ) {
        return;
      }

      if (
        !connectAttemptedRef.current &&
        wallet?.adapter.name !== selectedWalletName
      ) {
        handleFailure(
          new Error(
            `Could not select ${selectedWalletName}. Refresh detected wallets, or choose another wallet.`
          )
        );
        return;
      }

      if (
        wallet?.adapter.name === selectedWalletName &&
        wallet.adapter.connected &&
        !staleAdapterRecoveryAttemptedRef.current
      ) {
        recoverStaleSelectedWallet(selectedWalletName);
        return;
      }

      handleFailure(
        new Error(
          staleAdapterRecoveryAttemptedRef.current
            ? `Could not refresh ${selectedWalletName}. Disconnect it in the extension, then try again.`
            : `Could not start ${selectedWalletName}. Unlock the extension, refresh detected wallets, or choose another wallet.`
        )
      );
    }, settleDelay);

    return () => window.clearTimeout(timeout);
  }, [
    connected,
    connecting,
    handleFailure,
    recoverStaleSelectedWallet,
    state.status,
    wallet,
    walletNameToReselect,
  ]);

  const connectWallet = useCallback(
    (walletName: WalletName) => {
      connectAttemptedRef.current = false;
      staleAdapterRecoveryAttemptedRef.current = false;
      siwsAttemptedForWalletRef.current = null;
      verifyAttemptedForAddressRef.current = null;
      setWalletNameToReselect(null);
      selectedWalletNameRef.current = walletName;
      onFlowStart?.();

      if (!useLedgerProof && wallet?.adapter.name === walletName && signIn) {
        beginExplicitWalletConnect(walletName);
        dispatch({ type: "connecting" });
        void verifySelectedWalletWithSiws();
        return;
      }

      if (
        wallet?.adapter.name === walletName &&
        connected &&
        publicKey &&
        (useLedgerProof ? signTransaction : signMessage)
      ) {
        void verifyConnectedWallet();
        return;
      }

      beginExplicitWalletConnect(walletName);
      dispatch({ type: "connecting" });

      if (wallet?.adapter.name === walletName) {
        if (wallet.adapter.connected && (!connected || !publicKey)) {
          recoverStaleSelectedWallet(walletName);
          return;
        }

        connectAttemptedRef.current = true;
        void connect().catch((error) => {
          connectAttemptedRef.current = false;
          handleFailure(error);
        });
        return;
      }

      select(walletName);
    },
    [
      beginExplicitWalletConnect,
      connected,
      connect,
      handleFailure,
      onFlowStart,
      publicKey,
      recoverStaleSelectedWallet,
      select,
      signIn,
      signMessage,
      signTransaction,
      useLedgerProof,
      verifyConnectedWallet,
      verifySelectedWalletWithSiws,
      wallet,
    ]
  );

  const retry = useCallback(() => {
    const selectedWalletName = selectedWalletNameRef.current;
    endExplicitWalletConnect(selectedWalletName);
    connectAttemptedRef.current = false;
    staleAdapterRecoveryAttemptedRef.current = false;
    selectedWalletNameRef.current = null;
    siwsAttemptedForWalletRef.current = null;
    verifyAttemptedForAddressRef.current = null;
    setWalletNameToReselect(null);
    select(null);
    dispatch({ type: "reset" });
  }, [endExplicitWalletConnect, select]);

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
