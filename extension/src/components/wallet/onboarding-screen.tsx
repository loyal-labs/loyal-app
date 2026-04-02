import { useCallback, useEffect, useState } from "react";
import { track } from "~/src/lib/analytics";
import { onboardingCompleted } from "~/src/lib/storage";
import {
  ONBOARDING_COMPLETION_METHODS,
  ONBOARDING_EVENTS,
} from "./onboarding-analytics";

const SLIDES = [
  {
    image: "/onboarding/on1.png",
    title: "Manage All Your Tokens",
    subtitle:
      "Send, swap, and receive any Solana token from one secure wallet.",
  },
  {
    image: "/onboarding/on2.png",
    title: "Send Privately",
    subtitle:
      "Send crypto privately over Telegram username. Don\u2019t reveal your address and sensitive data onchain.",
  },
  {
    image: "/onboarding/on3.png",
    title: "Shield and Earn",
    subtitle:
      "Move assets into your private balance and earn up to 4.31% APY while keeping them ready for private transactions.",
  },
  {
    image: "/onboarding/on4.png",
    title: "Connect With Confidence",
    subtitle:
      "Securely connect to any onchain app and approve every action on your terms.",
  },
] as const;

function PaginationDots({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? "10px" : "6px",
            height: i === current ? "10px" : "6px",
            borderRadius: "9999px",
            background:
              i === current
                ? "rgba(249, 54, 60, 1)"
                : "rgba(249, 54, 60, 0.2)",
            transition:
              "width 0.3s ease, height 0.3s ease, background 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}

export function OnboardingScreen({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [current, setCurrent] = useState(0);
  // "enter" = slide fading in, "idle" = visible, "exit" = slide fading out
  const [phase, setPhase] = useState<"enter" | "idle" | "exit">("enter");
  // Whether the whole screen is fading out before completing
  const [exiting, setExiting] = useState(false);

  const isLast = current === SLIDES.length - 1;

  useEffect(() => {
    track(ONBOARDING_EVENTS.started);
  }, []);

  // Trigger enter→idle on mount and after each slide change
  useEffect(() => {
    if (phase === "enter") {
      const t = requestAnimationFrame(() => {
        // Double-rAF to ensure the initial transform is applied before transitioning
        requestAnimationFrame(() => setPhase("idle"));
      });
      return () => cancelAnimationFrame(t);
    }
  }, [phase]);

  const finish = useCallback(() => {
    void onboardingCompleted.setValue(true);
    track(ONBOARDING_EVENTS.ended, {
      method: isLast
        ? ONBOARDING_COMPLETION_METHODS.completed
        : ONBOARDING_COMPLETION_METHODS.skipped,
      slides_viewed: current + 1,
    });
    setExiting(true);
    setTimeout(() => onComplete(), 300);
  }, [onComplete, isLast, current]);

  const goNext = useCallback(() => {
    if (phase !== "idle") return;
    if (isLast) {
      finish();
      return;
    }
    // Phase 1: fade out current
    setPhase("exit");
    setTimeout(() => {
      // Phase 2: swap content, start entering from right
      track(ONBOARDING_EVENTS.slideViewed, {
        slide_index: current + 1,
        slide_title: SLIDES[current + 1].title,
      });
      setCurrent((c) => c + 1);
      setPhase("enter");
    }, 250);
  }, [phase, isLast, finish, current]);

  const slide = SLIDES[current];

  // Transform values per phase
  const slideTransform =
    phase === "enter"
      ? "translateX(30px)"
      : phase === "exit"
        ? "translateX(-30px)"
        : "translateX(0)";
  const slideOpacity = phase === "idle" ? 1 : 0;

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        width: "100%",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflow: "hidden",
        opacity: exiting ? 0 : 1,
        transition: "opacity 0.3s ease",
      }}
    >
      {/* Header — pagination dots centered, Skip on right, vertically aligned */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "52px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 8px",
          zIndex: 2,
          background:
            "linear-gradient(to bottom, #fff 60%, rgba(255,255,255,0))",
        }}
      >
        <PaginationDots current={current} total={SLIDES.length} />

        {/* Skip button — hidden on last slide, vertically centered in header */}
        <button
          type="button"
          onClick={finish}
          style={{
            position: "absolute",
            right: "8px",
            background: "rgba(249, 54, 60, 0.14)",
            border: "none",
            borderRadius: "9999px",
            padding: "8px 16px",
            cursor: "pointer",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "14px",
            fontWeight: 500,
            lineHeight: "20px",
            color: "#000",
            opacity: isLast ? 0 : 1,
            pointerEvents: isLast ? "none" : "auto",
            transition: "opacity 0.2s ease",
          }}
        >
          Skip
        </button>
      </div>

      {/* Slide content — centered */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "20px",
          padding: "52px 20px 76px",
          width: "100%",
          minHeight: 0,
          opacity: slideOpacity,
          transform: slideTransform,
          transition:
            phase === "enter"
              ? "none"
              : "opacity 0.25s ease, transform 0.25s ease",
        }}
      >
        {/* Preview image */}
        <div
          style={{
            width: "100%",
            maxWidth: "320px",
            maxHeight: "320px",
            aspectRatio: "1",
            flexShrink: 0,
          }}
        >
          <img
            src={slide.image}
            alt={slide.title}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              borderRadius: "16px",
            }}
          />
        </div>

        {/* Text */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            alignItems: "center",
            textAlign: "center",
            maxWidth: "320px",
            width: "100%",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "20px",
              fontWeight: 600,
              lineHeight: "24px",
              color: "#000",
              margin: 0,
            }}
          >
            {slide.title}
          </p>
          <p
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "rgba(60, 60, 67, 0.6)",
              margin: 0,
            }}
          >
            {slide.subtitle}
          </p>
        </div>
      </div>

      {/* Bottom button */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "16px 20px",
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0), #fff 40%)",
          zIndex: 2,
        }}
      >
        <button
          type="button"
          onClick={goNext}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px 16px",
            borderRadius: "9999px",
            border: "none",
            cursor: "pointer",
            background: "#000",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "16px",
            fontWeight: 400,
            lineHeight: "20px",
            color: "#fff",
            textAlign: "center",
          }}
        >
          {isLast ? "Get started" : "Next"}
        </button>
      </div>
    </div>
  );
}
