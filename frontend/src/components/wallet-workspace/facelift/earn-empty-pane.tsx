"use client";

import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useEarnForecastApy } from "@/hooks/use-earn-forecast-apy";
import { useAuthCapability } from "@/lib/auth/capability";
import {
  formatEarnApyLabel,
  getEarnForecastTargetMultiplier,
} from "@/lib/kamino/earn-forecast.shared";

const ASSET_BASE = "/wallet-workspace/facelift";
const HEADLINE_PRINCIPAL_USD = 6000;

function formatHeadlineUsd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function EarnEmptyPane({
  onDeposit,
  onOpenChart,
}: {
  onDeposit: () => void;
  onOpenChart: () => void;
}) {
  const apy = useEarnForecastApy();
  const { isHydrated, isSignedIn } = useAuthCapability();
  const { open: openSignIn } = useSignInModal();
  const target =
    HEADLINE_PRINCIPAL_USD * getEarnForecastTargetMultiplier(apy.apyBps);

  const headlineWords: { emphasized?: boolean; text: string }[] = [
    { text: "Turn" },
    { emphasized: true, text: formatHeadlineUsd(HEADLINE_PRINCIPAL_USD) },
    { text: "into" },
    { emphasized: true, text: formatHeadlineUsd(target) },
    { text: "in" },
    { text: "a" },
    { text: "year" },
    { text: "with" },
    { text: formatEarnApyLabel(apy.apyBps) },
  ];

  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col items-center overflow-clip rounded-3xl bg-white max-[795px]:rounded-none">
      <header className="flex w-full items-center p-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-4">
          <h1 className="whitespace-nowrap font-semibold text-[24px] text-black leading-7">
            Earn
          </h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-question.svg`}
          />
        </div>
        <button
          aria-label="Open chart"
          className="flex size-11 shrink-0 items-center justify-center rounded-3xl min-[1204px]:hidden"
          onClick={onOpenChart}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-chart.svg`}
          />
        </button>
      </header>

      <div className="flex w-full flex-1 flex-col items-center gap-9 pt-8">
        <div className="w-full max-w-[400px] px-10">
          <p
            className="flex flex-wrap content-center items-center justify-center gap-x-1.5 gap-y-0.5 font-bold text-[40px] uppercase leading-none tracking-[-0.4px]"
            style={{ fontFeatureSettings: '"case" 1' }}
          >
            {headlineWords.map((word, index) => (
              <span
                className={word.emphasized ? "text-black" : "text-[#8a8a8e]"}
                key={`${word.text}-${index}`}
              >
                {word.text}
              </span>
            ))}
          </p>
        </div>

        {(() => {
          if (!isHydrated) {
            // Keep the slot height stable until the auth session hydrates so
            // the CTA doesn't flash between states.
            return <div aria-hidden="true" className="h-14" />;
          }
          if (!isSignedIn) {
            return (
              <button
                className="flex h-14 items-center justify-center rounded-full bg-[#f9363c] px-8 font-medium text-[20px] text-white leading-6"
                onClick={openSignIn}
                type="button"
              >
                Connect wallet
              </button>
            );
          }
          return (
            <button
              className="flex h-14 items-center justify-center gap-2 rounded-full bg-black px-6 text-white"
              onClick={onDeposit}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-6"
                src={`${ASSET_BASE}/icon-plus.svg`}
              />
              <span className="whitespace-nowrap pr-2.5 font-medium text-[20px] leading-6">
                Deposit
              </span>
            </button>
          );
        })()}
      </div>

      {/* On mobile the dog clips to the rounded bottom above the tab bar
          (Figma 4693:69958); the white body makes the corners read clean. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center max-[795px]:overflow-clip max-[795px]:rounded-b-3xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="aspect-square w-full max-h-[420px] max-w-[420px]"
          src={`${ASSET_BASE}/front-dog.svg`}
        />
      </div>
    </section>
  );
}
