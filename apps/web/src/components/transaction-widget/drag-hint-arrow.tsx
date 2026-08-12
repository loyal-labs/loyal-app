"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

const TOTAL_LOOPS = 3;

interface DragHintProps {
  onComplete: () => void;
  tokenSymbol: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  firstTokenRef: React.RefObject<HTMLDivElement | null>;
  firstActionRef: React.RefObject<HTMLDivElement | null>;
}

export function DragHint({
  onComplete,
  tokenSymbol,
  containerRef,
  firstTokenRef,
  firstActionRef,
}: DragHintProps) {
  const [positions, setPositions] = useState<{
    from: { x: number; y: number; w: number; h: number };
    to: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const [phase, setPhase] = useState<"measuring" | "animating" | "fading">(
    "measuring"
  );
  // Key increments to reset the ghost back to start position between loops
  const [loopCount, setLoopCount] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const doneRef = useRef(false);

  // Measure positions on mount
  useEffect(() => {
    const container = containerRef.current;
    const token = firstTokenRef.current;
    const action = firstActionRef.current;
    if (!(container && token && action)) {
      onComplete();
      return;
    }

    const cRect = container.getBoundingClientRect();
    const tRect = token.getBoundingClientRect();
    const aRect = action.getBoundingClientRect();

    setPositions({
      from: {
        x: tRect.left - cRect.left,
        y: tRect.top - cRect.top,
        w: tRect.width,
        h: tRect.height,
      },
      to: {
        x: aRect.left - cRect.left,
        y: aRect.top - cRect.top,
        w: aRect.width,
        h: aRect.height,
      },
    });

    const timer = setTimeout(() => setPhase("animating"), 100);
    return () => clearTimeout(timer);
  }, [containerRef, firstTokenRef, firstActionRef, onComplete]);

  const handleGhostArrived = useCallback(() => {
    if (phase !== "animating") {
      return;
    }

    const nextLoop = loopCount + 1;
    if (nextLoop >= TOTAL_LOOPS) {
      // Final loop done — fade out
      setTimeout(() => setPhase("fading"), 400);
    } else {
      // Reset ghost to start for next loop
      setTimeout(() => {
        setLoopCount(nextLoop);
        setAnimKey((k) => k + 1);
      }, 500);
    }
  }, [phase, loopCount]);

  const handleFadeComplete = useCallback(() => {
    if (phase === "fading" && !doneRef.current) {
      doneRef.current = true;
      onComplete();
    }
  }, [phase, onComplete]);

  if (!positions || phase === "measuring") {
    return null;
  }

  const { from, to } = positions;

  return (
    <motion.div
      animate={phase === "fading" ? { opacity: 0 } : { opacity: 1 }}
      initial={{ opacity: 0 }}
      onAnimationComplete={handleFadeComplete}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: "none",
        zIndex: 3,
      }}
      transition={{ duration: 0.5 }}
    >
      {/* Ghost token card — key changes to reset position each loop */}
      <motion.div
        animate={{
          x: to.x + to.w / 2 - from.w / 2,
          y: to.y + to.h / 2 - from.h / 2,
          scale: 0.9,
        }}
        initial={{
          x: from.x,
          y: from.y,
          scale: 1,
        }}
        key={animKey}
        onAnimationComplete={handleGhostArrived}
        style={{
          position: "absolute",
          width: from.w,
          height: from.h,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "2px",
          background: "rgba(255, 255, 255, 0.06)",
          backdropFilter: "blur(8px)",
          borderRadius: "14px",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          opacity: 0.5,
        }}
        transition={{
          type: "spring",
          stiffness: 80,
          damping: 18,
          mass: 1,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
            fontWeight: 600,
            fontSize: "11px",
            color: "rgba(255, 255, 255, 0.5)",
            letterSpacing: "0.02em",
          }}
        >
          {tokenSymbol}
        </span>
      </motion.div>

      {/* Subtle glow on target action when ghost arrives */}
      <motion.div
        animate={
          phase === "fading"
            ? {
                opacity: 0.4,
                boxShadow: "0 0 20px rgba(255, 255, 255, 0.15)",
              }
            : { opacity: 0, boxShadow: "0 0 0px rgba(255, 255, 255, 0)" }
        }
        style={{
          position: "absolute",
          left: to.x,
          top: to.y,
          width: to.w,
          height: to.h,
          borderRadius: "14px",
          border: "1px solid rgba(255, 255, 255, 0.12)",
        }}
        transition={{ duration: 0.3 }}
      />
    </motion.div>
  );
}
