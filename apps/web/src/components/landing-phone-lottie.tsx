"use client";

import type { AnimationItem } from "lottie-web";
import { useEffect, useRef } from "react";

async function loadLottieLight() {
  const mod = await import("lottie-web/build/player/lottie_light");
  return mod.default ?? mod;
}

/** Seeker Earn phone animation for the "Multiple wallets, one smart account"
 * landing section. Lazy-inits when scrolled into view, pauses off-screen. */
export function LandingPhoneLottie() {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (entry.isIntersecting) {
          if (startedRef.current) {
            if (!prefersReducedMotion) animRef.current?.play();
            return;
          }
          startedRef.current = true;
          const lottie = await loadLottieLight();
          if (cancelled) return;
          const anim = lottie.loadAnimation({
            autoplay: !prefersReducedMotion,
            container: el,
            loop: true,
            path: "/landing/seeker-earn.json",
            renderer: "svg",
          });
          animRef.current = anim;
          anim.addEventListener("DOMLoaded", () => {
            el.style.opacity = "1";
          });
        } else {
          animRef.current?.pause();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
      animRef.current?.destroy();
      animRef.current = null;
    };
  }, []);

  return (
    <div
      aria-label="Loyal wallet on a phone showing total balance, Earn yield chart, and stablecoin and crypto holdings"
      className="absolute inset-0 opacity-0 transition-opacity duration-500"
      ref={containerRef}
      role="img"
    />
  );
}
