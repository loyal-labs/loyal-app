"use client";

import { NotebookPen } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import type { Recipe } from "@/hooks/use-recipes";
import type { TokenBalance } from "@/hooks/use-wallet-balances";

type SendFormProps = {
  token: TokenBalance;
  destinationType: "telegram" | "wallet";
  onSend: (data: {
    currency: string;
    currencyMint: string;
    currencyDecimals: number;
    amount: string;
    walletAddress: string;
  }) => void;
  onCancel: () => void;
  onCreateRecipe?: (recipe: Omit<Recipe, "id" | "createdAt">) => void;
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

const TOKEN_PRICES: Record<string, number> = {
  SOL: 145,
  USDC: 1,
  USDT: 1,
  BONK: 0.000_01,
  LOYAL: 0.1,
};

function isValidSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function isValidTelegramUsername(username: string): boolean {
  const clean = username.startsWith("@") ? username.slice(1) : username;
  return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(clean);
}

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

export function SendForm({
  token,
  destinationType,
  onSend,
  onCancel,
  onCreateRecipe,
  isLoading = false,
  status = null,
  result = null,
}: SendFormProps) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [activePreset, setActivePreset] = useState<number | null>(null);

  const price = TOKEN_PRICES[token.symbol] ?? 0;
  const amountNum = Number.parseFloat(amount) || 0;
  const usdValue = amountNum * price;

  // Validation
  const isRecipientValid =
    destinationType === "telegram"
      ? isValidTelegramUsername(recipient)
      : isValidSolanaAddress(recipient);
  const isAmountValid = amountNum > 0 && amountNum <= token.balance;
  const canSubmit = isRecipientValid && isAmountValid && !isLoading;

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
    if (!canSubmit) return;

    const cleanRecipient =
      destinationType === "telegram" && recipient.startsWith("@")
        ? recipient.slice(1)
        : recipient;

    onSend({
      currency: token.symbol,
      currencyMint: token.mint,
      currencyDecimals: token.decimals,
      amount,
      walletAddress: cleanRecipient,
    });
  };

  // Get input border color based on validation
  const getInputBorder = (hasValue: boolean, isValid: boolean): string => {
    if (!hasValue) return "rgba(255, 255, 255, 0.08)";
    return isValid ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)";
  };

  // Build recipe data from current form state
  const buildRecipeData = () => {
    const cleanRecipient =
      destinationType === "telegram" && recipient.startsWith("@")
        ? recipient.slice(1)
        : recipient;

    return {
      name: "",
      type: destinationType as "telegram" | "wallet",
      tokenSymbol: token.symbol,
      tokenMint: token.mint,
      tokenDecimals: token.decimals,
      amount,
      recipient: cleanRecipient,
    };
  };

  // Handle recipe save
  const handleSaveRecipe = () => {
    if (!onCreateRecipe) return;
    onCreateRecipe(buildRecipeData());
  };

  // Success state
  if (status === "success") {
    return (
      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        initial={{ opacity: 0, scale: 0.95 }}
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
          padding: "16px 0 8px",
        }}
      >
        {/* Minimal success indicator */}
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
            {amount} {token.symbol} sent
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
                handleSaveRecipe();
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
            Transaction Failed
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
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Recipient input - main focus */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label
          style={{
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontSize: "12px",
            fontWeight: 500,
            color: "rgba(255, 255, 255, 0.5)",
            paddingLeft: "2px",
          }}
        >
          {destinationType === "telegram" ? "Recipient" : "Wallet Address"}
        </label>
        <input
          autoFocus
          onChange={(e) => setRecipient(e.target.value)}
          placeholder={
            destinationType === "telegram"
              ? "@username"
              : "Enter Solana address..."
          }
          style={{
            ...glassInputStyle,
            padding: "12px 14px",
            fontSize: "14px",
            borderColor: getInputBorder(Boolean(recipient), isRecipientValid),
            boxShadow:
              recipient && isRecipientValid
                ? "0 0 0 2px rgba(34, 197, 94, 0.15)"
                : recipient && !isRecipientValid
                  ? "0 0 0 2px rgba(239, 68, 68, 0.15)"
                  : "none",
          }}
          type="text"
          value={recipient}
        />
        {recipient && !isRecipientValid && (
          <p
            style={{
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontSize: "11px",
              color: "rgba(248, 113, 113, 1)",
              paddingLeft: "2px",
            }}
          >
            {destinationType === "telegram"
              ? "Invalid username format"
              : "Invalid Solana address"}
          </p>
        )}
      </div>

      {/* Amount section */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <label
            style={{
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontSize: "12px",
              fontWeight: 500,
              color: "rgba(255, 255, 255, 0.5)",
              paddingLeft: "2px",
            }}
          >
            Amount
          </label>
          <span
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "11px",
              color: "rgba(255, 255, 255, 0.4)",
            }}
          >
            Balance: {token.balance.toFixed(4)} {token.symbol}
          </span>
        </div>

        {/* Amount input with token badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "4px",
            background: "rgba(0, 0, 0, 0.25)",
            border:
              amount && !isAmountValid
                ? "1px solid rgba(239, 68, 68, 0.5)"
                : "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <input
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="0.00"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "8px 10px",
              background: "transparent",
              border: "none",
              color: "#fff",
              fontSize: "18px",
              fontFamily: "var(--font-geist-mono), monospace",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 500,
              outline: "none",
              textAlign: "left",
            }}
            type="text"
            value={amount}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              background: "rgba(255, 255, 255, 0.08)",
              borderRadius: "10px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                fontSize: "13px",
                fontWeight: 600,
                color: "#fff",
              }}
            >
              {token.symbol}
            </span>
          </div>
        </div>

        {/* Presets row */}
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

        {/* USD estimate */}
        {amountNum > 0 && (
          <p
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "12px",
              color: "rgba(255, 255, 255, 0.4)",
              paddingLeft: "2px",
            }}
          >
            ≈ ${usdValue >= 0.01 ? usdValue.toFixed(2) : "< 0.01"} USD
          </p>
        )}

        {/* Amount error */}
        {amount && amountNum > token.balance && (
          <p
            style={{
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontSize: "11px",
              color: "rgba(248, 113, 113, 1)",
              paddingLeft: "2px",
            }}
          >
            Exceeds available balance
          </p>
        )}
      </div>

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
            borderRadius: "10px",
            color: canSubmit ? "#000" : "rgba(255, 255, 255, 0.3)",
            fontSize: "14px",
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontWeight: 600,
            cursor: canSubmit ? "pointer" : "not-allowed",
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
              Sending...
            </>
          ) : (
            <>
              Send {token.symbol}
              <span style={{ fontSize: "14px" }}>→</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
