"use client";

import { useEffect } from "react";

/** One-shot scroll reveals for [data-reveal] blocks — the landing's
 *  IntersectionObserver system. Reveals are marked with a data attribute,
 *  not a class: React rewrites className on state-driven re-renders and
 *  would wipe an imperatively added class, hiding the block again. Under
 *  prefers-reduced-motion every block is revealed immediately. */
export function ScrollReveals() {
  useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]")
    );
    if (elements.length === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const element of elements) element.dataset.revealed = "";
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -48px", threshold: 0.15 }
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return null;
}
