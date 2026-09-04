"use client";

import { DogLottie } from "@/components/wallet-workspace/facelift/dog-lottie";
import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import { PopDigits } from "@/components/wallet-workspace/facelift/pop-digits";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { useEarnForecastApyStatus } from "@/components/wallet-workspace/facelift/use-earn-forecast-apy-status";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
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
  onManageAutoswap,
  onOpenChart,
}: {
  onDeposit: () => void;
  onManageAutoswap?: () => void;
  onOpenChart: () => void;
}) {
  const { apy, isLoaded: isApyLoaded } = useEarnForecastApyStatus();
  const { isHydrated, isSignedIn } = useAuthCapability();
  const { open: openSignIn } = useSignInModal();
  const target =
    HEADLINE_PRINCIPAL_USD * getEarnForecastTargetMultiplier(apy.apyBps);

  // The target and APY words derive from the fetched APY; they skeleton until
  // it lands, then reveal with a digit pop (the fallback APY is hardcoded and
  // would otherwise flash and silently update).
  const headlineWords: {
    apyDependent?: boolean;
    emphasized?: boolean;
    text: string;
  }[] = [
    { text: "Turn" },
    { emphasized: true, text: formatHeadlineUsd(HEADLINE_PRINCIPAL_USD) },
    { text: "into" },
    { apyDependent: true, emphasized: true, text: formatHeadlineUsd(target) },
    { text: "in" },
    { text: "a" },
    { text: "year" },
    { text: "with" },
    { apyDependent: true, text: formatEarnApyLabel(apy.apyBps) },
  ];

  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col items-center rounded-3xl bg-card max-[795px]:overflow-clip max-[795px]:rounded-none">
      <header className="flex w-full items-center p-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-4">
          <h1 className="whitespace-nowrap font-semibold text-[24px] text-foreground leading-7">
            Earn
          </h1>
          {/* ponytail: mock tooltip copy — real copy comes with the wiring pass */}
          <InfoTooltip
            iconClassName="size-6"
            placement="bottom"
            text="Earn yield on your idle USDC"
          />
        </div>
        {isHydrated && !isSignedIn ? (
          <a
            className="t-hover flex h-11 shrink-0 items-center gap-2 rounded-3xl px-4 hover:bg-accent"
            href="https://askloyal.com"
          >
            <ThemedIcon
              className="size-6 text-tertiary"
              src={`${ASSET_BASE}/icon-globe.svg`}
            />
            <span className="whitespace-nowrap font-medium text-[14px] text-muted-foreground">
              askloyal.com
            </span>
          </a>
        ) : null}
        <button
          aria-label="Open chart"
          className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent min-[1204px]:hidden"
          onClick={onOpenChart}
          type="button"
        >
          <ThemedIcon
            className="size-6 text-muted-foreground"
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
            {headlineWords.map((word, index) => {
              const colorClassName = word.emphasized
                ? "text-foreground"
                : "text-muted-foreground";
              if (!word.apyDependent) {
                return (
                  <span className={colorClassName} key={index}>
                    {word.text}
                  </span>
                );
              }
              // Index keys keep the skeleton wrap mounted when the word's
              // text changes at load — a remount would skip the cross-fade.
              return (
                <SkeletonReveal
                  isRevealed={isApyLoaded}
                  key={index}
                  skeletonClassName="rounded-[8px] bg-accent-selected"
                >
                  <span className={colorClassName}>
                    {isApyLoaded ? (
                      <PopDigits segments={[{ text: word.text }]} />
                    ) : (
                      word.text
                    )}
                  </span>
                </SkeletonReveal>
              );
            })}
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
                className="t-hover flex h-14 items-center justify-center rounded-full bg-foreground px-8 font-medium text-[20px] leading-6 hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
                onClick={openSignIn}
                type="button"
              >
                <span className="text-background">Connect wallet</span>
              </button>
            );
          }
          return (
            <div className="flex flex-col items-center gap-2">
              <button
                className="t-hover flex h-14 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-background hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
                onClick={onDeposit}
                type="button"
              >
                <ThemedIcon
                  className="size-6"
                  src={`${ASSET_BASE}/icon-plus.svg`}
                />
                <span className="whitespace-nowrap pr-2.5 font-medium text-[20px] leading-6">
                  Deposit
                </span>
              </button>
              {onManageAutoswap ? (
                <button
                  className="t-hover rounded-full px-4 py-2 font-medium text-[14px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={onManageAutoswap}
                  type="button"
                >
                  Manage Autoswap
                </button>
              ) : null}
            </div>
          );
        })()}
      </div>

      {/* On mobile the dog clips to the rounded bottom above the tab bar
          (Figma 4693:69958); the white body makes the corners read clean.
          On desktop it ignores the pane instead: unclipped and dropped by the
          shell's 8px gap (p-2) so it sits flush with the viewport bottom. */}
      <div className="-bottom-2 pointer-events-none absolute inset-x-0 flex justify-center max-[795px]:bottom-0 max-[795px]:overflow-clip max-[795px]:rounded-b-3xl">
        {/* Desktop: the dog is a bottom-anchored square, so capping width caps
            height. ~380px of header/headline/CTA sits above it, so shrink with
            viewport height below 800px (380 + 420) to keep the CTA clear. */}
        <div className="relative w-full max-w-[420px] min-[796px]:max-w-[clamp(140px,100dvh_-_380px,420px)]">
          <DogLottie
            className="aspect-square max-h-[420px] w-full"
            variant="playful"
          />
          {/* Hover hitbox over the dog's head — top quarter left out so the
              pointer-events-none wrapper keeps the CTA clickable, and
              globals.css hides it entirely under 800px viewport height
              (where the dog rides up into the content). */}
          <div
            aria-hidden="true"
            className="milo-hitbox absolute inset-x-[6%] top-1/4 bottom-0"
          />
          {/* Milo — hovering the dog signs his handwritten name + an arrow
              pointing at him (stroke draw-on, globals.css .milo-tag). Must
              stay the hitbox's next sibling; paths are in pen order (the i
              is dotted last), each pathLength-normalized for the dash trick. */}
          <svg
            aria-hidden="true"
            className="milo-tag -rotate-[20deg] pointer-events-none absolute top-[4%] left-[33%] w-[33%]"
            fill="none"
            viewBox="0 0 240 160"
          >
            <path
              d="M14,97 C16,76 21,50 27,27 C33,48 38,64 44,79 C50,62 55,45 61,28 C65,51 68,74 70,96"
              pathLength={1}
            />
            <path d="M85,58 C84,71 83,84 84,96" pathLength={1} />
            <path d="M104,24 C101,48 100,72 103,96" pathLength={1} />
            <path
              d="M139,64 C134,56 124,57 119,66 C114,76 117,90 127,93 C136,95 142,87 141,76 C140,70 139,67 136,65"
              pathLength={1}
            />
            <path d="M85,44 C86,43.5 87,44.5 86,45.5" pathLength={1} />
            {/* Arrow hooks down-right: the face is below the name, and the
                -20° tilt swings "down" in path space toward the dog's eyes. */}
            <path d="M154,86 C172,92 184,108 190,130" pathLength={1} />
            <path
              d="M178,118 C182,122 186,126 190,130 C193,125 196,120 198,116"
              pathLength={1}
            />
          </svg>
        </div>
      </div>
    </section>
  );
}
