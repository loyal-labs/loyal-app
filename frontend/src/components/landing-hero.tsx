"use client";

import Image from "next/image";
import Link from "next/link";

import { usePublicEnv } from "@/contexts/public-env-context";

export function LandingHero() {
  const { loyalAppUrl } = usePublicEnv();

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
            <Image
              alt="Loyal app on a phone showing wallet balance, Earn yield chart, stablecoin and crypto holdings"
              className="aspect-[488/732] h-auto w-full max-w-[528px] lg:w-[400px] lg:min-w-[400px]"
              height={1464}
              priority
              src="/landing/figma/hero-device.png"
              width={976}
            />
          </div>

          <div
            className="flex w-full flex-col gap-5 pr-0 pt-6 lg:col-span-4 lg:col-start-1 lg:row-start-1 lg:self-end lg:pr-16 lg:pt-0"
            data-hero-reveal="left"
            data-hero-reveal-delay="2"
          >
            <div>
              <h2 className="text-[32px] font-semibold leading-[0.92]">
                Set it once
              </h2>
              <p className="mt-3 text-[20px] font-normal leading-[1.1] lg:mt-4">
                Autodeposits route your dollars to the best lending reserve
                inside on-chain guardrails you control
              </p>
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
