import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// SVG path constants — 980x784 viewBox
// ---------------------------------------------------------------------------

const DOG_BODY = "M147 686L0 343H441V0L637 343L686 0L980 784L147 686Z";

const PUPIL_CX = 539;
const PUPIL_CY = 488;
const MAX_OFFSET = 37;

// White eye/mouth shapes per mood
const WHITE_MAIN =
  "M542.333 423.938C623.408 428.186 686.147 488.592 682.464 558.856L388.867 543.47C392.549 473.205 461.259 419.689 542.333 423.938Z";
const WHITE_UPSET =
  "M545.963 549.93C468.298 545.859 407.47 490.256 405.728 423.819L684.869 480.066C660.003 524.137 606.425 553.098 545.963 549.93Z";
const WHITE_SCARED =
  "M542.333 423.938C623.408 428.186 686.147 488.592 682.464 558.856L388.867 543.47C392.549 473.205 461.259 419.689 542.333 423.938Z";
const WHITE_CRY =
  "M689.959 497.366C694.187 510.305 696.131 524.014 695.392 538.122L401.794 522.737C404.112 478.5 432.208 440.906 472.933 420.181L689.959 497.366Z";
const WHITE_EXCITED =
  "M542.333 423.938C623.407 428.187 686.146 488.592 682.464 558.857L388.867 543.47C392.549 473.205 461.258 419.689 542.333 423.938Z";

// Black pupil/mouth shapes per mood
const BLACK_MAIN =
  "M605 488C605 524.451 575.451 554 539 554C502.549 554 473 524.451 473 488C473 451.549 502.549 422 539 422C575.451 422 605 451.549 605 488Z";
const BLACK_UPSET =
  "M558.831 542.996C522.348 541.084 494.322 509.958 496.233 473.475C496.8 462.661 499.944 452.596 505.023 443.828L627.923 468.592C628.408 472.442 628.562 476.388 628.352 480.399C626.439 516.882 595.314 544.908 558.831 542.996Z";
const BLACK_SCARED =
  "M563.87 487.549C563.87 501.284 552.734 512.42 538.999 512.42C525.264 512.42 514.128 501.284 514.128 487.549C514.128 473.814 525.264 462.678 538.999 462.678C552.734 462.678 563.87 473.814 563.87 487.549Z";
const BLACK_CRY =
  "M614.204 470.422C615.446 476.089 615.964 482.015 615.645 488.089C614.715 505.838 606.865 521.584 594.852 532.856L499.522 527.86C488.754 515.394 482.597 498.913 483.527 481.163C484.561 461.447 494.126 444.203 508.458 432.817L614.204 470.422Z";
const BLACK_EXCITED =
  "M542.532 435.643C586.259 437.935 619.849 475.241 617.557 518.967C616.87 532.087 613.028 544.293 606.809 554.892L466.142 547.52C461.065 536.329 458.508 523.788 459.209 510.669C461.501 466.942 498.805 433.352 542.532 435.643Z";

// Scared sweat lines
const SWEAT_LINES = [
  "M826.872 270.112C805.027 295.225 765.01 330.015 840.96 356.475",
  "M765.672 437.907C770.822 405.023 786.497 367.47 841.01 399.32",
  "M676.167 363.687C709.124 359.03 744.922 349.884 725.779 428",
  "M747.861 243.103C761.275 273.565 781.079 316.312 700.699 319.053",
];

// Excited sparkle
const EXCITED_STAR =
  "M562.108 543.399C562.108 523.779 546.203 507.874 526.583 507.874C546.203 507.874 562.108 491.969 562.108 472.349C562.108 491.969 578.014 507.874 597.633 507.874C578.014 507.874 562.108 523.779 562.108 543.399Z";
const EXCITED_HIGHLIGHT = { cx: 588.44, cy: 477.861, r: 9.1875 };

// Cry teardrop
const CRY_TEARDROP =
  "M583.617 615.154C583.617 632.744 569.358 647.004 551.767 647.004C534.177 647.004 519.917 632.744 519.917 615.154C519.917 597.564 551.767 554.516 551.767 554.516C551.767 554.516 583.617 597.564 583.617 615.154Z";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type DogMood = "main" | "upset" | "scared" | "excited" | "cry";

const MORPH_DURATION = 0.4;
const IDLE_TIMEOUT = 8000;
const REACTION_DURATION = 2000;

const WHITES: Record<DogMood, string> = {
  main: WHITE_MAIN,
  upset: WHITE_UPSET,
  scared: WHITE_SCARED,
  excited: WHITE_EXCITED,
  cry: WHITE_CRY,
};
const BLACKS: Record<DogMood, string> = {
  main: BLACK_MAIN,
  upset: BLACK_UPSET,
  scared: BLACK_SCARED,
  excited: BLACK_EXCITED,
  cry: BLACK_CRY,
};

// ---------------------------------------------------------------------------
// Morph hook
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DogMascot({
  size = 160,
  triggerMood,
}: {
  size?: number;
  /** When set, directly controls displayed mood (held, not one-shot).
   *  When undefined, internal state machine runs (excited→main, idle→upset, etc). */
  triggerMood?: DogMood;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [internalMood, setInternalMood] = useState<DogMood>("excited");
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // triggerMood overrides internal mood when set
  const mood = triggerMood ?? internalMood;

  // When triggerMood is cleared (becomes undefined), sync internal to main
  const prevTriggerRef = useRef(triggerMood);
  useEffect(() => {
    if (prevTriggerRef.current && !triggerMood) {
      setInternalMood("main");
      resetIdleTimer();
    }
    prevTriggerRef.current = triggerMood;
  }, [triggerMood]);

  const whitePath = useMorphPath(WHITES, mood);
  const blackPath = useMorphPath(BLACKS, mood);

  // Return to main after reaction moods
  const returnToMain = useCallback(() => {
    setInternalMood("main");
    resetIdleTimer();
  }, []);

  // Idle timer — go upset when no activity
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setInternalMood((prev) => (prev === "main" ? "upset" : prev));
    }, IDLE_TIMEOUT);
  }, []);

  // Start excited → main on mount (only when no triggerMood)
  useEffect(() => {
    if (triggerMood) return;
    const t = setTimeout(() => {
      returnToMain();
    }, REACTION_DURATION);
    return () => clearTimeout(t);
  }, []);

  // Eye tracking — only in main mood and when not externally controlled to non-main
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

  useEffect(() => {
    if (mood !== "main") setEyeOffset({ x: 0, y: 0 });
  }, [mood]);

  // Activity listener — wake from upset (only when internal state is active)
  useEffect(() => {
    if (triggerMood) return; // external control, skip internal state machine
    const handleActivity = () => {
      setInternalMood((prev) => {
        if (prev === "upset") return "excited";
        return prev;
      });
      resetIdleTimer();
    };

    const events = ["mousemove", "keydown", "mousedown"] as const;
    for (const e of events)
      window.addEventListener(e, handleActivity, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, handleActivity);
    };
  }, [resetIdleTimer, triggerMood]);

  // Auto-return from excited (internal only)
  useEffect(() => {
    if (triggerMood) return;
    if (internalMood === "excited") {
      const t = setTimeout(returnToMain, REACTION_DURATION);
      return () => clearTimeout(t);
    }
  }, [internalMood, returnToMain, triggerMood]);

  const h = size * (784 / 980);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 980 784"
      width={size}
      height={h}
      fill="none"
      style={{ display: "block" }}
    >
      {/* Body */}
      <path d={DOG_BODY} fill="#F9363C" />

      {/* White eye shape */}
      <path d={whitePath} fill="#fff" />

      {/* Clip pupil to white eye area so it never escapes into the red head */}
      <defs>
        <clipPath id="eye-clip">
          <path d={whitePath} />
        </clipPath>
      </defs>

      {/* Black pupil — clipped to eye, with tracking offset in main mood */}
      <g clipPath="url(#eye-clip)">
        <path
          d={blackPath}
          fill="#000"
          style={{
            transform:
              mood === "main"
                ? `translate(${eyeOffset.x}px, ${eyeOffset.y}px)`
                : "translate(0, 0)",
            transition:
              mood === "main"
                ? "transform 0.08s ease-out"
                : "transform 0.25s ease",
          }}
        />
      </g>

      {/* Excited extras: star sparkle + highlight */}
      {mood === "excited" && (
        <>
          <path d={EXCITED_STAR} fill="#fff" />
          <circle
            cx={EXCITED_HIGHLIGHT.cx}
            cy={EXCITED_HIGHLIGHT.cy}
            r={EXCITED_HIGHLIGHT.r}
            fill="#fff"
          />
        </>
      )}

      {/* Scared sweat lines */}
      {mood === "scared" &&
        SWEAT_LINES.map((d, i) => (
          <path
            key={i}
            d={d}
            stroke="#F9363C"
            strokeWidth={8}
            strokeLinecap="round"
            fill="none"
          />
        ))}

      {/* Cry teardrop */}
      {mood === "cry" && <path d={CRY_TEARDROP} fill="#fff" />}
    </svg>
  );
}
