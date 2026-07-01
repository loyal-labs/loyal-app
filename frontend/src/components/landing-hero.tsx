"use client";

import type { AnimationItem } from "lottie-web";
import { Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

async function loadLottieLight() {
  const mod = await import("lottie-web/build/player/lottie_light");
  return mod.default ?? mod;
}

export function LandingHero() {
  const { loyalAppUrl } = usePublicEnv();
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
    <section
      className="flex w-full justify-center bg-[#f9363c] text-white"
      id="hero"
    >
      <div className="flex w-full max-w-[560px] items-center justify-between overflow-hidden px-4 pb-[125px] pt-7 md:pb-[147px] lg:max-w-[1560px] lg:px-6 lg:py-[120px]">
        <div className="grid w-full min-w-0 grid-cols-1 gap-0 lg:grid-cols-12 lg:grid-rows-[minmax(600px,max-content)] lg:gap-6">
          <div
            className="flex flex-col gap-6 pb-12 lg:col-span-4 lg:col-start-1 lg:row-start-1 lg:gap-0 lg:pb-0 lg:self-start"
            data-hero-reveal="left"
          >
            <h1 className="max-w-[420px] text-[56px] font-semibold leading-none lg:text-[64px]">
              Make your money bigger
            </h1>
            <p className="w-[292px] max-w-full text-[20px] font-normal leading-none lg:mt-6 lg:w-auto lg:max-w-[320px] lg:text-[24px]">
              Your stablecoins earn the best available rate, automatically
            </p>
          </div>

          <div
            className="my-0 flex items-start justify-center lg:col-span-4 lg:col-start-5 lg:row-start-1 lg:self-start"
            data-hero-reveal="scale"
            data-hero-reveal-delay="1"
          >
            <HeroLottie
              isPaused={isPaused}
              onFrameProgress={handleFrameProgress}
              onLoopComplete={handleLoopComplete}
              onReady={handleAnimationReady}
            />
          </div>

          <div
            className="flex w-full flex-col gap-5 pr-0 pt-6 lg:col-span-4 lg:col-start-1 lg:row-start-1 lg:self-end lg:pr-16 lg:pt-0"
            data-hero-reveal="left"
            data-hero-reveal-delay="2"
          >
            <div className="order-2 lg:order-1">
              <h2 className="text-[32px] font-semibold leading-[0.92]">
                Set it once
              </h2>
              <p className="mt-3 text-[20px] font-normal leading-[1.1] lg:mt-4">
                Autodeposits route your dollars to the best lending reserve
                inside on-chain guardrails you control
              </p>
            </div>
            <div className="order-1 flex w-full items-center gap-3 lg:order-2 lg:mt-8">
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

          <div
            className="hidden items-center justify-center lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:flex lg:self-stretch"
            data-hero-reveal="right"
            data-hero-reveal-delay="3"
          >
            <div className="flex flex-col items-center justify-center gap-6">
              <HeroButton href={loyalAppUrl} tone="solid">
                Open web app
              </HeroButton>
              <HeroButton
                href="#get-started-mobile"
                iconSrc="/landing/figma/mobile-icon.svg"
                tone="muted"
              >
                Get Seeker app
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
      className="aspect-[400/600] w-full max-w-[528px] overflow-hidden lg:h-[600px] lg:min-h-[600px] lg:w-[400px] lg:min-w-[400px]"
      ref={containerRef}
    />
  );
}
