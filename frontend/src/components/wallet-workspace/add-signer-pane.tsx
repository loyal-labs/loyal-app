"use client";

import { PublicKey } from "@solana/web3.js";
import { Check, Plus, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

import {
  ACCESS_OPTIONS,
  AccessLevelIcon,
  type AccessLevel,
} from "@/components/wallet-sidebar/agent-page-view";
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
  accountIndex,
  existingSigners,
  onAddSigner,
  onAdded,
  pendingActionKey,
  vaultAddress,
  vaultLabel,
}: {
  accountIndex: number;
  existingSigners: SmartAccountSignerEntry[];
  onAddSigner: (args: {
    signerAddress: string;
    accessLevel: AccessLevel;
  }) => Promise<void>;
  onAdded?: (args: { signerAddress: string }) => void;
  pendingActionKey: string | null;
  vaultAddress: string | null;
  vaultLabel: string;
}) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addedAddress, setAddedAddress] = useState<string | null>(null);
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("suggest");
  const normalizedAddress = useMemo(() => normalizeAddress(address), [address]);
  const existingSigner = normalizedAddress
    ? existingSigners.find((signer) => signer.address === normalizedAddress) ??
      null
    : null;
  const isPending =
    normalizedAddress !== null &&
    pendingActionKey === `add-signer:${normalizedAddress}`;
  const isSubmitDisabled =
    isPending || normalizedAddress === null || existingSigner !== null;
  const statusText = error
    ? error
    : existingSigner
      ? `Already added as ${existingSigner.label}`
      : addedAddress
        ? `Added ${formatAddressForDisplay(addedAddress)}`
        : normalizedAddress
          ? formatAddressForDisplay(normalizedAddress)
          : null;
  const statusColor = error
    ? red
    : addedAddress
      ? "#34C759"
      : secondary;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setAddedAddress(null);

    if (!normalizedAddress) {
      setError("Enter a valid Solana wallet address.");
      return;
    }

    if (existingSigner) {
      setError("This wallet is already in the vault tree.");
      return;
    }

    try {
      await onAddSigner({
        signerAddress: normalizedAddress,
        accessLevel,
      });
      setAddedAddress(normalizedAddress);
      setAddress("");
      setAccessLevel("suggest");
      onAdded?.({ signerAddress: normalizedAddress });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Failed to add signer."
      );
    }
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
        .add-signer-access-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
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
            Add signer
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
            title={vaultAddress ?? undefined}
          >
            {vaultLabel} · {vaultAddress ? formatAddressForDisplay(vaultAddress) : `Stash ${accountIndex}`}
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
              New signer
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
                  {addedAddress && <Check size={14} />}
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
                setAddedAddress(null);
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

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              marginTop: "4px",
            }}
          >
            <span
              style={{
                color: "#000",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 500,
                letterSpacing: "-0.176px",
                lineHeight: "20px",
              }}
            >
              Access level
            </span>
            {ACCESS_OPTIONS.map((option) => {
              const selected = accessLevel === option.id;
              return (
                <div
                  className="add-signer-access-row"
                  key={option.id}
                  onClick={() => {
                    if (isPending) return;
                    setAccessLevel(option.id);
                  }}
                  role="button"
                  style={{
                    alignItems: "center",
                    background: "transparent",
                    border: "none",
                    borderRadius: "16px",
                    cursor: isPending ? "default" : "pointer",
                    display: "flex",
                    padding: "6px 12px",
                    transition: "background 0.15s ease",
                    width: "100%",
                  }}
                  tabIndex={0}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      padding: "10px 0",
                      paddingRight: "12px",
                    }}
                  >
                    <AccessLevelIcon level={option.id} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flex: 1,
                      flexDirection: "column",
                      gap: "2px",
                      padding: "10px 0",
                    }}
                  >
                    <span
                      style={{
                        color: "#000",
                        fontFamily: font,
                        fontSize: "16px",
                        fontWeight: 500,
                        letterSpacing: "-0.176px",
                        lineHeight: "20px",
                      }}
                    >
                      {option.label}
                    </span>
                    <span
                      style={{
                        color: secondary,
                        fontFamily: font,
                        fontSize: "13px",
                        fontWeight: 400,
                        lineHeight: "16px",
                      }}
                    >
                      {option.description}
                    </span>
                  </div>
                  <div style={{ flexShrink: 0, paddingLeft: "12px" }}>
                    <div
                      style={{
                        background: "#fff",
                        border: selected
                          ? "7px solid #F9363C"
                          : "2px solid rgba(60, 60, 67, 0.3)",
                        borderRadius: "9999px",
                        boxSizing: "border-box",
                        height: "24px",
                        transition: "border 0.15s ease",
                        width: "24px",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

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
            {isPending ? "Adding" : "Add signer"}
          </button>
        </form>
      </div>
    </div>
  );
}
