"use client";

import type { ReactNode } from "react";

import { DogLottie } from "@/components/wallet-workspace/facelift/dog-lottie";
import { usePublicEnv } from "@/contexts/public-env-context";
import { openTrackedLink } from "@/lib/core/analytics";
import { getExplorerTxUrl } from "@/lib/solana/explorer";

const ASSET_BASE = "/wallet-workspace/facelift";

// Keeps the SOL a transfer can't spend so the wallet can still pay fees —
// the same reserve the OG swap/shield forms' MAX applies.
export const SOL_FEE_RESERVE = 0.00005;

export function formatTokenAmount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function formatUsdAmount(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

// Confetti burst for the success screen. Deterministic index-scrambled fan
// (no Math.random, so strict-mode double renders agree): each particle gets
// an angle with jitter, a distance ring, spin, stagger and a palette color,
// read by the t-confetti keyframes as inline custom props.
const CONFETTI_COLORS = ["#f9363c", "#ffb800", "#34c759", "#0a84ff", "#bf5af2"];
const CONFETTI_PARTICLES = Array.from({ length: 18 }, (_, index) => {
  const angle = (index / 18) * Math.PI * 2 + ((index % 5) - 2) * 0.11;
  const distance = 72 + (index % 4) * 22;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance - 24,
    rot: ((index % 7) - 3) * 130,
    delay: 120 + (index % 6) * 40,
    scale: 0.7 + (index % 3) * 0.3,
    color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  };
});

// The swap/shield flows share their result screens; each pane mounts these
// inside its own step-keyed PaneReveal so screen changes replay the rise.

// Figma 4813:405472 / 4822:422952 — centered pair icons + animated ellipsis.
export function ActionProcessingBody({
  icons,
  label,
}: {
  icons: ReactNode;
  label: string;
}) {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center pb-[68px]">
      <div className="flex w-full flex-col items-center gap-4 p-8">
        <div className="flex items-start">{icons}</div>
        <p className="text-center font-semibold text-[28px] text-black leading-8 tracking-[-0.28px]">
          {label}
          <span aria-hidden="true" className="t-loading-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      </div>
    </div>
  );
}

// Figma 4813:406464 — success check + confetti burst, actions, and the
// front dog rising from the pane bottom.
export function ActionSuccessBody({
  label,
  onDone,
  signature,
  source,
}: {
  label: string;
  onDone: () => void;
  signature: string | null;
  source: string;
}) {
  const publicEnv = usePublicEnv();
  return (
    <div className="relative flex w-full flex-1 flex-col items-center pt-8 pb-[68px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center"
      >
        <DogLottie className="aspect-square w-full max-w-[420px]" variant="calm" />
      </div>
      <div className="relative flex w-full flex-col items-center gap-4 p-8">
        <span className="relative">
          <span aria-hidden="true" className="t-confetti">
            {CONFETTI_PARTICLES.map((particle, index) => (
              <i
                key={index}
                style={{
                  ["--confetti-x" as never]: `${particle.x}px`,
                  ["--confetti-y" as never]: `${particle.y}px`,
                  ["--confetti-rot" as never]: `${particle.rot}deg`,
                  ["--confetti-delay" as never]: `${particle.delay}ms`,
                  ["--confetti-scale" as never]: String(particle.scale),
                  background: particle.color,
                }}
              />
            ))}
          </span>
          <span aria-hidden="true" className="t-success-check" data-state="in">
            <svg className="size-16" fill="none" viewBox="0 0 64 64">
              <circle cx="32" cy="32" fill="#34c759" r="32" />
              <path
                d="M20 33l8 8 16-16"
                stroke="white"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="5"
              />
            </svg>
          </span>
        </span>
        <p className="text-center font-semibold text-[28px] text-black leading-8 tracking-[-0.28px]">
          {label}
        </p>
      </div>
      <div className="relative flex flex-col items-center gap-3">
        {signature ? (
          <button
            className="t-hover flex h-12 items-center justify-center rounded-full bg-black/[0.04] px-5 font-medium text-[16px] text-black leading-5 hover:bg-black/[0.08]"
            onClick={() =>
              openTrackedLink(publicEnv, {
                href: getExplorerTxUrl(signature),
                linkText: "View in Explorer",
                source,
              })
            }
            type="button"
          >
            View in Explorer
          </button>
        ) : null}
        <button
          className="t-hover flex h-12 items-center justify-center rounded-full bg-black px-5 font-medium text-[16px] text-white leading-5 hover:-translate-y-0.5 hover:bg-[#171717] active:translate-y-0"
          onClick={onDone}
          type="button"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// Figma 4813:407564 — failed X with the error under it and the dog rising
// from the pane bottom (same layout as success — the message moved in-flow so
// it stays on white instead of over the red dog); Back returns to the form
// for a retry.
export function ActionErrorBody({
  message,
  onBack,
}: {
  message: string | null;
  onBack: () => void;
}) {
  return (
    <div className="relative flex w-full flex-1 flex-col items-center pt-8 pb-[68px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center"
      >
        <DogLottie className="aspect-square w-full max-w-[420px]" variant="calm" />
      </div>
      <div className="relative flex w-full flex-col items-center gap-4 p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="size-16"
          src={`${ASSET_BASE}/icon-swap-failed.svg`}
        />
        <p className="text-center font-semibold text-[28px] text-black leading-8 tracking-[-0.28px]">
          Failed
        </p>
        {message ? (
          <p className="max-w-[400px] truncate text-center text-[16px] leading-5 tracking-[-0.16px] text-[#f9363c]">
            {message}
          </p>
        ) : null}
      </div>
      <button
        className="t-hover relative flex h-12 items-center justify-center rounded-full bg-black px-5 font-medium text-[16px] text-white leading-5 hover:-translate-y-0.5 hover:bg-[#171717] active:translate-y-0"
        onClick={onBack}
        type="button"
      >
        Back
      </button>
    </div>
  );
}
