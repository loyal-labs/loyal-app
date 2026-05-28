import type { Metadata } from "next";
import Link from "next/link";

import {
  Banknote,
  BotMessageSquare,
  CircleCheck,
  CircleDashed,
  Cpu,
  Crosshair,
  Dot,
  Eye,
  KeyRound,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { type FaqItem, LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { LandingHeader } from "@/components/landing-header";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";
import { CardsGrid } from "@/features/marketing/blocks/cards-grid";
import { CardsThree } from "@/features/marketing/blocks/cards-three";
import { CardsTwo } from "@/features/marketing/blocks/cards-two";
import { Hero } from "@/features/marketing/blocks/hero";
import { Section } from "@/features/marketing/blocks/section";
import { TextImageHero } from "@/features/marketing/blocks/text-image";

const PAGE_TITLE =
  "Agent Wallet on Solana | Smart Accounts for AI Agents | Loyal";
const PAGE_DESCRIPTION =
  "Loyal is an agent wallet on Solana. Every wallet is a Smart Account with policies and spending caps, so your AI agents stay within bounds.";
const OG_IMAGE = "/marketing/agents/og-agents.13a73749.png";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/agents" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/agents",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Loyal Smart Accounts for AI Agents on Solana",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [OG_IMAGE],
  },
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://askloyal.com",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Agents",
      item: "https://askloyal.com/agents",
    },
  ],
};

const agentFaqs: FaqItem[] = [
  {
    question: "What is an agent wallet?",
    answer:
      "An agent wallet is a self-custodial crypto wallet designed for an AI agent to operate autonomously. It holds funds and signs transactions on the agent's behalf, but is constrained by an on-chain Smart Account policy (permission tier, spending cap, address allowlist) so the agent cannot exceed the limits its user defined. Loyal is an agent wallet on Solana with these guardrails built in.",
  },
  {
    question: "What's a Smart Account in Loyal?",
    answer:
      "Every wallet address in Loyal is a Smart Account: a Squads-based on-chain program with its own policies and spending caps. Agents you authorize get sub-accounts with permission tiers; the Smart Account evaluates every transaction against the policy before it lands on Solana.",
  },
  {
    question: "How do the three permission tiers work?",
    answer:
      "Loyal has three permission tiers per agent: Can Suggest (agent proposes, you sign), Can Sign (agent co-signs alongside you), and Can Execute (agent signs autonomously within a spending cap and allowlist). Tiers are stackable across a fleet, so different agents can run on different tiers at the same time.",
  },
  {
    question: "Can the agent drain my wallet?",
    answer:
      "No, with a permission tier and a cap or allowlist set. Can Execute is gated by a spending cap per period and an address allowlist. With both active, the agent's worst case is a transfer up to the cap, to an address you already trust. Can Suggest and Can Sign require your signature for every transaction, so an agent on those tiers can't move funds without you.",
  },
  {
    question:
      "How does Loyal compare to MetaMask Advanced Permissions or Coinbase Agentic Wallets?",
    answer:
      "All three solve the same problem (scoped agent access without giving up the wallet) at different layers of the stack. Coinbase Agentic Wallets are wallet infrastructure for Base; MetaMask Advanced Permissions are an EVM standard (ERC-7715) implemented in the MetaMask Smart Accounts Kit. Loyal is a deployed self-custodial agent wallet on Solana with the same intent-based model, built on Squads smart accounts and the @loyal-labs/private-transactions SDK.",
  },
  {
    question:
      "How does Loyal compare to Crossmint, Privy, Turnkey, or Cobo for agent wallets?",
    answer:
      "Crossmint, Privy, Turnkey, and Cobo are wallet infrastructure for developers: embedded wallets, signer APIs, MPC custody, and policy engines that other teams compose into their own product. Loyal is a self-custodial agent wallet you use directly. Where those platforms sell the building blocks to teams shipping agent products, Loyal ships the assembled product on Solana, with Squads-based Smart Account policies (permission tiers, spending caps, address allowlists) and the @loyal-labs/private-transactions SDK in the box. If you're building a product, those infra platforms may fit. If you want an agent wallet to use, Loyal is one.",
  },
  {
    question: "Does Loyal support MCP?",
    answer:
      "Yes via the SDK today. A dedicated loyal-mcp MCP server is on the roadmap. The current path is to wrap @loyal-labs/private-transactions in a thin MCP layer; straightforward TypeScript, a few hundred lines.",
  },
  {
    question: "Why Solana for AI agents?",
    answer:
      "Three reasons. Transaction cost: agents that spend often need micro-spends to stay economical, and Solana fees are sub-cent. Latency: Smart Account policy evaluation finishes in one slot (~400ms), fast enough that agent-driven UX doesn't feel laggy. Composability: Squads, Jupiter, Phoenix, Kamino, and most of the agent-relevant ecosystem are Solana-native, which is why we think the best wallet for AI agents on Solana looks more like Loyal than like a generic EVM smart account.",
  },
  {
    question: "Is the agent wallet self-custodial?",
    answer:
      "Yes. Each agent holds its own signing key. You hold the Smart Account control key. Neither Loyal nor any third party can move funds without one of those keys. The Smart Account is policy-enforcement code, not a custodian.",
  },
];

export default function AgentsPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      {/* JSON-LD as script children (XSS-safe; React escapes <>&) — schema has no such chars */}
      <script type="application/ld+json">
        {JSON.stringify(breadcrumbJsonLd)}
      </script>

      <LandingScrollAnimations />
      <LandingHeader />

      {/* Block 1 — Hero (dark) */}
      <Hero
        tone="dark"
        title="Smart Accounts for AI Agents"
        body="Every wallet address in Loyal is a Smart Account with its own policies and spending caps, so your agents can't spend more or send funds somewhere you didn't approve."
        cta={{ label: "Get started", href: "https://app.askloyal.com" }}
        image={{
          src: "/marketing/agents/hero-permission-ladder.e365a2e4.png",
          alt: "Loyal agent permission ladder with spending limit card",
        }}
      />

      {/* Block 2 — Section (why we built this) */}
      <Section
        title="Why we built this"
        cards={[
          {
            size: "lg",
            body: "AI agents are getting better at deciding what to do. They're worse at being trusted to do it with money. A trading bot might identify a good rebalance opportunity at 3am, but unless it can sign a transaction without your input, it can't act on it. A subscription agent can spot the API key you need to renew, but it can't pay for it. Today most agents are stuck at the recommend-but-don't-execute boundary.",
          },
          {
            size: "lg",
            body: (
              <>
                The obvious fix is to give the agent a key. The obvious problem
                with that is that a key gives the agent unlimited authority over
                your entire wallet balance, any address, any contract, forever. A
                single jailbroken prompt drains the wallet.
                <br />
                <br />
                Loyal takes a different approach using{" "}
                <strong>on-chain policy enforcement</strong>: the agent gets a
                key, but the wallet it points at is a Smart Account that decides
                what the key can actually do. The policy lives in an Anchor
                program on Solana, not on a Loyal server, not in a config file
                the agent could rewrite.
              </>
            ),
          },
        ]}
      />

      {/* Block 3 — Section (what an agent wallet on Loyal is) */}
      <Section
        title="What an agent wallet on Loyal is"
        cards={[
          {
            size: "lg",
            body: (
              <>
                Every Loyal wallet is a <strong>Smart Account</strong>: a
                Squads-based on-chain program that holds the funds and evaluates
                every transaction against a policy you set. When you onboard an
                agent, the agent gets its own sub-account with its own signing
                key, and you assign it a permission tier plus, optionally, a
                spending cap and an allowlist of approved destinations.
                <br />
                <br />
                The agent can sign transactions whenever it wants. The Smart
                Account decides whether to co-sign and let them land on Solana.
                If the transaction doesn&apos;t match the policy, it&apos;s
                rejected on-chain. There&apos;s no Loyal server in the loop that
                can be bribed or subverted; the rules live in Anchor programs.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                Each agent on Loyal also has a name and an avatar (Stash,
                Spotty, Buddy) so you can see at a glance which agent is holding
                what and which one is allowed to do what. These are defaults; you
                can rename them and add more.
                <br />
                <br />
                The agent layer is separate from the privacy layer. Loyal also
                makes USDC and SOL transfers unlinkable via a Confidential VM
                signer and a shielded vault, covered on the{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/private-payments"
                >
                  private transfers
                </Link>{" "}
                page.
              </>
            ),
          },
        ]}
      />

      {/* Block 4 — Section-5 (three bold permission-tier cards) */}
      <CardsThree
        title="The three permission tiers"
        description="You don't trust every agent the same way. Loyal's permission model has three levels, set per agent:"
        variant="bold"
        cards={[
          {
            icon: (
              <CircleDashed className="size-16 text-[#f9363c]" strokeWidth={1.5} />
            ),
            title: "Can Suggest",
            body: "Propose a transaction. You sign each one. No autonomy, full visibility. Best for new agents you're evaluating and advisory bots.",
          },
          {
            icon: <Dot className="size-16 text-[#f9363c]" strokeWidth={3} />,
            title: "Can Sign",
            body: "Co-sign alongside you. The transaction lands when both signatures are present. Best for high-value flows where you want the agent's signature and your approval.",
          },
          {
            icon: <Crosshair className="size-16 text-white" />,
            title: "Can Execute",
            body: "Sign autonomously within the spending cap and allowlist. Best for trusted agents on routine flows: subscriptions, micropayments, vetted strategies.",
          },
        ]}
      />

      {/* Block 5 — Section-7 (two muted cards: spending limits + allowlists) */}
      <CardsTwo
        title="Spending limits and allowlists"
        description={
          <>
            Permission tier sets how an agent can transact. Spending limits and
            allowlists set what it can transact on.
            <br />
            <br />
            Together, permission tier plus spending limits plus address
            allowlists form the agent guardrails every transaction is checked
            against on-chain.
          </>
        }
        variant="muted"
        cards={[
          {
            icon: <Banknote className="size-16 text-[#f9363c]" />,
            title: "Spending cap",
            body: "A dollar amount per day, per week, or per month. The agent cannot exceed the cap, even with Can Execute. Caps reset on the schedule you set.",
          },
          {
            icon: <ListChecks className="size-16 text-[#f9363c]" />,
            title: "Address allowlist",
            body: "A list of pre-approved destinations: specific routers, payees, or contracts. Off-list destinations are rejected at the Smart Account layer.",
          },
        ]}
      />

      {/* Block 6 — Section-14 (muted grid: what you can build) */}
      <CardsGrid
        title="What you can build"
        description="With scoped, on-chain enforcement, entire categories of agent behavior become safe to deploy without supervision."
        variant="muted"
        cards={[
          {
            icon: <Wallet className="size-16 text-[#f9363c]" />,
            title: "Subscription agents",
            body: "Autonomous bots paying for API credits, RPC endpoints, model inference. Can Execute with a monthly cap means a runaway agent can't drain the wallet.",
          },
          {
            icon: <TrendingUp className="size-16 text-[#f9363c]" />,
            title: "Trading bots",
            body: "DEX-routing strategies. An allowlist limits the agent to vetted routers (Jupiter, Phoenix, Raydium) so it can't bridge funds to an attacker-controlled venue.",
          },
          {
            icon: <Sparkles className="size-16 text-[#f9363c]" />,
            title: "Social and content bots",
            body: "Agents that tip, reward, or pay creators on Solana. The cap limits the monthly budget; the allowlist restricts to known creator addresses.",
          },
          {
            icon: <Cpu className="size-16 text-[#f9363c]" />,
            title: "MCP-driven assistants",
            body: "Claude, ChatGPT, or any MCP-connected assistant signing transactions on the user's behalf. The user defines the tier and the cap; the assistant operates within them.",
          },
          {
            icon: <BotMessageSquare className="size-16 text-[#f9363c]" />,
            title: "Treasury operations",
            body: (
              <>
                A DAO or team treasury that delegates routine payouts to an
                agent (payroll, vendor invoices) while keeping principal signers
                on the multisig. Can Sign is the natural fit. The same pattern
                routes idle reserves to a{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/earn"
                >
                  best-rate optimizer
                </Link>{" "}
                or a{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/yield"
                >
                  shielded-yield reserve
                </Link>
                .
              </>
            ),
          },
          {
            icon: <ShoppingBag className="size-16 text-[#f9363c]" />,
            title: "Commerce agents",
            body: "Checkout and payments agents that pay merchants or settle invoices on their own. Can Execute with a per-merchant allowlist and a monthly cap turns 'let the agent buy it' into a bounded, auditable action.",
          },
        ]}
      />

      {/* Block 7 — Section-16 (muted 2-col grid + closing: security model) */}
      <CardsGrid
        title="Security model"
        description="Every constraint is enforced on Solana, not on a Loyal server:"
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: "On-chain enforcement",
            body: (
              <>
                Permission tier, cap, and allowlist are all evaluated by the
                Smart Account&apos;s Anchor program before a transaction lands.
                <br />
                <br />
                There&apos;s no off-chain rule-checker that can be compromised.
              </>
            ),
          },
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: "Squads underneath",
            body: (
              <>
                The Smart Account is a Squads multisig (the most-deployed
                smart-account framework on Solana) extended with a policy
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
      />

      {/* Block 8 — Section-18 (text-left feature row: for developers) */}
      <TextImageHero
        title="For developers"
        body="The agent wallet is open-source and composable. Point your agent at a user's Loyal Smart Account with the @loyal-labs/private-transactions SDK; the Smart Account handles permission tier, spending cap, and allowlist enforcement on-chain."
        cta={{
          label: "Read the SDK",
          href: "https://docs.askloyal.com/sdk/private-transactions/quick-start",
        }}
        image={{
          src: "/marketing/agents/dev-sdk-card.53826a2b.png",
          alt: "Loyal SDK quick-start for agent transactions",
        }}
      />

      {/* Block 9 — Section-19 (image-left feature row: get started) */}
      <TextImageHero
        layout="text-right"
        title="Get started"
        body="Runs in the web app, browser extension, Telegram mini-app, and Android app, all backed by the same Squads Smart Account. Supported assets: USDC, SOL, USDT."
        cta={{ label: "Get started", href: "https://app.askloyal.com" }}
        image={{
          src: "/landing/figma/get-started-extension-wallet.png",
          alt: "Loyal browser extension wallet showing balance, tokens, and the Shield action",
        }}
      />

      <LandingFaq items={agentFaqs} />
      <LandingFooter />
    </main>
  );
}
