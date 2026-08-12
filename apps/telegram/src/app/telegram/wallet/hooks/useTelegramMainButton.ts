import {
  hapticFeedback,
  mainButton,
  secondaryButton,
  useSignal,
} from "@telegram-apps/sdk-react";
import type React from "react";
import { useEffect } from "react";

import type { SwapView } from "@/components/wallet/SwapSheet";
import {
  hideMainButton,
  hideSecondaryButton,
  showMainButton,
  showReceiveShareButton,
} from "@/lib/telegram/mini-app/buttons";
import {
  createShareMessage,
  shareSavedInlineMessage,
} from "@/lib/telegram/mini-app/share-message";
import type {
  IncomingTransaction,
  TransactionDetailsData,
} from "@/types/wallet";

import { CLAIM_SOURCES, type ClaimSource } from "../wallet-analytics";

interface TelegramMainButtonParams {
  // Sheet states
  isTransactionDetailsSheetOpen: boolean;
  isSendSheetOpen: boolean;
  isSwapSheetOpen: boolean;
  isReceiveSheetOpen: boolean;
  isBgPickerOpen: boolean;
  // Form states
  isSendFormValid: boolean;
  isSwapFormValid: boolean;
  isSendingTransaction: boolean;
  isSwapping: boolean;
  isClaimingTransaction: boolean;
  // Transaction state
  selectedTransaction: TransactionDetailsData | null;
  selectedIncomingTransaction: IncomingTransaction | null;
  showClaimSuccess: boolean;
  claimError: string | null;
  // Send flow
  sendStep: 1 | 2 | 3 | 4 | 5;
  sendError: string | null;
  sentAmountSol: number | undefined;
  sendFormValues: { amount: string; recipient: string };
  // Swap flow
  swapView: SwapView;
  swapActiveTab: "swap" | "secure";
  secureDirection: "shield" | "unshield";
  // Data
  rawInitData: string | undefined;
  solPriceUsd: number | null;
  // Callbacks
  handleOpenSendSheet: (recipientName?: string) => void;
  handleOpenReceiveSheet: () => void;
  handleShareAddress: () => Promise<void>;
  handleApproveTransaction: (id: string, source: ClaimSource) => Promise<void>;
  handleSubmitSend: () => Promise<void>;
  handleSubmitSwap: () => Promise<void>;
  handleSubmitSecure: () => Promise<void>;
  // Setters
  setSendSheetOpen: (open: boolean) => void;
  setSendStep: React.Dispatch<React.SetStateAction<1 | 2 | 3 | 4 | 5>>;
  setSwapSheetOpen: (open: boolean) => void;
  setSwapView: React.Dispatch<React.SetStateAction<SwapView>>;
  setSwapActiveTab: React.Dispatch<React.SetStateAction<"swap" | "secure">>;
  setSwapError: React.Dispatch<React.SetStateAction<string | null>>;
  setSwappedFromAmount: React.Dispatch<
    React.SetStateAction<number | undefined>
  >;
  setSwappedFromSymbol: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  setSwappedToAmount: React.Dispatch<React.SetStateAction<number | undefined>>;
  setSwappedToSymbol: React.Dispatch<React.SetStateAction<string | undefined>>;
  setTransactionDetailsSheetOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedTransaction: React.Dispatch<
    React.SetStateAction<TransactionDetailsData | null>
  >;
  setSelectedIncomingTransaction: React.Dispatch<
    React.SetStateAction<IncomingTransaction | null>
  >;
  setShowClaimSuccess: React.Dispatch<React.SetStateAction<boolean>>;
  setClaimError: React.Dispatch<React.SetStateAction<string | null>>;
  setIsSwapping: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSendingTransaction: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useTelegramMainButton(params: TelegramMainButtonParams): void {
  const {
    isTransactionDetailsSheetOpen,
    isSendSheetOpen,
    isSwapSheetOpen,
    isReceiveSheetOpen,
    isBgPickerOpen,
    isSendFormValid,
    isSwapFormValid,
    isSendingTransaction,
    isSwapping,
    isClaimingTransaction,
    selectedTransaction,
    selectedIncomingTransaction,
    showClaimSuccess,
    claimError,
    sendStep,
    sendError,
    sentAmountSol,
    sendFormValues,
    swapView,
    swapActiveTab,
    secureDirection,
    rawInitData,
    solPriceUsd,
    handleOpenSendSheet,
    handleOpenReceiveSheet,
    handleShareAddress,
    handleApproveTransaction,
    handleSubmitSend,
    handleSubmitSwap,
    handleSubmitSecure,
    setSendSheetOpen,
    setSendStep,
    setSwapSheetOpen,
    setSwapView,
    setSwapActiveTab,
    setSwapError,
    setSwappedFromAmount,
    setSwappedFromSymbol,
    setSwappedToAmount,
    setSwappedToSymbol,
    setTransactionDetailsSheetOpen,
    setSelectedTransaction,
    setSelectedIncomingTransaction,
    setShowClaimSuccess,
    setClaimError,
    setIsSwapping,
    setIsSendingTransaction,
  } = params;

  const mainButtonAvailable = useSignal(mainButton.setParams.isAvailable);
  const secondaryButtonAvailable = useSignal(
    secondaryButton.setParams.isAvailable
  );

  useEffect(() => {
    if (!mainButtonAvailable) {
      mainButton.mount.ifAvailable?.();
      hideMainButton();
    }

    if (!secondaryButtonAvailable) {
      secondaryButton.mount.ifAvailable?.();
      hideSecondaryButton();
    }

    if (!mainButtonAvailable) {
      return () => {
        hideMainButton();
        hideSecondaryButton();
      };
    }

    // Bg picker manages its own main button
    if (isBgPickerOpen) {
      return () => {
        hideMainButton();
        hideSecondaryButton();
      };
    }

    if (isTransactionDetailsSheetOpen && selectedTransaction) {
      hideSecondaryButton();

      // Show "Done" button on claim success or error
      if (showClaimSuccess || claimError) {
        showMainButton({
          text: "Done",
          onClick: () => {
            setTransactionDetailsSheetOpen(false);
            setSelectedTransaction(null);
            setSelectedIncomingTransaction(null);
            setShowClaimSuccess(false);
            setClaimError(null);
          },
          isEnabled: true,
          showLoader: false,
        });
      } else if (selectedIncomingTransaction) {
        // Only show Claim button for incoming (claimable) transactions
        if (isClaimingTransaction) {
          // Show only main button with loader during claim
          showMainButton({
            text: "Claim",
            onClick: () => {}, // No-op during loading
            isEnabled: false,
            showLoader: true,
          });
        } else {
          // Show Claim button
          showMainButton({
            text: "Claim",
            onClick: () =>
              handleApproveTransaction(
                selectedIncomingTransaction.id,
                CLAIM_SOURCES.manual
              ),
          });
        }
      } else {
        // For outgoing transactions, hide the main button
        hideMainButton();
      }
    } else if (isSendSheetOpen) {
      hideSecondaryButton();

      if (sendStep === 1) {
        // Token selection — no main button, token click auto-advances
        hideMainButton();
      } else if (sendStep === 2) {
        showMainButton({
          text: "Next",
          onClick: () => {
            if (isSendFormValid) setSendStep(3);
          },
          isEnabled: isSendFormValid,
          showLoader: false,
        });
      } else if (sendStep === 3) {
        showMainButton({
          text: "Review",
          onClick: () => {
            if (isSendFormValid) setSendStep(4);
          },
          isEnabled: isSendFormValid,
          showLoader: false,
        });
      } else if (sendStep === 4) {
        showMainButton({
          text: "Confirm and Send",
          onClick: () => {
            setIsSendingTransaction(true); // Set loading state BEFORE showing result view
            setSendStep(5);
            handleSubmitSend();
          },
          isEnabled: isSendFormValid && !isSendingTransaction,
          showLoader: false,
        });
      } else if (sendStep === 5) {
        if (isSendingTransaction) {
          // In-progress — hide button while spinner shows
          hideMainButton();
        } else if (sendError) {
          showMainButton({
            text: "Done",
            onClick: () => {
              setSendSheetOpen(false);
            },
            isEnabled: true,
            showLoader: false,
          });
        } else {
          showMainButton({
            text: "Share transaction",
            onClick: async () => {
              setSendSheetOpen(false);
              const recipientUsername = sendFormValues.recipient
                .trim()
                .replace(/^@/, "");

              if (
                sentAmountSol &&
                recipientUsername &&
                rawInitData &&
                solPriceUsd
              ) {
                try {
                  const amountSol = sentAmountSol;
                  const amountUsd = amountSol * (solPriceUsd || 0);
                  const msgId = await createShareMessage(
                    rawInitData,
                    recipientUsername,
                    amountSol,
                    amountUsd
                  );
                  if (msgId) {
                    await shareSavedInlineMessage(msgId);
                  }
                } catch (error) {
                  console.error("Failed to share transaction", error);
                }
              } else {
                console.error(
                  "Failed to share transaction: missing required data"
                );
              }
            },
            isEnabled: true,
            showLoader: false,
          });
        }
      }
    } else if (isSwapSheetOpen) {
      hideSecondaryButton();
      if (swapView === "result") {
        if (isSwapping) {
          // Swapping in progress - hide button
          hideMainButton();
        } else {
          // Result view (success or error) - show Done button
          showMainButton({
            text: "Done",
            onClick: () => {
              hapticFeedback.impactOccurred("light");
              setSwapSheetOpen(false);
              // Reset swap state
              setSwapView("main");
              setSwapActiveTab("swap");
              setSwapError(null);
              setSwappedFromAmount(undefined);
              setSwappedFromSymbol(undefined);
              setSwappedToAmount(undefined);
              setSwappedToSymbol(undefined);
            },
            isEnabled: true,
            showLoader: false,
          });
        }
      } else if (swapView === "confirm") {
        // Confirm view - show "Confirm and Swap" button
        showMainButton({
          text: "Confirm and Swap",
          onClick: () => {
            hapticFeedback.impactOccurred("medium");
            setIsSwapping(true); // Set loading state BEFORE showing result view
            setSwapView("result");
            void handleSubmitSwap();
          },
          isEnabled: !isSwapping,
          showLoader: false,
        });
      } else if (swapView === "main") {
        if (swapActiveTab === "swap") {
          showMainButton({
            text: "Review",
            onClick: () => {
              hapticFeedback.impactOccurred("light");
              setSwapView("confirm");
            },
            isEnabled: isSwapFormValid && !isSwapping,
            showLoader: false,
          });
        } else {
          const btnText =
            secureDirection === "shield"
              ? "Confirm and Shield"
              : "Confirm and Unshield";
          showMainButton({
            text: btnText,
            onClick: () => {
              hapticFeedback.impactOccurred("medium");
              setIsSwapping(true);
              setSwapView("result");
              void handleSubmitSecure();
            },
            isEnabled: isSwapFormValid && !isSwapping,
            showLoader: false,
          });
        }
      } else {
        // Token selection views - hide main button
        hideMainButton();
      }
    } else if (isReceiveSheetOpen) {
      hideSecondaryButton();
      showReceiveShareButton({ onShare: handleShareAddress });
    } else {
      hideMainButton();
      hideSecondaryButton();
    }

    return () => {
      hideMainButton();
      hideSecondaryButton();
    };
  }, [
    isTransactionDetailsSheetOpen,
    isSendSheetOpen,
    isSwapSheetOpen,
    isReceiveSheetOpen,
    isBgPickerOpen,
    isSendFormValid,
    isSwapFormValid,
    isSendingTransaction,
    selectedTransaction,
    selectedIncomingTransaction,
    isClaimingTransaction,
    mainButtonAvailable,
    secondaryButtonAvailable,
    handleOpenSendSheet,
    handleOpenReceiveSheet,
    handleShareAddress,
    handleApproveTransaction,
    handleSubmitSend,
    sendStep,
    sentAmountSol,
    sendFormValues,
    showClaimSuccess,
    setShowClaimSuccess,
    claimError,
    setClaimError,
    sendError,
    rawInitData,
    solPriceUsd,
    swapView,
    swapActiveTab,
    handleSubmitSwap,
    handleSubmitSecure,
    secureDirection,
    isSwapping,
    setIsSendingTransaction,
    setIsSwapping,
    setSelectedIncomingTransaction,
    setSelectedTransaction,
    setSendSheetOpen,
    setSendStep,
    setSwapActiveTab,
    setSwapError,
    setSwapSheetOpen,
    setSwapView,
    setSwappedFromAmount,
    setSwappedFromSymbol,
    setSwappedToAmount,
    setSwappedToSymbol,
    setTransactionDetailsSheetOpen,
  ]);
}
