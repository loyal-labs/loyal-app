import {
  BotMessageSquare,
  Cpu,
  Eye,
  KeyRound,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";

import { LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { LandingHeader } from "@/components/landing-header";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";
import { CardsGrid } from "@/features/marketing/blocks/cards-grid";
import { CardsThree } from "@/features/marketing/blocks/cards-three";
import { CardsTwo } from "@/features/marketing/blocks/cards-two";
import { Hero } from "@/features/marketing/blocks/hero";
import { Section } from "@/features/marketing/blocks/section";
import { TextImageHero } from "@/features/marketing/blocks/text-image";

export const metadata: Metadata = {
  title: "Smart Accounts for AI Agents — Loyal",
  description:
    "Loyal turns every wallet address into a Smart Account with scoped, on-chain guardrails for AI agents — permission tiers, spending caps, and address allowlists.",
  alternates: { canonical: "/smart-accounts" },
};

export default function SmartAccountsPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      <LandingScrollAnimations />
      <LandingHeader />

      {/* Hero-3 — brand red hero */}
      <Hero
        body="Every wallet address in Loyal is a Smart Account with its own policies and spending caps — so your agents can't spend more or send funds somewhere you didn't approve."
        cta={{ label: "Get started", href: "/chat" }}
        image={{
          src: "/marketing/smart-accounts/hero.png",
          alt: "Agent access controls and spending limit settings",
        }}
        title="Smart Accounts for AI Agents"
        tone="red"
      />

      {/* Section — two-paragraph narrative */}
      <Section
        cards={[
          {
            size: "lg",
            body: "If the agent's tier is Can Suggest, the SDK returns a pending proposal the user can sign in the wallet UI. If the tier is Can Execute and the destination is on the allowlist and within the spending cap, the SDK co-signs and submits.",
          },
          {
            size: "lg",
            body: (
              <>
                Permission tier sets how an agent can transact. Spending limits
                and allowlists set what it can transact on.
                <br />
                <br />
                Together, permission tier plus{" "}
                <strong>spending limits</strong> plus address allowlists form
                the <strong>agent guardrails</strong> every transaction is
                checked against on-chain.
              </>
            ),
          },
        ]}
        title="What an agent wallet on Loyal is"
      />

      {/* Section-5 — three permission tiers (bold tone progression) */}
      <CardsThree
        cards={[
          {
            icon: (
              <Eye
                className="size-16 text-[#f9363c]"
                strokeWidth={1.5}
              />
            ),
            title: "Can Suggest",
            body: (
              <>
                Propose a transaction. You sign each one. No autonomy, full
                visibility.
                <br />
                <br />
                Best for new agents you&apos;re evaluating; advisory bots.
              </>
            ),
          },
          {
            icon: <KeyRound className="size-16 text-[#f9363c]" />,
            title: "Can Sign",
            body: (
              <>
                Co-sign alongside you. The transaction lands when both
                signatures are present.
                <br />
                <br />
                Best for high-value flows where you want the agent&apos;s
                signature and your approval.
              </>
            ),
          },
          {
            icon: <Sparkles className="size-16 text-white" />,
            title: "Can Execute",
            body: (
              <>
                Sign autonomously within the spending cap and allowlist.
                <br />
                <br />
                Best for trusted agents on routine flows: subscriptions,
                micropayments, vetted strategies.
              </>
            ),
          },
        ]}
        description="You don't trust every agent the same way. Loyal's permission model has three levels, set per agent:"
        title="The three permission tiers"
        variant="bold"
      />

      {/* Section-7 — spending limits and allowlists (muted, two cards) */}
      <CardsTwo
        cards={[
          {
            icon: <Wallet className="size-16 text-[#f9363c]" />,
            title: "Spending cap",
            body: "A dollar amount per day, per week, or per month. The agent cannot exceed the cap, even with Can Execute. Caps reset on the schedule you set.",
          },
          {
            icon: <ListChecks className="size-16 text-[#f9363c]" />,
            title: "Address allowlist",
            body: (
              <>
                A list of pre-approved destinations: specific routers, payees,
                or contracts. Off-list destinations are rejected at the Smart
                Account layer.
                <br />
                <br />
                The two are orthogonal. Combine them for fully scoped autonomy
                — for example, Buddy can execute up to $500/month, only to
                these three addresses.
              </>
            ),
          },
        ]}
        description={
          <>
            Permission tier sets how an agent can transact. Spending limits
            and allowlists set what it can transact on.
            <br />
            <br />
            Together, permission tier plus spending limits plus address
            allowlists form the agent guardrails every transaction is checked
            against on-chain.
          </>
        }
        title="Spending limits and allowlists"
        variant="muted"
      />

      {/* Section-14 — what you can build (muted grid, 5 cards) */}
      <CardsGrid
        cards={[
          {
            icon: <Cpu className="size-16 text-[#f9363c]" />,
            title: "Subscription agents",
            body: "Autonomous bots paying for API credits, RPC endpoints, model inference. Can Execute with a monthly cap means a runaway agent can't drain the wallet.",
          },
          {
            icon: <TrendingUp className="size-16 text-[#f9363c]" />,
            title: "Trading bots",
            body: "DEX-routing strategies. An allowlist limits the agent to vetted routers — Jupiter, Phoenix, Raydium — so it can't bridge funds to an attacker-controlled venue.",
          },
          {
            icon: <Sparkles className="size-16 text-[#f9363c]" />,
            title: "Social and content bots",
            body: "Agents that tip, reward, or pay creators on Solana. The cap limits the monthly budget; the allowlist restricts to known creator addresses.",
          },
          {
            icon: <BotMessageSquare className="size-16 text-[#f9363c]" />,
            title: "MCP-driven assistants",
            body: "Claude, ChatGPT, or any MCP-connected assistant signing transactions on the user's behalf. The user defines the tier and the cap; the assistant operates within them.",
          },
          {
            icon: <Wallet className="size-16 text-[#f9363c]" />,
            title: "Treasury operations",
            body: "A DAO or team treasury that delegates routine payouts to an agent (payroll, vendor invoices) while keeping principal signers on the multisig. Can Sign is the natural fit.",
          },
        ]}
        columns={3}
        description="With scoped, on-chain enforcement, entire categories of agent behavior become safe to deploy without supervision."
        title="What you can build"
        variant="muted"
      />

      {/* Section-16 — security model (muted 2-col + closing statement) */}
      <CardsGrid
        cards={[
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: "On-chain enforcement",
            body: (
              <>
                Permission tier, cap, and allowlist are all evaluated by the
                Smart Account&apos;s Anchor program before a transaction
                lands.
                <br />
                <br />
                There&apos;s no off-chain rule-checker that can be
                compromised.
              </>
            ),
          },
          {
            icon: <Sparkles className="size-16 text-[#f9363c]" />,
            title: "Squads underneath",
            body: (
              <>
                The Smart Account is a Squads multisig — the most-deployed
                smart-account framework on Solana — extended with a policy
                module.
                <br />
                <br />
                The signing model has been battle-tested across thousands of
                teams.
              </>
            ),
          },
          {
            icon: <KeyRound className="size-16 text-[#f9363c]" />,
            title: "Self-custodial",
            body: "Each agent holds its own signing key. You hold the Smart Account control key. Neither Loyal nor any third party can move funds without one of those keys.",
          },
          {
            icon: <RotateCcw className="size-16 text-[#f9363c]" />,
            title: "Revocable",
            body: "You can revoke an agent's permissions at any time from the wallet UI. The change takes effect on the next transaction.",
          },
          {
            icon: <Eye className="size-16 text-[#f9363c]" />,
            title: "No hidden execution",
            body: "Every action the agent takes is a regular Solana transaction with the agent's signature on it. Block explorers see exactly what happened.",
          },
        ]}
        closingStatement="The result is a safe wallet for autonomous agent behavior at scale: every constraint is in code, on-chain, with no off-chain authority Loyal or anyone else can override."
        columns={2}
        description="Every constraint is enforced on Solana, not on a Loyal server:"
        title="Security model"
        variant="muted"
      />

      {/* Section-19 — for developers (image-left, text-right hero row) */}
      <TextImageHero
        body="The Smart Account SDK ships as a TypeScript package — drop it into a Next.js, Node, or worker codebase and you're proposing transactions inside an hour. Open source under Apache 2.0."
        cta={{ label: "Read the docs", href: "https://docs.askloyal.com" }}
        image={{
          src: "/marketing/smart-accounts/sdk.png",
          alt: "Loyal Smart Account SDK code snippet",
        }}
        layout="text-right"
        title="For developers"
      />

      <LandingFaq />
      <LandingFooter />
    </main>
  );
}
