"use client";

import { hapticFeedback } from "@telegram-apps/sdk-react";
import { ChevronRight } from "lucide-react";
import Image from "next/image";
import { type SyntheticEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  GaslessState,
  getGaslessState,
} from "@/lib/telegram/mini-app/cloud-storage-gassless";

import ClaimFreeTransactionsSheet from "./ClaimFreeTransactionsSheet";

export type GaslessBannerProps = {
  onHaptic?: () => void;
  initialState?: GaslessState | null;
  onStateChange?: (state: GaslessState) => void;
};

export default function GaslessBanner({
  onHaptic,
  initialState = null,
  onStateChange,
}: GaslessBannerProps) {
  const [isClaimFreeSheetOpen, setIsClaimFreeSheetOpen] = useState(false);
  const [gaslessState, setGaslessState] = useState<GaslessState | null>(initialState);

  const triggerHaptic = useCallback(() => {
    if (onHaptic) {
      onHaptic();
    } else if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
  }, [onHaptic]);

  const openClaimFreeSheet = useCallback(() => {
    triggerHaptic();
    setIsClaimFreeSheetOpen(true);
  }, [triggerHaptic]);

  const handleJoinLinkClick = useCallback(
    (e?: SyntheticEvent) => {
      e?.stopPropagation();
      openClaimFreeSheet();
    },
    [openClaimFreeSheet],
  );

  useEffect(() => {
    let isCancelled = false;

    const loadGaslessState = async () => {
      try {
        const state = await getGaslessState();
        if (isCancelled) return;
        setGaslessState(state);
        onStateChange?.(state);
      } catch (error) {
        console.warn("Failed to load gasless state", error);
        if (isCancelled) return;
        setGaslessState(GaslessState.NOT_CLAIMED);
        onStateChange?.(GaslessState.NOT_CLAIMED);
      }
    };

    void loadGaslessState();

    return () => {
      isCancelled = true;
    };
  }, [isClaimFreeSheetOpen, onStateChange]);

  useEffect(() => {
    setGaslessState(initialState);
  }, [initialState]);

  const handleGaslessStateChange = useCallback((state: GaslessState) => {
    setGaslessState(state);
    onStateChange?.(state);
  }, [onStateChange]);

  const ctaLabel = useMemo(() => {
    switch (gaslessState) {
      case GaslessState.CLAIMING:
        return "Verify";
      case GaslessState.CLAIMED:
        return "Completed";
      default:
        return "Join";
    }
  }, [gaslessState]);

  return (
    <>
      {/* Banner */}
      <div className="px-4 pb-4">
        <button
          onClick={openClaimFreeSheet}
          className="flex gap-4 items-start pl-4 pr-[120px] py-3 rounded-2xl w-full relative text-left active:opacity-80 transition-opacity"
          style={{
            backgroundImage:
              "linear-gradient(70.22deg, rgba(0, 177, 251, 0) 0%, rgba(0, 177, 251, 0.08) 65%, rgba(0, 177, 251, 0.2) 100%), linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.06) 100%)",
          }}
        >
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex flex-col gap-1">
              <p className="font-medium text-base leading-5 text-white tracking-[-0.176px]">
                Gasless transactions for joining the Loyal Community
              </p>
              <div
                className="flex items-center"
                onClick={handleJoinLinkClick}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleJoinLinkClick(e);
                  }
                }}
              >
                <span className="text-sm leading-5 text-white/60">{ctaLabel}</span>
                <ChevronRight
                  size={12}
                  strokeWidth={1.5}
                  className="text-white/60 mt-0.5"
                />
              </div>
            </div>
          </div>

          {/* Lightning SVG */}
          <div className="absolute right-[16px] top-[-12px] w-[100px] h-[100px] overflow-hidden">
            <Image
              src="/icons/molnia.svg"
              alt=""
              width={100}
              height={100}
              className="w-full h-full object-contain"
            />
          </div>
        </button>
      </div>

      <ClaimFreeTransactionsSheet
        open={isClaimFreeSheetOpen}
        onOpenChange={setIsClaimFreeSheetOpen}
        trigger={null}
        onStateChange={handleGaslessStateChange}
      />
    </>
  );
}
