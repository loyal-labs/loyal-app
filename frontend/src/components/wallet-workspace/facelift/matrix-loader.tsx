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

// The lottie's two cell colors are baked for a white surface; in dark the
// pale cells glare, so the palette remaps at mount (the loader is transient,
// so a mid-flight theme toggle isn't re-themed until remount).
const DARK_CELL_REMAP: [from: number[], to: number[]][] = [
  [
    [249, 54, 60],
    [255, 80, 80],
  ], // brand red -> dark accent #FF5050
  [
    [227, 201, 202],
    [85, 49, 54],
  ], // pale pink -> #553136, same lift off #2B2930 as the pink has off white
];

function remapDarkCellColors(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      remapDarkCellColors(item);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node as Record<string, unknown>;
  const color = record.c as { k?: unknown } | undefined;
  if (
    color &&
    Array.isArray(color.k) &&
    color.k.length >= 3 &&
    color.k.every((channel) => typeof channel === "number")
  ) {
    const k = color.k as number[];
    for (const [from, to] of DARK_CELL_REMAP) {
      if (from.every((value, i) => Math.abs(k[i] * 255 - value) < 2)) {
        for (let i = 0; i < 3; i++) {
          k[i] = to[i] / 255;
        }
      }
    }
  }
  for (const value of Object.values(record)) {
    remapDarkCellColors(value);
  }
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
        // lottie mutates the data it plays; clone so concurrent/sequential
        // mounts never share a poisoned object.
        const data = structuredClone(animationData);
        if (document.documentElement.classList.contains("dark")) {
          remapDarkCellColors(data);
        }
        anim = lottie.loadAnimation({
          animationData: data,
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
