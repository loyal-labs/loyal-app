"use client";

import {
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  PanelRightOpen,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { RightSidebarTab } from "@/components/wallet-sidebar";
import { Sparkline } from "@/components/wallet-sidebar/sparkline";

export interface ChatInputProps {
  isChatMode: boolean;
  isInputStuckToBottom: boolean;
  stickyInputBottomOffset: number;
  parallaxOffset: number;
  pendingText: string;
  onPendingTextChange: (text: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSubmit: (e: React.FormEvent) => void;
  hasUsableInput: boolean;
  isLoading: boolean;
  isSignedIn: boolean;
  isOnline: boolean;
  isBalanceHidden: boolean;
  onBalanceHiddenChange: (hidden: boolean) => void;
  isWalletConnected: boolean;
  isWalletLoading: boolean;
  walletLabel: string;
  balanceWhole: string;
  balanceFraction: string;
  balanceSolLabel: string;
  onOpenRightSidebar: (tab: RightSidebarTab) => void;
  onOpenSignIn: (source: "hero_card") => void;
  walletAddress: string | null;
  balanceHistory: number[];
  dogCry?: boolean;
  dogNice?: boolean;
}

// All dog SVG paths use 980x784 viewBox (displayed at 160x128)
// Body is shared; only face features (white shape, black shape, sweat lines) differ per mood

const DOG_BODY = "M147 686L0 343H441V0L637 343L686 0L980 784L147 686Z";

// Pupil center in 980x784 space and max travel
const PUPIL_CX = 539;
const PUPIL_CY = 488;
const MAX_OFFSET = 37; // ~6px scaled up (6 * 980/160)

// White eye/mouth shapes per mood
const WHITE_MAIN =
  "M542.333 423.938C623.408 428.186 686.147 488.592 682.464 558.856L388.867 543.47C392.549 473.205 461.259 419.689 542.333 423.938Z";
const WHITE_UPSET =
  "M545.963 549.93C468.298 545.859 407.47 490.256 405.728 423.819L684.869 480.066C660.003 524.137 606.425 553.098 545.963 549.93Z";
const WHITE_SCARED =
  "M542.333 423.938C623.408 428.186 686.147 488.592 682.464 558.856L388.867 543.47C392.549 473.205 461.259 419.689 542.333 423.938Z";
const WHITE_HUH =
  "M545.961 549.928C468.295 545.857 407.468 490.255 405.726 423.817L684.867 480.064C660.001 524.136 606.422 553.096 545.961 549.928Z";

// Black pupil/mouth shapes per mood (circle approximated as path for morphing)
// Main: circle at (539, 488) r≈66 — same as scared pupil but bigger for eye-tracking
const BLACK_MAIN =
  "M605 488C605 524.451 575.451 554 539 554C502.549 554 473 524.451 473 488C473 451.549 502.549 422 539 422C575.451 422 605 451.549 605 488Z";
const BLACK_UPSET =
  "M558.831 542.996C522.348 541.084 494.322 509.958 496.233 473.475C496.8 462.661 499.944 452.596 505.023 443.828L627.923 468.592C628.408 472.442 628.562 476.388 628.352 480.399C626.439 516.882 595.314 544.908 558.831 542.996Z";
const BLACK_SCARED =
  "M563.87 487.549C563.87 501.284 552.734 512.42 538.999 512.42C525.264 512.42 514.128 501.284 514.128 487.549C514.128 473.814 525.264 462.678 538.999 462.678C552.734 462.678 563.87 473.814 563.87 487.549Z";
const BLACK_HUH =
  "M546.253 494.915C514.649 493.258 489.4 469.676 484.453 439.682L605.697 464.111C593.335 483.7 571.03 496.213 546.253 494.915Z";

// Scared-only sweat lines
const SWEAT_LINES = [
  "M826.872 270.112C805.027 295.225 765.01 330.015 840.96 356.475",
  "M765.672 437.907C770.822 405.023 786.497 367.47 841.01 399.32",
  "M676.167 363.687C709.124 359.03 744.922 349.884 725.779 428",
  "M747.861 243.103C761.275 273.565 781.079 316.312 700.699 319.053",
];

// Eyelid rects in 980x784 space (scaled from 160x128 originals)
const EYELID_TOP = { x: 368, y: 288, w: 343, h: 135 };
const EYELID_BOT = { x: 368, y: 558, w: 343, h: 86 };
const EYELID_TOP_SQUINT_Y = 86; // translateY when squinting
const EYELID_BOT_SQUINT_Y = -61;

// Excited dog — big grin with star sparkle in eye
const WHITE_EXCITED =
  "M542.333 423.938C623.407 428.187 686.146 488.592 682.464 558.857L388.867 543.47C392.549 473.205 461.258 419.689 542.333 423.938Z";
const BLACK_EXCITED =
  "M542.532 435.643C586.259 437.935 619.849 475.241 617.557 518.967C616.87 532.087 613.028 544.293 606.809 554.892L466.142 547.52C461.065 536.329 458.522 523.788 459.209 510.669C461.501 466.942 498.805 433.352 542.532 435.643Z";
// Star sparkle path (white) — excited only
const EXCITED_STAR =
  "M562.108 543.399C562.108 523.779 546.203 507.874 526.583 507.874C546.203 507.874 562.108 491.969 562.108 472.349C562.108 491.969 578.014 507.874 597.633 507.874C578.014 507.874 562.108 523.779 562.108 543.399Z";
// Eye highlight circle — excited only
const EXCITED_HIGHLIGHT = { cx: 588.44, cy: 477.861, r: 9.1875 };

// Cry dog — squished eye with teardrop
const WHITE_CRY =
  "M689.959 497.366C694.187 510.305 696.131 524.014 695.392 538.122L401.794 522.737C404.112 478.5 432.208 440.906 472.933 420.181L689.959 497.366Z";
const BLACK_CRY =
  "M614.204 470.422C615.446 476.089 615.964 482.015 615.645 488.089C614.715 505.838 606.865 521.584 594.852 532.856L499.522 527.86C488.754 515.394 482.597 498.913 483.527 481.163C484.561 461.447 494.126 444.203 508.458 432.817L614.204 470.422Z";
// Teardrop path (white) — cry only
const CRY_TEARDROP =
  "M583.617 615.154C583.617 632.744 569.358 647.004 551.767 647.004C534.177 647.004 519.917 632.744 519.917 615.154C519.917 597.564 551.767 554.516 551.767 554.516C551.767 554.516 583.617 597.564 583.617 615.154Z";

// Nice dog — satisfied smile after wallet loads
const WHITE_NICE =
  "M542.334 423.938C623.409 428.186 686.148 488.592 682.465 558.856L388.868 543.47C392.551 473.205 461.26 419.689 542.334 423.938Z";
const BLACK_NICE =
  "M542.52 435.642C586.246 437.934 619.834 475.24 617.542 518.967C616.855 532.086 613.014 544.292 606.795 554.891L466.132 547.519C461.055 536.328 458.508 523.787 459.196 510.668C461.487 466.942 498.794 433.351 542.52 435.642Z";

type DogMood = "main" | "upset" | "scared" | "huh" | "excited" | "cry" | "nice";

const IDLE_TIMEOUT = 5000;
const REACTION_DURATION = 2000;
const SCARED_CLICK_THRESHOLD = 3;
const MORPH_DURATION = 0.4; // seconds

const WHITES: Record<DogMood, string> = {
  main: WHITE_MAIN,
  upset: WHITE_UPSET,
  scared: WHITE_SCARED,
  huh: WHITE_HUH,
  excited: WHITE_EXCITED,
  cry: WHITE_CRY,
  nice: WHITE_NICE,
};
const BLACKS: Record<DogMood, string> = {
  main: BLACK_MAIN,
  upset: BLACK_UPSET,
  scared: BLACK_SCARED,
  huh: BLACK_HUH,
  excited: BLACK_EXCITED,
  cry: BLACK_CRY,
  nice: BLACK_NICE,
};

function useMorphPath(paths: Record<DogMood, string>, mood: DogMood) {
  const [current, setCurrent] = useState(paths[mood]);
  const prevMoodRef = useRef(mood);
  const rafRef = useRef<number>(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (prevMoodRef.current === mood) return;

    const from = paths[prevMoodRef.current];
    const to = paths[mood];
    prevMoodRef.current = mood;

    // Lazy-import flubber to keep bundle split
    let cancelled = false;
    void import("flubber").then(({ interpolate }) => {
      if (cancelled) return;
      const interp = interpolate(from, to, { maxSegmentLength: 10 });
      startRef.current = performance.now();

      const tick = (now: number) => {
        if (cancelled) return;
        const t = Math.min(
          (now - startRef.current) / (MORPH_DURATION * 1000),
          1
        );
        // Ease-in-out cubic
        const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        setCurrent(interp(eased));
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [mood, paths]);

  return current;
}

function DogWithMood({
  squint,
  cry,
  nice,
}: {
  squint?: boolean;
  cry?: boolean;
  nice?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mood, setMood] = useState<DogMood>("main");
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scaredClicksRef = useRef(0);

  // Morph paths
  const whitePath = useMorphPath(WHITES, mood);
  const blackPath = useMorphPath(BLACKS, mood);

  // Eye tracking (only active in main mood)
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (mood !== "main") return;
      const svg = svgRef.current;
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const scaleX = 980 / rect.width;
      const scaleY = 784 / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;
      const dx = mx - PUPIL_CX;
      const dy = my - PUPIL_CY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist === 0) {
        setEyeOffset({ x: 0, y: 0 });
      } else {
        const clamp = Math.min(dist, MAX_OFFSET) / dist;
        setEyeOffset({ x: dx * clamp, y: dy * clamp });
      }
    },
    [mood]
  );

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  // Reset eye offset when leaving main mood
  useEffect(() => {
    if (mood !== "main") setEyeOffset({ x: 0, y: 0 });
  }, [mood]);

  // Idle timer
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setMood((prev) => (prev === "main" ? "upset" : prev));
    }, IDLE_TIMEOUT);
  }, []);

  const returnToMain = useCallback(() => {
    setMood("main");
    scaredClicksRef.current = 0;
    resetIdleTimer();
  }, [resetIdleTimer]);

  // Excited and nice auto-return to main after REACTION_DURATION
  useEffect(() => {
    if (mood === "excited" || mood === "nice") {
      const t = setTimeout(returnToMain, REACTION_DURATION);
      return () => clearTimeout(t);
    }
  }, [mood, returnToMain]);

  // Cry trigger from parent (wallet disconnect)
  const prevCryRef = useRef(cry);
  useEffect(() => {
    const justStartedCrying = cry && !prevCryRef.current;
    prevCryRef.current = cry;

    if (justStartedCrying) {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setMood("cry");
      reactionTimerRef.current = setTimeout(returnToMain, REACTION_DURATION);
    }
  }, [cry, returnToMain]);

  // Nice trigger from parent (wallet finished loading) — shows excited face
  const prevNiceRef = useRef(nice);
  useEffect(() => {
    const justBecameNice = nice && !prevNiceRef.current;
    prevNiceRef.current = nice;

    if (justBecameNice) {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
      setMood("excited");
      reactionTimerRef.current = setTimeout(returnToMain, REACTION_DURATION);
    }
  }, [nice, returnToMain]);

  // Activity listener — waking up from upset triggers excited
  useEffect(() => {
    const handleActivity = () => {
      setMood((prev) => {
        if (prev === "upset") return "excited";
        // Don't interrupt excited — let its timer handle return to main
        return prev;
      });
      resetIdleTimer();
    };

    const events = [
      "mousemove",
      "keydown",
      "mousedown",
      "touchstart",
      "scroll",
    ] as const;
    for (const evt of events) {
      window.addEventListener(evt, handleActivity, { passive: true });
    }
    resetIdleTimer();

    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, handleActivity);
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  useEffect(() => {
    return () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    };
  }, []);

  const handleDogClick = useCallback(() => {
    if (mood === "cry") return; // Don't interrupt cry
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);

    if (mood === "scared") {
      scaredClicksRef.current += 1;
      if (scaredClicksRef.current >= SCARED_CLICK_THRESHOLD) {
        setMood("huh");
        scaredClicksRef.current = 0;
        reactionTimerRef.current = setTimeout(returnToMain, REACTION_DURATION);
      } else {
        reactionTimerRef.current = setTimeout(returnToMain, REACTION_DURATION);
      }
    } else {
      setMood("scared");
      scaredClicksRef.current = 1;
      reactionTimerRef.current = setTimeout(returnToMain, REACTION_DURATION);
    }
  }, [mood, returnToMain]);

  const isMain = mood === "main";
  const showSweat = mood === "scared";
  const showExcitedExtras = mood === "excited";
  const showTeardrop = mood === "cry";

  return (
    <svg
      ref={svgRef}
      width="160"
      height="128"
      viewBox="0 0 980 784"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      onClick={handleDogClick}
      style={{ cursor: "pointer" }}
    >
      {/* Shared body */}
      <path d={DOG_BODY} fill="#F9363C" />

      {/* Morphing white eye/mouth */}
      <path d={whitePath} fill="white" />

      {/* Morphing black pupil/mouth — with eye tracking transform in main mood */}
      <path
        d={blackPath}
        fill="black"
        style={{
          transform:
            isMain && !squint
              ? `translate(${eyeOffset.x}px, ${eyeOffset.y}px)`
              : "translate(0, 0)",
          transition:
            isMain && !squint
              ? "transform 0.08s ease-out"
              : "transform 0.25s ease",
        }}
      />

      {/* Eyelids (squint) — clipped to body, only visible in main mood */}
      <defs>
        <clipPath id="dog-body-clip-m">
          <path d={DOG_BODY} />
        </clipPath>
      </defs>
      <g clipPath="url(#dog-body-clip-m)">
        <rect
          x={EYELID_TOP.x}
          y={EYELID_TOP.y}
          width={EYELID_TOP.w}
          height={EYELID_TOP.h}
          fill="#F9363C"
          style={{
            transform:
              squint && isMain
                ? `translateY(${EYELID_TOP_SQUINT_Y}px)`
                : "translateY(0)",
            opacity: isMain ? 1 : 0,
            transition: "transform 0.25s ease, opacity 0.3s ease",
          }}
        />
        <rect
          x={EYELID_BOT.x}
          y={EYELID_BOT.y}
          width={EYELID_BOT.w}
          height={EYELID_BOT.h}
          fill="#F9363C"
          style={{
            transform:
              squint && isMain
                ? `translateY(${EYELID_BOT_SQUINT_Y}px)`
                : "translateY(0)",
            opacity: isMain ? 1 : 0,
            transition: "transform 0.25s ease, opacity 0.3s ease",
          }}
        />
      </g>

      {/* Sweat lines — scared only, fade in/out */}
      {SWEAT_LINES.map((d, i) => (
        <path
          d={d}
          key={i}
          stroke="black"
          strokeWidth="29.4"
          fill="none"
          style={{
            opacity: showSweat ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
        />
      ))}

      {/* Excited extras — star sparkle + eye highlight */}
      <path
        d={EXCITED_STAR}
        fill="white"
        style={{
          opacity: showExcitedExtras ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />
      <circle
        cx={EXCITED_HIGHLIGHT.cx}
        cy={EXCITED_HIGHLIGHT.cy}
        r={EXCITED_HIGHLIGHT.r}
        fill="white"
        style={{
          opacity: showExcitedExtras ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />

      {/* Cry teardrop */}
      <path
        d={CRY_TEARDROP}
        fill="white"
        style={{
          opacity: showTeardrop ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />
    </svg>
  );
}

export function ChatInput(props: ChatInputProps) {
  const isBalanceHidden = props.isBalanceHidden;
  const walletLoading = props.isWalletConnected && props.isWalletLoading;
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!props.walletAddress) return;
      void navigator.clipboard.writeText(props.walletAddress).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [props.walletAddress]
  );

  return (
    <>
      {/* SVG pixelation filters for balance hiding */}
      <svg
        aria-hidden="true"
        height="0"
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
        }}
        width="0"
      >
        <defs>
          {/* Large pixel filter for main dollar balance */}
          <filter id="pixelate-lg" x="0" y="0" width="100%" height="100%">
            <feFlood x="4" y="4" height="2" width="2" />
            <feComposite width="10" height="10" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="5" />
          </filter>
          {/* Smaller pixel filter for SOL balance */}
          <filter id="pixelate-sm" x="0" y="0" width="100%" height="100%">
            <feFlood x="3" y="3" height="2" width="2" />
            <feComposite width="8" height="8" />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius="4" />
          </filter>
        </defs>
      </svg>

      {/* Chat Input Container - animates between center and bottom */}
      <div
        style={{
          position: props.isChatMode
            ? "absolute"
            : props.isInputStuckToBottom
            ? "fixed"
            : "absolute",
          bottom: props.isChatMode
            ? "16px"
            : props.isInputStuckToBottom
            ? `${props.stickyInputBottomOffset}px`
            : "50%",
          left: props.isInputStuckToBottom && !props.isChatMode ? "0" : "16px",
          right: props.isInputStuckToBottom && !props.isChatMode ? "0" : "16px",
          transform: props.isChatMode
            ? "translateY(0)"
            : props.isInputStuckToBottom
            ? "translateY(0)"
            : `translateY(calc(50% - 17px + ${props.parallaxOffset}px))`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          zIndex: props.isChatMode ? "auto" : 50,
          transition: props.isChatMode
            ? "bottom 0.5s cubic-bezier(0.4, 0, 0.2, 1), transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)"
            : props.isInputStuckToBottom
            ? "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), left 0.3s ease, right 0.3s ease, max-width 0.3s ease"
            : "transform 0.3s ease-out",
        }}
      >
        {/* Dog illustration */}
        {!props.isChatMode && !props.isInputStuckToBottom && (
          <div
            style={{
              position: "relative",
              width: "160px",
              height: "128px",
              marginBottom: "-18px",
              pointerEvents: "auto",
            }}
          >
            <DogWithMood
              squint={isBalanceHidden}
              cry={props.dogCry}
              nice={props.dogNice}
            />
            {/* Red loading spinner on dog's ear */}
            <div
              style={{
                position: "absolute",
                top: "38px",
                right: "12px",
                width: "28px",
                height: "28px",
                zIndex: 1,
                opacity: walletLoading ? 1 : 0,
                transform: walletLoading ? "scale(1)" : "scale(0.5)",
                transition: "opacity 0.3s ease, transform 0.3s ease",
                pointerEvents: "none",
              }}
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 28 28"
                style={{
                  animation: walletLoading
                    ? "dog-spinner 0.8s linear infinite"
                    : "none",
                }}
              >
                <circle
                  cx="14"
                  cy="14"
                  r="11"
                  fill="none"
                  stroke="rgba(0, 0, 0, 0.1)"
                  strokeWidth="2.5"
                />
                <circle
                  cx="14"
                  cy="14"
                  r="11"
                  fill="none"
                  stroke="rgba(0, 0, 0, 0.5)"
                  strokeWidth="2.5"
                  strokeDasharray="69.115"
                  strokeDashoffset="51.836"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Input form - liquid glass style with integrated send button */}
        <form
          onSubmit={props.onSubmit}
          style={{
            position: "relative",
            width: "100%",
            maxWidth:
              props.isInputStuckToBottom && !props.isChatMode
                ? "500px"
                : "768px",
            pointerEvents: "auto",
            transition: "max-width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              background: "rgba(241, 241, 241, 0.7)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              borderRadius: "32px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                width: "100%",
              }}
            >
              {/* Input field area */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "flex-end",
                  maxHeight: "368px",
                  overflow: "hidden",
                  paddingLeft: "24px",
                  paddingRight: "16px",
                  paddingTop: "16px",
                  paddingBottom: "16px",
                }}
              >
                <textarea
                  onChange={(e) => {
                    props.onPendingTextChange(e.target.value);

                    // Auto-resize textarea based on content
                    if (props.inputRef.current) {
                      props.inputRef.current.style.height = "auto";
                      const scrollHeight = props.inputRef.current.scrollHeight;
                      const maxHeight = 336; // 368 - 32 (padding)
                      if (scrollHeight > maxHeight) {
                        props.inputRef.current.style.height = `${maxHeight}px`;
                        props.inputRef.current.style.overflowY = "auto";
                      } else {
                        props.inputRef.current.style.height = `${scrollHeight}px`;
                        props.inputRef.current.style.overflowY = "hidden";
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    // Allow Shift+Enter to create new lines
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (props.hasUsableInput && !props.isLoading) {
                        props.onSubmit(e as unknown as React.FormEvent);
                      }
                    }
                  }}
                  placeholder={
                    props.isOnline
                      ? props.isChatMode && !props.isSignedIn
                        ? "Please sign in to continue..."
                        : "Ask loyal anything..."
                      : "No internet connection..."
                  }
                  ref={props.inputRef}
                  rows={1}
                  style={{
                    width: "100%",
                    padding: "2px 0",
                    background: "transparent",
                    border: "none",
                    color: "#000",
                    fontSize: "16px",
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    lineHeight: "24px",
                    resize: "none",
                    outline: "none",
                    overflowY: "hidden",
                  }}
                  value={props.pendingText}
                />
              </div>

              {/* Submit button wrapper */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                  padding: "8px",
                  alignSelf: "stretch",
                }}
              >
                <button
                  disabled={!(props.hasUsableInput || props.isLoading)}
                  onClick={(e) => {
                    e.preventDefault();
                    if (props.isLoading) {
                      // TODO: Implement stop functionality
                    } else if (props.hasUsableInput) {
                      props.onSubmit(e as unknown as React.FormEvent);
                    }
                  }}
                  style={{
                    width: "44px",
                    height: "44px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#F9363C",
                    opacity: props.hasUsableInput || props.isLoading ? 1 : 0.4,
                    border: "none",
                    borderRadius: "9999px",
                    cursor:
                      props.hasUsableInput || props.isLoading
                        ? "pointer"
                        : "not-allowed",
                    outline: "none",
                    transition: "all 0.2s ease",
                    boxShadow:
                      props.hasUsableInput || props.isLoading
                        ? "0px 4px 8px 0px rgba(0, 0, 0, 0.04), 0px 2px 4px 0px rgba(0, 0, 0, 0.02)"
                        : "none",
                    mixBlendMode: "normal",
                  }}
                  type="button"
                >
                  {props.isLoading ? (
                    <img
                      alt="Stop"
                      height={24}
                      src="/send_stop.svg"
                      width={24}
                    />
                  ) : props.hasUsableInput ? (
                    <img
                      alt="Send"
                      height={24}
                      src="/send_enabled.svg"
                      width={24}
                    />
                  ) : (
                    <img
                      alt="Send"
                      height={24}
                      src="/send_disabled.svg"
                      width={24}
                    />
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>

        {/* Wallet + Action Cards — hidden on mobile */}
        {!props.isChatMode && !props.isInputStuckToBottom && (
          <div
            className="hero-wallet-cards"
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              width: "100%",
              maxWidth: "768px",
              padding: "0 16px",
              marginTop: "28px",
              pointerEvents: "auto",
            }}
          >
            <div
              className="action-card"
              onClick={() =>
                props.isSignedIn
                  ? props.onOpenRightSidebar("portfolio")
                  : props.onOpenSignIn("hero_card")
              }
              style={{
                flex: 1,
                display: "flex",
                gap: "16px",
                alignItems: props.isSignedIn ? "flex-start" : "center",
                justifyContent: props.isSignedIn ? "flex-start" : "center",
                padding: "16px 16px 12px",
                borderRadius: "20px",
                border: "1px solid rgba(0, 0, 0, 0.08)",
                minHeight: props.isSignedIn ? undefined : "116px",
              }}
            >
              {!props.isSignedIn ? (
                <span
                  style={{
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: "14px",
                    fontWeight: 400,
                    lineHeight: "20px",
                    color: "rgba(60, 60, 67, 0.6)",
                    textAlign: "center",
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpenSignIn("hero_card");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      font: "inherit",
                      color: "#F9363C",
                      cursor: "pointer",
                      fontWeight: 500,
                    }}
                    type="button"
                  >
                    Sign in
                  </button>{" "}
                  to use all features
                </span>
              ) : (
                <>
                  <div
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "9999px",
                      background: "rgba(249, 54, 60, 0.14)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <PanelRightOpen size={20} style={{ color: "#F9363C" }} />
                  </div>
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        fontSize: "14px",
                        fontWeight: 400,
                        lineHeight: "20px",
                        color: "rgba(60, 60, 67, 0.6)",
                        fontFeatureSettings: "'liga' off, 'clig' off",
                        display: "flex",
                        alignItems: "center",
                        gap: "3px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {props.walletLabel}
                      {props.walletAddress && (
                        <button
                          onClick={handleCopyAddress}
                          style={{
                            background: "none",
                            border: "none",
                            padding: "1px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            color: copied
                              ? "#34C759"
                              : "rgba(60, 60, 67, 0.35)",
                            transition: "color 0.15s ease",
                            flexShrink: 0,
                          }}
                          type="button"
                        >
                          {copied ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      )}
                    </span>
                    {walletLoading ? (
                      <>
                        <div
                          className="skeleton-shimmer"
                          style={{
                            width: "140px",
                            height: "32px",
                            borderRadius: "8px",
                            background: "rgba(0, 0, 0, 0.06)",
                          }}
                        />
                        <div
                          className="skeleton-shimmer"
                          style={{
                            width: "80px",
                            height: "20px",
                            borderRadius: "6px",
                            background: "rgba(0, 0, 0, 0.04)",
                          }}
                        />
                      </>
                    ) : (
                      <>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <div
                            style={{ borderRadius: "8px", overflow: "hidden" }}
                          >
                            <span
                              style={{
                                fontFamily:
                                  "var(--font-geist-sans), sans-serif",
                                fontSize: "28px",
                                fontWeight: 600,
                                lineHeight: "32px",
                                color: isBalanceHidden ? "#BBBBC0" : "#000",
                                fontFeatureSettings: "'liga' off, 'clig' off",
                                filter: isBalanceHidden
                                  ? "url(#pixelate-lg)"
                                  : "none",
                                transition:
                                  "filter 0.15s ease, color 0.15s ease",
                                userSelect: isBalanceHidden ? "none" : "auto",
                                display: "block",
                              }}
                            >
                              {props.balanceWhole}
                              <span
                                style={{
                                  color: isBalanceHidden
                                    ? "#BBBBC0"
                                    : "rgba(60, 60, 67, 0.6)",
                                  transition: "color 0.15s ease",
                                }}
                              >
                                {props.balanceFraction}
                              </span>
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onBalanceHiddenChange(!isBalanceHidden);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              padding: 0,
                              display: "flex",
                              alignItems: "center",
                              flexShrink: 0,
                            }}
                            type="button"
                          >
                            {isBalanceHidden ? (
                              <EyeOff
                                size={22}
                                strokeWidth={1.5}
                                style={{ color: "rgba(60, 60, 67, 0.5)" }}
                              />
                            ) : (
                              <Eye
                                size={22}
                                strokeWidth={1.5}
                                style={{ color: "rgba(60, 60, 67, 0.5)" }}
                              />
                            )}
                          </button>
                        </div>
                        <div
                          style={{ borderRadius: "6px", overflow: "hidden" }}
                        >
                          <span
                            style={{
                              fontFamily: "var(--font-geist-sans), sans-serif",
                              fontSize: "14px",
                              fontWeight: 400,
                              lineHeight: "20px",
                              color: isBalanceHidden
                                ? "#C8C8CC"
                                : "rgba(60, 60, 67, 0.6)",
                              fontFeatureSettings: "'liga' off, 'clig' off",
                              filter: isBalanceHidden
                                ? "url(#pixelate-sm)"
                                : "none",
                              transition: "filter 0.15s ease, color 0.15s ease",
                              userSelect: isBalanceHidden ? "none" : "auto",
                              display: "block",
                            }}
                          >
                            {props.balanceSolLabel}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                  {!walletLoading && props.balanceHistory.length >= 2 && (
                    <div
                      style={{
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        alignSelf: "center",
                      }}
                    >
                      <Sparkline data={props.balanceHistory} width={140} />
                    </div>
                  )}
                </>
              )}
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                gap: "8px",
                opacity: walletLoading || !props.isSignedIn ? 0.4 : 1,
                pointerEvents:
                  walletLoading || !props.isSignedIn ? "none" : "auto",
                transition: "opacity 0.3s ease",
              }}
            >
              {/* Recent Activity Card */}
              <div
                className="action-card"
                onClick={() => props.onOpenRightSidebar("portfolio")}
                style={{
                  flex: 1,
                  height: "116px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  padding: "16px 16px 12px",
                  borderRadius: "20px",
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "9999px",
                    background: "rgba(249, 54, 60, 0.14)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <ArrowUpRight size={20} style={{ color: "#F9363C" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: "14px",
                      fontWeight: 500,
                      lineHeight: "20px",
                      color: "#000",
                      fontFeatureSettings: "'liga' off, 'clig' off",
                    }}
                  >
                    Sent 0.5 SOL
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: "13px",
                      fontWeight: 400,
                      lineHeight: "16px",
                      color: "rgba(60, 60, 67, 0.6)",
                      fontFeatureSettings: "'liga' off, 'clig' off",
                    }}
                  >
                    to @alex · 2m ago
                  </span>
                </div>
              </div>

              {/* Approval Request Card */}
              <div
                className="action-card"
                onClick={() => props.onOpenRightSidebar("portfolio")}
                style={{
                  flex: 1,
                  height: "116px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  padding: "16px 16px 12px",
                  borderRadius: "20px",
                  border: "1px solid rgba(0, 0, 0, 0.08)",
                  overflow: "hidden",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="Agent 47"
                  src="/agents/Agent-02.svg"
                  style={{ width: "36px", height: "36px", borderRadius: "10px" }}
                />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: "14px",
                      fontWeight: 500,
                      lineHeight: "20px",
                      color: "#000",
                      fontFeatureSettings: "'liga' off, 'clig' off",
                    }}
                  >
                    Agent 47
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: "13px",
                      fontWeight: 400,
                      lineHeight: "16px",
                      color: "rgba(200, 160, 0, 0.85)",
                      fontFeatureSettings: "'liga' off, 'clig' off",
                    }}
                  >
                    Needs approval
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        /* Custom scrollbar for textarea */
        textarea::-webkit-scrollbar {
          width: 6px;
        }
        textarea::-webkit-scrollbar-track {
          background: transparent;
        }
        textarea::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.15);
          border-radius: 12px;
          opacity: 0.48;
        }
        textarea::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.25);
        }
        textarea {
          scrollbar-width: thin;
          scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
        }

        input::placeholder,
        textarea::placeholder {
          color: rgba(0, 0, 0, 0.4);
        }

        .action-card {
          transition: background-color 0.3s ease;
          cursor: pointer;
        }
        .action-card:hover {
          background-color: rgba(0, 0, 0, 0.04);
        }

        @keyframes dog-spinner {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes skeleton-shimmer-anim {
          0% {
            background-position: -200px 0;
          }
          100% {
            background-position: 200px 0;
          }
        }

        .skeleton-shimmer {
          background-image: linear-gradient(
            90deg,
            rgba(0, 0, 0, 0.06) 0%,
            rgba(0, 0, 0, 0.02) 50%,
            rgba(0, 0, 0, 0.06) 100%
          ) !important;
          background-size: 200px 100%;
          animation: skeleton-shimmer-anim 1.5s ease-in-out infinite;
        }

        @media (max-width: 767px) {
          .hero-wallet-cards {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}
