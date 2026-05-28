import type { Metadata } from "next";
import Link from "next/link";

import {
  Banknote,
  BotMessageSquare,
  Building2,
  CircleCheck,
  KeyRound,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { type FaqItem, LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { LandingHeader } from "@/components/landing-header";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";
import { CardsGrid } from "@/features/marketing/blocks/cards-grid";
import { Hero } from "@/features/marketing/blocks/hero";
import { Section } from "@/features/marketing/blocks/section";
import { TextImageHero } from "@/features/marketing/blocks/text-image";

const PAGE_TITLE = "Yield on Shielded USDC, SOL & USDT on Solana | Loyal";
const PAGE_DESCRIPTION =
  "Loyal routes your shielded USDC, SOL, and USDT into Kamino lending vaults, so your balance earns yield while it stays private. Non-custodial, open-source.";
// TODO: replace with /marketing/yield/og-yield.<hash>.png once the
// per-page 1200x630 card ships.
const OG_IMAGE = "/og-image.png";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/yield" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/yield",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Loyal yield on shielded USDC, SOL, and USDT on Solana",
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

const financialProductJsonLd = {
  "@context": "https://schema.org",
  "@type": "FinancialProduct",
  name: "Yield on Shielded USDC",
  url: "https://askloyal.com/yield",
  description: PAGE_DESCRIPTION,
  category: "Stablecoin lending",
  provider: { "@id": "https://askloyal.com/#organization" },
  feesAndCommissionsSpecification:
    "No platform fees on yield. Underlying yield is sourced from Kamino lending vaults; rates float with on-chain supply and demand.",
  interestRate: {
    "@type": "QuantitativeValue",
    description:
      "Variable APY from Kamino's single-asset lending vaults on Solana. The current rate is displayed in the app before deposit.",
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
      name: "Yield",
      item: "https://askloyal.com/yield",
    },
  ],
};

const yieldFaqs: FaqItem[] = [
  {
    question:
      "How do I earn yield on USDC without exposing my wallet on-chain?",
    answer:
      "Deposit USDC into Loyal and shield the balance. Loyal routes the underlying USDC into Kamino's single-asset lending vaults on Solana, so it earns yield while your balance stays shielded: individual balances and movements aren't attributable to your address. You collect yield without un-shielding and without revealing your balance on-chain. Withdraw any time by un-shielding.",
  },
  {
    question: "Where does the yield come from?",
    answer:
      "Kamino. Specifically, Kamino's single-asset lending vaults on Solana, the same infrastructure used by Phantom, Pendle, Anchorage, and others. When you earn APY on shielded USDC, SOL, or USDT, your assets are deployed into Kamino's strategies. We don't run our own yield strategies and we don't promise magic numbers.",
  },
  {
    question: "Do I have to un-shield to earn yield?",
    answer:
      "No. The underlying tokens are deployed to Kamino while your balance stays shielded, so yield accrues without you exposing your balance or moving back to a public position. You only un-shield when you want to withdraw to ordinary USDC, SOL, or USDT.",
  },
  {
    question: "What APY can I expect?",
    answer:
      "A variable, market rate, not a fixed promise. Yield comes from Kamino's lending markets, so the rate floats with on-chain supply and demand. Loyal doesn't run its own strategies and doesn't quote magic numbers. The underlying rate is public on Kamino, and the current rate shows in the app before you deposit.",
  },
  {
    question: "Can I lose money?",
    answer:
      "Yield carries risk. Your principal is deployed to Kamino's lending vaults while shielded, so a Kamino smart-contract exploit or bad-debt event could affect it, the same risk any Kamino lender takes. Like any DeFi lending position, deposits aren't covered by deposit insurance. A compromise of Loyal's own signing layer does not move your funds, because your private key signature is required on every transfer and withdrawal.",
  },
  {
    question: "Has Loyal been audited?",
    answer:
      "Loyal hasn't commissioned its own standalone audit yet, but it's built on primitives that have been audited heavily. The smart accounts use Squads, the most-deployed smart-account framework on Solana, and transfer privacy runs on MagicBlock's ephemeral runtime. Both have been through multiple independent audits, and the funds earn in Kamino, one of Solana's most-used lending protocols. The full Loyal stack is open-source, so you can review it directly.",
  },
  {
    question: "How fast can I withdraw?",
    answer:
      "Un-shielding pulls your funds back from Kamino first. In normal market conditions this is fast; like any lending market, it can be delayed if the underlying Kamino market is at unusually high utilization, with most supplied liquidity borrowed out. That's standard DeFi lending behavior, not a Loyal-specific lockup.",
  },
  {
    question: "Can I prove my earnings for taxes?",
    answer:
      "Yes, without exposing your keys. Loyal supports hierarchical viewing keys: you can grant a read-only view of your balance and history to an accountant, a tax tool, or an auditor, without ever revealing your private key or giving up the ability to move funds. Proof of earnings is opt-in and granular.",
  },
  {
    question: "Is Loyal custodial?",
    answer:
      "No. Keys live in your Telegram passkey, Chrome extension, or web app session. The signing layer is a co-processor running in a hardware-isolated Confidential VM, not a key custodian. Your private key signature is still required to move funds, including to withdraw from the yield position. Pooling tokens in a shared Vault isn't custody either: this is not a centralized exchange, and only your key can withdraw your balance.",
  },
  {
    question: "Can the Loyal team see my balance?",
    answer:
      "No. Balances are encrypted inside the Vault and only readable by the holder of the corresponding key. Loyal team members running the infrastructure see encrypted values and aggregate flow metrics, nothing tied to a specific user, including the portion deployed to Kamino.",
  },
];

export default function YieldPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      {/* JSON-LD as script children (XSS-safe; React escapes <>&) — schema has no such chars */}
      <script type="application/ld+json">
        {JSON.stringify(financialProductJsonLd)}
      </script>
      <script type="application/ld+json">
        {JSON.stringify(breadcrumbJsonLd)}
      </script>

      <LandingScrollAnimations />
      <LandingHeader />

      {/* Block 1 — Hero (dark) */}
      <Hero
        tone="dark"
        title="Earn Yield on Shielded USDC, SOL, and USDT"
        body="Your dollars shouldn't have to sit idle to stay private. Loyal routes your shielded USDC, SOL, and USDT into Kamino lending vaults, so your balance earns yield the entire time it stays shielded. You don't un-shield to earn, and you don't reveal your balance to collect."
        cta={{ label: "Open the wallet", href: "https://app.askloyal.com" }}
        image={{
          // TODO: replace with /marketing/yield/hero-shielded-yield.<hash>.png
          // (brand-style redraw of the "Vault → Kamino routing" diagram from
          // loom-recordings/part-1-yield-on-private-dollars/diagrams/).
          src: "/landing/figma/feature-yield-card.png",
          alt: "Loyal wallet showing shielded USDC earning yield while staying private",
        }}
      />

      {/* Block 2 — Section (How yield on shielded assets works) */}
      <Section
        title="How yield on shielded assets works"
        description="Shielding and earning are two layers stacked on the same pool of tokens."
        cards={[
          {
            size: "lg",
            body: (
              <>
                <strong>Deposit into a shared Vault.</strong> Send USDC, SOL, or
                USDT to Loyal and your tokens join a shared on-chain Vault: one
                pool per token mint, holding everyone&apos;s real SPL tokens
                commingled. Your position is tracked as a confidential deposit
                account against that pool, not as coins sitting at your own
                address.
                <br />
                <br />
                <strong>Your balance stays private.</strong> Inside the Vault,
                balances aren&apos;t attributable to any address. Transfers
                between shielded users don&apos;t move real tokens at all;
                they&apos;re arithmetic on deposit accounts, run inside
                MagicBlock&apos;s ephemeral runtime where only the account owner
                can see or touch the balance.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                <strong>The pooled tokens earn in Kamino.</strong> Because the
                real tokens sit commingled in the Vault, they don&apos;t have to
                sit idle. The Vault deploys them into Kamino&apos;s single-asset
                lending vaults on Solana to earn yield, while every balance on
                top stays shielded.
                <br />
                <br />
                <strong>Un-shield to exit.</strong> When you withdraw, the Vault
                pulls the tokens back from Kamino and releases real SPL tokens
                from the pool to your address. Because deposits and withdrawals
                both go through the shared pool, there&apos;s no on-chain link
                between the two. Commingled isn&apos;t custodial: only your own
                key can withdraw your balance.
              </>
            ),
          },
        ]}
      />

      {/* Block 3 — Section (Why your shielded dollars shouldn't sit idle) */}
      <Section
        title="Why your shielded dollars shouldn't sit idle"
        cards={[
          {
            size: "lg",
            body: (
              <>
                Shielding a balance just to make it{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/private-payments"
                >
                  private
                </Link>{" "}
                doesn&apos;t stand on its own. Almost nobody parks capital
                purely to keep it confidential, and privacy needs a crowd: your
                own transaction volume isn&apos;t enough to hide behind. A
                privacy layer with no other reason to hold funds never attracts
                the activity that makes it work.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                Utility brings the deposits. People park dollars somewhere that
                also pays them, and once enough capital is parked, the privacy
                gets stronger for everyone.
                <br />
                <br />
                Most privacy protocols lock funds that then sit idle for the
                entire time they&apos;re shielded. The dollars backing a
                shielded balance on Loyal don&apos;t. They&apos;re deposited
                into Kamino and earn while the balance stays private. For the
                same routing logic on open (unshielded) balances, see{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/earn"
                >
                  /earn
                </Link>
                .
              </>
            ),
          },
        ]}
      />

      {/* Block 4 — Section (Why this works on Solana) */}
      <Section
        title="Why this works on Solana"
        cards={[
          {
            size: "lg",
            body: (
              <>
                Solana has a deep bench of on-chain native protocols that
                compose with each other. Loyal&apos;s Vault can deposit its
                underlying tokens straight into Kamino, a major Solana lending
                protocol, and pull them back on demand, all on-chain, all in
                code. There&apos;s no off-chain bridge, no custodian moving
                funds between venues, no manual rebalancing desk.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                The shielded layer and the yield layer are both Solana programs
                talking to each other. Composability, backed by large,
                established DeFi protocols, is what lets Loyal put your idle
                shielded dollars to work automatically. Transaction costs stay
                low enough that routing even small balances to yield is
                economical.
              </>
            ),
          },
        ]}
      />

      {/* Block 5 — Section (Where the yield comes from) */}
      <Section
        title="Where the yield comes from"
        cards={[
          {
            size: "lg",
            body: (
              <>
                <strong>
                  Kamino. Specifically, Kamino&apos;s single-asset lending
                  vaults on Solana
                </strong>
                , the same infrastructure used by Phantom, Pendle, Anchorage,
                and others. When you earn APY on shielded USDC, SOL, or USDT,
                your assets are deployed into Kamino&apos;s strategies. We
                don&apos;t run our own yield strategies and we don&apos;t
                promise magic numbers.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                Rates float with Kamino&apos;s lending markets, so the live APY
                moves with on-chain supply and demand. You don&apos;t have to
                take our word for what it is: the underlying market rate is
                public on{" "}
                <a
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="https://kamino.finance"
                  rel="noopener"
                  target="_blank"
                >
                  Kamino
                </a>
                , and the current rate for your assets shows in the app before
                you deposit.
              </>
            ),
          },
        ]}
      />

      {/* Block 6 — CardsGrid (muted, 2-col) Risk */}
      <CardsGrid
        title="Risk: what you can lose and what stays safe"
        description="What's exposed when your shielded balance earns yield, and what stays safe regardless."
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <TrendingUp className="size-16 text-[#f9363c]" />,
            title: "Your principal carries Kamino's risk",
            body: "While shielded, the underlying tokens sit in Kamino's lending vaults. If one of those vaults suffered a smart-contract exploit or a bad-debt event, the deposited principal could be affected, the same risk every Kamino lender takes. We don't insure deposits and we don't run our own strategies that could paper over a loss. The venue is Kamino, one of the most-used lending protocols on Solana.",
          },
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: "A Loyal-side compromise does not move your funds",
            body: "The shielded layer runs a signer inside a hardware-isolated Confidential VM. Even a worst-case compromise of that layer can't move your money, because your own private key signature is still required on every transfer and withdrawal. A worst-case hardware compromise would degrade your transfer privacy back toward a standard Solana wallet (still self-custodial, still your funds), not drain your balance.",
          },
          {
            icon: <KeyRound className="size-16 text-[#f9363c]" />,
            title: "You hold the keys",
            body: "Loyal is self-custodial. Keys live in your Telegram passkey, Chrome extension, web app session, or Android app. The Confidential VM is a signing co-processor, not a custodian, and Loyal can't move your funds (including the portion in Kamino) without your signature.",
          },
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: "Every part is open-source",
            body: (
              <>
                Loyal hasn&apos;t commissioned its own standalone audit yet, but
                the substrate has been audited heavily: smart accounts use
                Squads, the most-deployed smart-account framework on Solana, and
                transfer privacy runs on MagicBlock&apos;s ephemeral runtime.
                Every line of Loyal-specific code on top is{" "}
                <a
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="https://github.com/loyal-labs/loyal-app"
                  rel="noopener"
                  target="_blank"
                >
                  open-source
                </a>
                .
              </>
            ),
          },
        ]}
      />

      {/* Block 7 — CardsGrid (muted, 4 use cases) */}
      <CardsGrid
        title="Who earns private yield with Loyal"
        variant="muted"
        cards={[
          {
            icon: <Building2 className="size-16 text-[#f9363c]" />,
            title: "Treasury managers",
            body: "A public on-chain balance is a liability. Counterparties, competitors, and anyone with a block explorer can read exactly how much runway you're holding. With Loyal, a treasury earns yield on idle USDC without broadcasting its size on-chain. Shielded assets plus Kamino yield means the treasury works for you instead of advertising itself.",
          },
          {
            icon: <Banknote className="size-16 text-[#f9363c]" />,
            title: "Teams holding runway",
            body: "If you raised in stablecoins and you're holding months of payroll, that float can earn while it waits, without exposing the balance or the burn rate that a competitor could infer from it. You un-shield what you need, when you need it.",
          },
          {
            icon: <BotMessageSquare className="size-16 text-[#f9363c]" />,
            title: "DAOs and on-chain orgs",
            body: (
              <>
                A DAO treasury that wants its idle stablecoins productive, but
                doesn&apos;t want every governance contribution and payout
                amount sitting in plain sight, gets both: yield on the idle
                portion and privacy on the movements. Pair it with{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/agents"
                >
                  Smart Account
                </Link>{" "}
                policies for scoped, agent-driven payouts.
              </>
            ),
          },
          {
            icon: <Wallet className="size-16 text-[#f9363c]" />,
            title: "Everyday holders",
            body: "If you hold USDC for payments or as a store of value, your idle dollars earn automatically while staying private. No navigating five DeFi protocols, no choosing between privacy and APY.",
          },
        ]}
      />

      {/* Block 8 — TextImageHero (text-left): How it's built */}
      <TextImageHero
        title="How it's built"
        body={
          <>
            Loyal&apos;s shielding runs in open-source on-chain programs, not on
            a server you have to trust. The shield and un-shield machinery lives
            in two Anchor programs on Solana mainnet. Transfer privacy comes
            from MagicBlock&apos;s ephemeral runtime, where the per-user
            accounting happens. The underlying tokens are deposited into Kamino
            to earn yield.
            <br />
            <br />
            The whole stack is in the loyal-app monorepo; read how the Vault,
            the shielding, and the Kamino routing fit together.
          </>
        }
        cta={{
          label: "Read the docs",
          href: "https://docs.askloyal.com",
        }}
        image={{
          src: "/marketing/agents/dev-sdk-card.53826a2b.png",
          alt: "Loyal open-source monorepo and SDK for shielded yield",
        }}
      />

      {/* Block 9 — TextImageHero (text-right): Start earning */}
      <TextImageHero
        layout="text-right"
        title="Start earning"
        body="Deposit USDC, SOL, or USDT, shield it, and it starts earning. Loyal lives in four places, all on the same Squads-based smart account: web app, Chrome extension, Telegram mini-app, and the Android app."
        cta={{ label: "Get started", href: "https://app.askloyal.com" }}
        image={{
          src: "/landing/figma/get-started-extension-wallet.png",
          alt: "Loyal browser extension wallet showing a shielded balance earning yield",
        }}
      />

      <LandingFaq items={yieldFaqs} />
      <LandingFooter />
    </main>
  );
}
