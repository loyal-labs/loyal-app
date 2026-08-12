"use client";

import NumberFlow from "@number-flow/react";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Brush, Copy, RefreshCcw } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import { formatAddress } from "@/lib/solana/wallet/formatters";

interface BalanceCardProps {
  balanceRef: React.RefObject<HTMLDivElement | null>;
  walletAddress: string | null;
  isLoading: boolean;
  walletError: string | null;
  onRetry: () => void;
  balanceBg: string | null;
  bgLoaded: boolean;
  displayCurrency: "USD" | "SOL";
  usdBalance: number;
  solBalance: number;
  showBalanceSkeleton: boolean;
  showSecondarySkeleton: boolean;
  onToggleCurrency: () => void;
  onOpenBgPicker: () => void;
}

export function BalanceCard({
  balanceRef,
  walletAddress,
  isLoading,
  walletError,
  onRetry,
  balanceBg,
  bgLoaded,
  displayCurrency,
  usdBalance,
  solBalance,
  showBalanceSkeleton,
  showSecondarySkeleton,
  onToggleCurrency,
  onOpenBgPicker,
}: BalanceCardProps) {
  const [addressCopied, setAddressCopied] = useState(false);
  const solanaEnv = getSolanaEnv();

  return (
    <div className="flex flex-col items-center pt-5 px-4">
      <div
        ref={balanceRef}
        className="relative w-full overflow-hidden rounded-[26px]"
        style={{
          border: "2px solid rgba(255, 255, 255, 0.1)",
          aspectRatio: "361 / 203",
        }}
      >
        {/* Card background layers */}
        <div
          className="absolute inset-0 rounded-[26px]"
          style={{ background: "#f2f2f7" }}
        />
        {!bgLoaded && (
          <div
            className="absolute inset-0 rounded-[26px] animate-pulse"
            style={{ background: "rgba(0, 0, 0, 0.04)" }}
          />
        )}
        {balanceBg && (
          <Image
            src={`/bgs/${balanceBg}.png`}
            alt=""
            fill
            className="object-cover rounded-[26px]"
            priority
          />
        )}
        {/* Inner shadow overlay */}
        <div
          className="absolute inset-0 rounded-[26px] pointer-events-none"
          style={{
            boxShadow: "inset 0px 0px 36px 0px rgba(255, 255, 255, 0.4)",
          }}
        />

        {/* Card content */}
        <div className="relative flex flex-col justify-between h-full p-4">
          {walletError ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 py-2">
              <p
                className="text-[15px] leading-[20px] text-center px-4"
                style={{ color: balanceBg ? "white" : "#1c1c1e" }}
              >
                {walletError}
              </p>
              <button
                onClick={onRetry}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full active:scale-95 transition-transform"
                style={{
                  background: balanceBg
                    ? "rgba(255, 255, 255, 0.2)"
                    : "rgba(0, 0, 0, 0.06)",
                }}
              >
                <RefreshCcw
                  size={16}
                  strokeWidth={2}
                  style={{
                    color: balanceBg ? "white" : "#1c1c1e",
                  }}
                />
                <span
                  className="text-[15px] font-medium"
                  style={{ color: balanceBg ? "white" : "#1c1c1e" }}
                >
                  Retry
                </span>
              </button>
            </div>
          ) : (
            <>
              {/* Top: Wallet address + network */}
              <div className="flex flex-col gap-0.5">
                {isLoading || !walletAddress ? (
                  <>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 bg-white/20 animate-pulse rounded" />
                      <div className="w-24 h-5 bg-white/20 animate-pulse rounded" />
                    </div>
                    <div className="w-20 h-4 bg-white/10 animate-pulse rounded mt-0.5 ml-0.5" />
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (hapticFeedback.impactOccurred.isAvailable()) {
                          hapticFeedback.impactOccurred("light");
                        }
                        if (walletAddress) {
                          if (navigator?.clipboard?.writeText) {
                            navigator.clipboard.writeText(walletAddress);
                            setAddressCopied(true);
                            setTimeout(() => setAddressCopied(false), 2000);
                          }
                          if (hapticFeedback.notificationOccurred.isAvailable()) {
                            hapticFeedback.notificationOccurred("success");
                          }
                        }
                      }}
                      className="flex items-center gap-1 active:opacity-70 transition-opacity self-start"
                    >
                      <Copy
                        className="w-5 h-5"
                        strokeWidth={1.5}
                        style={{
                          color: balanceBg ? "white" : "rgba(60, 60, 67, 0.6)",
                        }}
                      />
                      <span
                        className="text-[17px] leading-[22px]"
                        style={{
                          color: balanceBg ? "white" : "rgba(60, 60, 67, 0.6)",
                        }}
                      >
                        {addressCopied ? "Copied!" : formatAddress(walletAddress)}
                      </span>
                    </button>
                    <span
                      className="text-[13px] leading-[18px] capitalize pl-0.5"
                      style={{
                        color: balanceBg
                          ? "rgba(255, 255, 255, 0.7)"
                          : "rgba(60, 60, 67, 0.45)",
                      }}
                    >
                      Solana {solanaEnv}
                    </span>
                  </>
                )}
              </div>

          {/* Bottom: Balance + USD value */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={onToggleCurrency}
              className="active:scale-[0.98] transition-transform self-start"
            >
              {(() => {
                const mainColor = balanceBg ? "white" : "#1c1c1e";
                const decimalColor = balanceBg
                  ? "white"
                  : "rgba(60, 60, 67, 0.6)";

                if (showBalanceSkeleton) {
                  return (
                    <div className="flex items-center gap-2">
                      <div className="w-40 h-10 bg-white/20 animate-pulse rounded" />
                      <div className="w-16 h-8 bg-white/20 animate-pulse rounded" />
                    </div>
                  );
                }

                const value =
                  displayCurrency === "USD" ? usdBalance : solBalance;
                const decimals = displayCurrency === "USD" ? 2 : 4;
                const prefix = displayCurrency === "USD" ? "$" : "";
                const suffix = displayCurrency === "SOL" ? " SOL" : "";

                // Convert to a stable fixed string so decimal digits never drift due to float math.
                const fixed = value.toFixed(decimals);
                const [intStr, decStr = "0"] = fixed.split(".");
                const intPart = Number(intStr);
                const decimalDigits = Number(decStr);

                return (
                  <span
                    className="font-semibold inline-flex items-baseline"
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      lineHeight: "48px",
                      color: mainColor,
                    }}
                  >
                    {prefix && (
                      <span className="text-[40px]">{prefix}</span>
                    )}
                    <NumberFlow
                      value={intPart}
                      style={{ fontSize: "40px" }}
                      format={{
                        maximumFractionDigits: 0,
                        useGrouping: true,
                      }}
                      willChange
                    />
                    <NumberFlow
                      value={decimalDigits}
                      prefix="."
                      suffix={suffix}
                      style={{ fontSize: "28px", color: decimalColor }}
                      format={{
                        minimumIntegerDigits: decimals,
                        useGrouping: false,
                      }}
                      willChange
                    />
                  </span>
                );
              })()}
            </button>

            <div className="flex items-center gap-1.5">
              <span
                className="text-[17px] leading-[22px]"
                style={{
                  fontVariantNumeric: "tabular-nums",
                  color: balanceBg ? "white" : "rgba(60, 60, 67, 0.6)",
                }}
              >
                {showSecondarySkeleton ? (
                  <span className="inline-block w-28 h-5 bg-white/20 animate-pulse rounded" />
                ) : displayCurrency === "USD" ? (
                  `${solBalance.toLocaleString("en-US", {
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 4,
                  })} SOL`
                ) : (
                  `$${usdBalance.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                )}
              </span>
            </div>
          </div>

          {/* Brush icon for background picker */}
          {bgLoaded && (
            <button
              onClick={() => {
                if (hapticFeedback.impactOccurred.isAvailable()) {
                  hapticFeedback.impactOccurred("light");
                }
                onOpenBgPicker();
              }}
              className="absolute bottom-4 right-4 p-2 rounded-full backdrop-blur-[8px] active:opacity-70 transition-opacity"
              style={{
                background: balanceBg
                  ? "rgba(255, 255, 255, 0.15)"
                  : "rgba(0, 0, 0, 0.05)",
              }}
            >
              <Brush
                size={20}
                strokeWidth={1.5}
                style={{
                  color: balanceBg
                    ? "rgba(255, 255, 255, 0.6)"
                    : "rgba(60, 60, 67, 0.6)",
                }}
              />
            </button>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
