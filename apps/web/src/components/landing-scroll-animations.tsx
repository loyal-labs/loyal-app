"use client";

import { useEffect } from "react";

export function LandingScrollAnimations() {
  useEffect(() => {
    const seenElements = new WeakSet<Element>();
    const revealElements = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealElements().forEach((element) => element.classList.add("is-revealed"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        });
      },
      {
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.12,
      }
    );

    const observeElement = (element: HTMLElement) => {
      if (seenElements.has(element)) {
        return;
      }

      seenElements.add(element);
      observer.observe(element);
    };

    revealElements().forEach(observeElement);

    const mutationObserver = new MutationObserver(() => {
      revealElements().forEach(observeElement);
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, []);

  return null;
}
