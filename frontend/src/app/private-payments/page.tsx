import type { Metadata } from "next";
import Link from "next/link";

import {
  Banknote,
  BotMessageSquare,
  CircleCheck,
  CircleDashed,
  Cpu,
  Eye,
  KeyRound,
  ListChecks,
  RotateCcw,
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

const PAGE_TITLE = "Anonymous Crypto Wallet on Solana | Loyal";
const PAGE_DESCRIPTION =
  "Loyal is a Solana wallet with private USDC, SOL, and USDT transfers. Shielded balances on a Confidential VM, yield on shielded dollars. Open-source.";
// TODO: replace with /marketing/private-payments/og-private-payments.<hash>.png
// once the designer ships the per-page 1200x630 card (mascot + "Private by default").
const OG_IMAGE = "/og-image.png";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/private-payments" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/private-payments",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Loyal Anonymous Crypto Wallet on Solana",
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

const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Loyal",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web, Chrome, Android",
  url: "https://askloyal.com/private-payments",
  description: PAGE_DESCRIPTION,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  creator: {
    "@type": "Organization",
    name: "Loyal",
    url: "https://askloyal.com",
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
      name: "Private Payments",
      item: "https://askloyal.com/private-payments",
    },
  ],
};

const privatePaymentsFaqs: FaqItem[] = [
  {
    question: "Is Solana untraceable?",
    answer:
      "Solana is not untraceable by default; every transaction is public on a public ledger. With Loyal, USDC, SOL, and USDT transfers happen as arithmetic on confidential deposit accounts inside MagicBlock's ephemeral runtime, not as real token movements on the main chain, so there's nothing for an on-chain analyst to graph. That's what most users mean when they say 'untraceable'.",
  },
  {
    question: "Is Loyal a mixer?",
    answer:
      "No. The shared Vault commingles balances, but the privacy comes from the Confidential VM signing layer and MagicBlock's ephemeral runtime. OFAC screening at deposit means sanctioned funds never enter the system. Different architecture and different threat model than a mixer.",
  },
  {
    question: "Is Loyal custodial?",
    answer:
      "No. Keys live in your Telegram passkey, Chrome extension, web app session, or Android app. The Confidential VM is a signing co-processor, not a key custodian. Pooling tokens in a shared Vault isn't custody either: this is not a centralized exchange, and only your key can withdraw your balance.",
  },
  {
    question: "Is it KYC-free?",
    answer:
      "Yes at the wallet layer. Loyal does not collect identity, email, or personal information to create a wallet. Deposit screening is OFAC-list-only: a sanctions check, not an identity check.",
  },
  {
    question: "What is a Confidential VM?",
    answer:
      "A server runtime that uses hardware memory encryption (AMD SEV-SNP or Intel TDX) so that not even the cloud provider can read the contents of memory. Loyal uses Confidential VMs to compute private transfer flows without exposing balances or counterparties to the public chain. Attestation is hardware-signed, so you can verify the exact code that's running before you trust it.",
  },
  {
    question: "Can the Loyal team see my balance?",
    answer:
      "No. Balances are encrypted inside the Vault and only readable by the holder of the corresponding key. Loyal team members running the infrastructure see encrypted values and aggregate flow metrics, nothing tied to a specific user. We cannot produce balances we don't have access to.",
  },
  {
    question: "What happens if the Confidential VM is compromised?",
    answer:
      "Funds remain safe, because a Confidential VM compromise alone is not sufficient to move funds; your private key signature is still required on every transfer. A worst-case hardware compromise would degrade transfer privacy back toward a standard Solana wallet (still self-custodial, still your funds), not exfiltrate balances. Attestation lets you verify the VM state before trusting it.",
  },
  {
    question: "Do private transfers work for SOL too, or only for USDC?",
    answer:
      "USDC, SOL, and USDT are supported as shielded assets. Each lives in its own per-mint shared Vault. The same mechanism (confidential deposit accounts on top of a commingled token pool, with transfers as arithmetic inside MagicBlock's ephemeral runtime) applies across all three.",
  },
  {
    question: "Can I use Loyal for payroll without exposing recipient addresses?",
    answer:
      "Yes, when both sides are Loyal users. A shielded-to-shielded transfer is arithmetic on deposit accounts inside the ephemeral runtime, not an on-chain movement, so the recipient's address and the amount aren't exposed on the public chain. The recipient un-shields when they want to move funds outside Loyal.",
  },
  {
    question: "Can a regulator subpoena my balance?",
    answer:
      "We cannot produce what we don't have. Loyal's infrastructure does not store cleartext balances or transfer history that's readable by Loyal team members: both are encrypted, with cleartext access governed by the user's keys. If you need to disclose your balance or history selectively, Loyal supports hierarchical viewing keys: you grant a read-only view to the party who needs it, without giving up your private key.",
  },
];

export default function PrivatePaymentsPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      {/* JSON-LD as script children (XSS-safe; React escapes <>&) — schema has no such chars */}
      <script type="application/ld+json">
        {JSON.stringify(softwareApplicationJsonLd)}
      </script>
      <script type="application/ld+json">
        {JSON.stringify(breadcrumbJsonLd)}
      </script>

      <LandingScrollAnimations />
      <LandingHeader />

      {/* Block 1 — Hero (dark) */}
      <Hero
        tone="dark"
        title="Anonymous Crypto Wallet on Solana"
        body="Send USDC, SOL, and USDT to anyone without exposing your balance or your history. Private transfers are the default, balances stay shielded from the public chain, and your shielded dollars keep earning yield."
        cta={{ label: "Open the wallet", href: "https://app.askloyal.com" }}
        image={{
          // TODO: replace with /marketing/private-payments/hero-shielded-vault.<hash>.png
          // (brand-style redraw of the shielded Vault + confidential deposit accounts diagram)
          src: "/landing/figma/feature-phone-overlay.png",
          alt: "Loyal mobile app showing a shielded balance and private send screen",
        }}
      />

      {/* Block 2 — Section (How private transfers work — two-property model) */}
      <Section
        title="How private transfers work"
        cards={[
          {
            size: "lg",
            body: (
              <>
                Solana is a public ledger by default. Every transfer, every
                balance, every wallet is readable by anyone with a block
                explorer. Loyal turns that off for your dollars.
                <br />
                <br />
                <strong>The shared Vault gives you fungibility.</strong> When
                you shield USDC, SOL, or USDT, your tokens join a shared
                on-chain Vault: one pool per token mint, holding everyone&apos;s
                real SPL tokens commingled. Inside the Vault, an observer
                can&apos;t tell whose deposited tokens are whose. Because
                deposits and withdrawals both go through the shared pool,
                there&apos;s no on-chain link between your deposit address and
                any address you later withdraw to.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                <strong>The ephemeral runtime gives you transfer privacy.</strong>{" "}
                Transfers between shielded users don&apos;t move real tokens at
                all. They&apos;re pure arithmetic on confidential deposit
                accounts, run inside MagicBlock&apos;s private ephemeral
                runtime, where only the deposit owner can see or interact with
                the account.
                <br />
                <br />
                Two different properties. Pool size matters for fungibility;
                it doesn&apos;t matter for transfer privacy, because the transfers
                themselves are invisible inside the ephemeral runtime regardless
                of how many other users are in the pool. Commingled isn&apos;t
                custodial: only your own key can withdraw your balance.
              </>
            ),
          },
        ]}
      />

      {/* Block 3 — Section (Yield on the private balance — cross-links /yield + /earn) */}
      <Section
        title="Yield on the private balance"
        cards={[
          {
            size: "lg",
            body: (
              <>
                Most privacy wallets force a choice between staying private and
                earning yield. Loyal doesn&apos;t.
                <br />
                <br />
                Your shielded dollars earn the <strong>passive baseline rate</strong>{" "}
                while they&apos;re shielded: the underlying pooled tokens are
                deployed into Kamino&apos;s single-asset lending vaults on
                Solana, and yield accrues without you exposing your balance or
                un-shielding to collect. Full mechanism on{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/yield"
                >
                  yield on shielded assets
                </Link>
                .
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                There&apos;s also an <strong>active optimizer</strong> in Loyal
                that routes across the highest-paying stablecoin reserves, but
                it runs on the open balance, <strong>not</strong> on shielded
                dollars. Shielded dollars earn the baseline only.
                <br />
                <br />
                You can split a balance (shielded for privacy at the baseline,
                open for active optimization) on the{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/earn"
                >
                  /earn
                </Link>{" "}
                page. The point of saying this clearly is so you know which
                lever does what before you split.
              </>
            ),
          },
        ]}
      />

      {/* Block 4 — Section-16 (muted 2-col grid with closing statement: mixer differentiation) */}
      <CardsGrid
        title="How Loyal differs from a mixer"
        description="A mixer takes funds in, shuffles them with other people's funds, and lets you withdraw to a fresh address. Loyal is built differently:"
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: "OFAC-compliant at deposit, by infrastructure",
            body: "MagicBlock's ephemeral runtime is OFAC-compliant: sanctioned wallets are screened and rejected at the deposit level, before funds ever enter the Vault. The pool stays clean by infrastructure design, not by trust.",
          },
          {
            icon: <CircleDashed className="size-16 text-[#f9363c]" strokeWidth={1.5} />,
            title: "Privacy comes from the runtime, not the pool",
            body: "A mixer scrambles a trail. Loyal doesn't have a trail to scramble: transfers between shielded users aren't on-chain movements at all, they're arithmetic on deposit accounts inside the ephemeral runtime. Pool size affects the anonymity set on deposits and withdrawals, but transfer privacy is independent of pool size.",
          },
          {
            icon: <Eye className="size-16 text-[#f9363c]" />,
            title: "Hierarchical viewing keys for opt-in compliance",
            body: "Grant a read-only view of your balance and history to an accountant, a tax tool, or an auditor, without ever revealing your private key or giving up the ability to move funds. Compliance is opt-in and granular, not bolted on after the fact.",
          },
          {
            icon: <Cpu className="size-16 text-[#f9363c]" />,
            title: "Confidential VM signing, not a multisig of strangers",
            body: "The Vault's signing key runs inside a hardware-isolated Confidential VM. Privacy comes from hardware isolation plus the ephemeral runtime, not from commingling with anonymous strangers in a pool.",
          },
        ]}
        closingStatement="Different architecture. Different threat model. For normal users who want their salary, payments, or DeFi flows kept private, built for you. For laundering sanctioned funds, wrong system."
      />

      {/* Block 5 — Section (Confidential VM and attestation) */}
      <Section
        title="Confidential VM and attestation"
        cards={[
          {
            size: "lg",
            body: (
              <>
                A <strong>Confidential VM</strong> is a server runtime that uses
                hardware memory encryption (AMD SEV-SNP or Intel TDX) so that
                not even the cloud provider can read the contents of memory.
                The signer for the Vault runs inside one. Even Loyal, as the
                operator, doesn&apos;t see the cleartext of what&apos;s inside.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                <strong>Attestation</strong> is the cryptographic receipt that
                proves which code is actually running. Hardware-signed
                attestations prove the code running matches what we published
                on GitHub. You can verify the running code before you trust
                it.
                <br />
                <br />
                In Loyal&apos;s own words: trust the silicon, not the humans.
              </>
            ),
          },
        ]}
      />

      {/* Block 6 — Section-16 (muted 2-col grid with closing: risk) */}
      <CardsGrid
        title="Risk: what stays safe and what doesn't"
        description="A privacy page that only lists upside isn't worth trusting. Here's the honest version."
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <RotateCcw className="size-16 text-[#f9363c]" />,
            title: "A Confidential VM compromise alone doesn't move your funds",
            body: "Your own private key signature is still required on every transfer and withdrawal. A worst-case hardware compromise would degrade transfer privacy back toward a standard Solana wallet (still self-custodial, still your funds), not exfiltrate balances. The privacy guarantee degrades; the custody guarantee doesn't.",
          },
          {
            icon: <KeyRound className="size-16 text-[#f9363c]" />,
            title: "You hold the keys",
            body: (
              <>
                Loyal is self-custodial. Keys live in your Telegram passkey,
                Chrome extension, web app session, or Android app. The
                Confidential VM is a signing co-processor, not a custodian.
                Pooling tokens in a shared Vault isn&apos;t custody either: only
                your key can withdraw your balance. Smart-account policies on
                the same wallet can also delegate bounded authority to{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/agents"
                >
                  AI agents
                </Link>
                , so the same custody model covers agent operators too.
              </>
            ),
          },
          {
            icon: <TrendingUp className="size-16 text-[#f9363c]" />,
            title: "Shielded balances that earn carry Kamino's lending risk",
            body: "While shielded, the underlying pooled tokens earn in Kamino's single-asset lending vaults. A Kamino smart-contract exploit or bad-debt event could affect deposited principal, the same risk any Kamino lender takes. No insurance, no Loyal-run strategies that could paper over a loss. Full risk discussion on /yield.",
          },
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: "Loyal hasn't commissioned a standalone audit yet",
            body: "What's been audited heavily is the substrate: smart accounts use Squads, the most-deployed smart-account framework on Solana, and transfer privacy runs on MagicBlock's ephemeral runtime. Both Squads and MagicBlock have been through multiple independent audits. Every line of Loyal-specific code on top is open-source.",
          },
        ]}
        closingStatement="Every part of this is open-source, so you don't have to take the description on faith."
      />

      {/* Block 7 — Section-14 (muted 3-col grid: who uses a private balance) */}
      <CardsGrid
        title="Who uses a private balance"
        description="Privacy isn't a niche feature. Four kinds of users get the most from it."
        variant="muted"
        cards={[
          {
            icon: <Banknote className="size-16 text-[#f9363c]" />,
            title: "Treasury managers",
            body: "A public on-chain balance is a liability. Counterparties and competitors can read exactly how much runway you're holding and how fast you're burning it. With Loyal, a treasury holds shielded USDC that earns yield without broadcasting its size or movements on-chain.",
          },
          {
            icon: <ListChecks className="size-16 text-[#f9363c]" />,
            title: "Payroll and contractor payments",
            body: "Paying employees, contractors, or vendors on a public chain leaks salary information to anyone watching the recipient's wallet. Shielded transfers move dollars between Loyal users as arithmetic on deposit accounts, with nothing on-chain to graph.",
          },
          {
            icon: <BotMessageSquare className="size-16 text-[#f9363c]" />,
            title: "Agent operators",
            body: "If you've authorized an AI agent with agent guardrails, private transfers keep the agent's activity off the public chain, while the on-chain Smart Account policy still enforces spending caps and an allowlist. Privacy and bounded autonomy compose; you don't pick one.",
          },
          {
            icon: <Wallet className="size-16 text-[#f9363c]" />,
            title: "Everyday holders",
            body: "If you hold USDC, SOL, or USDT for payments or as a store of value, your balance and transfer history are exposed by default on Solana. Loyal makes them private without changing the asset you're holding. Shield, transact privately, un-shield only when you want to land in the public layer.",
          },
        ]}
      />

      {/* Block 8 — Section-18 (text-left feature row: how it's built) */}
      <TextImageHero
        title="How it's built"
        body="Two open-source Anchor programs on Solana mainnet handle shielding and verification. Transfer privacy runs on MagicBlock's ephemeral runtime. The @loyal-labs/private-transactions SDK is public; read the source, ship private transfers in your own app."
        cta={{
          label: "Read the SDK",
          href: "https://docs.askloyal.com/sdk/private-transactions/quick-start",
        }}
        image={{
          src: "/marketing/agents/dev-sdk-card.53826a2b.png",
          alt: "Loyal private-transactions SDK quick-start",
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
          alt: "Loyal browser extension wallet showing a shielded balance and the Shield action",
        }}
      />

      <LandingFaq items={privatePaymentsFaqs} />
      <LandingFooter />
    </main>
  );
}
