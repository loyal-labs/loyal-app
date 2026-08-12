"use client";

import { NotebookPen } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Recipe } from "@/hooks/use-recipes";
import type { TokenBalance } from "@/hooks/use-wallet-balances";

// Available swap targets
const SWAP_TARGETS = [
  {
    symbol: "SOL",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    gradient: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
    glow: "rgba(153, 69, 255, 0.4)",
  },
  {
    symbol: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    gradient: "linear-gradient(135deg, #2775CA 0%, #4BA3FF 100%)",
    glow: "rgba(39, 117, 202, 0.4)",
  },
  {
    symbol: "USDT",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
    gradient: "linear-gradient(135deg, #26A17B 0%, #50D9A8 100%)",
    glow: "rgba(38, 161, 123, 0.4)",
  },
  {
    symbol: "BONK",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    decimals: 5,
    gradient: "linear-gradient(135deg, #F7931A 0%, #FFB74D 100%)",
    glow: "rgba(247, 147, 26, 0.4)",
  },
  {
    symbol: "LOYAL",
    mint: "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta",
    decimals: 6,
    gradient: "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
    glow: "rgba(239, 68, 68, 0.4)",
  },
];

type SwapFormProps = {
  token: TokenBalance;
  onSwap: (data: {
    fromCurrency: string;
    fromCurrencyMint: string;
    fromCurrencyDecimals: number;
    amount: string;
    toCurrency: string;
    toCurrencyMint: string;
    toCurrencyDecimals: number;
  }) => void;
  onCancel: () => void;
  onCreateRecipe?: (recipe: Omit<Recipe, "id" | "createdAt">) => void;
  onGetQuote: (
    fromToken: string,
    toToken: string,
    amount: string,
    fromMint?: string,
    fromDecimals?: number,
    toDecimals?: number,
    toMint?: string
  ) => Promise<{ outputAmount: string; priceImpact?: string } | null>;
  isLoading?: boolean;
  status?: "pending" | "success" | "error" | null;
  result?: { signature?: string; error?: string } | null;
};

const AMOUNT_PRESETS = [
  { label: "25%", value: 0.25 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "Max", value: 1 },
];

// Shared glass input style
const glassInputStyle = {
  width: "100%",
  padding: "14px 18px",
  background: "rgba(0, 0, 0, 0.25)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: "14px",
  color: "#fff",
  fontSize: "15px",
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  lineHeight: "22px",
  outline: "none",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
};

export function SwapForm({
  token,
  onSwap,
  onCancel,
  onCreateRecipe,
  onGetQuote,
  isLoading = false,
  status = null,
  result = null,
}: SwapFormProps) {
  const [toToken, setToToken] = useState<(typeof SWAP_TARGETS)[number] | null>(
    null
  );
  const [amount, setAmount] = useState("");
  const [activePreset, setActivePreset] = useState<number | null>(null);
  const [quote, setQuote] = useState<{
    outputAmount: string;
    priceImpact?: string;
  } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const amountNum = Number.parseFloat(amount) || 0;
  const isAmountValid = amountNum > 0 && amountNum <= token.balance;
  const canSubmit = toToken && isAmountValid && quote && !isLoading;

  // Available targets (excluding the from token)
  const availableTargets = SWAP_TARGETS.filter(
    (t) => t.symbol !== token.symbol
  );

  // Fetch quote when amount or toToken changes
  useEffect(() => {
    if (!(toToken && isAmountValid)) {
      setQuote(null);
      return;
    }

    const fetchQuote = async () => {
      setQuoteLoading(true);
      try {
        const quoteResult = await onGetQuote(
          token.symbol,
          toToken.symbol,
          amount,
          token.mint,
          token.decimals,
          toToken.decimals,
          toToken.mint
        );
        setQuote(quoteResult);
      } catch {
        setQuote(null);
      } finally {
        setQuoteLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchQuote, 500);
    return () => clearTimeout(timeoutId);
  }, [toToken, amount, isAmountValid, token, onGetQuote]);

  const handlePresetClick = (preset: { label: string; value: number }) => {
    const presetAmount = token.balance * preset.value;
    const formatted =
      presetAmount < 1 ? presetAmount.toFixed(6) : presetAmount.toFixed(4);
    setAmount(formatted.replace(/\.?0+$/, ""));
    setActivePreset(preset.value);
  };

  const handleAmountChange = (value: string) => {
    setAmount(value);
    setActivePreset(null);
  };

  const handleSubmit = () => {
    if (!(canSubmit && toToken)) return;

    onSwap({
      fromCurrency: token.symbol,
      fromCurrencyMint: token.mint,
      fromCurrencyDecimals: token.decimals,
      amount,
      toCurrency: toToken.symbol,
      toCurrencyMint: toToken.mint,
      toCurrencyDecimals: toToken.decimals,
    });
  };

  // Success state
  if (status === "success") {
    return (
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        initial={{ opacity: 0, scale: 0.95 }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          padding: "16px 0",
        }}
      >
        <motion.div
          animate={{ scale: 1, opacity: 1 }}
          initial={{ scale: 0.5, opacity: 0 }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
          transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#22c55e",
              boxShadow: "0 0 12px rgba(34, 197, 94, 0.6)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "14px",
              fontWeight: 500,
              color: "#fff",
              letterSpacing: "-0.02em",
            }}
          >
            {amount} {token.symbol} → {toToken?.symbol}
          </span>
        </motion.div>
        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            width: "100%",
            marginTop: "8px",
          }}
        >
          {onCreateRecipe && (
            <motion.button
              animate={{ opacity: 1, y: 0 }}
              initial={{ opacity: 0, y: 8 }}
              onClick={() => {
                onCreateRecipe({
                  name: "",
                  type: "swap",
                  tokenSymbol: token.symbol,
                  tokenMint: token.mint,
                  tokenDecimals: token.decimals,
                  amount,
                  recipient: "",
                  toTokenSymbol: toToken?.symbol,
                  toTokenMint: toToken?.mint,
                  toTokenDecimals: toToken?.decimals,
                });
                onCancel();
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "14px 20px",
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "12px",
                color: "#fff",
                fontSize: "14px",
                fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              transition={{ delay: 0.2 }}
              type="button"
              whileHover={{
                background: "rgba(255, 255, 255, 0.12)",
                borderColor: "rgba(255, 255, 255, 0.25)",
              }}
            >
              <NotebookPen size={16} />
              Save as Recipe
            </motion.button>
          )}
          <button
            onClick={onCancel}
            style={{
              width: "100%",
              padding: "12px 20px",
              background: "transparent",
              border: "none",
              borderRadius: "10px",
              color: "rgba(255, 255, 255, 0.5)",
              fontSize: "13px",
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontWeight: 500,
              cursor: "pointer",
              transition: "color 0.15s ease",
            }}
            type="button"
          >
            Done
          </button>
        </div>
      </motion.div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        initial={{ opacity: 0, scale: 0.95 }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          padding: "16px 0",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#ef4444",
              boxShadow: "0 0 12px rgba(239, 68, 68, 0.6)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontWeight: 500,
              fontSize: "14px",
              color: "#fff",
              letterSpacing: "-0.02em",
            }}
          >
            Swap Failed
          </span>
        </div>
        {result?.error && (
          <p
            style={{
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontSize: "12px",
              color: "rgba(248, 113, 113, 0.8)",
              textAlign: "center",
              maxWidth: "260px",
            }}
          >
            {result.error}
          </p>
        )}
        <button
          onClick={onCancel}
          style={{
            width: "100%",
            padding: "10px 16px",
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "10px",
            color: "rgba(255, 255, 255, 0.7)",
            fontSize: "13px",
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontWeight: 500,
            cursor: "pointer",
          }}
          type="button"
        >
          Try Again
        </button>
      </motion.div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* From → To summary row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 12px",
          background: "rgba(255, 255, 255, 0.04)",
          borderRadius: "12px",
          border: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontWeight: 600,
            fontSize: "13px",
            color: "#fff",
          }}
        >
          {token.symbol}
        </span>
        <span style={{ color: "rgba(255, 255, 255, 0.3)", fontSize: "12px" }}>
          →
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontWeight: 600,
            fontSize: "13px",
            color: toToken ? "#fff" : "rgba(255, 255, 255, 0.4)",
          }}
        >
          {toToken ? toToken.symbol : "Select"}
        </span>
        {quoteLoading && (
          <motion.span
            animate={{ opacity: [0.3, 1, 0.3] }}
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.4)",
              marginLeft: "auto",
            }}
            transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
          >
            quoting...
          </motion.span>
        )}
        {!quoteLoading && quote && toToken && (
          <span
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.5)",
              marginLeft: "auto",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            ≈ {Number.parseFloat(quote.outputAmount).toFixed(4)}{" "}
            {toToken.symbol}
          </span>
        )}
      </div>

      {/* Target token chips */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
        }}
      >
        {availableTargets.map((target) => {
          const isSelected = toToken?.symbol === target.symbol;
          return (
            <button
              key={target.symbol}
              onClick={() => setToToken(target)}
              style={{
                padding: "6px 12px",
                background: isSelected
                  ? "rgba(255, 255, 255, 0.1)"
                  : "rgba(255, 255, 255, 0.04)",
                border: isSelected
                  ? "1px solid rgba(255, 255, 255, 0.2)"
                  : "1px solid rgba(255, 255, 255, 0.06)",
                borderRadius: "8px",
                color: isSelected ? "#fff" : "rgba(255, 255, 255, 0.5)",
                fontSize: "12px",
                fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              type="button"
            >
              {target.symbol}
            </button>
          );
        })}
      </div>

      {/* Amount presets */}
      <div style={{ display: "flex", gap: "6px" }}>
        {AMOUNT_PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => handlePresetClick(preset)}
            style={{
              flex: 1,
              padding: "6px 0",
              background:
                activePreset === preset.value
                  ? "rgba(255, 255, 255, 0.12)"
                  : "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: "8px",
              color:
                activePreset === preset.value
                  ? "#fff"
                  : "rgba(255, 255, 255, 0.5)",
              fontSize: "12px",
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Amount input row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <div style={{ flex: 1 }}>
          <input
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="0.00"
            style={{
              ...glassInputStyle,
              padding: "10px 14px",
              textAlign: "right",
              fontFamily: "var(--font-geist-mono), monospace",
              fontVariantNumeric: "tabular-nums",
              fontSize: "16px",
              fontWeight: 500,
              borderColor:
                amount && !isAmountValid
                  ? "rgba(239, 68, 68, 0.5)"
                  : "rgba(255, 255, 255, 0.08)",
              boxShadow:
                amount && !isAmountValid
                  ? "0 0 0 3px rgba(239, 68, 68, 0.15)"
                  : "none",
            }}
            type="text"
            value={amount}
          />
        </div>
        <span
          style={{
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontSize: "16px",
            color: "rgba(255, 255, 255, 0.6)",
            fontWeight: 500,
            minWidth: "50px",
          }}
        >
          {token.symbol}
        </span>
      </div>

      {/* Quote display */}
      {quote && toToken && (
        <p
          style={{
            textAlign: "right",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "14px",
            color: "rgba(255, 255, 255, 0.5)",
            marginTop: "-16px",
            paddingRight: "70px",
          }}
        >
          ≈ {Number.parseFloat(quote.outputAmount).toFixed(4)} {toToken.symbol}
          {quote.priceImpact && (
            <span
              style={{ marginLeft: "8px", color: "rgba(255, 255, 255, 0.3)" }}
            >
              ({Number.parseFloat(quote.priceImpact).toFixed(2)}% impact)
            </span>
          )}
        </p>
      )}

      {/* Amount error */}
      {amount && amountNum > token.balance && (
        <p
          style={{
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontSize: "13px",
            color: "rgba(248, 113, 113, 1)",
          }}
        >
          Exceeds balance ({token.balance.toFixed(4)} {token.symbol} available)
        </p>
      )}

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          paddingTop: "8px",
        }}
      >
        <button
          disabled={isLoading}
          onClick={onCancel}
          style={{
            padding: "10px 16px",
            background: "transparent",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "10px",
            color: "rgba(255, 255, 255, 0.6)",
            fontSize: "13px",
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          type="button"
        >
          Cancel
        </button>

        <button
          disabled={!canSubmit}
          onClick={handleSubmit}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "10px 20px",
            background: canSubmit ? "#fff" : "rgba(255, 255, 255, 0.08)",
            border: "none",
            borderRadius: "12px",
            color: canSubmit ? "#000" : "rgba(255, 255, 255, 0.3)",
            fontSize: "14px",
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
            transition: "all 0.2s ease",
            boxShadow: "none",
          }}
          type="button"
        >
          {isLoading ? (
            <>
              <motion.span
                animate={{ rotate: 360 }}
                style={{ display: "inline-flex" }}
                transition={{
                  duration: 1,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "linear",
                }}
              >
                ◌
              </motion.span>
              Swapping...
            </>
          ) : (
            <>
              Swap
              <span style={{ fontSize: "16px" }}>⇄</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
