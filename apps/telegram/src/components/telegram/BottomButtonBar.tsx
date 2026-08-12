"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import {
  type ButtonBarState,
  getButtonStateSnapshot,
  type SingleButtonState,
  subscribeButtonState,
} from "@/lib/telegram/mini-app/buttons";

export const BUTTON_BAR_ID = "bottom-button-bar";

function PillButton({ state }: { state: SingleButtonState }) {
  return (
    <button
      type="button"
      disabled={!state.isEnabled}
      onClick={state.onClick ?? undefined}
      className="pointer-events-auto flex h-[50px] min-w-[50px] flex-1 items-center justify-center overflow-hidden rounded-[78px] px-3 active:opacity-80"
      style={{
        backgroundColor: state.isEnabled ? "#000000" : "#d0d0d2",
      }}
    >
      {state.showLoader ? (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      ) : (
        <span className="text-[17px] leading-[22px] text-white whitespace-nowrap">
          {state.text}
        </span>
      )}
    </button>
  );
}

const emptyState: ButtonBarState = { main: null, secondary: null };
const getServerSnapshot = () => emptyState;

export function BottomButtonBar() {
  const state = useSyncExternalStore(
    subscribeButtonState,
    getButtonStateSnapshot,
    getServerSnapshot
  );

  const hasButtons = !!(state.main || state.secondary);

  return createPortal(
    <div
      id={BUTTON_BAR_ID}
      className="pointer-events-none fixed bottom-0 left-0 right-0 z-[10000] max-w-md mx-auto"
      style={{ display: hasButtons ? "flex" : "none" }}
    >
      <div
        className="pointer-events-none flex w-full gap-2 px-8 pb-6 pt-4"
        style={{
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0), white 40%)",
          paddingBottom:
            "calc(max(24px, var(--tg-content-safe-area-inset-bottom, 0px)) + 8px)",
        }}
      >
        {state.secondary && <PillButton state={state.secondary} />}
        {state.main && <PillButton state={state.main} />}
      </div>
    </div>,
    document.body
  );
}
