"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type DropdownOrigin =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

// transitions.dev "Menu dropdown" (frontend/transitions/menu-dropdown.md):
// the popover mounts in its pre-open state (scaled down + transparent), opens
// after a forced reflow so the grow transition plays, and stays mounted
// through the .is-closing scale-down before unmounting.
export function DropdownReveal({
  children,
  className,
  isOpen,
  origin = "top-left",
}: {
  children: ReactNode;
  className: string;
  isOpen: boolean;
  origin?: DropdownOrigin;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(isOpen);

  if (isOpen && !isMounted) {
    setIsMounted(true);
  }

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) {
      return;
    }
    if (isOpen) {
      el.classList.remove("is-closing");
      void el.offsetHeight;
      el.classList.add("is-open");
      return;
    }
    el.classList.remove("is-open");
    el.classList.add("is-closing");
    const closeMs =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--dropdown-close-dur"
        )
      ) || 150;
    const timer = window.setTimeout(() => {
      el.classList.remove("is-closing");
      setIsMounted(false);
    }, closeMs);
    return () => window.clearTimeout(timer);
  }, [isOpen, isMounted]);

  if (!isMounted) {
    return null;
  }

  return (
    <div className={`t-dropdown ${className}`} data-origin={origin} ref={elRef}>
      {children}
    </div>
  );
}
