"use client";

import { useEffect, useRef, useState } from "react";

import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";

// Single-slot toast for the Earn action flows (deposit / withdraw /
// autodeposit). use-earn-actions.ts reports lifecycle moments through
// `earnToast`; the host mounted in shell.tsx renders them as a
// bottom-center pill (transitions.dev toast recipe). The status icon is a
// three-way icon-swap: pending spinner (a) morphs into the success check
// (b) or the error cross (c).
//
// Multi-stage flows can additionally begin() a step script: the pill then
// renders as a task-steps card listing every stage upfront (pending dot /
// spinner / check / cross per row), and each loading() message lights up
// its step. Success collapses the card back into the plain success pill.

type EarnToastPhase = "error" | "loading" | "success";

type EarnToastDetail = { message: string; phase: EarnToastPhase };

export type EarnFlowId =
  | "autodeposit-delete"
  | "autodeposit-setup"
  | "close-policies"
  | "deposit"
  | "withdraw";

type EarnToastListener = {
  begin: (flow: EarnFlowId) => void;
  settle: () => void;
  show: (detail: EarnToastDetail) => void;
  signed: () => void;
};

let listener: EarnToastListener | null = null;

// The wallet-sign stage message. The wallet adapter bridge calls
// earnToast.signed() when a signature resolves, and the host only advances
// the toast when this exact message is showing — keep them in sync.
export const CONFIRM_IN_WALLET_MESSAGE = "Confirm in wallet";

// Step scripts for the multi-stage Earn flows. Entries are the exact
// loading() messages use-earn-actions.ts emits, in order — the host maps
// each message to its index and auto-checks everything before it, so a
// conditional stage that never runs (e.g. "Waiting for approval" when the
// deposit needs no approval) still reads as done. A loading message outside
// the active script drops the toast back to the plain pill.
const FLOW_STEPS: Record<EarnFlowId, readonly string[]> = {
  "autodeposit-delete": [
    "Waiting for approval",
    CONFIRM_IN_WALLET_MESSAGE,
    "Confirming",
  ],
  "autodeposit-setup": [
    "Waiting for approval",
    "Preparing Autodeposit",
    CONFIRM_IN_WALLET_MESSAGE,
    "Confirming",
  ],
  "close-policies": [
    "Closing policies",
    CONFIRM_IN_WALLET_MESSAGE,
    "Confirming",
  ],
  deposit: [
    "Preparing deposit",
    // Conditional: only legacy-policy wallets depositing a Token-2022 mint
    // hit this stage (ASK-2108); the host auto-checks it for everyone else.
    "Updating Earn policy",
    "Waiting for approval",
    CONFIRM_IN_WALLET_MESSAGE,
    "Confirming",
  ],
  withdraw: [
    "Preparing withdrawal",
    "Waiting for approval",
    CONFIRM_IN_WALLET_MESSAGE,
    "Confirming",
  ],
};

export const earnToast = {
  // Arm the step script for the flow that is about to start. The following
  // loading()/success()/error()/settle() calls need no changes — messages
  // resolve to steps, terminal calls end the flow.
  begin(flow: EarnFlowId) {
    listener?.begin(flow);
  },
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

const PILL_HEIGHT_PX = 48;
const STEP_ROW_HEIGHT_PX = 28;
const CARD_PADDING_Y_PX = 12;
const CARD_WIDTH_PX = 240;

export function EarnToastHost() {
  const [detail, setDetail] = useState<EarnToastDetail | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [steps, setSteps] = useState<readonly string[] | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const detailRef = useRef<EarnToastDetail | null>(null);
  const stepsRef = useRef<readonly string[] | null>(null);
  const timersRef = useRef<{
    clear?: ReturnType<typeof setTimeout>;
    hide?: ReturnType<typeof setTimeout>;
  }>({});

  useEffect(() => {
    const clearTimers = () => {
      clearTimeout(timersRef.current.hide);
      clearTimeout(timersRef.current.clear);
    };
    const disarm = () => {
      stepsRef.current = null;
      setSteps(null);
      setStepIndex(-1);
    };
    const close = () => {
      detailRef.current = null;
      setIsOpen(false);
      timersRef.current.clear = setTimeout(() => {
        setDetail(null);
        disarm();
      }, CLEAR_AFTER_CLOSE_MS);
    };
    const show = (next: EarnToastDetail) => {
      clearTimers();
      detailRef.current = next;
      if (next.phase === "loading" && stepsRef.current) {
        const index = stepsRef.current.indexOf(next.message);
        if (index === -1) {
          disarm();
        } else {
          setStepIndex(index);
        }
      } else if (next.phase === "success") {
        // Collapse the step card into the plain success pill; errors keep
        // the card so the failed step shows where the flow stopped.
        disarm();
      }
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
      begin: (flow) => {
        stepsRef.current = FLOW_STEPS[flow];
        setSteps(stepsRef.current);
        setStepIndex(-1);
      },
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

  const isCard =
    steps !== null &&
    stepIndex >= 0 &&
    detail !== null &&
    detail.phase !== "success";

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-6 z-[60] flex justify-center"
      role="status"
    >
      <div
        className={`t-toast t-toast-resize flex flex-col justify-center overflow-hidden bg-popover font-medium text-[14px] text-foreground leading-5 shadow-[0px_0px_2px_0px_rgba(0,0,0,0.08),0px_4px_16px_0px_rgba(0,0,0,0.08)] ${
          isOpen ? "is-open" : ""
        }`}
        // Top-anchored, so the pill drops in from above its resting spot
        // (the recipe's default +16px rises from below). Height/radius are
        // inline so the card ⇄ pill morph rides the resize clock, same as
        // t-earn-banner.
        style={{
          ["--toast-distance" as never]: "-16px",
          borderRadius: PILL_HEIGHT_PX / 2,
          height: isCard
            ? CARD_PADDING_Y_PX * 2 + steps.length * STEP_ROW_HEIGHT_PX
            : PILL_HEIGHT_PX,
          width: isCard ? CARD_WIDTH_PX : undefined,
        }}
      >
        {isCard ? (
          <div className="flex flex-col px-4">
            {steps.map((label, index) => {
              const isActive = index === stepIndex;
              const state =
                index < stepIndex
                  ? "b"
                  : isActive
                  ? detail.phase === "error"
                    ? "c"
                    : "a"
                  : "p";
              return (
                <div className="flex h-7 items-center gap-2.5" key={label}>
                  <span
                    aria-hidden="true"
                    className="t-step-icon size-4 shrink-0"
                    data-state={state}
                  >
                    <span className="t-step-ico" data-ico="p">
                      <span className="size-1.5 rounded-full bg-foreground/20" />
                    </span>
                    <span className="t-step-ico" data-ico="a">
                      <SpinnerIcon className="size-4" />
                    </span>
                    <span className="t-step-ico" data-ico="b">
                      <CheckIcon className="size-4" />
                    </span>
                    <span className="t-step-ico" data-ico="c">
                      <CrossIcon className="size-4" />
                    </span>
                  </span>
                  <span
                    className={`t-step-label min-w-0 truncate ${
                      state === "p" ? "text-muted-foreground" : ""
                    }`}
                  >
                    <TextSwap
                      className={state === "a" ? "t-step-active" : ""}
                      text={
                        isActive && detail.phase === "error"
                          ? detail.message
                          : label
                      }
                    />
                  </span>
                </div>
              );
            })}
            <span className="sr-only">
              {`${steps[stepIndex]}, step ${stepIndex + 1} of ${steps.length}`}
            </span>
          </div>
        ) : detail ? (
          <div className="flex items-center gap-2.5 pr-5 pl-4">
            <span
              aria-hidden="true"
              className="t-icon-swap size-5"
              data-state={ICON_STATE[detail.phase]}
            >
              <span className="t-icon" data-icon="a">
                <SpinnerIcon className="size-5" />
              </span>
              {/* Same circle + check pair as ActionSuccessBody's t-success-check. */}
              <span className="t-icon" data-icon="b">
                <CheckIcon className="size-5" />
              </span>
              <span className="t-icon" data-icon="c">
                <CrossIcon className="size-5" />
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
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 64 64">
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
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 64 64">
      <circle cx="32" cy="32" fill="var(--positive)" r="32" />
      <path
        d="M20 33l8 8 16-16"
        stroke="white"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
      />
    </svg>
  );
}

function CrossIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 64 64">
      <circle cx="32" cy="32" fill="var(--destructive)" r="32" />
      <path
        d="M23 23l18 18M41 23l-18 18"
        stroke="white"
        strokeLinecap="round"
        strokeWidth="5"
      />
    </svg>
  );
}
