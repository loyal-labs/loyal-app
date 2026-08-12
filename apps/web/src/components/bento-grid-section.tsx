"use client";
import type { AnimationItem } from "lottie-web";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { type BentoItem, bentoItems } from "@/data/bento";
import { BentoGrid, BentoGridItem } from "./ui/bento-grid";

async function loadLottieLight() {
  const mod = await import("lottie-web/build/player/lottie_light");
  return mod.default ?? mod;
}

function BentoAnimation({ item, delay }: { item: BentoItem; delay: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const startedRef = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);

  const initAnimation = useCallback(async () => {
    const el = containerRef.current;
    if (!el || startedRef.current) return;
    startedRef.current = true;

    const lottie = await loadLottieLight();
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: item.animationPath,
    });
    animRef.current = anim;
    el.style.opacity = "1";
    el.style.animation = "bentoFadeIn 0.6s ease-out";
    setHasStarted(true);
  }, [item.animationPath]);

  // Start animation after delay when first visible
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !startedRef.current) {
          observer.disconnect();
          timer = setTimeout(initAnimation, delay);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [delay, initAnimation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      animRef.current?.destroy();
    };
  }, []);

  // Pause/play based on viewport visibility
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasStarted) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const anim = animRef.current;
        if (!anim) return;
        if (entry.isIntersecting) {
          anim.play();
        } else {
          anim.pause();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasStarted]);

  const aspectRatio =
    item.aspectRatio ?? (item.colSpan === 2 ? "795 / 389" : "1 / 1");

  return (
    <div
      ref={containerRef}
      className="shrink-0 w-full overflow-hidden"
      style={{ aspectRatio, background: "#F5F5F5", opacity: 0 }}
    />
  );
}

function BentoGridSectionComponent() {
  return (
    <section
      id="about-section"
      style={{
        position: "relative",
        padding: "64px 16px",
        overflow: "hidden",
        background: "#FFFFFF",
      }}
    >
      <style>{`
        @keyframes bentoFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          position: "relative",
        }}
      >
        <div style={{ paddingBottom: "48px" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "20px",
              textAlign: "center",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "48px",
                fontWeight: 600,
                color: "#000",
                letterSpacing: "-0.96px",
                lineHeight: "48px",
                margin: 0,
              }}
            >
              About Loyal
            </h2>
            <p
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "20px",
                fontWeight: 400,
                color: "rgba(60, 60, 67, 0.6)",
                lineHeight: "24px",
                margin: 0,
              }}
            >
              The future of agentic finance
            </p>
          </div>
        </div>

        <BentoGrid>
          {bentoItems.map((item, i) => (
            <BentoGridItem
              animationDelay={i * 0.03}
              className={
                item.colSpan === 2 ? "md:col-[2/span_2]" : "md:col-span-1"
              }
              description={item.description}
              header={<BentoAnimation delay={i * 200} item={item} />}
              key={item.title}
              title={item.title}
            />
          ))}
        </BentoGrid>
      </div>
    </section>
  );
}

export const BentoGridSection = memo(BentoGridSectionComponent);
