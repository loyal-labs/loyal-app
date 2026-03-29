"use client";

import { AnimatePresence, motion } from "motion/react";
import type { DragEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDragDrop } from "@/hooks/use-drag-drop";
import { type Recipe, useRecipes } from "@/hooks/use-recipes";
import { useSend } from "@/hooks/use-send";
import { useSwap } from "@/hooks/use-swap";
import type { TokenBalance } from "@/hooks/use-wallet-balances";
import { useWalletBalances } from "@/hooks/use-wallet-balances";
import { DropZone, type DropZoneType } from "./DropZone";
import { DragHint } from "./drag-hint-arrow";
import { RecipeCard } from "./RecipeCard";
import { RecipeSendForm } from "./RecipeSendForm";
import { SendForm } from "./SendForm";
import { SwapForm } from "./SwapForm";
import { getUsdValue, TokenCard } from "./TokenCard";

type TransactionWidgetProps = {
  className?: string;
  onTransactionComplete?: (
    type: "send" | "swap",
    result: { signature?: string }
  ) => void;
};

export function TransactionWidget({
  className,
  onTransactionComplete,
}: TransactionWidgetProps) {
  const {
    balances,
    loading: balancesLoading,
    isConnected,
    refetch,
  } = useWalletBalances();
  const { executeSend } = useSend();
  const { getQuote, executeSwap } = useSwap();
  const {
    state,
    startDrag,
    endDrag,
    selectToken,
    dragOverZone,
    dragLeaveZone,
    dropOnZone,
    cancelForm,
    setExecuting,
    setTransactionResult,
  } = useDragDrop();
  const { recipes, addRecipe, deleteRecipe, generateRecipeName } = useRecipes();

  // Active recipe state - when a recipe card is clicked
  const [activeRecipe, setActiveRecipe] = useState<Recipe | null>(null);

  // Touch device detection — disable HTML5 DnD on touch (it doesn't work anyway)
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    setIsTouchDevice(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // Drag hint - ghost card animation, shows once when actions first load
  const [showDragHint, setShowDragHint] = useState(false);
  const hintShownRef = useRef(false);
  const layoutContainerRef = useRef<HTMLDivElement>(null);
  const firstTokenRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLDivElement>(null);

  // Show drag hint arrow once after balances load
  useEffect(() => {
    if (balances.length > 0 && !hintShownRef.current && !isTouchDevice) {
      hintShownRef.current = true;
      const timer = setTimeout(() => setShowDragHint(true), 600);
      return () => clearTimeout(timer);
    }
  }, [balances.length, isTouchDevice]);

  // Handle cancel - close modal
  const handleCancel = useCallback(() => {
    if (activeRecipe) {
      setActiveRecipe(null);
      return;
    }
    cancelForm();
  }, [cancelForm, activeRecipe]);

  // Handle recipe click - opens pre-filled form
  const handleRecipeClick = useCallback((recipe: Recipe) => {
    setActiveRecipe(recipe);
  }, []);

  // Handle recipe creation - auto-generate name if empty
  const handleCreateRecipe = useCallback(
    (recipeData: Omit<Recipe, "id" | "createdAt">) => {
      const name = recipeData.name || generateRecipeName(recipeData);
      addRecipe({ ...recipeData, name });
    },
    [addRecipe, generateRecipeName]
  );

  // Handle recipe delete
  const handleDeleteRecipe = useCallback(
    (id: string) => {
      deleteRecipe(id);
    },
    [deleteRecipe]
  );

  // Tap on action zone: use selected token, or fallback to first available token
  const handleZoneTap = useCallback(
    (zone: DropZoneType) => {
      const token =
        state.selectedToken ??
        balances.find((t) => getUsdValue(t.balance, t.symbol) >= 0.01);
      if (token) {
        dropOnZone(zone, token);
      }
    },
    [state.selectedToken, balances, dropOnZone]
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (_e: DragEvent<HTMLDivElement>, token: TokenBalance) => {
      startDrag(token);
    },
    [startDrag]
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  // Handle drag over zone
  const handleDragOver = useCallback(
    (zone: DropZoneType) => (_e: DragEvent<HTMLDivElement>) => {
      if (state.isDragging) {
        dragOverZone(zone);
      }
    },
    [state.isDragging, dragOverZone]
  );

  // Handle drag leave zone
  const handleDragLeave = useCallback(
    () => (_e: DragEvent<HTMLDivElement>) => {
      dragLeaveZone();
    },
    [dragLeaveZone]
  );

  // Handle drop on zone
  const handleDrop = useCallback(
    (zone: DropZoneType) => (e: DragEvent<HTMLDivElement>) => {
      try {
        const data = e.dataTransfer.getData("application/json");
        const token = JSON.parse(data) as TokenBalance;
        dropOnZone(zone, token);
      } catch {
        endDrag();
      }
    },
    [dropOnZone, endDrag]
  );

  // Handle send transaction
  const handleSend = useCallback(
    async (data: {
      currency: string;
      currencyMint: string;
      currencyDecimals: number;
      amount: string;
      walletAddress: string;
    }) => {
      setExecuting(true);
      try {
        const result = await executeSend(
          data.currency,
          data.amount,
          data.walletAddress,
          data.currencyMint,
          data.currencyDecimals
        );

        if (result.success) {
          setTransactionResult("success", { signature: result.signature });
          onTransactionComplete?.("send", { signature: result.signature });
          refetch(); // Refresh balances
        } else {
          setTransactionResult("error", { error: result.error });
        }
      } catch (err) {
        setTransactionResult("error", {
          error: err instanceof Error ? err.message : "Transaction failed",
        });
      }
    },
    [
      executeSend,
      setExecuting,
      setTransactionResult,
      onTransactionComplete,
      refetch,
    ]
  );

  // Handle swap quote
  const handleGetQuote = useCallback(
    async (
      fromToken: string,
      toToken: string,
      amount: string,
      fromMint?: string,
      fromDecimals?: number,
      toDecimals?: number
    ) => {
      const quote = await getQuote(
        fromToken,
        toToken,
        amount,
        fromMint,
        fromDecimals,
        toDecimals
      );
      if (quote) {
        return {
          outputAmount: quote.outputAmount,
          priceImpact: quote.priceImpact,
        };
      }
      return null;
    },
    [getQuote]
  );

  // Handle swap transaction
  const handleSwap = useCallback(
    async (data: {
      fromCurrency: string;
      fromCurrencyMint: string;
      fromCurrencyDecimals: number;
      amount: string;
      toCurrency: string;
      toCurrencyMint: string;
      toCurrencyDecimals: number;
    }) => {
      setExecuting(true);
      try {
        // First get the quote to ensure we have it
        await getQuote(
          data.fromCurrency,
          data.toCurrency,
          data.amount,
          data.fromCurrencyMint,
          data.fromCurrencyDecimals,
          data.toCurrencyDecimals
        );

        // Then execute the swap
        const result = await executeSwap();

        if (result.success) {
          setTransactionResult("success", { signature: result.signature });
          onTransactionComplete?.("swap", { signature: result.signature });
          refetch(); // Refresh balances
        } else {
          setTransactionResult("error", { error: result.error });
        }
      } catch (err) {
        setTransactionResult("error", {
          error: err instanceof Error ? err.message : "Swap failed",
        });
      }
    },
    [
      getQuote,
      executeSwap,
      setExecuting,
      setTransactionResult,
      onTransactionComplete,
      refetch,
    ]
  );

  // Not signed in state — show skeleton
  if (!isConnected && balances.length === 0 && !balancesLoading) {
    const skeletonBlock = {
      background: "rgba(255, 255, 255, 0.04)",
      borderRadius: "14px",
      border: "1px solid rgba(255, 255, 255, 0.06)",
    };
    return (
      <div
        className={className}
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontSize: "12px",
            fontWeight: 500,
            color: "rgba(255, 255, 255, 0.45)",
            textAlign: "center",
          }}
        >
          Sign in to perform actions
        </span>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "24px",
            opacity: 0.5,
          }}
        >
          {/* Skeleton tokens */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span
              style={{
                fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                fontSize: "11px",
                fontWeight: 500,
                color: "rgba(255, 255, 255, 0.25)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                paddingLeft: "4px",
              }}
            >
              Your Tokens
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "10px",
              }}
            >
              <div
                style={{
                  ...skeletonBlock,
                  padding: "6px 10px",
                  height: "32px",
                }}
              />
              <div
                style={{
                  ...skeletonBlock,
                  padding: "6px 10px",
                  height: "32px",
                }}
              />
            </div>
          </div>

          {/* Skeleton actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span
              style={{
                fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                fontSize: "11px",
                fontWeight: 500,
                color: "rgba(255, 255, 255, 0.25)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                paddingLeft: "4px",
              }}
            >
              Actions
            </span>
            <div style={{ display: "flex", gap: "10px" }}>
              <div
                style={{
                  ...skeletonBlock,
                  padding: "6px 10px",
                  height: "32px",
                  width: "80px",
                }}
              />
              <div
                style={{
                  ...skeletonBlock,
                  padding: "6px 10px",
                  height: "32px",
                  width: "80px",
                }}
              />
              <div
                style={{
                  ...skeletonBlock,
                  padding: "6px 10px",
                  height: "32px",
                  width: "80px",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (balancesLoading && balances.length === 0) {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px",
        }}
      >
        <div
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            border: "2px solid rgba(255, 255, 255, 0.2)",
            borderTopColor: "rgba(255, 255, 255, 0.6)",
            animation: "spin 1s linear infinite",
          }}
        />
      </div>
    );
  }

  const filteredBalances = balances.filter(
    (token) => getUsdValue(token.balance, token.symbol) >= 0.01
  );

  const isAnyZoneExpanded =
    state.expandedZone !== null || activeRecipe !== null;

  // Determine which zone type the modal shows (for header)
  const modalZone = state.expandedZone ?? activeRecipe?.type ?? null;

  // Modal content
  const renderModalContent = () => {
    if (state.expandedZone && state.droppedToken) {
      if (state.expandedZone === "swap") {
        return (
          <SwapForm
            isLoading={state.isExecuting}
            onCancel={handleCancel}
            onCreateRecipe={handleCreateRecipe}
            onGetQuote={handleGetQuote}
            onSwap={handleSwap}
            result={state.transactionResult}
            status={state.transactionStatus}
            token={state.droppedToken}
          />
        );
      }
      return (
        <SendForm
          destinationType={state.expandedZone}
          isLoading={state.isExecuting}
          onCancel={handleCancel}
          onCreateRecipe={handleCreateRecipe}
          onSend={handleSend}
          result={state.transactionResult}
          status={state.transactionStatus}
          token={state.droppedToken}
        />
      );
    }
    if (activeRecipe) {
      return (
        <RecipeSendForm
          isLoading={state.isExecuting}
          onCancel={handleCancel}
          onSend={handleSend}
          onSwap={handleSwap}
          recipe={activeRecipe}
          result={state.transactionResult}
          status={state.transactionStatus}
        />
      );
    }
    return null;
  };

  return (
    <div className={className} style={{ width: "100%", overflow: "hidden" }}>
      <div
        ref={layoutContainerRef}
        style={{
          position: "relative",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          width: "100%",
          gap: "24px",
        }}
      >
        {/* Ghost drag hint - one-time animated guide */}
        {showDragHint && !isAnyZoneExpanded && (
          <DragHint
            containerRef={layoutContainerRef}
            firstActionRef={firstActionRef}
            firstTokenRef={firstTokenRef}
            onComplete={() => setShowDragHint(false)}
            tokenSymbol={filteredBalances[0]?.symbol ?? ""}
          />
        )}

        {/* Tokens */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            flex: "1 1 100%",
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontSize: "11px",
              fontWeight: 500,
              color: "rgba(255, 255, 255, 0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              paddingLeft: "4px",
            }}
          >
            Your Tokens
          </span>

          {filteredBalances.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))",
                gap: "10px",
              }}
            >
              {filteredBalances.map((token, index) => (
                <div
                  key={token.mint}
                  ref={index === 0 ? firstTokenRef : undefined}
                >
                  <TokenCard
                    isDragging={state.draggedToken?.mint === token.mint}
                    isOtherDragging={
                      state.isDragging &&
                      state.draggedToken?.mint !== token.mint
                    }
                    isSelected={state.selectedToken?.mint === token.mint}
                    onDragEnd={isTouchDevice ? undefined : handleDragEnd}
                    onDragStart={isTouchDevice ? undefined : handleDragStart}
                    onSelect={() => selectToken(token)}
                    token={token}
                  />
                </div>
              ))}
            </div>
          ) : (
            <span
              style={{
                fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                fontSize: "12px",
                fontWeight: 500,
                color: "rgba(255, 255, 255, 0.35)",
                paddingLeft: "4px",
              }}
            >
              Add funds to perform actions
            </span>
          )}
        </div>

        {/* Actions section */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            flex: "1 1 100%",
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
              fontSize: "11px",
              fontWeight: 500,
              color: "rgba(255, 255, 255, 0.4)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              paddingLeft: "4px",
            }}
          >
            Actions
          </span>

          {/* Action cards */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            {(["telegram", "wallet", "swap"] as const).map(
              (zone, zoneIndex) => (
                <div
                  data-dropzone={zone}
                  key={zone}
                  ref={zoneIndex === 0 ? firstActionRef : undefined}
                  style={{ flex: 1 }}
                >
                  <DropZone
                    droppedToken={state.droppedToken}
                    isDragOver={state.dragOverZone === zone}
                    isExpanded={false}
                    isHighlighted={state.selectedToken !== null}
                    onClick={() => handleZoneTap(zone)}
                    onDragLeave={handleDragLeave()}
                    onDragOver={handleDragOver(zone)}
                    onDrop={handleDrop(zone)}
                    type={zone}
                  />
                </div>
              )
            )}
          </div>

          {/* Recipes row */}
          {recipes.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                marginTop: "8px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
                  fontSize: "10px",
                  fontWeight: 500,
                  color: "rgba(255, 255, 255, 0.3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  paddingLeft: "4px",
                }}
              >
                Recipes
              </span>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                {recipes.map((recipe) => (
                  <RecipeCard
                    key={recipe.id}
                    onClick={() => handleRecipeClick(recipe)}
                    onDelete={() => handleDeleteRecipe(recipe.id)}
                    recipe={recipe}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Portal modal overlay */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isAnyZoneExpanded && modalZone && (
              <motion.div
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                key="modal-backdrop"
                onClick={handleCancel}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    handleCancel();
                  }
                }}
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 9999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0, 0, 0, 0.6)",
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
                transition={{ duration: 0.2 }}
              >
                <motion.div
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 8 }}
                  initial={{ opacity: 0, scale: 0.97, y: 8 }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  style={{
                    width: "100%",
                    maxWidth: "360px",
                    margin: "0 16px",
                    background: "rgba(22, 22, 22, 0.95)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "16px",
                    boxShadow:
                      "0 24px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.04)",
                    overflow: "hidden",
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 35,
                  }}
                >
                  {/* Modal header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px 16px",
                      borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                    }}
                  >
                    <span
                      style={{
                        fontFamily:
                          "var(--font-geist-sans), system-ui, sans-serif",
                        fontWeight: 600,
                        fontSize: "13px",
                        color: "#fff",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {activeRecipe
                        ? activeRecipe.name
                        : modalZone === "telegram"
                          ? "Send via Telegram"
                          : modalZone === "wallet"
                            ? "Send to Address"
                            : "Swap"}
                    </span>
                    <button
                      onClick={handleCancel}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "28px",
                        height: "28px",
                        borderRadius: "8px",
                        border: "none",
                        background: "rgba(255, 255, 255, 0.06)",
                        color: "rgba(255, 255, 255, 0.5)",
                        fontSize: "14px",
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                      }}
                      type="button"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Modal body */}
                  <div style={{ padding: "16px" }}>{renderModalContent()}</div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}

export { DropZone } from "./DropZone";
export { SendForm } from "./SendForm";
export { SwapForm } from "./SwapForm";
// Re-export components for potential individual use
export { TokenCard } from "./TokenCard";
