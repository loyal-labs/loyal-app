"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

// transitions.dev "texts reveal" (frontend/transitions/texts-reveal.md):
// children marked as StaggerLine rise into view with staggered blur once the
// group mounts (remove → reflow → add .is-shown, per the recipe's showText).
export function StaggerReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = groupRef.current;
    if (!el) {
      return;
    }
    el.classList.remove("is-shown");
    void el.offsetHeight;
    el.classList.add("is-shown");
  }, []);

  return (
    <div className={`t-stagger ${className ?? ""}`} ref={groupRef}>
      {children}
    </div>
  );
}

// Dynamic form of the recipe's .t-stagger-line--N helpers: the delay scales
// with the row's index instead of a fixed class per line.
export function StaggerLine({
  children,
  index,
}: {
  children: ReactNode;
  index: number;
}) {
  return (
    <div
      className="t-stagger-line"
      style={{ transitionDelay: `calc(var(--stagger-stagger) * ${index})` }}
    >
      {children}
    </div>
  );
}
