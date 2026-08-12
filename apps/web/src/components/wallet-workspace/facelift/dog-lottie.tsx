"use client";

import type { AnimationItem } from "lottie-web";
import { useEffect, useRef } from "react";

const DOG_ASSET_BASE = "/wallet-workspace/facelift/dog";

async function loadLottieLight() {
  const mod = await import("lottie-web/build/player/lottie_light");
  return mod.default ?? mod;
}

type DogClip =
  | "appear"
  | "idle"
  | "blink"
  | "look-up"
  | "look-left"
  | "look-right"
  | "look-left-right";

/**
 * playful — full repertoire: the intro ends on a look-around and the ambient
 * loop occasionally glances sideways (0-balance deposit, connect wallet).
 * calm — no sideways looks at all (tx success/error screens).
 */
export type DogVariant = "playful" | "calm";

const VARIANT_CLIPS: Record<DogVariant, DogClip[]> = {
  playful: [
    "appear",
    "idle",
    "blink",
    "look-up",
    "look-left",
    "look-right",
    "look-left-right",
  ],
  calm: ["appear", "idle", "blink", "look-up"],
};

const INTRO_SEQUENCE: Record<DogVariant, DogClip[]> = {
  playful: ["appear", "look-up", "idle", "blink", "look-left-right"],
  calm: ["appear", "look-up", "idle", "blink"],
};

// Ambient behavior after the intro: mostly breathing, regular blinks, an
// occasional look up, and (playful only) rare sideways glances. Weighted
// picks run at clip boundaries — every clip starts and ends on the neutral
// pose, so switching there is seamless and the idle length (2s) naturally
// jitters the gaps between gestures.
const AMBIENT_WEIGHTS: Record<DogVariant, [DogClip, number][]> = {
  playful: [
    ["idle", 45],
    ["blink", 27],
    ["look-up", 16],
    ["look-left", 4],
    ["look-right", 4],
    ["look-left-right", 4],
  ],
  calm: [
    ["idle", 50],
    ["blink", 30],
    ["look-up", 20],
  ],
};

function pickAmbientClip(
  variant: DogVariant,
  previous: DogClip,
  consecutiveBlinks: number
): DogClip {
  // Settle back into a breath after any gesture; a quick double blink is the
  // one natural exception.
  if (previous === "blink") {
    return consecutiveBlinks < 2 && Math.random() < 0.25 ? "blink" : "idle";
  }
  if (previous !== "idle") {
    return "idle";
  }

  const weights = AMBIENT_WEIGHTS[variant];
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [clip, weight] of weights) {
    roll -= weight;
    if (roll <= 0) {
      return clip;
    }
  }
  return "idle";
}

/**
 * The big red dog, alive: plays the appear intro, then loops an organic
 * blink/look scheduler. All clips share one rig and neutral endpoints, so
 * each state preloads into its own hidden lottie instance and the sequencer
 * flips visibility at clip boundaries — no reparse, no pose jumps.
 *
 * With prefers-reduced-motion the dog renders as the static neutral pose.
 */
export function DogLottie({
  className,
  variant,
}: {
  className?: string;
  variant: DogVariant;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let cancelled = false;
    const instances = new Map<
      DogClip,
      { animation: AnimationItem; element: HTMLDivElement }
    >();
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const neededClips: DogClip[] = prefersReducedMotion
      ? ["idle"]
      : VARIANT_CLIPS[variant];

    void (async () => {
      const [lottie, clipData] = await Promise.all([
        loadLottieLight(),
        Promise.all(
          neededClips.map(async (clip) => {
            const response = await fetch(`${DOG_ASSET_BASE}/${clip}.json`);
            return [clip, await response.json()] as const;
          })
        ),
      ]);
      if (cancelled) {
        return;
      }

      for (const [clip, animationData] of clipData) {
        const element = document.createElement("div");
        element.style.position = "absolute";
        element.style.inset = "0";
        element.style.visibility = "hidden";
        container.appendChild(element);
        instances.set(clip, {
          animation: lottie.loadAnimation({
            animationData,
            autoplay: false,
            container: element,
            loop: false,
            renderer: "svg",
          }),
          element,
        });
      }

      if (prefersReducedMotion) {
        const idle = instances.get("idle");
        if (idle) {
          idle.element.style.visibility = "visible";
          idle.animation.goToAndStop(0, true);
        }
        return;
      }

      const intro = [...INTRO_SEQUENCE[variant]];
      let current: DogClip | null = null;
      let consecutiveBlinks = 0;

      const playClip = (clip: DogClip) => {
        const previous = current ? instances.get(current) : null;
        const next = instances.get(clip);
        if (!next) {
          return;
        }
        consecutiveBlinks = clip === "blink" ? consecutiveBlinks + 1 : 0;
        current = clip;
        next.element.style.visibility = "visible";
        if (previous && previous !== next) {
          previous.element.style.visibility = "hidden";
        }
        next.animation.goToAndPlay(0, true);
      };

      for (const { animation } of instances.values()) {
        animation.addEventListener("complete", () => {
          if (cancelled || !current) {
            return;
          }
          playClip(
            intro.shift() ?? pickAmbientClip(variant, current, consecutiveBlinks)
          );
        });
      }

      playClip(intro.shift() ?? "idle");
    })();

    return () => {
      cancelled = true;
      for (const { animation } of instances.values()) {
        animation.destroy();
      }
      container.replaceChildren();
    };
  }, [variant]);

  return (
    <div
      aria-hidden="true"
      className={className}
      ref={containerRef}
      style={{ position: "relative" }}
    />
  );
}
