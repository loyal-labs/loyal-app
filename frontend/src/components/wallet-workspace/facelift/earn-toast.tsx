"use client";

import { useEffect, useRef, useState } from "react";

import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";

// Single-slot toast for the Earn action flows (deposit / withdraw /
// autodeposit). use-earn-actions.ts reports lifecycle moments through
// `earnToast`; the host mounted in shell.tsx renders them as a
// bottom-center pill (transitions.dev toast recipe). The status icon is a
// three-way icon-swap: pending spinner (a) morphs into the success check
// (b) or the error cross (c).

type EarnToastPhase = "error" | "loading" | "success";

type EarnToastDetail = { message: string; phase: EarnToastPhase };

type EarnToastListener = {
  settle: () => void;
  show: (detail: EarnToastDetail) => void;
  signed: () => void;
};

let listener: EarnToastListener | null = null;

// The wallet-sign stage message. The wallet adapter bridge calls
// earnToast.signed() when a signature resolves, and the host only advances
// the toast when this exact message is showing — keep them in sync.
export const CONFIRM_IN_WALLET_MESSAGE = "Confirm in wallet";

export const earnToast = {
  error(message: string) {
    listener?.show({ message, phase: "error" });
  },
  loading(message: string) {
    listener?.show({ message, phase: "loading" });
  },
  // Close the toast if it is still in its loading phase — the flow ended
  // without an outcome worth announcing (wallet cancel, review decline,
  // sign-in gate). Safe to call unconditionally from `finally` blocks.
  settle() {
    listener?.settle();
  },
  // The wallet finished signing: advance a visible "Confirm in wallet"
  // toast to "Confirming" (submission + chain/backend confirm). No-op for
  // any other toast state, so non-Earn signature flows never surface one.
  signed() {
    listener?.signed();
  },
  success(message: string) {
    listener?.show({ message, phase: "success" });
  },
};

const SUCCESS_DISMISS_MS = 2500;
const ERROR_DISMISS_MS = 5000;
// Outlives --toast-close (250ms) so content stays mounted through the
// close transition instead of emptying the pill mid-flight.
const CLEAR_AFTER_CLOSE_MS = 300;

const ICON_STATE: Record<EarnToastPhase, "a" | "b" | "c"> = {
  error: "c",
  loading: "a",
  success: "b",
};

export function EarnToastHost() {
  const [detail, setDetail] = useState<EarnToastDetail | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const detailRef = useRef<EarnToastDetail | null>(null);
  const timersRef = useRef<{
    clear?: ReturnType<typeof setTimeout>;
    hide?: ReturnType<typeof setTimeout>;
  }>({});

  useEffect(() => {
    const clearTimers = () => {
      clearTimeout(timersRef.current.hide);
      clearTimeout(timersRef.current.clear);
    };
    const close = () => {
      detailRef.current = null;
      setIsOpen(false);
      timersRef.current.clear = setTimeout(
        () => setDetail(null),
        CLEAR_AFTER_CLOSE_MS
      );
    };
    const show = (next: EarnToastDetail) => {
      clearTimers();
      detailRef.current = next;
      setDetail(next);
      setIsOpen(true);
      if (next.phase !== "loading") {
        timersRef.current.hide = setTimeout(
          close,
          next.phase === "success" ? SUCCESS_DISMISS_MS : ERROR_DISMISS_MS
        );
      }
    };
    listener = {
      settle: () => {
        if (detailRef.current?.phase === "loading") {
          clearTimers();
          close();
        }
      },
      show,
      signed: () => {
        if (
          detailRef.current?.phase === "loading" &&
          detailRef.current.message === CONFIRM_IN_WALLET_MESSAGE
        ) {
          show({ message: "Confirming", phase: "loading" });
        }
      },
    };
    return () => {
      listener = null;
      clearTimers();
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-6 z-[60] flex justify-center"
      role="status"
    >
      <div
        className={`t-toast flex h-12 items-center gap-2.5 rounded-full bg-white pr-5 pl-4 font-medium text-[14px] text-black leading-5 shadow-[0px_0px_2px_0px_rgba(0,0,0,0.08),0px_4px_16px_0px_rgba(0,0,0,0.08)] ${
          isOpen ? "is-open" : ""
        }`}
        // Top-anchored, so the pill drops in from above its resting spot
        // (the recipe's default +16px rises from below).
        style={{ ["--toast-distance" as never]: "-16px" }}
      >
        {detail ? (
          <>
            <span
              aria-hidden="true"
              className="t-icon-swap size-5"
              data-state={ICON_STATE[detail.phase]}
            >
              <span className="t-icon" data-icon="a">
                <svg className="size-5" fill="none" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" fill="#ffb800" r="32" />
                  <circle
                    className="t-toast-spinner"
                    cx="32"
                    cy="32"
                    fill="none"
                    r="14"
                    stroke="white"
                    strokeDasharray="40 48"
                    strokeLinecap="round"
                    strokeWidth="6"
                  />
                </svg>
              </span>
              {/* Same circle + check pair as ActionSuccessBody's t-success-check. */}
              <span className="t-icon" data-icon="b">
                <svg className="size-5" fill="none" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" fill="#34c759" r="32" />
                  <path
                    d="M20 33l8 8 16-16"
                    stroke="white"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="5"
                  />
                </svg>
              </span>
              <span className="t-icon" data-icon="c">
                <svg className="size-5" fill="none" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" fill="#f9363c" r="32" />
                  <path
                    d="M23 23l18 18M41 23l-18 18"
                    stroke="white"
                    strokeLinecap="round"
                    strokeWidth="5"
                  />
                </svg>
              </span>
            </span>
            <span>
              <TextSwap text={detail.message} />
              {detail.phase === "loading" ? (
                <span aria-hidden="true" className="t-loading-dots">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              ) : null}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}
