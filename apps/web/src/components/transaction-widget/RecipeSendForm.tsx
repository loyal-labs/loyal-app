"use client";

import { motion } from "motion/react";
import { useCallback, useState } from "react";
import type { Recipe } from "@/hooks/use-recipes";

interface RecipeSendFormProps {
  recipe: Recipe;
  onSend: (data: {
    currency: string;
    currencyMint: string;
    currencyDecimals: number;
    amount: string;
    walletAddress: string;
  }) => void;
  onSwap?: (data: {
    fromCurrency: string;
    fromCurrencyMint: string;
    fromCurrencyDecimals: number;
    amount: string;
    toCurrency: string;
    toCurrencyMint: string;
    toCurrencyDecimals: number;
  }) => void;
  onCancel: () => void;
  isLoading?: boolean;
  status?: "pending" | "success" | "error" | null;
  result?: { signature?: string; error?: string } | null;
}

export function RecipeSendForm({
  recipe,
  onSend,
  onSwap,
  onCancel,
  isLoading = false,
  status = null,
  result = null,
}: RecipeSendFormProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  const isSwap = recipe.type === "swap";

  const handleSubmit = useCallback(() => {
    if (isSwap && onSwap && recipe.toTokenSymbol && recipe.toTokenMint && recipe.toTokenDecimals != null) {
      onSwap({
        fromCurrency: recipe.tokenSymbol,
        fromCurrencyMint: recipe.tokenMint,
        fromCurrencyDecimals: recipe.tokenDecimals,
        amount: recipe.amount,
        toCurrency: recipe.toTokenSymbol,
        toCurrencyMint: recipe.toTokenMint,
        toCurrencyDecimals: recipe.toTokenDecimals,
      });
    } else {
      onSend({
        currency: recipe.tokenSymbol,
        currencyMint: recipe.tokenMint,
        currencyDecimals: recipe.tokenDecimals,
        amount: recipe.amount,
        walletAddress: recipe.recipient,
      });
    }
  }, [recipe, onSend, onSwap, isSwap]);

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
          gap: "16px",
          padding: "16px 0 8px",
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
              fontSize: "15px",
              fontWeight: 500,
              color: "#fff",
              letterSpacing: "-0.02em",
            }}
          >
            {isSwap
              ? `${recipe.amount} ${recipe.tokenSymbol} swapped`
              : `${recipe.amount} ${recipe.tokenSymbol} sent`}
          </span>
        </motion.div>
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
            Recipe Failed
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

  // Confirmation view
  if (isConfirming) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Summary */}
        <div
          style={{
            padding: "14px",
            background: "rgba(0, 0, 0, 0.2)",
            borderRadius: "12px",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {isSwap ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                    fontSize: "12px",
                    color: "rgba(255, 255, 255, 0.5)",
                  }}
                >
                  From
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: "13px",
                    color: "#fff",
                  }}
                >
                  {recipe.amount} {recipe.tokenSymbol}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                    fontSize: "12px",
                    color: "rgba(255, 255, 255, 0.5)",
                  }}
                >
                  To
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: "13px",
                    color: "#fff",
                  }}
                >
                  {recipe.toTokenSymbol}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                    fontSize: "12px",
                    color: "rgba(255, 255, 255, 0.5)",
                  }}
                >
                  Recipient
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: "13px",
                    color: "#fff",
                  }}
                >
                  {recipe.type === "telegram"
                    ? `@${recipe.recipient}`
                    : `${recipe.recipient.slice(0, 8)}...`}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                    fontSize: "12px",
                    color: "rgba(255, 255, 255, 0.5)",
                  }}
                >
                  Amount
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: "13px",
                    color: "#fff",
                  }}
                >
                  {recipe.amount} {recipe.tokenSymbol}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <button
            disabled={isLoading}
            onClick={() => setIsConfirming(false)}
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
            Back
          </button>

          <button
            disabled={isLoading}
            onClick={handleSubmit}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              padding: "10px 20px",
              background: isLoading ? "rgba(255, 255, 255, 0.08)" : "#fff",
              border: "none",
              borderRadius: "10px",
              color: isLoading ? "rgba(255, 255, 255, 0.3)" : "#000",
              fontSize: "14px",
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontWeight: 600,
              cursor: isLoading ? "wait" : "pointer",
              transition: "all 0.15s ease",
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
                {isSwap ? "Swapping..." : "Sending..."}
              </>
            ) : (
              <>
                Confirm {isSwap ? "Swap" : "Send"}
                <span style={{ fontSize: "14px" }}>→</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Default: Recipe preview
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Recipe details */}
      <div
        style={{
          padding: "14px",
          background: "rgba(0, 0, 0, 0.2)",
          borderRadius: "12px",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        {isSwap ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                  fontSize: "12px",
                  color: "rgba(255, 255, 255, 0.5)",
                }}
              >
                From
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "13px",
                  color: "#fff",
                }}
              >
                {recipe.amount} {recipe.tokenSymbol}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                  fontSize: "12px",
                  color: "rgba(255, 255, 255, 0.5)",
                }}
              >
                To
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "13px",
                  color: "#fff",
                }}
              >
                {recipe.toTokenSymbol}
              </span>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                  fontSize: "12px",
                  color: "rgba(255, 255, 255, 0.5)",
                }}
              >
                To
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "13px",
                  color: "#fff",
                }}
              >
                {recipe.type === "telegram"
                  ? `@${recipe.recipient}`
                  : `${recipe.recipient.slice(0, 8)}...${recipe.recipient.slice(-4)}`}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                  fontSize: "12px",
                  color: "rgba(255, 255, 255, 0.5)",
                }}
              >
                Amount
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "13px",
                  color: "#fff",
                }}
              >
                {recipe.amount} {recipe.tokenSymbol}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <button
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
          onClick={() => setIsConfirming(true)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            padding: "10px 20px",
            background: "#fff",
            border: "none",
            borderRadius: "10px",
            color: "#000",
            fontSize: "14px",
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            boxShadow: "none",
          }}
          type="button"
        >
          Execute Recipe
          <span style={{ fontSize: "14px" }}>→</span>
        </button>
      </div>
    </div>
  );
}
