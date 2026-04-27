"use client";

import type { AnimationItem } from "lottie-web";
import { Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

async function loadLottieLight() {
  const mod = await import("lottie-web/build/player/lottie_light");
  return mod.default ?? mod;
}

export function LandingHero() {
  const animationRef = useRef<AnimationItem | null>(null);
  const isPausedRef = useRef(false);
  const [activeProgressBar, setActiveProgressBar] = useState<0 | 1>(0);
  const [isPaused, setIsPaused] = useState(false);
  const [loopProgress, setLoopProgress] = useState(0);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const handleAnimationReady = useCallback((animation: AnimationItem) => {
    animationRef.current = animation;
    if (isPausedRef.current) {
      animation.pause();
    }
  }, []);

  const handleFrameProgress = useCallback((progress: number) => {
    setLoopProgress(progress);
  }, []);

  const handleLoopComplete = useCallback(() => {
    setLoopProgress(1);
    requestAnimationFrame(() => {
      setActiveProgressBar((current) => (current === 0 ? 1 : 0));
      setLoopProgress(0);
    });
  }, []);

  const handlePlayerToggle = useCallback(() => {
    setIsPaused((current) => {
      const next = !current;
      if (next) {
        animationRef.current?.pause();
      } else {
        animationRef.current?.play();
      }
      return next;
    });
  }, []);

  const firstProgress = activeProgressBar === 0 ? loopProgress : 1;
  const secondProgress = activeProgressBar === 1 ? loopProgress : 0;

  return (
    <section className="flex w-full justify-center bg-[#f9363c] text-white">
      <div className="flex w-full max-w-[1560px] items-center justify-between overflow-hidden px-6 py-20 md:py-[120px]">
        <div className="grid w-full min-w-0 grid-cols-1 gap-12 md:grid-cols-12 md:grid-rows-[minmax(600px,max-content)] md:gap-6">
          <div className="flex flex-col items-start justify-between md:col-span-4 md:row-start-1 md:self-stretch">
            <div>
              <h1 className="max-w-[420px] text-[44px] font-semibold leading-none md:text-[64px]">
                Put your money on autopilot
              </h1>
              <p className="mt-6 max-w-[320px] text-[18px] font-normal leading-none md:text-[24px]">
                Keep full control over your funds and away from prying eyes
              </p>
            </div>

            <div className="mt-16 w-full pr-0 md:mt-0 md:pr-16">
              <h2 className="text-[26px] font-semibold leading-[0.92] md:text-[32px]">
                Yield on shielded assets
              </h2>
              <p className="mt-4 text-[16px] font-normal leading-[1.1] md:text-[20px]">
                Earn yield on USDC, SOL, and USDT while your assets stay private
              </p>
              <div className="mt-8 flex w-full items-center gap-3">
                <button
                  aria-label={
                    isPaused ? "Play hero animation" : "Pause hero animation"
                  }
                  aria-pressed={isPaused}
                  className="grid h-9 w-9 place-items-center rounded-full bg-black/15 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-black/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
                  onClick={handlePlayerToggle}
                  type="button"
                >
                  {isPaused ? (
                    <Play
                      aria-hidden="true"
                      className="ml-0.5 h-4 w-4 fill-white"
                      strokeWidth={0}
                    />
                  ) : (
                    <Image
                      alt=""
                      aria-hidden="true"
                      height={24}
                      src="/landing/figma/pause-24.svg"
                      width={24}
                    />
                  )}
                </button>
                <div className="grid h-9 min-w-0 flex-1 grid-cols-2 items-center gap-2">
                  <HeroProgressBar
                    progress={firstProgress}
                    testId="hero-progress-1"
                  />
                  <HeroProgressBar
                    progress={secondProgress}
                    testId="hero-progress-2"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-start justify-center md:col-span-4 md:col-start-5 md:row-start-1 md:self-start">
            <HeroLottie
              isPaused={isPaused}
              onFrameProgress={handleFrameProgress}
              onLoopComplete={handleLoopComplete}
              onReady={handleAnimationReady}
            />
          </div>

          <div className="flex items-center justify-center md:col-span-4 md:col-start-9 md:row-start-1 md:self-stretch">
            <div className="flex flex-col items-center justify-center gap-6">
              <HeroButton
                href="/app"
                iconSrc="/landing/figma/extension-icon.svg"
                tone="muted"
              >
                Get extension
              </HeroButton>
              <HeroButton href="/app" tone="solid">
                Open web app
              </HeroButton>
              <HeroButton
                href="/app"
                iconSrc="/landing/figma/mobile-icon.svg"
                tone="muted"
              >
                Get mobile app
              </HeroButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroProgressBar({
  progress,
  testId,
}: {
  progress: number;
  testId: string;
}) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-black/15">
      <div
        className="h-full origin-left rounded-full bg-white transition-transform duration-75 ease-linear"
        data-testid={testId}
        style={{ transform: `scaleX(${Math.min(Math.max(progress, 0), 1)})` }}
      />
    </div>
  );
}

function HeroButton({
  children,
  href,
  iconSrc,
  tone,
}: {
  children: React.ReactNode;
  href: string;
  iconSrc?: string;
  tone: "muted" | "solid";
}) {
  return (
    <Link
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-center text-[16px] font-normal leading-5 transition duration-150 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0 ${
        tone === "solid"
          ? "bg-black text-white hover:bg-[#171717]"
          : "bg-black/15 text-white hover:bg-black/25"
      }`}
      href={href}
    >
      {iconSrc ? (
        <Image alt="" aria-hidden="true" height={20} src={iconSrc} width={20} />
      ) : null}
      {children}
    </Link>
  );
}

function HeroLottie({
  isPaused,
  onFrameProgress,
  onLoopComplete,
  onReady,
}: {
  isPaused: boolean;
  onFrameProgress: (progress: number) => void;
  onLoopComplete: () => void;
  onReady: (animation: AnimationItem) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    let animation: AnimationItem | null = null;

    const handleEnterFrame = () => {
      if (!animation) {
        return;
      }

      const totalFrames = Math.max(animation.totalFrames || 1, 1);
      onFrameProgress(Math.min(animation.currentFrame / totalFrames, 1));
    };

    async function initAnimation() {
      const el = containerRef.current;
      if (!el) {
        return;
      }

      const lottie = await loadLottieLight();
      if (cancelled) {
        return;
      }

      animation = lottie.loadAnimation({
        autoplay: true,
        container: el,
        loop: true,
        path: "/landing/yield-2.json",
        renderer: "svg",
      });

      animation.addEventListener("enterFrame", handleEnterFrame);
      animation.addEventListener("loopComplete", onLoopComplete);
      animRef.current = animation;
      onReady(animation);
    }

    void initAnimation();

    return () => {
      cancelled = true;
      if (animation) {
        animation.removeEventListener("enterFrame", handleEnterFrame);
        animation.removeEventListener("loopComplete", onLoopComplete);
        animation.destroy();
      }
      animRef.current = null;
    };
  }, [onFrameProgress, onLoopComplete, onReady]);

  useEffect(() => {
    if (isPaused) {
      animRef.current?.pause();
    } else {
      animRef.current?.play();
    }
  }, [isPaused]);

  return (
    <div
      aria-label="Animated wallet yield preview"
      className="aspect-[400/600] h-[600px] min-h-[600px] w-[400px] min-w-[400px] overflow-hidden max-[767px]:h-auto max-[767px]:min-h-0 max-[767px]:w-full max-[767px]:min-w-0 max-[767px]:max-w-[400px]"
      ref={containerRef}
    />
  );
}
