"use client";

import type { AnimationItem } from "lottie-web";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import type { EarnPublicStats } from "@/lib/yield-optimization/earn-public-stats.server";

const AUM_TOOLTIP =
  "Cumulative value deposited into our active Earn routing policies.";
const VOLUME_TOOLTIP =
  "Total USDC reallocated by confirmed Earn optimizations. This measures routing throughput across reserves, so the same deposited dollar can add to volume again when it is moved by a later optimization.";
const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  notation: "compact",
  style: "currency",
});

function HeroStatTooltip({ text }: { text: string }) {
  const id = useId();

  return (
    <span className="t-tt-wrap">
      <button
        aria-describedby={id}
        aria-label="More info"
        className="t-tt-trigger flex size-6 cursor-help items-center justify-center opacity-60"
        type="button"
      >
        <Image
          alt=""
          aria-hidden="true"
          height={20}
          src="/landing/assets/hero-stat-question.svg"
          width={20}
        />
      </button>
      <span className="t-tt text-[13px] leading-4" id={id} role="tooltip">
        {text}
      </span>
    </span>
  );
}

function HeroStat({
  label,
  tooltip,
  value,
}: {
  label: string;
  tooltip?: string;
  value: string | null;
}) {
  return (
    <div className="flex h-24 w-full flex-col items-start gap-2 py-2 first:pr-4">
      <div className="flex items-center gap-1">
        <p className="text-[20px] leading-6 text-white">{label}</p>
        {tooltip ? <HeroStatTooltip text={tooltip} /> : null}
      </div>
      {value ? (
        <p className="w-full font-semibold text-[48px] leading-[48px] text-white">
          {value}
        </p>
      ) : (
        <span
          aria-label={`Loading ${label}`}
          className="h-12 w-48 max-w-full animate-pulse rounded-xl bg-white/20 motion-reduce:animate-none"
          role="status"
        />
      )}
    </div>
  );
}

function LandingHeroStats() {
  const [stats, setStats] = useState<EarnPublicStats | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    fetch("/api/earn/stats")
      .then((response) => {
        if (!response.ok) {
          throw new Error("earn_stats_unavailable");
        }
        return response.json() as Promise<EarnPublicStats>;
      })
      .then((value) => {
        if (isCurrent) {
          setStats(value);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setHasError(true);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  if (hasError) {
    return null;
  }

  return (
    <section
      aria-label="Loyal Stats"
      className="flex w-full flex-col items-start gap-4 pt-12 lg:col-span-3 lg:col-start-10 lg:row-start-1 lg:justify-self-end lg:self-center lg:gap-6 lg:pt-0 xl:w-[356px]"
      data-hero-reveal="right"
      data-hero-reveal-delay="2"
    >
      <HeroStat
        label="Earn AUM"
        tooltip={AUM_TOOLTIP}
        value={stats ? compactUsdFormatter.format(stats.aumUsd) : null}
      />
      <HeroStat
        label="Optimization Volume"
        tooltip={VOLUME_TOOLTIP}
        value={
          stats ? compactUsdFormatter.format(stats.optimizationVolumeUsd) : null
        }
      />
      <HeroStat
        label="Total Users"
        value={stats ? stats.totalUsers.toLocaleString("en-US") : null}
      />
    </section>
  );
}

export function LandingHero() {
  const { loyalAppUrl } = usePublicEnv();
  const animationContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = animationContainerRef.current;
    if (!container) return;

    let anim: AnimationItem | null = null;
    let cancelled = false;

    (async () => {
      const mod = await import("lottie-web/build/player/lottie_light");
      const lottie = mod.default ?? mod;
      if (cancelled) return;
      anim = lottie.loadAnimation({
        container,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: "/landing/hero-animation.json",
      });
    })();

    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, []);

  return (
    <section
      className="flex w-full justify-center bg-[#f9363c] text-white"
      id="hero"
    >
      <div className="flex w-full max-w-[560px] items-center justify-between overflow-hidden px-4 pb-24 pt-7 lg:max-w-[1560px] lg:px-6 lg:py-[120px]">
        <div className="grid w-full min-w-0 grid-cols-1 gap-0 lg:grid-cols-12 lg:gap-6">
          <div
            className="flex flex-col items-start justify-center pb-12 lg:col-span-4 lg:col-start-1 lg:row-start-1 lg:self-stretch lg:pb-0"
            data-hero-reveal="left"
          >
            <div className="flex w-full flex-col items-start gap-9">
              <div className="flex w-full flex-col items-start gap-6">
                <h1 className="max-w-[420px] text-[56px] font-semibold leading-none tracking-[-1.12px] lg:text-[64px] lg:tracking-[-1.28px]">
                  Make your idle cash smarter
                </h1>
                <p className="w-[292px] max-w-full text-[20px] font-normal leading-none tracking-[-0.4px] lg:w-[338px] lg:text-[24px] lg:leading-[1.1] lg:tracking-[-0.48px] lg:text-white/80">
                  Connect your wallet once and earn the best available rate on
                  USDC automatically
                </p>
              </div>

              <div className="hidden w-full max-w-[448px] flex-col items-start gap-3 lg:flex">
                <Link
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-black py-5 pl-3.5 pr-6 text-center text-[20px] font-medium leading-6 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
                  href={loyalAppUrl}
                  rel="noopener noreferrer"
                >
                  <Image
                    alt=""
                    aria-hidden="true"
                    height={24}
                    src="/landing/assets/hero-open-web.svg"
                    width={24}
                  />
                  Open web app
                </Link>
                <Link
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-black/15 py-5 pl-3.5 pr-6 text-center text-[20px] font-medium leading-6 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-black/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
                  href="#get-started-mobile"
                >
                  <Image
                    alt=""
                    aria-hidden="true"
                    height={24}
                    src="/landing/assets/hero-download-loyal.svg"
                    width={24}
                  />
                  Download Loyal
                </Link>
              </div>
            </div>
          </div>

          <div
            className="flex items-start justify-center lg:col-span-4 lg:col-start-5 lg:row-start-1 lg:self-start"
            data-hero-reveal="scale"
            data-hero-reveal-delay="1"
          >
            <div
              aria-label="Loyal app animation: connect a wallet, watch the balance grow, and set up autodeposit"
              className="aspect-[2/3] w-full"
              ref={animationContainerRef}
              role="img"
            />
          </div>

          <LandingHeroStats />
        </div>
      </div>
    </section>
  );
}
