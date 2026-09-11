"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/lib/utils";

const KAMINO_YIELD = 0.08;
const BALANCE_STOPS = [
  1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 30_000_000,
  50_000_000, 75_000_000, 100_000_000,
];
const SHARE_STOPS = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08];

const usd = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});
const pct = (v: number) => `${Math.round(v * 100)}%`;
const usdShort = (v: number) =>
  v >= 1_000_000_000
    ? `$${v / 1_000_000_000} billion`
    : `$${v / 1_000_000} million`;

export function DemoStart() {
  const [balanceIdx, setBalanceIdx] = useState(3);
  const [shareIdx, setShareIdx] = useState(3);
  const balances = BALANCE_STOPS[balanceIdx];
  const yourShare = SHARE_STOPS[shareIdx];
  const usersShare = KAMINO_YIELD - yourShare;
  const youKeep = balances * yourShare;

  return (
    <div className="dark flex min-h-screen w-full flex-col items-center bg-[#141218] font-sans text-[#e1e3e6]">
      <header className="flex w-full justify-center px-6">
        <div className="flex h-[68px] w-full max-w-[1200px] items-center">
          <Image
            alt="Loyal"
            height={24}
            src="/landing/figma/header-logotype.svg"
            width={56}
          />
        </div>
      </header>

      <section className="flex w-full flex-col items-center gap-8 px-6 pt-6 pb-12 text-center">
        <div className="flex max-w-[540px] flex-col gap-4">
          <h1 className="font-bold text-[40px] uppercase leading-none md:text-[56px]">
            Money that moves itself
          </h1>
          <p className="text-[15px] text-[#97959a] leading-[1.2]">
            At {usdShort(balances)} of user balances this loop pays you about{" "}
            {usd.format(youKeep)} a year. Users earn {pct(usersShare)}, you keep{" "}
            {pct(yourShare)} of roughly {pct(KAMINO_YIELD)} Kamino yield.
            <br />
            Rates float. The split is set in your contract.
          </p>
        </div>
        <button
          className="h-14 rounded-full bg-[#e1e3e6] px-6 font-medium text-[#0f0d13] text-[20px] transition-opacity hover:opacity-90"
          type="button"
        >
          Continue with email
        </button>
      </section>

      <section className="flex w-full justify-center px-6 py-4">
        <div className="relative w-full max-w-[1200px] lg:py-[60px]">
          <Connectors />
          <div className="grid grid-cols-1 gap-6 lg:h-[240px] lg:grid-cols-3">
            <SchemeCard
              caption="User's spendable cash"
              title="Privy wallet"
            />
            <SchemeCard
              caption="Programmable and policy-guarded account"
              title="Smart account"
            />
            <SchemeCard
              caption="Vault, where idle cash works"
              dim
              title="Kamino Main Market"
            />
          </div>
        </div>
      </section>

      <section className="flex w-full flex-col items-center gap-12 px-6 py-24 lg:px-16">
        <h2 className="max-w-[474px] text-center font-bold text-[40px] uppercase leading-none md:text-[56px]">
          Make more money
        </h2>
        <div className="relative w-full max-w-[680px]">
          <Image
            alt=""
            className="pointer-events-none absolute top-[-32px] left-[-64px] hidden size-64 md:block"
            height={256}
            src="/demo/dog-back.svg"
            width={256}
          />
          <div className="relative flex h-[250px] flex-col items-center justify-center rounded-[32px] bg-[#1d1b20] p-6">
            <Image
              alt=""
              className="absolute top-0 right-0 size-[100px]"
              height={100}
              src="/demo/corner.svg"
              width={100}
            />
            <div className="flex flex-col items-center gap-1 pb-6">
              <p className="text-[#97959a] text-[20px] leading-6">You keep</p>
              <div className="flex items-baseline gap-[7px] md:pl-9">
                <p className="font-semibold text-[40px] leading-[64px] tracking-[-0.616px] md:text-[56px]">
                  {usd.format(youKeep)}
                </p>
                <p className="text-[#97959a] text-[20px] leading-6">/year</p>
              </div>
            </div>
          </div>
          <div className="mx-8 h-[2px] border-[#1d1b20] border-t-2 border-dashed" />
          <div className="relative flex flex-col gap-6 rounded-[32px] bg-[#1d1b20] p-6 md:flex-row">
            <div className="flex flex-1 flex-col">
              <div className="flex flex-col gap-1 px-2 pb-2">
                <p className="text-[#97959a] text-[16px] leading-5">
                  User balances
                </p>
                <p className="font-semibold text-[24px] leading-7 tracking-[-0.264px]">
                  {usd.format(balances)}
                </p>
              </div>
              <StepSlider
                label="User balances"
                onChange={setBalanceIdx}
                stops={BALANCE_STOPS.length}
                value={balanceIdx}
              />
            </div>
            <div className="flex flex-1 flex-col">
              <div className="flex gap-2 px-2 pb-2">
                <div className="flex flex-1 flex-col gap-1">
                  <p className="text-[#97959a] text-[16px] leading-5">
                    Your share
                  </p>
                  <p className="font-semibold text-[24px] leading-7 tracking-[-0.264px]">
                    {pct(yourShare)}
                  </p>
                </div>
                <div className="flex flex-1 flex-col gap-1 text-right">
                  <p className="text-[#97959a] text-[16px] leading-5">
                    Users’ share
                  </p>
                  <p className="font-semibold text-[24px] leading-7 tracking-[-0.264px]">
                    {pct(usersShare)}
                  </p>
                </div>
              </div>
              <StepSlider
                label="Your share"
                onChange={setShareIdx}
                stops={SHARE_STOPS.length}
                value={shareIdx}
              />
              <p className="px-2 pt-2 text-[#97959a] text-[13px] leading-4">
                Based on roughly {pct(KAMINO_YIELD)} Kamino yield. Rates float.
                The split is set in your contract
              </p>
            </div>
          </div>
          <Image
            alt=""
            className="pointer-events-none absolute top-[-32px] left-[-64px] hidden size-64 md:block"
            height={256}
            src="/demo/dog-front.svg"
            width={256}
          />
        </div>
      </section>
    </div>
  );
}

function SchemeCard({
  title,
  caption,
  dim,
}: {
  title: string;
  caption: string;
  dim?: boolean;
}) {
  return (
    <div className="flex min-h-[200px] flex-col justify-between rounded-[32px] bg-[#1d1b20]">
      <div className="flex flex-col gap-0.5 p-6">
        <p className="text-[#97959a] text-[16px] leading-5">{title}</p>
        <div className="flex items-center gap-2">
          <Image
            alt="USDC"
            className="size-9 rounded-full"
            height={36}
            src="/demo/usdc.png"
            width={36}
          />
          <p
            className={cn(
              "font-semibold text-[40px] leading-[48px] tracking-[-0.44px]",
              dim && "text-[#636067]"
            )}
          >
            0<span className="text-[#636067]">.00</span>
          </p>
        </div>
      </div>
      <p className="p-6 text-[#97959a] text-[16px] leading-5">{caption}</p>
    </div>
  );
}

// Arrows between the three cards. Drawn over the card grid; hidden below lg
// where the cards stack. The Figma design uses a 24px column gap and 60px
// connector rows; `vectorEffect` keeps the strokes 2px while the arcs
// stretch with the layout.
function Connectors() {
  const top: [string, string][] = [
    ["Pull 2 USDC · recurring", "left-[calc(33.333%-12px)]"],
    ["Deposit · 2 USDC", "left-[calc(66.666%-12px)]"],
  ];
  const bottom: [string, string][] = [
    ["Withdraw · 1 USDC", "left-[calc(33.333%-12px)]"],
    ["Withdraw · 1 USDC", "left-[calc(66.666%-12px)]"],
  ];
  return (
    <div className="pointer-events-none absolute inset-0 hidden lg:block">
      <svg
        aria-hidden
        className="absolute inset-0 size-full text-[#4b4950]"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 1200 360"
      >
        {/* Card centers x = 192, 600, 1008; cards span y 60..300. Source dots
            and arrowheads on the middle card are offset ±8px so they don't overlap. */}
        <g stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke">
          <path d="M192 60 V45 Q192 21 216 21 H568 Q592 21 592 45 V60" />
          <path d="M608 60 V45 Q608 21 632 21 H984 Q1008 21 1008 45 V60" />
          <path d="M1008 300 V315 Q1008 339 984 339 H632 Q608 339 608 315 V300" />
          <path d="M592 300 V315 Q592 339 568 339 H216 Q192 339 192 315 V300" />
        </g>
        <g fill="currentColor">
          <circle cx="192" cy="61" r="5" />
          <circle cx="608" cy="61" r="5" />
          <circle cx="1008" cy="299" r="5" />
          <circle cx="592" cy="299" r="5" />
        </g>
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        >
          <path d="M585 52 L592 59 L599 52" />
          <path d="M1001 52 L1008 59 L1015 52" />
          <path d="M601 308 L608 301 L615 308" />
          <path d="M185 308 L192 301 L199 308" />
        </g>
      </svg>
      {top.map(([text, left]) => (
        <Pill className={cn("top-[2px]", left)} key={text + left}>
          {text}
        </Pill>
      ))}
      {bottom.map(([text, left]) => (
        <Pill className={cn("bottom-[2px]", left)} key={text + left}>
          {text}
        </Pill>
      ))}
    </div>
  );
}

function Pill({
  children,
  className,
}: {
  children: string;
  className: string;
}) {
  return (
    <span
      className={cn(
        "absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-[#333036] px-5 py-2.5 text-[16px] leading-5 tracking-[-0.176px]",
        className
      )}
    >
      {children}
    </span>
  );
}

function StepSlider({
  label,
  stops,
  value,
  onChange,
}: {
  label: string;
  stops: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const max = stops - 1;
  const fill = `${(value / max) * 100}%`;
  return (
    <div className="p-2">
      <div className="relative h-6 rounded-full bg-white/[0.04]">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#ff5050]"
          style={{ width: `calc(${fill} + (100% - ${fill}) * 0.1)` }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-2">
          {Array.from({ length: stops }, (_, i) => (
            <span
              className={cn(
                "size-2 rounded-full",
                i === value
                  ? "bg-[#636067]"
                  : i < value
                    ? "bg-white/60 scale-50"
                    : "bg-[#636067] scale-50"
              )}
              key={i}
            />
          ))}
        </div>
        <div
          className="pointer-events-none absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.12] bg-white"
          style={{ left: `calc(14px + (100% - 28px) * ${value / max})` }}
        />
        <input
          aria-label={label}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
          max={max}
          min={0}
          onChange={(e) => onChange(Number(e.target.value))}
          step={1}
          type="range"
          value={value}
        />
      </div>
    </div>
  );
}
