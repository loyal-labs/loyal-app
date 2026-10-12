"use client";

import { CircleDollarSign, Landmark, PenLine, TrendingUp } from "lucide-react";

import {
  FlowDiagram,
  type FlowStep,
} from "@/components/wallet-workspace/facelift/flow-explainer";

const EARN_STEPS: readonly FlowStep[] = [
  {
    Icon: CircleDollarSign,
    title: "Choose an amount",
    body: "Pick how much to move from your wallet into Earn. The minimum is $1.",
  },
  {
    Icon: PenLine,
    title: "Approve in your wallet",
    body: "One signature sends the deposit through your own smart account — Loyal never takes custody of your funds.",
  },
  {
    Icon: Landmark,
    title: "Your stablecoins are lent out",
    body: "They land in your Earn vault, then an approved lending market on Kamino. Each stablecoin stays the same — it is never swapped.",
  },
  {
    Icon: TrendingUp,
    title: "Earning starts right away",
    body: "Interest accrues continuously at a variable rate. Withdraw back to your wallet anytime.",
  },
];

export function EarnExplainerCard() {
  return (
    <section className="flex w-full shrink-0 flex-col overflow-clip rounded-3xl bg-card">
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 py-2.5 pl-4 font-semibold text-[20px] text-foreground leading-6">
          How Earn works
        </h2>
      </header>
      <FlowDiagram
        docsHref="https://docs.askloyal.com/automations/routing-and-yield"
        footnote="Rates are variable, and supplied funds carry the risks of the underlying lending market."
        steps={EARN_STEPS}
      />
    </section>
  );
}
