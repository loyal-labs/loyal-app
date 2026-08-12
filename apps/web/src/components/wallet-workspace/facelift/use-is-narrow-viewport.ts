"use client";

import { useSyncExternalStore } from "react";

// Matches the facelift's mobile breakpoint (max-[795px] in Tailwind classes).
// Use only for presentational props that CSS alone can't switch (e.g. chart
// axis tick counts) — layout switching stays in responsive classes.
const QUERY = "(max-width: 795px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useIsNarrowViewport() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
