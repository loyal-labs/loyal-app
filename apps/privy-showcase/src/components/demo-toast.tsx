"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { SponsorStage } from "@/lib/sponsor-protocol";

// Single-slot toast for the demo's waiting states, ported from the webapp's
// Earn action toast (apps/web facelift/earn-toast.tsx, transitions.dev toast
// recipe). Flows report lifecycle moments through `demoToast`; the host
// mounted once in page.tsx renders them as a top-center pill. The status icon
// is a three-way icon-swap: pending spinner (a) morphs into the success check
// (b) or the error cross (c).
//
// Multi-stage flows can additionally begin() a step script: the pill then
// renders as a task-steps card listing every stage upfront (pending dot /
// spinner / check / cross per row), and each loading() message lights up its
// step. Steps the flow skips (already provisioned on-chain) auto-check when a
// later step activates. Success collapses the card back into the plain pill.

type DemoToastPhase = "error" | "loading" | "success";

type DemoToastDetail = { message: string; phase: DemoToastPhase };

export type DemoFlowId = "create-policies" | "payday" | "purchase";

type DemoToastListener = {
  begin: (flow: DemoFlowId) => void;
  settle: () => void;
  show: (detail: DemoToastDetail) => void;
};

let listener: DemoToastListener | null = null;

// The per-stage loading() messages the policy-setup flow emits. Keys are the
// sponsor protocol stages, so a renamed stage breaks the mapping at compile
// time instead of silently desyncing the card.
export const STAGE_TOAST_MESSAGES: Record<SponsorStage, string> = {
  settings: "Creating the smart account",
  "autodeposit-authority": "Autodeposit authority",
  "autodeposit-policy": "Autodeposit policy",
  "autodeposit-delegation": "Autodeposit delegation",
  "autodeposit-approval": "Token approval",
  "earn-route-policy": "Kamino route policy",
  "earn-setup-policy": "Kamino setup policy",
  "exit-policy": "Wallet exit limit",
};

// Step scripts for the multi-stage flows. Entries are the exact loading()
// messages the flows emit, in order — the host maps each message to its index
// and auto-checks everything before it, so a stage that never runs (already
// provisioned) still reads as done. A loading message outside the active
// script drops the toast back to the plain pill.
const FLOW_STEPS: Record<DemoFlowId, readonly string[]> = {
  "create-policies": [
    "Covering setup costs",
    STAGE_TOAST_MESSAGES["autodeposit-authority"],
    STAGE_TOAST_MESSAGES["autodeposit-policy"],
    STAGE_TOAST_MESSAGES["autodeposit-delegation"],
    STAGE_TOAST_MESSAGES["autodeposit-approval"],
    STAGE_TOAST_MESSAGES["earn-route-policy"],
    STAGE_TOAST_MESSAGES["earn-setup-policy"],
    STAGE_TOAST_MESSAGES["exit-policy"],
  ],
  payday: ["Move 2 USDC to smart account", "Move 2 USDC to Kamino"],
  purchase: ["Move 1 USDC back to smart account", "Send 1 USDC to wallet"],
};

export const demoToast = {
  // Arm the step script for the flow that is about to start. The following
  // loading()/success()/error()/settle() calls need no changes — messages
  // resolve to steps, terminal calls end the flow.
  begin(flow: DemoFlowId) {
    listener?.begin(flow);
  },
  error(message: string) {
    listener?.show({ message, phase: "error" });
  },
  loading(message: string) {
    listener?.show({ message, phase: "loading" });
  },
  // Close the toast if it is still in its loading phase — the flow ended
  // without an outcome worth announcing (wallet cancel, sign-in gate). Safe
  // to call unconditionally from `finally` blocks.
  settle() {
    listener?.settle();
  },
  success(message: string) {
    listener?.show({ message, phase: "success" });
  },
};

const SUCCESS_DISMISS_MS = 2500;
const ERROR_DISMISS_MS = 5000;
// Outlives --toast-close (250ms) so content stays mounted through the close
// transition instead of emptying the pill mid-flight.
const CLEAR_AFTER_CLOSE_MS = 300;
const TEXT_SWAP_MS = 150;

const ICON_STATE: Record<DemoToastPhase, "a" | "b" | "c"> = {
  error: "c",
  loading: "a",
  success: "b",
};

const PILL_HEIGHT_PX = 48;
const STEP_ROW_HEIGHT_PX = 28;
const CARD_PADDING_Y_PX = 12;
const CARD_WIDTH_PX = 280;

// transitions.dev "text states swap": when `text` changes, the old text exits
// up with blur, then the new text enters from below.
function TextSwap({ className, text }: { className?: string; text: string }) {
  const [displayText, setDisplayText] = useState(text);
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = spanRef.current;
    if (!el || el.textContent === text) return;
    el.classList.add("is-exit");
    const timer = window.setTimeout(() => {
      flushSync(() => setDisplayText(text));
      el.classList.remove("is-exit");
      el.classList.add("is-enter-start");
      void el.offsetHeight;
      el.classList.remove("is-enter-start");
    }, TEXT_SWAP_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  return (
    <span className={`t-text-swap ${className ?? ""}`} ref={spanRef}>
      {displayText}
    </span>
  );
}

export function DemoToastHost() {
  const [detail, setDetail] = useState<DemoToastDetail | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [steps, setSteps] = useState<readonly string[] | null>(null);
  const [stepIndex, setStepIndex] = useState(-1);
  const detailRef = useRef<DemoToastDetail | null>(null);
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
    const show = (next: DemoToastDetail) => {
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
        // Collapse the step card into the plain success pill; errors keep the
        // card so the failed step shows where the flow stopped.
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
    <div aria-live="polite" className="demo-toast-viewport" role="status">
      <div
        className={`t-toast t-toast-resize demo-toast${isOpen ? " is-open" : ""}`}
        style={{
          borderRadius: PILL_HEIGHT_PX / 2,
          height: isCard
            ? CARD_PADDING_Y_PX * 2 + steps.length * STEP_ROW_HEIGHT_PX
            : PILL_HEIGHT_PX,
          width: isCard ? CARD_WIDTH_PX : undefined,
        }}
      >
        {isCard ? (
          <div className="demo-toast-steps">
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
                <div className="demo-toast-step" key={label}>
                  <span aria-hidden="true" className="t-step-icon" data-state={state}>
                    <span className="t-step-ico" data-ico="p">
                      <span className="t-step-dot" />
                    </span>
                    <span className="t-step-ico" data-ico="a">
                      <SpinnerIcon />
                    </span>
                    <span className="t-step-ico" data-ico="b">
                      <CheckIcon />
                    </span>
                    <span className="t-step-ico" data-ico="c">
                      <CrossIcon />
                    </span>
                  </span>
                  <span
                    className={`t-step-label${state === "p" ? " is-pending" : ""}`}
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
          <div className="demo-toast-pill">
            <span
              aria-hidden="true"
              className="t-icon-swap"
              data-state={ICON_STATE[detail.phase]}
            >
              <span className="t-icon" data-icon="a">
                <SpinnerIcon />
              </span>
              <span className="t-icon" data-icon="b">
                <CheckIcon />
              </span>
              <span className="t-icon" data-icon="c">
                <CrossIcon />
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

function SpinnerIcon() {
  return (
    <svg fill="none" viewBox="0 0 64 64">
      <circle cx="32" cy="32" fill="var(--yellow, #ffb800)" r="32" />
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

function CheckIcon() {
  return (
    <svg fill="none" viewBox="0 0 64 64">
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

function CrossIcon() {
  return (
    <svg fill="none" viewBox="0 0 64 64">
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
