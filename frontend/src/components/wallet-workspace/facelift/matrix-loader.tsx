"use client";

import type { AnimationItem } from "lottie-web";
import { useEffect, useRef } from "react";

type LottieLightPlayer = {
  loadAnimation: (params: {
    animationData: unknown;
    autoplay: boolean;
    container: Element;
    loop: boolean;
    renderer: "svg";
  }) => AnimationItem;
};

// The player chunk and the animation JSON are fetched once, at module
// evaluation (i.e. while the page is still hydrating), so the animation can
// start the moment a loader mounts instead of after two sequential fetches.
let warmupPromise: Promise<[LottieLightPlayer, unknown]> | null = null;

function loadMatrixLoaderAssets(): Promise<[LottieLightPlayer, unknown]> {
  warmupPromise ??= Promise.all([
    import("lottie-web/build/player/lottie_light").then(
      (mod) => (mod.default ?? mod) as unknown as LottieLightPlayer
    ),
    fetch("/auth/matrix-loader.json").then(
      (response) => response.json() as unknown
    ),
  ]);
  return warmupPromise;
}

if (typeof window !== "undefined") {
  // Failed warmup resets the cache so a later mount retries the fetch.
  loadMatrixLoaderAssets().catch(() => {
    warmupPromise = null;
  });
}

// Brand-red "Matrix Loader" lottie. Shared by the sign-in wallet wait and the
// Earn shell boot loader.
export function MatrixLoader() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let anim: AnimationItem | null = null;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    loadMatrixLoaderAssets()
      .then(([lottie, animationData]) => {
        const el = containerRef.current;
        if (cancelled || !el) {
          return;
        }
        anim = lottie.loadAnimation({
          // lottie mutates the data it plays; clone so concurrent/sequential
          // mounts never share a poisoned object.
          animationData: structuredClone(animationData),
          autoplay: !prefersReducedMotion,
          container: el,
          loop: true,
          renderer: "svg",
        });
      })
      .catch(() => {
        warmupPromise = null;
      });

    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, []);

  return <div aria-hidden="true" className="h-15 w-15" ref={containerRef} />;
}
