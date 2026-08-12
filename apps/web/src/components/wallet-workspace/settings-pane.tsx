"use client";

import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import { usePublicEnv } from "@/contexts/public-env-context";

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

export function SettingsPane() {
  const publicEnv = usePublicEnv();
  const activeValue = publicEnv.solanaEnv;

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
              return (
                <div
                  className="settings-network-row"
                  key={option.value}
                  style={{
                    alignItems: "center",
                    background: "transparent",
                    border: "none",
                    borderRadius: "16px",
                    display: "flex",
                    padding: "10px 12px",
                    width: "100%",
                  }}
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
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
