"use client";

import type { AnimationItem } from "lottie-web";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

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
      <div className="flex w-full max-w-[560px] items-center justify-between overflow-hidden px-4 pb-[125px] pt-7 md:pb-[147px] lg:max-w-[1560px] lg:px-6 lg:py-[120px]">
        <div className="grid w-full min-w-0 grid-cols-1 gap-0 lg:grid-cols-12 lg:grid-rows-[minmax(600px,max-content)] lg:gap-6">
          <div
            className="flex flex-col gap-6 pb-12 lg:col-span-4 lg:col-start-1 lg:row-start-1 lg:pb-0 lg:self-center"
            data-hero-reveal="left"
          >
            <h1 className="max-w-[420px] text-[56px] font-semibold leading-none lg:text-[64px]">
              Make your idle cash earn smarter
            </h1>
            <p className="w-[292px] max-w-full text-[20px] font-normal leading-[1.1] lg:w-auto lg:max-w-[320px] lg:text-[24px]">
              Connect your wallet once and earn the best available rate on USDC
              automatically
            </p>
          </div>

          <div
            className="my-0 flex items-start justify-center lg:col-span-4 lg:col-start-5 lg:row-start-1 lg:self-start"
            data-hero-reveal="scale"
            data-hero-reveal-delay="1"
          >
            <div
              aria-label="Loyal app animation: connect a wallet, watch the balance grow, and set up autodeposit"
              className="aspect-[2/3] w-full max-w-[528px] lg:w-[400px] lg:min-w-[400px]"
              ref={animationContainerRef}
              role="img"
            />
          </div>

          <div
            className="hidden items-center justify-center lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:flex lg:self-stretch"
            data-hero-reveal="right"
            data-hero-reveal-delay="2"
          >
            <div className="flex flex-col items-center justify-center gap-5">
              <Link
                className="inline-flex h-[91px] w-[232px] items-center justify-center rounded-full bg-black text-center text-[24px] font-medium leading-6 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
                href={loyalAppUrl}
              >
                Open web app
              </Link>
              <Link
                className="transition duration-150 ease-out hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0"
                href="#get-started-mobile"
              >
                <Image
                  alt="Get it on Solana dApp Store"
                  height={91}
                  src="/landing/figma/solana-dapp-store-badge.svg"
                  width={232}
                />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
