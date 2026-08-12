"use client";

import { PublicKey } from "@solana/web3.js";
import { Plus, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

import type { SmartAccountSignerEntry } from "@/hooks/use-smart-account-sidebar-data";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const red = "#F9363C";

function normalizeAddress(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    return null;
  }
}

function formatAddressForDisplay(address: string): string {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function AddSignerPane({
  connectedWalletAddress,
  existingSigners,
  isBackupLimitReached,
  onPreviewSigner,
  settingsAddress,
  targetAccountLabel,
}: {
  connectedWalletAddress: string | null | undefined;
  existingSigners: Pick<SmartAccountSignerEntry, "address" | "label">[];
  isBackupLimitReached: boolean;
  onPreviewSigner: (args: { signerAddress: string }) => void;
  settingsAddress: string | null | undefined;
  targetAccountLabel: string;
}) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const normalizedAddress = useMemo(() => normalizeAddress(address), [address]);
  const connectedAddress = useMemo(
    () => normalizeAddress(connectedWalletAddress ?? ""),
    [connectedWalletAddress]
  );
  const existingSigner = normalizedAddress
    ? existingSigners.find((signer) => signer.address === normalizedAddress) ??
      null
    : null;
  const isConnectedWallet =
    normalizedAddress !== null && normalizedAddress === connectedAddress;
  const isSubmitDisabled =
    isBackupLimitReached ||
    address.trim().length === 0 ||
    existingSigner !== null ||
    isConnectedWallet;
  const statusText = error
    ? error
    : isBackupLimitReached
      ? "Backup account already added"
      : existingSigner
      ? `Already added as ${existingSigner.label}`
      : isConnectedWallet
        ? "This is your current wallet"
        : normalizedAddress
          ? formatAddressForDisplay(normalizedAddress)
          : null;
  const statusColor =
    error || isBackupLimitReached || existingSigner || isConnectedWallet
      ? red
      : secondary;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (isBackupLimitReached) {
      setError("Only one Backup Account can be added.");
      return;
    }

    if (!normalizedAddress) {
      setError("Enter a valid Solana wallet address.");
      return;
    }

    if (isConnectedWallet) {
      setError("Use a different wallet than your current wallet.");
      return;
    }

    if (existingSigner) {
      setError("This wallet is already a signer.");
      return;
    }

    onPreviewSigner({ signerAddress: normalizedAddress });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <style jsx>{`
        .add-signer-submit:hover:not(:disabled) {
          background: #222 !important;
        }
        .add-signer-input:focus {
          border-color: rgba(249, 54, 60, 0.45) !important;
          box-shadow: 0 0 0 3px rgba(249, 54, 60, 0.12);
          outline: none;
        }
      `}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            padding: "0 12px",
          }}
        >
          <span
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 600,
              lineHeight: "20px",
            }}
          >
            Add backup
          </span>
          <span
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={settingsAddress ?? undefined}
          >
            {targetAccountLabel} ·{" "}
            {settingsAddress
              ? formatAddressForDisplay(settingsAddress)
              : "Root settings"}
          </span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", padding: "8px 20px" }}
        >
          <div
            style={{
              width: "64px",
              height: "64px",
              borderRadius: "16px",
              flexShrink: 0,
              marginRight: "12px",
              background: "rgba(249, 54, 60, 0.14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(60, 60, 67, 0.6)",
            }}
          >
            <UserPlus size={32} strokeWidth={1.5} />
          </div>
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              gap: "2px",
              minWidth: 0,
              padding: "9px 0",
            }}
          >
            <span
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "20px",
                fontWeight: 600,
                lineHeight: "24px",
              }}
            >
              New backup
            </span>
          </div>
        </div>

        <form
          onSubmit={submit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            padding: "16px 20px 8px",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 500,
                letterSpacing: "-0.176px",
                lineHeight: "20px",
              }}
            >
              <span>Wallet address</span>
              {statusText && (
                <span
                  style={{
                    color: statusColor,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "13px",
                    fontWeight: 400,
                    letterSpacing: 0,
                  }}
                >
                  {statusText}
                </span>
              )}
            </span>
            <input
              autoComplete="off"
              className="add-signer-input"
              onChange={(event) => {
                setAddress(event.target.value);
                setError(null);
              }}
              placeholder="Paste Solana address"
              spellCheck={false}
              style={{
                width: "100%",
                height: "48px",
                border: "1px solid rgba(0, 0, 0, 0.08)",
                borderRadius: "16px",
                padding: "0 14px",
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                lineHeight: "20px",
                transition: "border-color 0.15s ease, box-shadow 0.15s ease",
              }}
              value={address}
            />
          </label>

          <button
            className="add-signer-submit"
            disabled={isSubmitDisabled}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              height: "44px",
              border: "none",
              borderRadius: "9999px",
              background: "#000",
              color: "#fff",
              cursor: isSubmitDisabled ? "default" : "pointer",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              opacity: isSubmitDisabled ? 0.4 : 1,
              transition: "background 0.15s ease, opacity 0.15s ease",
            }}
            type="submit"
          >
            <Plus size={22} />
            Preview transaction
          </button>
        </form>
      </div>
    </div>
  );
}
