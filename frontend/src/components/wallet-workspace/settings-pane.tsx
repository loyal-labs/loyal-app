"use client";

import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { SOLANA_ENV_OVERRIDE_COOKIE } from "@/lib/core/config/solana-env-override";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

const NETWORK_OPTIONS: {
  value: Extract<SolanaEnv, "mainnet" | "devnet">;
  label: string;
  description: string;
}[] = [
  {
    value: "mainnet",
    label: "Mainnet",
    description: "Live Solana network",
  },
  {
    value: "devnet",
    label: "Devnet",
    description: "Test network with fake assets",
  },
];

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function setSolanaEnvCookie(value: string): void {
  document.cookie = `${SOLANA_ENV_OVERRIDE_COOKIE}=${value}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function SettingsPane() {
  const publicEnv = usePublicEnv();
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const activeValue = pendingValue ?? publicEnv.solanaEnv;

  const handleSelect = (
    value: Extract<SolanaEnv, "mainnet" | "devnet">
  ) => {
    if (value === activeValue) return;
    setPendingValue(value);
    setSolanaEnvCookie(value);
    window.location.reload();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#fff",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          padding: "20px 20px 16px",
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            color: "#000",
            fontFamily: font,
            fontSize: "32px",
            fontWeight: 600,
            letterSpacing: "-0.4px",
            lineHeight: "36px",
            margin: 0,
          }}
        >
          Settings
        </h1>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 20px 20px",
        }}
      >
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <h2
            style={{
              color: "#000",
              fontFamily: font,
              fontSize: "16px",
              fontWeight: 500,
              letterSpacing: "-0.176px",
              lineHeight: "20px",
              margin: 0,
            }}
          >
            Network
          </h2>
          <p
            style={{
              color: secondary,
              fontFamily: font,
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              margin: 0,
            }}
          >
            Switch between Solana clusters. The page reloads to apply.
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              marginTop: "8px",
            }}
          >
            {NETWORK_OPTIONS.map((option) => {
              const selected = activeValue === option.value;
              const isPending = pendingValue !== null;
              return (
                <button
                  className="settings-network-row"
                  disabled={isPending}
                  key={option.value}
                  onClick={() => handleSelect(option.value)}
                  style={{
                    alignItems: "center",
                    background: "transparent",
                    border: "none",
                    borderRadius: "16px",
                    cursor: isPending ? "default" : "pointer",
                    display: "flex",
                    padding: "10px 12px",
                    transition: "background 0.15s ease",
                    width: "100%",
                  }}
                  type="button"
                >
                  <div
                    style={{
                      display: "flex",
                      flex: 1,
                      flexDirection: "column",
                      gap: "2px",
                      textAlign: "left",
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
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <style jsx>{`
        .settings-network-row:hover:not(:disabled) {
          background: rgba(0, 0, 0, 0.04) !important;
        }
      `}</style>
    </div>
  );
}
