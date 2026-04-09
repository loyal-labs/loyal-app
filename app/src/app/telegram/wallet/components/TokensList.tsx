"use client";

import { hapticFeedback } from "@telegram-apps/sdk-react";
import Image from "next/image";

import {
  resolveTokenIcon,
  type TokenHolding,
} from "@/lib/solana/token-holdings";

interface TokensListProps {
  tokenHoldings: TokenHolding[];
  solPriceUsd: number | null;
  onShowAll: () => void;
}

export function TokensList({
  tokenHoldings,
  solPriceUsd,
  onShowAll,
}: TokensListProps) {
  const formatEarnedLabel = (earnedBalance: number, symbol: string): string =>
    `Earned ${earnedBalance.toLocaleString("en-US", {
      maximumFractionDigits: 4,
    })} ${symbol}`;

  const displayTokens =
    tokenHoldings.length > 0
      ? tokenHoldings
      : [
          {
            mint: "SOL",
            symbol: "SOL",
            name: "Solana",
            balance: 0,
            decimals: 9,
            priceUsd: solPriceUsd,
            valueUsd: 0,
            imageUrl: "/tokens/solana-sol-logo.png",
          },
        ];

  return (
    <>
      <div className="px-3 pt-3 pb-2">
        <p className="text-base font-medium text-black leading-5 tracking-[-0.176px]">
          Tokens
        </p>
      </div>
      <div className="flex flex-col gap-2 items-center px-4 pb-4">
        {displayTokens.slice(0, 5).map((token) => {
          const iconSrc = resolveTokenIcon(token);

          return (
            <div
              key={`${token.mint}${token.isSecured ? "-secure" : ""}`}
              className="flex items-center w-full overflow-hidden rounded-[20px] px-4 py-1"
              style={{ border: "2px solid #f2f2f7" }}
            >
              {/* Token icon */}
              <div className="py-1.5 pr-3">
                <div className="w-12 h-12 relative">
                  <div className="w-12 h-12 rounded-full overflow-hidden relative bg-[#f2f2f7]">
                    <Image
                      src={iconSrc}
                      alt={token.symbol}
                      fill
                      className="object-cover"
                    />
                  </div>
                  {token.isSecured && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-[20px] h-[20px]">
                      <Image
                        src="/Shield.svg"
                        alt="Secured"
                        width={20}
                        height={20}
                      />
                    </div>
                  )}
                </div>
              </div>
              {/* Token info */}
              <div className="flex-1 flex flex-col py-2.5 min-w-0">
                <p className="text-[17px] font-medium text-black leading-[22px] tracking-[-0.187px]">
                  {token.symbol}
                </p>
                <p
                  className="text-[15px] leading-5"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                >
                  {typeof token.earnedBalance === "number"
                    ? formatEarnedLabel(token.earnedBalance, token.symbol)
                    : token.priceUsd !== null
                    ? `$${token.priceUsd.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : "\u2014"}
                </p>
              </div>
              {/* Token amount */}
              <div className="flex flex-col items-end py-2.5 pl-3">
                <p className="text-[17px] text-black leading-[22px] text-right">
                  {token.balance.toLocaleString("en-US", {
                    maximumFractionDigits: 4,
                  })}
                </p>
                <p
                  className="text-[15px] leading-5 text-right"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                >
                  {token.valueUsd !== null
                    ? `$${token.valueUsd.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : "\u2014"}
                </p>
              </div>
            </div>
          );
        })}

        {/* Show All button */}
        {tokenHoldings.length > 5 && (
          <button
            onClick={() => {
              if (hapticFeedback.impactOccurred.isAvailable()) {
                hapticFeedback.impactOccurred("light");
              }
              onShowAll();
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium leading-5"
            style={{
              background: "rgba(249, 54, 60, 0.14)",
              color: "#f9363c",
            }}
          >
            Show All
          </button>
        )}
      </div>
    </>
  );
}
