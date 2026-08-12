"use client";

import { hapticFeedback, themeParams, useRawInitData } from "@telegram-apps/sdk-react";
import { Modal, VisuallyHidden } from "@telegram-apps/telegram-ui";
import type { RGB } from "@telegram-apps/types";
import { Drawer } from "@xelene/vaul-with-scroll-fix";
import { X } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useModalSnapPoint, useTelegramSafeArea } from "@/hooks/useTelegramSafeArea";
import { publicEnv } from "@/lib/core/config/public";
import {
  hideMainButton,
  hideSecondaryButton,
  showMainButton,
} from "@/lib/telegram/mini-app/buttons";
import {
  GaslessState,
  getGaslessState,
  setGaslessState,
} from "@/lib/telegram/mini-app/cloud-storage-gassless";
import { openLoyalTgLink } from "@/lib/telegram/mini-app/open-telegram-link";

export type ClaimFreeTransactionsSheetProps = {
  trigger?: ReactNode | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onStateChange?: (state: GaslessState) => void;
};

export default function ClaimFreeTransactionsSheet({
  trigger,
  open,
  onOpenChange,
  onStateChange,
}: ClaimFreeTransactionsSheetProps) {
  const rawInitData = useRawInitData();
  const snapPoint = useModalSnapPoint();
  const { bottom: safeBottom } = useTelegramSafeArea();
  const [gaslessState, setGaslessStateLocal] = useState<GaslessState | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [buttonColors] = useState(() => {
    try {
      const background = (themeParams.buttonColor?.() ?? "#2990ff") as RGB;
      const text = (themeParams.buttonTextColor?.() ?? "#ffffff") as RGB;
      return { background, text };
    } catch {
      return { background: "#2990ff" as RGB, text: "#ffffff" as RGB };
    }
  });

  const modalStyle = useMemo(
    () =>
      ({
        "--tgui--bg_color": "transparent",
        "--tgui--divider": "rgba(255, 255, 255, 0.05)",
      }) as CSSProperties,
    [],
  );

  const resolveEndpoint = useCallback((path: string): string => {
    const serverHost = publicEnv.serverHost;

    if (typeof window !== "undefined") {
      if (!serverHost) return path;
      try {
        const configured = new URL(serverHost);
        const current = new URL(window.location.origin);
        const hostsMatch =
          configured.protocol === current.protocol &&
          configured.host === current.host;
        return hostsMatch
          ? new URL(path, configured).toString()
          : path;
      } catch {
        return path;
      }
    }

    return serverHost
      ? new URL(path, serverHost).toString()
      : path;
  }, []);

  const handleJoinChannel = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setVerificationError(null);
    setGaslessStateLocal(GaslessState.CLAIMING);
    onStateChange?.(GaslessState.CLAIMING);
    void setGaslessState(GaslessState.CLAIMING);
    void openLoyalTgLink();
  }, [onStateChange]);

  const handleVerify = useCallback(async () => {
    if (gaslessState !== GaslessState.CLAIMING) return;
    if (!rawInitData) {
      console.error("Cannot verify: Telegram init data is missing");
      return;
    }
    if (isVerifying) return;

    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("medium");
    }

    setIsVerifying(true);
    setVerificationError(null);

    const path = "/api/telegram/verify/join";
    const endpoint = resolveEndpoint(path);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: rawInitData,
      });

      const payload = await response
        .json()
        .catch(async () => ({ error: await response.text().catch(() => null) }));

      if (!response.ok) {
        console.error("Verification failed", payload);
        // Reset state to NOT_CLAIMED so user can try again
        void setGaslessState(GaslessState.NOT_CLAIMED);
        setGaslessStateLocal(GaslessState.NOT_CLAIMED);
        onStateChange?.(GaslessState.NOT_CLAIMED);
        setVerificationError("Verification failed. Please try again.");
        if (hapticFeedback.notificationOccurred.isAvailable()) {
          hapticFeedback.notificationOccurred("error");
        }
        return;
      }

      void setGaslessState(GaslessState.CLAIMED);
      setGaslessStateLocal(GaslessState.CLAIMED);
      onStateChange?.(GaslessState.CLAIMED);

      if (onOpenChange) {
        onOpenChange(false);
      }
    } catch (error) {
      console.error("Verification request failed", error);
      // Reset state to NOT_CLAIMED so user can try again
      void setGaslessState(GaslessState.NOT_CLAIMED);
      setGaslessStateLocal(GaslessState.NOT_CLAIMED);
      onStateChange?.(GaslessState.NOT_CLAIMED);
      setVerificationError("Verification failed. Please try again.");
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("error");
      }
    } finally {
      setIsVerifying(false);
    }
  }, [gaslessState, isVerifying, onOpenChange, onStateChange, rawInitData, resolveEndpoint]);

  useEffect(() => {
    let isCancelled = false;

    const syncGaslessState = async () => {
      if (!open) return;
      try {
        const state = await getGaslessState();
        if (isCancelled) return;
        setGaslessStateLocal(state);
        onStateChange?.(state);
      } catch (error) {
        console.warn("Failed to fetch gasless state", error);
        if (isCancelled) return;
        setGaslessStateLocal(GaslessState.NOT_CLAIMED);
        onStateChange?.(GaslessState.NOT_CLAIMED);
      }
    };

    void syncGaslessState();

    return () => {
      isCancelled = true;
    };
  }, [onStateChange, open]);

  useEffect(() => {
    if (!open) {
      setIsVerifying(false);
      setVerificationError(null);
      return;
    }

    if (!gaslessState) {
      hideMainButton();
      hideSecondaryButton();
      return () => {
        hideMainButton();
        hideSecondaryButton();
      };
    }

    if (gaslessState === GaslessState.CLAIMING) {
      const verifyShown = showMainButton({
        text: "Verify",
        onClick: handleVerify,
        backgroundColor: buttonColors.background,
        textColor: buttonColors.text,
        isEnabled: Boolean(rawInitData) && !isVerifying,
        showLoader: isVerifying,
      });

      hideSecondaryButton();

      if (!verifyShown) {
        hideMainButton();
      }

      return () => {
        hideMainButton();
        hideSecondaryButton();
      };
    }

    if (gaslessState === GaslessState.CLAIMED) {
      const completedShown = showMainButton({
        text: "Completed",
        onClick: () => {},
        backgroundColor: buttonColors.background,
        textColor: buttonColors.text,
        isEnabled: false,
        showLoader: false,
      });

      hideSecondaryButton();

      if (!completedShown) {
        hideMainButton();
      }

      return () => {
        hideMainButton();
        hideSecondaryButton();
      };
    }

    const mainShown = showMainButton({
      text: "Join channel",
      onClick: handleJoinChannel,
      backgroundColor: buttonColors.background,
      textColor: buttonColors.text,
    });

    hideSecondaryButton();

    // If Telegram native buttons are unavailable, fall back to hiding both
    if (!mainShown) {
      hideMainButton();
      hideSecondaryButton();
    }

    return () => {
      hideMainButton();
      hideSecondaryButton();
    };
  }, [
    buttonColors.background,
    buttonColors.text,
    handleJoinChannel,
    handleVerify,
    isVerifying,
    gaslessState,
    open,
    rawInitData,
  ]);

  return (
    <Modal
      aria-label="Claim free transactions"
      trigger={trigger || <button style={{ display: 'none' }} />}
      open={open}
      onOpenChange={onOpenChange}
      style={modalStyle}
      snapPoints={[snapPoint]}
    >
      <div
        style={{
          background: "rgba(38, 38, 38, 0.55)",
          backgroundBlendMode: "luminosity",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          paddingBottom: Math.max(safeBottom, 80),
        }}
        className="flex flex-col text-white relative overflow-hidden min-h-[400px] rounded-t-3xl"
      >
        <Drawer.Title asChild>
          <VisuallyHidden>Claim free transactions</VisuallyHidden>
        </Drawer.Title>

        {/* Header */}
        <div className="relative h-[52px] flex items-center justify-center shrink-0">
          <span className="text-base font-medium text-white tracking-[-0.176px]">
            Claim free transactions
          </span>

          {/* Close Button */}
          <Modal.Close>
            <div
              onClick={() => {
                if (hapticFeedback.impactOccurred.isAvailable()) {
                  hapticFeedback.impactOccurred("light");
                }
              }}
              className="absolute right-2 p-1.5 rounded-full flex items-center justify-center active:scale-95 active:bg-white/10 transition-all duration-150 cursor-pointer"
              style={{
                background: "rgba(255, 255, 255, 0.06)",
              }}
            >
              <X size={24} strokeWidth={1.5} className="text-white/60" />
            </div>
          </Modal.Close>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-4 text-center gap-6">
          {/* Error Message */}
          {verificationError && (
            <div
              className="mx-4 px-4 py-3 rounded-xl"
              style={{ background: "rgba(239, 68, 68, 0.15)" }}
            >
              <p className="text-sm text-red-400 leading-5">
                {verificationError}
              </p>
            </div>
          )}
          {/* Info Text */}
          <p className="text-base text-white/60 leading-5 px-4">
            Join our Telegram channel to get gasless transactions.
          </p>
          <p className="text-sm text-white/50 leading-5 px-6">
            Use the Telegram button to join the channel and unlock free transactions.
          </p>
        </div>
      </div>
    </Modal>
  );
}
