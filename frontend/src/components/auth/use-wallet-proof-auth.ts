"use client";

import type { WalletName } from "@solana/wallet-adapter-base";
import {
  WalletConnectionError,
  WalletDisconnectedError,
  WalletError,
  WalletLoadError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletSignInError,
  WalletSignMessageError,
  WalletSignTransactionError,
  WalletTimeoutError,
  WalletWindowBlockedError,
  WalletWindowClosedError,
} from "@solana/wallet-adapter-base";
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
import { createBrowserLifecycleTracker } from "@/features/observability/client";
import {
  type LifecycleErrorCode,
  type LifecycleFlowStage,
  type LifecycleTracker,
  normalizeLifecycleErrorCode,
} from "@/features/observability/lifecycle-contract";

const WALLET_CONNECTION_SETTLE_MS = 2500;
const WALLET_SELECTION_SETTLE_MS = 7000;

function hasRejectionWording(value: unknown): boolean {
  const message =
    value instanceof Error
      ? value.message.toLowerCase()
      : String(value ?? "").toLowerCase();

  return (
    message.includes("rejected") ||
    message.includes("declined") ||
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("user denied")
  );
}

// Wallet adapters disagree on how a dismissed prompt surfaces: some throw
// `WalletWindowClosedError`, others a generic `WalletConnectionError` whose
// wording is the only signal, and several nest the provider's own error under
// `WalletError.error`. Check the class first and fall back to wording on both
// the wrapper and the nested cause — matching wording alone used to classify a
// closed popup as a hard failure (ASK-1857).
function isRejectedWalletRequest(error: unknown): boolean {
  if (error instanceof WalletWindowClosedError) {
    return true;
  }

  if (error instanceof WalletError) {
    return hasRejectionWording(error) || hasRejectionWording(error.error);
  }

  return hasRejectionWording(error);
}

// Maps a wallet-adapter failure onto the lifecycle vocabulary so connect-time
// problems stop collapsing into `unexpected_error`. Returns undefined for
// anything that is not a wallet-adapter error, leaving the caller's own
// normalization in charge.
function classifyWalletAdapterError(
  error: unknown
): LifecycleErrorCode | undefined {
  if (!(error instanceof WalletError)) {
    return undefined;
  }

  if (error instanceof WalletTimeoutError) {
    return "wallet_connection_timeout";
  }

  // Not installed, disabled, or still injecting; and a blocked popup is the
  // same dead end from the user's side — the browser suppressed the prompt.
  if (
    error instanceof WalletNotReadyError ||
    error instanceof WalletLoadError ||
    error instanceof WalletWindowBlockedError
  ) {
    return "wallet_unavailable";
  }

  if (
    error instanceof WalletConnectionError ||
    error instanceof WalletNotConnectedError ||
    error instanceof WalletDisconnectedError
  ) {
    return "wallet_connection_timeout";
  }

  if (
    error instanceof WalletSignInError ||
    error instanceof WalletSignMessageError ||
    error instanceof WalletSignTransactionError
  ) {
    return "invalid_wallet_signature";
  }

  return "wallet_unavailable";
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
  const lifecycleRef = useRef<LifecycleTracker | null>(null);

  const installedWallets = useMemo(
    () => wallets.filter((candidate) => candidate.readyState === "Installed"),
    [wallets]
  );

  // `stage` is where the flow actually died. It defaults to `completion` only
  // for the proof-flow callers, which have already emitted `challenge` and
  // `wallet_approval` themselves; every pre-proof caller passes its own stage
  // so a connect failure is not reported as a completion failure (ASK-1857).
  const handleFailure = useCallback(
    (
      error: unknown,
      options?: { stage?: LifecycleFlowStage; errorCode?: LifecycleErrorCode }
    ) => {
      endExplicitWalletConnect(selectedWalletNameRef.current);
      const nextError = mapWalletProofError(error);
      const errorCode =
        options?.errorCode ??
        normalizeLifecycleErrorCode(
          error instanceof AuthApiClientError
            ? error.code
            : error instanceof WalletProofSignerError
            ? error.code
            : classifyWalletAdapterError(error)
        );
      if (nextError.status === "rejected") {
        // Without an explicit stage this is a proof-flow caller, where a
        // rejection is always the signature prompt.
        lifecycleRef.current?.cancel(options?.stage ?? "wallet_approval", {
          errorCode: "wallet_rejected",
        });
      } else {
        lifecycleRef.current?.fail(options?.stage ?? "completion", {
          errorCode,
        });
      }
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
      handleFailure(new Error("Wallet is not selected."), {
        stage: "wallet_select",
        errorCode: "wallet_unavailable",
      });
      return;
    }

    if (!signIn) {
      handleFailure(
        new WalletProofSignerError(
          "This wallet does not support Sign In With Solana.",
          "wallet_signing_unsupported"
        ),
        { stage: "wallet_connect" }
      );
      return;
    }

    const walletName = wallet.adapter.name;
    siwsAttemptedForWalletRef.current = walletName;
    dispatch({ type: "awaiting_signature" });

    try {
      await runWalletSiwsProofFlow({
        authApiClient,
        lifecycle: lifecycleRef.current ?? undefined,
        onStatusChange: (status) => dispatch({ type: status }),
        signIn,
        turnstileToken: turnstileTokenRef.current,
        walletName,
      });
      lifecycleRef.current?.observe("session_refresh", {
        authProofKind: "siws",
      });
      await refreshSession();
      dispatch({ type: "success" });
      lifecycleRef.current?.complete("ui_commit", { authProofKind: "siws" });
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
      handleFailure(new Error("Wallet is not connected."), {
        stage: "wallet_connect",
        errorCode: "wallet_unavailable",
      });
      return;
    }

    const walletAddress = publicKey.toBase58();

    if (useLedgerProof) {
      if (!signTransaction) {
        handleFailure(
          new WalletProofSignerError(
            "This wallet does not support transaction signing.",
            "wallet_signing_unsupported"
          ),
          { stage: "wallet_connect" }
        );
        return;
      }

      verifyAttemptedForAddressRef.current = `transaction:${walletAddress}`;

      try {
        await runWalletTransactionProofFlow({
          authApiClient,
          lifecycle: lifecycleRef.current ?? undefined,
          onStatusChange: (status) => dispatch({ type: status }),
          signTransaction,
          turnstileToken: turnstileTokenRef.current,
          walletAddress,
        });
        lifecycleRef.current?.observe("session_refresh", {
          authProofKind: "transaction",
        });
        await refreshSession();
        dispatch({ type: "success" });
        lifecycleRef.current?.complete("ui_commit", {
          authProofKind: "transaction",
        });
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
        ),
        { stage: "wallet_connect" }
      );
      return;
    }

    verifyAttemptedForAddressRef.current = `message:${walletAddress}`;

    try {
      await runWalletMessageProofFlow({
        authApiClient,
        lifecycle: lifecycleRef.current ?? undefined,
        messageSigner: signMessage,
        onStatusChange: (status) => dispatch({ type: status }),
        turnstileToken: turnstileTokenRef.current,
        walletAddress,
      });
      lifecycleRef.current?.observe("session_refresh", {
        authProofKind: "message",
      });
      await refreshSession();
      dispatch({ type: "success" });
      lifecycleRef.current?.complete("ui_commit", {
        authProofKind: "message",
      });
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
        ),
        { stage: "wallet_connect", errorCode: "wallet_unavailable" }
      );
      return;
    }

    connectAttemptedRef.current = true;
    lifecycleRef.current?.observe("wallet_connect");
    void connect().catch((error) => {
      connectAttemptedRef.current = false;
      handleFailure(error, { stage: "wallet_connect" });
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
          ),
          { stage: "wallet_select", errorCode: "wallet_selection_timeout" }
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
        ),
        { stage: "wallet_connect", errorCode: "wallet_connection_timeout" }
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
      lifecycleRef.current = createBrowserLifecycleTracker({
        flowName: "auth.sign_in",
        flowVariant: "interactive",
      });
      lifecycleRef.current.start("intent");
      lifecycleRef.current.observe("wallet_select");

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
        lifecycleRef.current?.observe("wallet_connect");
        void connect().catch((error) => {
          connectAttemptedRef.current = false;
          handleFailure(error, { stage: "wallet_connect" });
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
    lifecycleRef.current = createBrowserLifecycleTracker({
      flowName: "auth.sign_in",
      flowVariant: "interactive",
    });
    lifecycleRef.current.start("intent");
    lifecycleRef.current.observe("wallet_select");
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
