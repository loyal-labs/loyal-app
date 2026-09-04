import type {
  ShieldedBalance,
  UnshieldResult,
} from "@loyal-labs/wallet-core/hooks";
import { getTokenIconUrl } from "@loyal-labs/wallet-core/lib";
import type { PortfolioPosition } from "@loyal-labs/solana-wallet";
import { ExternalLink, X } from "lucide-react";
import { useState } from "react";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

// ponytail: shielded-only tokens have no portfolio position; known mints get
// symbol/decimals here, anything else shows the raw amount + short mint.
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  So11111111111111111111111111111111111111112: { symbol: "SOL", decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
};

function formatAmount(amountRaw: bigint, decimals: number): string {
  const whole = amountRaw / 10n ** BigInt(decimals);
  const fraction = (amountRaw % 10n ** BigInt(decimals))
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function UnshieldContent({
  balances,
  positions,
  executeUnshield,
  loading,
  error,
  onClose,
}: {
  balances: ShieldedBalance[];
  positions: PortfolioPosition[];
  executeUnshield: (tokenMint: string) => Promise<UnshieldResult>;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [activeMint, setActiveMint] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const handleUnshield = async (tokenMint: string) => {
    setActiveMint(tokenMint);
    setSignature(null);
    const result = await executeUnshield(tokenMint);
    if (result.success && result.signature) setSignature(result.signature);
    setActiveMint(null);
  };

  return (
    <>
      <style>{`
        .unshield-close:hover { background: rgba(0, 0, 0, 0.08) !important; }
        .unshield-btn:hover:not(:disabled) { background: rgba(0, 0, 0, 0.85) !important; }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px",
        }}
      >
        <div style={{ flex: 1, padding: "4px 0 4px 12px" }}>
          <span
            style={{
              fontFamily: font,
              fontSize: "18px",
              fontWeight: 600,
              lineHeight: "28px",
              color: "#000",
            }}
          >
            Unshield
          </span>
        </div>
        <button
          className="unshield-close"
          onClick={onClose}
          style={{
            width: "36px",
            height: "36px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.04)",
            border: "none",
            borderRadius: "9999px",
            cursor: "pointer",
            transition: "all 0.2s ease",
            color: "#3C3C43",
            flexShrink: 0,
          }}
          type="button"
        >
          <X size={24} />
        </button>
      </div>

      {/* Body */}
      <div
        style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "0 12px" }}
      >
        <p
          style={{
            fontFamily: font,
            fontSize: "14px",
            lineHeight: "20px",
            color: secondary,
            padding: "0 12px 12px",
          }}
        >
          Shielded balances are being sunset. Move your full balance back to
          your wallet.
        </p>

        {balances.length === 0 && (
          <p
            style={{
              fontFamily: font,
              fontSize: "14px",
              color: secondary,
              textAlign: "center",
              padding: "24px 12px",
            }}
          >
            No shielded balances.
          </p>
        )}

        {balances.map(({ tokenMint, amountRaw }) => {
          const position = positions.find((p) => p.asset.mint === tokenMint);
          const known = KNOWN_TOKENS[tokenMint];
          const symbol =
            position?.asset.symbol ?? known?.symbol ?? tokenMint.slice(0, 4);
          const decimals = position?.asset.decimals ?? known?.decimals ?? 0;
          const icon = position?.asset.imageUrl || getTokenIconUrl(symbol);
          const isActive = loading && activeMint === tokenMint;
          return (
            <div
              key={tokenMint}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "8px 12px",
                borderRadius: "16px",
              }}
            >
              <img
                alt={symbol}
                height={40}
                src={icon}
                style={{ borderRadius: "9999px", objectFit: "cover" }}
                width={40}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 500,
                    color: "#000",
                  }}
                >
                  {symbol}
                </div>
                <div
                  style={{
                    fontFamily: font,
                    fontSize: "13px",
                    color: secondary,
                  }}
                >
                  {formatAmount(amountRaw, decimals)} shielded
                </div>
              </div>
              <button
                className="unshield-btn"
                disabled={loading}
                onClick={() => void handleUnshield(tokenMint)}
                style={{
                  padding: "8px 16px",
                  background: "#000",
                  border: "none",
                  borderRadius: "9999px",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading && !isActive ? 0.4 : 1,
                  fontFamily: font,
                  fontSize: "14px",
                  color: "#fff",
                  transition: "background 0.2s ease",
                }}
                type="button"
              >
                {isActive ? "Unshielding…" : "Unshield"}
              </button>
            </div>
          );
        })}

        {error && (
          <p
            style={{
              fontFamily: font,
              fontSize: "13px",
              color: "#F9363C",
              padding: "12px",
            }}
          >
            {error}
          </p>
        )}

        {signature && (
          <a
            href={`https://explorer.solana.com/tx/${signature}`}
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontFamily: font,
              fontSize: "13px",
              color: "#34C759",
              padding: "12px",
              textDecoration: "none",
            }}
            target="_blank"
          >
            Unshield confirmed. View in explorer <ExternalLink size={14} />
          </a>
        )}
      </div>
    </>
  );
}
