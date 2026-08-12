"use client";

import { RefreshCcw, Send, Wallet } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { DragEvent, ReactNode } from "react";
import { useState } from "react";
import type { TokenBalance } from "@/hooks/use-wallet-balances";

export type DropZoneType = "telegram" | "wallet" | "swap";

interface DropZoneProps {
  type: DropZoneType;
  isExpanded: boolean;
  isDragOver: boolean;
  isHighlighted?: boolean;
  droppedToken: TokenBalance | null;
  children?: ReactNode;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onClick?: () => void;
}

const ZONE_CONFIG: Record<
  DropZoneType,
  { icon: ReactNode; label: string; gradient: string; glow: string }
> = {
  telegram: {
    icon: <Send size={16} />,
    label: "Send w Telegram",
    gradient: "linear-gradient(135deg, #0088cc 0%, #00a0dc 100%)",
    glow: "rgba(0, 136, 204, 0.4)",
  },
  wallet: {
    icon: <Wallet size={16} />,
    label: "Send w address",
    gradient: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
    glow: "rgba(153, 69, 255, 0.4)",
  },
  swap: {
    icon: <RefreshCcw size={14} />,
    label: "Swap",
    gradient: "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
    glow: "rgba(239, 68, 68, 0.4)",
  },
};

export function DropZone({
  type,
  isExpanded,
  isDragOver,
  isHighlighted = false,
  droppedToken,
  children,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
}: DropZoneProps) {
  const config = ZONE_CONFIG[type];
  const [, setDragCounter] = useState(0);

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragCounter((c) => c + 1);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragCounter((c) => {
      const newCount = c - 1;
      if (newCount === 0) {
        onDragLeave(e);
      }
      return newCount;
    });
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    onDragOver(e);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragCounter(0);
    onDrop(e);
  };

  const active = isDragOver || isHighlighted;

  // Compute background based on state
  const getBackground = () => {
    if (isExpanded) return "rgba(26, 26, 26, 0.5)";
    if (active) return "rgba(255, 255, 255, 0.08)";
    return "rgba(26, 26, 26, 0.3)";
  };

  // Compute border based on state
  const getBorder = () => {
    if (isExpanded) return "1px solid rgba(255, 255, 255, 0.1)";
    if (active) return `1px solid ${config.glow}`;
    return "1px solid rgba(255, 255, 255, 0.06)";
  };

  // Compute shadow based on state
  const getShadow = () => {
    if (isDragOver) {
      return `0 8px 32px rgba(0, 0, 0, 0.3), 0 0 20px ${config.glow}, inset 0 1px 0 0 rgba(255, 255, 255, 0.05)`;
    }
    if (isExpanded) {
      return "0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 0 rgba(255, 255, 255, 0.03)";
    }
    return "0 4px 16px rgba(0, 0, 0, 0.15)";
  };

  return (
    <motion.div
      animate={{
        flex: isExpanded ? 1 : "none",
      }}
      layout
      onClick={onClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: isExpanded ? "20px" : "14px",
        background: getBackground(),
        backdropFilter: "blur(24px) saturate(150%)",
        WebkitBackdropFilter: "blur(24px) saturate(150%)",
        border: getBorder(),
        boxShadow: getShadow(),
        cursor: isHighlighted ? "pointer" : "default",
        transition:
          "background 0.3s ease, border 0.3s ease, box-shadow 0.3s ease, border-radius 0.3s ease",
      }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      {/* Glow effect when dragging over */}
      <motion.div
        animate={{
          opacity: isDragOver ? 0.5 : 0,
        }}
        style={{
          position: "absolute",
          top: "-20px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          height: "60px",
          background: config.gradient,
          filter: "blur(40px)",
          borderRadius: "50%",
          pointerEvents: "none",
          zIndex: 0,
        }}
        transition={{ duration: 0.3 }}
      />

      <AnimatePresence mode="wait">
        {isExpanded ? (
          // Expanded state - form content only (header provided by modal)
          <motion.div
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="expanded"
            style={{
              position: "relative",
              zIndex: 1,
            }}
            transition={{ duration: 0.15 }}
          >
            {children}
          </motion.div>
        ) : (
          // Collapsed state - compact card matching token cards
          <motion.div
            animate={{
              opacity: 1,
              scale: isDragOver ? 1.02 : 1,
            }}
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="collapsed"
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "8px 12px",
            }}
            transition={{ duration: 0.2 }}
          >
            {/* Icon */}
            <span
              style={{
                display: "flex",
                color: active ? "#fff" : "rgba(255, 255, 255, 0.5)",
                transition: "color 0.2s ease",
              }}
            >
              {config.icon}
            </span>

            {/* Label */}
            <span
              style={{
                fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                fontWeight: 500,
                fontSize: "12px",
                color: active ? "#fff" : "rgba(255, 255, 255, 0.5)",
                transition: "color 0.2s ease",
                whiteSpace: "nowrap",
              }}
            >
              {config.label}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
