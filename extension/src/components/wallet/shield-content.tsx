import { ArrowDownUp, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useShield } from "@loyal-labs/wallet-core/hooks";

import type { FormButtonProps, SubView, SwapMode, SwapToken } from "@loyal-labs/wallet-core/types";

import { useWalletContext } from "~/src/components/wallet/wallet-provider";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";
const red = "#F9363C";

function SwapShieldTabs({
  mode,
  onModeChange,
  onClose,
}: {
  mode: SwapMode;
  onModeChange: (mode: SwapMode) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.04)",
          borderRadius: "9999px",
          padding: "4px",
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => onModeChange("swap")}
          style={{
            display: "flex",
            gap: "6px",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 16px",
            borderRadius: "9999px",
            border: "none",
            cursor: "pointer",
            background: mode === "swap" ? "#fff" : "transparent",
            fontFamily: font,
            fontSize: "15px",
            fontWeight: mode === "swap" ? 500 : 400,
            lineHeight: "20px",
            color: mode === "swap" ? "#000" : secondary,
            transition: "background 0.2s ease, color 0.2s ease",
          }}
          type="button"
        >
          Swap
        </button>
        <button
          onClick={() => onModeChange("shield")}
          style={{
            display: "flex",
            gap: "6px",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 16px 8px 8px",
            borderRadius: "9999px",
            border: "none",
            cursor: "pointer",
            background: mode === "shield" ? "#fff" : "transparent",
            fontFamily: font,
            fontSize: "15px",
            fontWeight: mode === "shield" ? 500 : 400,
            lineHeight: "20px",
            color: mode === "shield" ? "#000" : secondary,
            transition: "background 0.2s ease, color 0.2s ease",
          }}
          type="button"
        >
          <img
            alt=""
            src="/hero-new/Shield.png"
            style={{ width: "20px", height: "20px" }}
          />
          Shield
        </button>
      </div>
      <div style={{ paddingLeft: "12px" }}>
        <button
          className="shield-close"
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
            transition: "background 0.2s ease",
            color: "#3C3C43",
          }}
          type="button"
        >
          <X size={24} />
        </button>
      </div>
    </div>
  );
}

export { SwapShieldTabs };

function StatusHeader({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px",
      }}
    >
      <div
        style={{
          flex: 1,
          paddingLeft: "12px",
          paddingTop: "4px",
          paddingBottom: "4px",
        }}
      >
        <span
          style={{
            fontFamily: font,
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "28px",
            color: "#000",
          }}
        >
          {title}
        </span>
      </div>
      <button
        className="shield-close"
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
        }}
        type="button"
      >
        <X size={24} />
      </button>
    </div>
  );
}

function ShieldedTokenPill({ token }: { token: SwapToken }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 4px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 14px 4px 4px",
          position: "relative",
        }}
      >
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "9999px",
            overflow: "hidden",
            marginRight: "-8px",
          }}
        >
          <img
            alt={token.symbol}
            height={28}
            src={token.icon}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            width={28}
          />
        </div>
        <img
          alt="Shielded"
          src="/hero-new/Shield.png"
          style={{
            width: "16px",
            height: "16px",
            position: "absolute",
            bottom: "2px",
            right: "2px",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: font,
          fontSize: "16px",
          fontWeight: 500,
          lineHeight: "20px",
          color: "#000",
          letterSpacing: "-0.176px",
          whiteSpace: "nowrap",
          padding: "8px 0",
        }}
      >
        {token.symbol}
      </span>
    </div>
  );
}

function SelectableTokenPill({
  token,
  onClick,
}: {
  token: SwapToken;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        background: "#F5F5F5",
        borderRadius: "54px",
        padding: "0 4px",
        border: "none",
        cursor: "pointer",
        flexShrink: 0,
      }}
      type="button"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          paddingRight: "6px",
          padding: "4px 6px 4px 4px",
        }}
      >
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "9999px",
            overflow: "hidden",
          }}
        >
          <img
            alt={token.symbol}
            height={28}
            src={token.icon}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            width={28}
          />
        </div>
      </div>
      <span
        style={{
          fontFamily: font,
          fontSize: "16px",
          fontWeight: 500,
          lineHeight: "20px",
          color: "#000",
          letterSpacing: "-0.176px",
          whiteSpace: "nowrap",
          padding: "8px 0",
        }}
      >
        {token.symbol}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "36px",
          padding: "8px 0",
        }}
      >
        <ChevronRight size={16} style={{ color: "#3C3C43" }} />
      </div>
    </button>
  );
}

function ShieldedSelectableTokenPill({
  token,
  onClick,
}: {
  token: SwapToken;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        background: "#F5F5F5",
        borderRadius: "54px",
        padding: "0 4px",
        border: "none",
        cursor: "pointer",
        flexShrink: 0,
      }}
      type="button"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 14px 4px 4px",
          position: "relative",
        }}
      >
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "9999px",
            overflow: "hidden",
            marginRight: "-8px",
          }}
        >
          <img
            alt={token.symbol}
            height={28}
            src={token.icon}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            width={28}
          />
        </div>
        <img
          alt="Shielded"
          src="/hero-new/Shield.png"
          style={{
            width: "16px",
            height: "16px",
            position: "absolute",
            bottom: "2px",
            right: "2px",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: font,
          fontSize: "16px",
          fontWeight: 500,
          lineHeight: "20px",
          color: "#000",
          letterSpacing: "-0.176px",
          whiteSpace: "nowrap",
          padding: "8px 0",
        }}
      >
        {token.symbol}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "36px",
          padding: "8px 0",
        }}
      >
        <ChevronRight size={16} style={{ color: "#3C3C43" }} />
      </div>
    </button>
  );
}

type ShieldPhase = "form" | "processing" | "success" | "error" | "details";

export function ShieldContent({
  onClose,
  onDone,
  onNavigate,
  token: tokenProp,
  onTokenChange,
  securedBalance,
  swapMode,
  onSwapModeChange,
  hideFormChrome,
  onFormActiveChange,
  onFormButtonChange,
}: {
  onClose: () => void;
  onDone: () => void;
  onNavigate: (view: SubView) => void;
  token: SwapToken;
  onTokenChange: (t: SwapToken) => void;
  securedBalance: number;
  swapMode: SwapMode;
  onSwapModeChange: (mode: SwapMode) => void;
  hideFormChrome?: boolean;
  onFormActiveChange?: (isForm: boolean) => void;
  onFormButtonChange?: (props: FormButtonProps | null) => void;
}) {
  const { signer, connection, network } = useWalletContext();

  // Map extension network to SolanaEnv expected by hooks
  const solanaEnv = network === "mainnet" ? "mainnet" : "devnet";

  const { executeShield: shieldFn, executeUnshield: unshieldFn } = useShield(signer, connection, solanaEnv);
  const [direction, setDirection] = useState<"shield" | "unshield">("shield");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<ShieldPhase>("form");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [resultAmount, setResultAmount] = useState("");
  const [resultUsd, setResultUsd] = useState("");

  useEffect(() => {
    onFormActiveChange?.(phase === "form");
  }, [phase, onFormActiveChange]);

  const token = tokenProp;
  const numericAmount = Number.parseFloat(amount) || 0;
  const hasAmount = numericAmount > 0;

  const sourceBalance = direction === "shield" ? token.balance : securedBalance;
  const destBalance = direction === "shield" ? securedBalance : token.balance;
  const insufficientFunds = numericAmount > sourceBalance;

  const usdValue = useMemo(
    () =>
      (numericAmount * token.price).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [numericAmount, token.price]
  );

  const exchangeRate = useMemo(
    () =>
      `1 ${token.symbol} ≈ $${token.price.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })}`,
    [token.symbol, token.price]
  );

  const buttonLabel = !hasAmount
    ? "Enter Amount"
    : insufficientFunds
    ? "Insufficient Funds"
    : direction === "shield"
    ? "Confirm and Shield"
    : "Confirm and Unshield";
  const buttonDisabled = !hasAmount || insufficientFunds;
  const amountColor = insufficientFunds && hasAmount ? red : "#000";

  const handleToggleDirection = useCallback(() => {
    setDirection((d) => (d === "shield" ? "unshield" : "shield"));
  }, []);

  const handlePercentage = useCallback(
    (pct: number) => {
      const bal = sourceBalance;
      const val = pct === 100 ? bal : bal * (pct / 100);
      setAmount(val > 0 ? String(Number(val.toFixed(6))) : "");
    },
    [sourceBalance]
  );

  const handleConfirm = useCallback(async () => {
    if (!hasAmount || insufficientFunds) return;

    setResultAmount(String(numericAmount));
    setResultUsd(
      `$${(numericAmount * token.price).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    );
    setErrorMessage(undefined);
    setPhase("processing");

    const params = {
      tokenSymbol: token.symbol,
      amount: numericAmount,
      tokenMint: token.mint,
    };

    const result =
      direction === "shield"
        ? await shieldFn(params)
        : await unshieldFn(params);

    if (result.success) {
      setPhase("success");
      setAmount("");
    } else {
      setErrorMessage(result.error);
      setPhase("error");
    }
  }, [
    hasAmount,
    insufficientFunds,
    numericAmount,
    token.price,
    token.symbol,
    token.mint,
    direction,
    shieldFn,
    unshieldFn,
  ]);

  // Report form button props to parent when chrome is managed externally
  useEffect(() => {
    if (!hideFormChrome || !onFormButtonChange) return;
    if (phase !== "form") {
      onFormButtonChange(null);
      return;
    }
    onFormButtonChange({
      label: buttonLabel,
      disabled: buttonDisabled,
      onClick: handleConfirm,
    });
  });

  // Cross-fade between phases
  const [phaseOpacity, setPhaseOpacity] = useState(1);
  const [displayPhase, setDisplayPhase] = useState<ShieldPhase>(phase);
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (phase !== prevPhase.current) {
      setPhaseOpacity(0);
      const t = setTimeout(() => {
        setDisplayPhase(phase);
        setPhaseOpacity(1);
        prevPhase.current = phase;
      }, 200);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const renderPhaseContent = (p: ShieldPhase) => {
    if (p === "processing") {
      return (
        <div
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          <style>{`
            .shield-close:hover {
              background: rgba(0, 0, 0, 0.08) !important;
            }
            @keyframes chevronBounce {
              0%,
              100% {
                transform: translateX(0);
              }
              50% {
                transform: translateX(4px);
              }
            }
          `}</style>

          <StatusHeader
            onClose={onClose}
            title={direction === "shield" ? "Shield" : "Unshield"}
          />

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "20px",
                alignItems: "center",
                padding: "24px 32px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: "16px",
                  alignItems: "center",
                  padding: "8px 0",
                }}
              >
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "9999px",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  <img
                    alt={token.symbol}
                    height={64}
                    src={token.icon}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                    width={64}
                  />
                </div>
                <ChevronRight
                  size={16}
                  style={{
                    color: secondary,
                    animation: "chevronBounce 1s ease-in-out infinite",
                  }}
                />
                <img
                  alt={direction === "shield" ? "Shield" : "Unshield"}
                  src={
                    direction === "shield"
                      ? "/hero-new/Shield.png"
                      : "/hero-new/Unshield.svg"
                  }
                  style={{ width: "64px", height: "64px", flexShrink: 0 }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  alignItems: "center",
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "20px",
                    fontWeight: 600,
                    lineHeight: "24px",
                    color: "#000",
                  }}
                >
                  {direction === "shield" ? "Shielding..." : "Unshielding..."}
                </span>
              </div>
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <button
              disabled
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "9999px",
                background: "#CCCDCD",
                border: "none",
                cursor: "default",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#fff",
                textAlign: "center",
              }}
              type="button"
            >
              In progress...
            </button>
          </div>
        </div>
      );
    }

    if (p === "success" || p === "error") {
      const isSuccess = p === "success";
      return (
        <div
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          <style>{`
            .shield-close:hover {
              background: rgba(0, 0, 0, 0.08) !important;
            }
            .shield-done-btn:hover {
              background: #333 !important;
            }
            .shield-done-secondary-btn:hover {
              background: rgba(0, 0, 0, 0.08) !important;
            }
            @keyframes mascotNod {
              0%,
              100% {
                transform: rotate(0deg);
              }
              25% {
                transform: rotate(4deg);
              }
              75% {
                transform: rotate(-4deg);
              }
            }
          `}</style>

          <StatusHeader
            onClose={onClose}
            title={
              isSuccess
                ? direction === "shield"
                  ? "Shield"
                  : "Unshield"
                : "Shield/Unshield"
            }
          />

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "20px",
                alignItems: "center",
                padding: "24px 32px",
              }}
            >
              <img
                alt={isSuccess ? "Success" : "Error"}
                src={
                  isSuccess ? "/hero-new/success.svg" : "/hero-new/error.svg"
                }
                style={{
                  width: "100px",
                  height: "80px",
                  animation: "mascotNod 0.6s ease-in-out 2",
                  transformOrigin: "center bottom",
                }}
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  alignItems: "center",
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "20px",
                    fontWeight: 600,
                    lineHeight: "24px",
                    color: "#000",
                  }}
                >
                  {isSuccess
                    ? `${token.symbol} ${
                        direction === "shield" ? "Shielded" : "Unshielded"
                      }`
                    : direction === "shield"
                    ? "Shielding Failed"
                    : "Unshielding Failed"}
                </span>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                    maxWidth: "255px",
                  }}
                >
                  {isSuccess ? (
                    <>
                      <span style={{ color: "#000" }}>
                        {resultAmount} {token.symbol}
                      </span>
                      {` moved to your ${
                        direction === "shield" ? "secure" : "main"
                      } balance`}
                    </>
                  ) : (
                    errorMessage || "Something went wrong. Please try again."
                  )}
                </span>
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {isSuccess && (
              <button
                className="shield-done-btn"
                onClick={() => setPhase("details")}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: "9999px",
                  background: "#000",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: "#fff",
                  textAlign: "center",
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                Transaction Details
              </button>
            )}
            <button
              className={
                isSuccess ? "shield-done-secondary-btn" : "shield-done-btn"
              }
              onClick={() => {
                setPhase("form");
                onDone();
              }}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "9999px",
                background: isSuccess ? "rgba(0, 0, 0, 0.04)" : "#000",
                border: "none",
                cursor: "pointer",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: isSuccess ? "#000" : "#fff",
                textAlign: "center",
                transition: "background 0.15s ease",
              }}
              type="button"
            >
              Done
            </button>
          </div>
        </div>
      );
    }

    if (p === "details") {
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const timeStr = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      return (
        <div
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          <style>{`
            .shield-close:hover {
              background: rgba(0, 0, 0, 0.08) !important;
            }
            .shield-done-btn:hover {
              background: #333 !important;
            }
          `}</style>

          <StatusHeader
            onClose={onClose}
            title={direction === "shield" ? "Shielded" : "Unshielded"}
          />

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              padding: "8px",
              overflowY: "auto",
            }}
          >
            {/* Token icon with badge */}
            <div style={{ padding: "8px 12px 0" }}>
              <div
                style={{ position: "relative", width: "48px", height: "56px" }}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "9999px",
                    overflow: "hidden",
                  }}
                >
                  <img
                    alt={token.symbol}
                    height={48}
                    src={token.icon}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                    width={48}
                  />
                </div>
                <img
                  alt={direction === "shield" ? "Shielded" : "Unshielded"}
                  src={
                    direction === "shield"
                      ? "/hero-new/Shield.png"
                      : "/hero-new/Unshield.svg"
                  }
                  style={{
                    width: "24px",
                    height: "24px",
                    position: "absolute",
                    bottom: "0",
                    left: "16px",
                  }}
                />
              </div>
            </div>

            {/* Amount hero */}
            <div style={{ padding: "12px 12px 24px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "8px",
                  fontFamily: font,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                <span
                  style={{
                    fontSize: "40px",
                    lineHeight: "48px",
                    color: "#000",
                  }}
                >
                  {resultAmount}
                </span>
                <span
                  style={{
                    fontSize: "28px",
                    lineHeight: "32px",
                    color: "rgba(60, 60, 67, 0.4)",
                    letterSpacing: "0.4px",
                  }}
                >
                  {token.symbol}
                </span>
              </div>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: secondary,
                  display: "block",
                  marginTop: "4px",
                }}
              >
                ≈{resultUsd}
              </span>
              <span
                style={{
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  lineHeight: "20px",
                  color: secondary,
                  display: "block",
                }}
              >
                {dateStr}, {timeStr}
              </span>
            </div>

            {/* Status card */}
            <div
              style={{
                background: "rgba(0, 0, 0, 0.04)",
                borderRadius: "16px",
                padding: "4px 0",
              }}
            >
              <div style={{ padding: "9px 12px" }}>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 400,
                    lineHeight: "16px",
                    color: secondary,
                    display: "block",
                  }}
                >
                  Status
                </span>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: "#000",
                    display: "block",
                    marginTop: "2px",
                  }}
                >
                  Completed
                </span>
              </div>
            </div>
          </div>

          {/* Done button */}
          <div style={{ padding: "16px 20px" }}>
            <button
              className="shield-done-btn"
              onClick={() => {
                setPhase("form");
                onDone();
              }}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "9999px",
                background: "#000",
                border: "none",
                cursor: "pointer",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#fff",
                textAlign: "center",
                transition: "background 0.15s ease",
              }}
              type="button"
            >
              Done
            </button>
          </div>
        </div>
      );
    }

    // Form phase
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <style>{`
          .shield-close:hover {
            background: rgba(0, 0, 0, 0.08) !important;
          }
          .pct-btn:hover {
            opacity: 0.7;
          }
          .swap-circle:hover {
            background: #333 !important;
          }
          .confirm-btn:not(:disabled):hover {
            background: #333 !important;
          }
        `}</style>

        {/* Header with tabs — hidden when parent owns chrome */}
        {!hideFormChrome && (
          <SwapShieldTabs
            mode={swapMode}
            onClose={onClose}
            onModeChange={onSwapModeChange}
          />
        )}

        {/* Body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0",
            overflow: "auto",
            padding: "8px 8px 16px",
          }}
        >
          {/* Input cards container */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              position: "relative",
              isolation: "isolate",
              overflow: "visible",
            }}
          >
            {/* From card */}
            <div
              style={{
                background: "#fff",
                borderRadius: "16px",
                padding: "10px 12px",
                position: "relative",
                zIndex: 2,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontFamily: font,
                  fontWeight: 400,
                  lineHeight: "20px",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ fontSize: "16px", color: secondary }}>
                  {direction === "shield" ? "You shield" : "You unshield"}
                </span>
                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    alignItems: "center",
                    fontSize: "14px",
                    color: red,
                  }}
                >
                  <button
                    className="pct-btn"
                    onClick={() => handlePercentage(25)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: red,
                      fontFamily: font,
                      fontSize: "14px",
                      fontWeight: 400,
                      padding: 0,
                    }}
                    type="button"
                  >
                    25%
                  </button>
                  <button
                    className="pct-btn"
                    onClick={() => handlePercentage(50)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: red,
                      fontFamily: font,
                      fontSize: "14px",
                      fontWeight: 400,
                      padding: 0,
                    }}
                    type="button"
                  >
                    50%
                  </button>
                  <button
                    className="pct-btn"
                    onClick={() => handlePercentage(100)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: red,
                      fontFamily: font,
                      fontSize: "14px",
                      fontWeight: 400,
                      padding: 0,
                    }}
                    type="button"
                  >
                    Max
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  height: "48px",
                  alignItems: "center",
                }}
              >
                <input
                  inputMode="decimal"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
                  }}
                  placeholder="0"
                  style={{
                    flex: 1,
                    fontFamily: font,
                    fontSize: "32px",
                    fontWeight: 600,
                    lineHeight: "36px",
                    color: amountColor,
                    background: "none",
                    border: "none",
                    outline: "none",
                    padding: 0,
                    minWidth: 0,
                  }}
                  type="text"
                  value={amount}
                />
                {direction === "shield" ? (
                  <SelectableTokenPill
                    onClick={() => onNavigate({ type: "shieldTokenSelect" })}
                    token={token}
                  />
                ) : (
                  <ShieldedSelectableTokenPill
                    onClick={() => onNavigate({ type: "shieldTokenSelect" })}
                    token={token}
                  />
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{ display: "flex", gap: "6px", alignItems: "center" }}
                >
                  <div
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "9999px",
                      background: "#F5F5F5",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ArrowDownUp
                      size={12}
                      style={{ color: secondary, opacity: 0.4 }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: font,
                      fontSize: "14px",
                      fontWeight: 400,
                      lineHeight: "20px",
                      color: secondary,
                    }}
                  >
                    {exchangeRate}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "14px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                  }}
                >
                  Balance: {sourceBalance.toLocaleString()}{" "}
                </span>
              </div>

              {/* Swap circle — toggles shield/unshield */}
              <button
                className="swap-circle"
                onClick={handleToggleDirection}
                style={{
                  position: "absolute",
                  bottom: "-18px",
                  left: "calc(50% + 4px)",
                  transform: "translateX(-50%)",
                  width: "28px",
                  height: "28px",
                  borderRadius: "9999px",
                  background: "#000",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  zIndex: 3,
                  transition: "background 0.15s ease",
                }}
                type="button"
              >
                <ArrowDownUp size={16} style={{ color: "#fff" }} />
              </button>
            </div>

            {/* To card */}
            <div
              style={{
                border: "1px solid rgba(0, 0, 0, 0.08)",
                borderRadius: "16px",
                padding: "12px",
                zIndex: 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                  }}
                >
                  You receive
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  height: "48px",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontFamily: font,
                    fontSize: "32px",
                    fontWeight: 600,
                    lineHeight: "36px",
                    color:
                      insufficientFunds && hasAmount
                        ? red
                        : hasAmount
                        ? "#000"
                        : "rgba(60, 60, 67, 0.4)",
                    minWidth: 0,
                  }}
                >
                  {hasAmount ? amount : "0"}
                </span>
                {direction === "shield" ? (
                  <ShieldedTokenPill token={token} />
                ) : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "0 4px",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        paddingRight: "6px",
                        padding: "4px 6px 4px 4px",
                      }}
                    >
                      <div
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "9999px",
                          overflow: "hidden",
                        }}
                      >
                        <img
                          alt={token.symbol}
                          height={28}
                          src={token.icon}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                          width={28}
                        />
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: font,
                        fontSize: "16px",
                        fontWeight: 500,
                        lineHeight: "20px",
                        color: "#000",
                        letterSpacing: "-0.176px",
                        whiteSpace: "nowrap",
                        padding: "8px 0",
                      }}
                    >
                      {token.symbol}
                    </span>
                  </div>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "14px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                  }}
                >
                  ${hasAmount ? usdValue : "0"}
                </span>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "14px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: secondary,
                  }}
                >
                  Balance: {destBalance.toLocaleString()}{" "}
                </span>
              </div>
            </div>
          </div>

          {/* Spacer to push info card to bottom */}
          <div style={{ flex: 1 }} />

          {/* Info card about shielded assets */}
          <div style={{ padding: "0 12px" }}>
            <div
              style={{
                background: "rgba(0, 0, 0, 0.04)",
                borderRadius: "16px",
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  paddingRight: "12px",
                  padding: "4px 12px 4px 0",
                  flexShrink: 0,
                }}
              >
                <img
                  alt=""
                  src="/hero-new/Shield.png"
                  style={{ width: "40px", height: "40px" }}
                />
              </div>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  padding: "10px 0",
                }}
              >
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "16px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: "#000",
                  }}
                >
                  What are Shielded Assets?
                </span>
                <span
                  style={{
                    fontFamily: font,
                    fontSize: "13px",
                    fontWeight: 400,
                    lineHeight: "16px",
                    color: secondary,
                  }}
                >
                  When you shield assets, they move to your private balance.
                  This enables private transactions without revealing your
                  address or sensitive data on-chain.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom button — hidden when parent owns chrome */}
        {!hideFormChrome && (
          <div style={{ padding: "16px 20px" }}>
            <button
              className="confirm-btn"
              disabled={buttonDisabled}
              onClick={handleConfirm}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: "9999px",
                background: buttonDisabled ? "#CCCDCD" : "#000",
                border: "none",
                cursor: buttonDisabled ? "default" : "pointer",
                fontFamily: font,
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "#fff",
                textAlign: "center",
                transition: "background 0.15s ease",
              }}
              type="button"
            >
              {buttonLabel}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        opacity: phaseOpacity,
        transition: "opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {renderPhaseContent(displayPhase)}
    </div>
  );
}
