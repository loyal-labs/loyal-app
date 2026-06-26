"use client";

import type { WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { AlertCircle, Check, LoaderCircle, Unplug, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const WALLET_SELECTION_SETTLE_MS = 2500;

function formatAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function walletErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Could not reconnect wallet.";
}

export function WalletReconnectPrompt({
  expectedWalletAddress,
  onClose,
  onReady,
  open,
}: {
  expectedWalletAddress: string | null;
  onClose: () => void;
  onReady: () => void;
  open: boolean;
}) {
  const {
    connected,
    connecting,
    connect,
    disconnect,
    publicKey,
    select,
    wallet,
    wallets,
  } = useWallet();
  const installedWallets = useMemo(
    () => wallets.filter((candidate) => candidate.readyState === "Installed"),
    [wallets]
  );
  const selectedWalletNameRef = useRef<WalletName | null>(null);
  const connectAttemptedRef = useRef(false);
  const [isConnectingSelected, setIsConnectingSelected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectedAddress = publicKey?.toBase58() ?? null;
  const isMatchingWallet =
    Boolean(expectedWalletAddress) && connectedAddress === expectedWalletAddress;
  const isWrongWallet =
    Boolean(expectedWalletAddress && connectedAddress) && !isMatchingWallet;

  useEffect(() => {
    if (!open) {
      selectedWalletNameRef.current = null;
      connectAttemptedRef.current = false;
      setError(null);
      setIsConnectingSelected(false);
      return;
    }

    if (isMatchingWallet) {
      setError(null);
      setIsConnectingSelected(false);
    }
  }, [isMatchingWallet, open]);

  useEffect(() => {
    if (!open || !isConnectingSelected) {
      return;
    }

    if (connected && publicKey) {
      setIsConnectingSelected(false);
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
    void connect().catch((nextError) => {
      connectAttemptedRef.current = false;
      setIsConnectingSelected(false);
      setError(walletErrorMessage(nextError));
    });
  }, [
    connect,
    connected,
    connecting,
    isConnectingSelected,
    open,
    publicKey,
    wallet,
  ]);

  useEffect(() => {
    if (!open || !isConnectingSelected) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (connected || connecting) {
        return;
      }

      const selectedWalletName = selectedWalletNameRef.current;
      if (
        selectedWalletName &&
        wallet?.adapter.name === selectedWalletName &&
        !connectAttemptedRef.current
      ) {
        return;
      }

      setIsConnectingSelected(false);
      setError(
        "Could not start wallet connection. Unlock your wallet and try again."
      );
    }, WALLET_SELECTION_SETTLE_MS);

    return () => window.clearTimeout(timeout);
  }, [connected, connecting, isConnectingSelected, open, wallet]);

  const connectWallet = useCallback(
    (walletName: WalletName) => {
      setError(null);
      setIsConnectingSelected(true);
      selectedWalletNameRef.current = walletName;
      connectAttemptedRef.current = false;

      if (wallet?.adapter.name === walletName) {
        connectAttemptedRef.current = true;
        void connect().catch((nextError) => {
          connectAttemptedRef.current = false;
          setIsConnectingSelected(false);
          setError(walletErrorMessage(nextError));
        });
        return;
      }

      select(walletName);
    },
    [connect, select, wallet]
  );

  const disconnectWrongWallet = useCallback(async () => {
    setError(null);
    setIsConnectingSelected(false);
    selectedWalletNameRef.current = null;
    connectAttemptedRef.current = false;
    await disconnect();
  }, [disconnect]);

  if (!open || !expectedWalletAddress) {
    return null;
  }

  const isBusy = connecting || isConnectingSelected;

  return (
    <div
      aria-modal="true"
      role="dialog"
      style={{
        alignItems: "center",
        background: "rgba(0, 0, 0, 0.28)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: "20px",
        position: "fixed",
        zIndex: 80,
      }}
    >
      <div
        style={{
          background: "#fff",
          border: "1px solid rgba(0, 0, 0, 0.08)",
          borderRadius: "28px",
          boxShadow: "0 24px 70px rgba(0, 0, 0, 0.22)",
          color: "#111",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          maxWidth: "420px",
          padding: "20px",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", gap: "14px" }}>
          <span
            style={{
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.04)",
              borderRadius: "18px",
              display: "flex",
              flexShrink: 0,
              height: "52px",
              justifyContent: "center",
              width: "52px",
            }}
          >
            {isMatchingWallet ? (
              <Check aria-hidden="true" size={22} />
            ) : isWrongWallet ? (
              <AlertCircle aria-hidden="true" size={22} />
            ) : (
              <Wallet aria-hidden="true" size={22} />
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "22px",
                fontWeight: 600,
                lineHeight: "28px",
                margin: 0,
              }}
            >
              {isMatchingWallet
                ? "Wallet reconnected"
                : isWrongWallet
                ? "Wrong wallet connected"
                : "Reconnect wallet"}
            </h2>
            <p
              style={{
                color: "rgba(60, 60, 67, 0.72)",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "14px",
                lineHeight: "20px",
                margin: "4px 0 0",
              }}
            >
              Sign with {formatAddress(expectedWalletAddress)} to continue.
            </p>
          </div>
        </div>

        {isWrongWallet ? (
          <div
            style={{
              background: "rgba(249, 54, 60, 0.1)",
              borderRadius: "14px",
              color: "#9D1B1F",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "13px",
              lineHeight: "18px",
              padding: "10px 12px",
            }}
          >
            Connected wallet {formatAddress(connectedAddress ?? "")} does not
            match the signed-in wallet.
          </div>
        ) : null}

        {error ? (
          <div
            style={{
              background: "rgba(249, 54, 60, 0.1)",
              borderRadius: "14px",
              color: "#9D1B1F",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "13px",
              lineHeight: "18px",
              padding: "10px 12px",
            }}
          >
            {error}
          </div>
        ) : null}

        {isMatchingWallet ? (
          <button
            onClick={onReady}
            style={{
              background: "#000",
              border: "none",
              borderRadius: "9999px",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "15px",
              fontWeight: 500,
              height: "48px",
            }}
            type="button"
          >
            Continue signing
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {installedWallets.map((installedWallet) => (
              <button
                disabled={isBusy}
                key={installedWallet.adapter.name}
                onClick={() => connectWallet(installedWallet.adapter.name)}
                style={{
                  alignItems: "center",
                  background: "rgba(0, 0, 0, 0.04)",
                  border: "none",
                  borderRadius: "16px",
                  color: "#111",
                  cursor: isBusy ? "default" : "pointer",
                  display: "flex",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "14px",
                  gap: "12px",
                  height: "52px",
                  opacity: isBusy ? 0.55 : 1,
                  padding: "0 14px",
                  textAlign: "left",
                }}
                type="button"
              >
                {installedWallet.adapter.icon ? (
                  // Wallet adapter icons are extension-provided URLs/data URIs.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    src={installedWallet.adapter.icon}
                    style={{ height: "24px", width: "24px" }}
                  />
                ) : (
                  <Wallet aria-hidden="true" size={20} />
                )}
                <span style={{ flex: 1 }}>{installedWallet.adapter.name}</span>
                {isBusy &&
                wallet?.adapter.name === installedWallet.adapter.name ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin"
                    size={18}
                  />
                ) : null}
              </button>
            ))}
            {installedWallets.length === 0 ? (
              <p
                style={{
                  color: "rgba(60, 60, 67, 0.72)",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "14px",
                  lineHeight: "20px",
                  margin: 0,
                  textAlign: "center",
                }}
              >
                No wallet extensions detected.
              </p>
            ) : null}
          </div>
        )}

        <div style={{ display: "flex", gap: "10px" }}>
          {isWrongWallet ? (
            <button
              onClick={disconnectWrongWallet}
              style={{
                alignItems: "center",
                background: "rgba(249, 54, 60, 0.12)",
                border: "none",
                borderRadius: "9999px",
                color: "#F9363C",
                cursor: "pointer",
                display: "flex",
                flex: 1,
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "14px",
                fontWeight: 500,
                gap: "8px",
                height: "44px",
                justifyContent: "center",
              }}
              type="button"
            >
              <Unplug aria-hidden="true" size={16} />
              Disconnect wallet
            </button>
          ) : null}
          <button
            onClick={onClose}
            style={{
              background: "rgba(0, 0, 0, 0.04)",
              border: "none",
              borderRadius: "9999px",
              color: "#111",
              cursor: "pointer",
              flex: 1,
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              fontWeight: 500,
              height: "44px",
            }}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
