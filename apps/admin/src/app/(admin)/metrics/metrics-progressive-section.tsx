"use client";

import { useEffect, useRef, useState } from "react";

type LoadState = "loading" | "ready" | "error";

type ProgressiveSectionProps<T> = {
  children: (data: T) => React.ReactNode;
  enabled?: boolean;
  endpoint: string;
  onSettled?: (state: Exclude<LoadState, "loading">) => void;
  section: string;
  skeleton: React.ReactNode;
};

export function MetricsProgressiveSection<T>({
  children,
  enabled = true,
  endpoint,
  onSettled,
  section,
  skeleton,
}: ProgressiveSectionProps<T>) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const requestStarted = useRef(false);
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    if (!enabled || requestStarted.current) {
      return;
    }

    let controller: AbortController | undefined;
    let observer: IntersectionObserver | undefined;

    const load = async () => {
      requestStarted.current = true;
      controller = new AbortController();
      setState("loading");

      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Metrics request failed with HTTP ${response.status}`
          );
        }
        setData((await response.json()) as T);
        setState("ready");
        onSettled?.("ready");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        console.error(`Metrics ${section} section failed to load`, error);
        setState("error");
        onSettled?.("error");
      }
    };

    if (section === "metrics-dashboard") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            void load();
          }
        },
        { rootMargin: "240px 0px" }
      );
      if (sectionRef.current) {
        observer.observe(sectionRef.current);
      }
    } else {
      void load();
    }

    return () => {
      observer?.disconnect();
      controller?.abort();
    };
  }, [enabled, endpoint, onSettled, section]);

  return (
    <div
      className={`min-w-0 ${
        section === "metrics-dashboard" ? "min-h-[3000px]" : ""
      }`}
      data-progressive-section={section}
      data-progressive-state={state}
      ref={sectionRef}
    >
      {state === "ready" && data !== null ? (
        children(data)
      ) : state === "error" ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm">
          <h2 className="font-semibold">Metrics unavailable</h2>
          <p className="mt-1 text-muted-foreground">
            This section could not be loaded. Other metrics remain available.
          </p>
        </div>
      ) : (
        skeleton
      )}
    </div>
  );
}
