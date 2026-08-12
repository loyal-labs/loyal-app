"use client";

import { RefreshCcw, Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Recipe } from "@/hooks/use-recipes";

interface RecipeCardProps {
  recipe: Recipe;
  onClick: () => void;
  onDelete: () => void;
}

export function RecipeCard({ recipe, onClick, onDelete }: RecipeCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleting(true);
    setTimeout(() => {
      onDelete();
    }, 200);
  };

  const isSwap = recipe.type === "swap";

  return (
    <AnimatePresence>
      {!isDeleting && (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          initial={{ opacity: 0, scale: 0.8 }}
          onClick={onClick}
          onHoverEnd={() => setIsHovered(false)}
          onHoverStart={() => setIsHovered(true)}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 12px",
            background: "rgba(255, 255, 255, 0.04)",
            borderRadius: "10px",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            cursor: "pointer",
            userSelect: "none",
            overflow: "visible",
            transition: "all 0.15s ease",
          }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          whileHover={{
            background: "rgba(255, 255, 255, 0.08)",
            borderColor: "rgba(255, 255, 255, 0.12)",
          }}
        >
          {/* Delete button - visible on hover */}
          <motion.button
            animate={{
              opacity: isHovered ? 1 : 0,
              scale: isHovered ? 1 : 0.8,
            }}
            initial={{ opacity: 0, scale: 0.8 }}
            onClick={handleDelete}
            style={{
              position: "absolute",
              top: "-6px",
              right: "-6px",
              width: "18px",
              height: "18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(239, 68, 68, 0.9)",
              border: "2px solid rgba(22, 22, 22, 0.8)",
              borderRadius: "50%",
              cursor: "pointer",
              zIndex: 10,
            }}
            transition={{ duration: 0.15 }}
            type="button"
            whileHover={{ scale: 1.15 }}
          >
            <svg
              aria-label="Delete recipe"
              fill="none"
              height="8"
              role="img"
              stroke="#fff"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              width="8"
            >
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </motion.button>

          {/* Type icon */}
          {isSwap ? (
            <RefreshCcw
              size={13}
              style={{ flexShrink: 0, color: "rgba(255, 255, 255, 0.4)" }}
            />
          ) : (
            <Send
              size={13}
              style={{ flexShrink: 0, color: "rgba(255, 255, 255, 0.4)" }}
            />
          )}

          {/* Recipe name */}
          <span
            style={{
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontWeight: 500,
              fontSize: "12px",
              color: "rgba(255, 255, 255, 0.8)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {recipe.name}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
