import Image from "next/image";
import Link from "next/link";

import { LandingBlog } from "@/components/landing-blog";
import { LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { LandingGetStarted } from "@/components/landing-get-started";
import { LandingHeader } from "@/components/landing-header";
import { LandingHero } from "@/components/landing-hero";
import { LandingRoadmap } from "@/components/landing-roadmap";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";

const featureCards = [
  {
    images: ["/landing/figma/feature-yield-card.png"],
    text: "Earn in the background without locking up your funds or giving up control",
    tone: "black",
  },
  {
    images: [
      "/landing/figma/feature-phone-bg.png",
      "/landing/figma/feature-phone-overlay.png",
    ],
    text: "Keep your finds private, execute secure transactions and make money on shielded assets",
    tone: "light",
  },
  {
    images: ["/landing/figma/feature-agent-card.png"],
    text: "Define guardrails and rulesets for your financial workflows: assign granular permissions to every agent",
    tone: "red",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      <LandingScrollAnimations />
      <LandingHeader />
      <LandingHero />

      <section
        className="flex w-full justify-center bg-white px-4 pb-[72px] pt-20 lg:px-6 lg:pb-24 lg:pt-32"
        id="features"
      >
        <div className="grid w-full max-w-[528px] gap-14 lg:max-w-[1560px] lg:grid-cols-3 lg:gap-6">
          {featureCards.map((feature, index) => (
            <article
              className="flex min-w-0 flex-col gap-5 lg:gap-8"
              data-reveal="scale"
              data-reveal-delay={index + 1}
              key={feature.text}
            >
              <div
                className={`relative aspect-square w-full overflow-hidden rounded-[24px] ${
                  feature.tone === "black"
                    ? "bg-black"
                    : feature.tone === "red"
                    ? "bg-[#f9363c]"
                    : "bg-[#f2f2f2]"
                }`}
              >
                {feature.images.map((src) => (
                  <Image
                    alt=""
                    aria-hidden="true"
                    className="object-cover"
                    fill
                    key={src}
                    loading="eager"
                    sizes="(min-width: 1560px) 496px, (min-width: 768px) calc((100vw - 96px) / 3), calc(100vw - 48px)"
                    src={src}
                    unoptimized
                  />
                ))}
              </div>
              <p className="max-w-[400px] pr-4 text-[20px] font-normal leading-[1.2] text-black lg:text-[24px]">
                {feature.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="flex w-full justify-center bg-white px-4 py-12 lg:px-6 lg:py-32">
        <div className="grid w-full max-w-[528px] gap-6 lg:max-w-[1560px] lg:grid-cols-12 lg:gap-6">
          <div
            className="order-1 flex items-center lg:col-span-4 lg:order-none lg:pr-1"
            data-reveal="left"
          >
            <h2 className="max-w-[420px] text-[48px] font-semibold leading-none text-black lg:text-[56px]">
              Multiple wallets, one smart account
            </h2>
          </div>

          <div
            className="order-3 flex items-start justify-center lg:col-span-4 lg:col-start-5 lg:order-none lg:row-start-1"
            data-reveal="scale"
            data-reveal-delay="1"
          >
            <div className="relative mt-6 aspect-[400/600] w-full overflow-hidden rounded-[24px] border border-black/10 lg:mt-0">
              <Image
                alt=""
                aria-hidden="true"
                className="object-cover"
                fill
                sizes="(min-width: 1560px) 496px, (min-width: 768px) calc((100vw - 96px) / 3), calc(100vw - 48px)"
                src="/landing/figma/multiple-wallets-content.png"
              />
            </div>
          </div>

          <div
            className="order-2 flex flex-col items-start justify-center gap-6 lg:col-span-3 lg:col-start-10 lg:order-none lg:row-start-1 lg:gap-8"
            data-reveal="right"
            data-reveal-delay="2"
          >
            <p className="max-w-[280px] text-[20px] font-normal leading-[1.1] text-black lg:max-w-[300px] lg:text-[24px]">
              Schedule payments, run strategies, and let never sleeping AI work
              for you
            </p>
            <Link
              className="inline-flex items-center justify-center rounded-full bg-black px-5 py-3 text-center text-[16px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-y-0"
              href="#get-started"
            >
              Get started
            </Link>
          </div>
        </div>
      </section>

      <section
        className="flex w-full justify-center bg-white px-4 py-12 lg:px-6 lg:py-24"
        id="developers"
      >
        <div className="grid w-full max-w-[528px] gap-4 lg:max-w-[1560px] lg:grid-cols-2 lg:gap-6">
          <article
            className="relative flex h-[518px] min-w-0 flex-col overflow-hidden rounded-[24px] bg-[#f5f5f5] lg:h-[600px]"
            data-reveal="left"
          >
            <div className="flex w-full flex-col items-start gap-6 px-6 py-6 pr-8 lg:gap-8 lg:px-8 lg:py-8 lg:pr-16">
              <h2 className="max-w-[600px] text-[24px] font-medium leading-[1.1] text-black lg:text-[32px]">
                Access trusted agentic workflows built into the wallet app and
                browser extension, or build on&nbsp;top with permissionless
                access
              </h2>
              <Link
                className="inline-flex h-[52px] items-center justify-center rounded-full bg-black px-5 py-3 text-center text-[20px] font-normal leading-5 text-white transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black active:translate-y-0 lg:h-auto lg:text-[16px]"
                href="https://docs.askloyal.com/sdk/private-transactions/how-it-works"
              >
                How it works
              </Link>
            </div>
            <div className="relative flex h-[264px] shrink-0 items-end justify-end overflow-hidden pl-16 pt-6 lg:h-auto lg:min-h-0 lg:flex-1 lg:pl-8 lg:pt-8">
              <WorkflowMascot />
            </div>
          </article>

          <article
            className="relative flex h-[610.5px] min-w-0 flex-col overflow-hidden rounded-[24px] bg-black lg:h-[600px]"
            data-reveal="right"
            data-reveal-delay="1"
          >
            <div className="flex w-full flex-col items-start gap-6 px-6 py-6 pr-8 lg:gap-8 lg:px-8 lg:py-8 lg:pr-16">
              <h2 className="max-w-[600px] text-[24px] font-medium leading-[1.1] text-white lg:text-[32px]">
                Access agentic workflows available for the mobile app and
                browser extension, or build on top with permissionless access
                using our SDK — all code is open source
              </h2>
              <Link
                className="inline-flex h-[52px] items-center justify-center rounded-full bg-white px-5 py-3 text-center text-[20px] font-normal leading-5 text-black transition duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#f5f5f5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:translate-y-0 lg:h-auto lg:text-[16px]"
                href="https://docs.askloyal.com/"
              >
                Explore SDK
              </Link>
            </div>
            <div className="relative flex h-[304.5px] shrink-0 items-end justify-center overflow-hidden px-6 pb-6 pt-12 lg:h-auto lg:min-h-0 lg:flex-1 lg:justify-end lg:p-8">
              <WorkflowDocsIllustration />
            </div>
          </article>
        </div>
      </section>

      <LandingRoadmap />

      <LandingFaq />

      <LandingBlog />

      <LandingGetStarted />

      <LandingFooter />
    </main>
  );
}

function WorkflowMascot() {
  return (
    <div
      aria-hidden="true"
      className="relative aspect-square h-full max-h-[240px] max-w-[240px] shrink-0 lg:max-h-[320px] lg:max-w-[320px]"
    >
      <Image
        alt=""
        className="object-contain"
        fill
        src="/landing/figma/workflows-mascot.svg"
      />
    </div>
  );
}

function WorkflowDocsIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative aspect-[320/240] h-full max-h-[240px] max-w-[320px] shrink-0"
    >
      <Image
        alt=""
        className="object-contain"
        fill
        src="/landing/figma/workflows-docs.svg"
      />
    </div>
  );
}
