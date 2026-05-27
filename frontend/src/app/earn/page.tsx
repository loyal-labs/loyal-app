import type { Metadata } from "next";
import Link from "next/link";

import {
  Banknote,
  Building2,
  CircleCheck,
  FileCode,
  KeyRound,
  Network,
  ShieldCheck,
  Sprout,
  TrendingDown,
  Vault,
} from "lucide-react";

import { type FaqItem, LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { LandingHeader } from "@/components/landing-header";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";
import { CardsGrid } from "@/features/marketing/blocks/cards-grid";
import { Hero } from "@/features/marketing/blocks/hero";
import { Section } from "@/features/marketing/blocks/section";
import { TextImageHero } from "@/features/marketing/blocks/text-image";

const PAGE_TITLE = "Best Available Stablecoin Yield on Solana | Loyal";
const PAGE_DESCRIPTION =
  "Loyal routes your stablecoins to whichever Solana lending reserve pays the most, bounded by an on-chain policy, so you earn the best available rate without giving up custody.";
// TODO: replace with /marketing/earn/og-earn.<hash>.png once the
// per-page 1200x630 card ships (designer to brand-redraw the routing diagram).
const OG_IMAGE = "/og-image.png";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/earn" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/earn",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Loyal earns the best available stablecoin yield on Solana, automatically",
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
  url: "https://askloyal.com/earn",
  description: PAGE_DESCRIPTION,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  creator: {
    "@type": "Organization",
    name: "Loyal",
    url: "https://askloyal.com",
  },
};

const techArticleJsonLd = {
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline:
    "Earn the Best Available Stablecoin Yield on Solana, Automatically",
  description:
    "How Loyal earns the best available stablecoin yield on Solana: routing dollars to whichever Kamino lending reserve pays the most, bounded by an on-chain Squads policy, without giving up custody.",
  datePublished: "2026-05-21",
  dateModified: "2026-05-21",
  author: {
    "@type": "Person",
    name: "Chris",
    jobTitle: "CEO",
    worksFor: {
      "@type": "Organization",
      name: "Loyal",
      url: "https://askloyal.com",
    },
  },
  publisher: {
    "@type": "Organization",
    name: "Loyal",
    url: "https://askloyal.com",
    logo: { "@type": "ImageObject", url: "https://askloyal.com/logo.png" },
  },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": "https://askloyal.com/earn",
  },
  about: [
    { "@type": "Thing", name: "Stablecoin yield optimization" },
    { "@type": "Thing", name: "Non-custodial yield" },
    { "@type": "Organization", name: "Kamino", url: "https://kamino.finance" },
    { "@type": "Organization", name: "Squads", url: "https://squads.so" },
  ],
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
      name: "Earn",
      item: "https://askloyal.com/earn",
    },
  ],
};

const earnFaqs: FaqItem[] = [
  {
    question:
      "How do I get the best stablecoin lending yield on Solana automatically?",
    answer:
      "Deposit dollars into Loyal and set how much goes to earning. Loyal routes that allocation to whichever reputable Kamino reserve currently pays the most, swapping between risk-equivalent stablecoins (USDC, PYUSD, USDT, USDS) when a better market uses a different dollar, and re-routing as rates move. It runs through an on-chain Squads policy, so the automation never takes custody. You withdraw to the dollar asset you started with, any time.",
  },
  {
    question: "Why do lending APYs spike?",
    answer:
      "A reserve pays lenders out of what borrowers pay, balanced by its total supply and how much of it is borrowed (utilization). When a large lender withdraws but borrowing demand stays high, the reserve is short on capital, so it raises the APY it pays to attract deposits. The rate can jump well above normal for a few hours until new capital arrives and it settles. Sitting in the right reserve during those windows is where the extra yield comes from.",
  },
  {
    question: "Is this custodial?",
    answer:
      "No. The automation runs as a policy on your Squads smart account with whitelisted intents (approved swaps, deposits, and withdrawals). Loyal's backend can trigger those moves but never holds your private key and can't act outside the whitelist. Only your key owns the funds, and you can optionally require your confirmation on each swap.",
  },
  {
    question: "What APY can I expect?",
    answer:
      "A variable, market rate, not a fixed promise. Yield comes from Kamino's lending reserves, so the rate floats with on-chain supply and demand, and the optimizer keeps your dollars in whichever reserve is paying the most. Loyal doesn't quote magic numbers. The current rate shows in the app before you deposit, and the underlying reserve rates are public on Kamino so you can check them yourself.",
  },
  {
    question: "Can I lose money?",
    answer:
      "The strategy is built to be low-variance. It's plain stablecoin lending, with no liquidations and no impermanent loss, because it uses neither leverage nor liquidity-provider positions. Your dollars sit in established Kamino reserves and the whitelist sticks to reputable dollars, so the residual risks are the ordinary ones any lender takes: a smart-contract issue in a reserve, or a stablecoin losing its peg. You keep custody the entire time, and the automation can never move funds outside the whitelisted intents.",
  },
  {
    question: "How is this different from a yield vault like Kamino Earn?",
    answer:
      "A managed vault takes custody and allocates for you, often with lock-ups, and it can't move fast enough to catch short rate spikes. Loyal keeps custody with you, has no lock-up, and routes faster because it monitors reserves and reacts to spikes as they happen. The trade-off is that Loyal is a newer approach; a vault is the more established set-and-forget option, better suited to institutional capital that wants to delegate.",
  },
  {
    question: "Do I have to manage anything?",
    answer:
      "No. You deposit dollars and set how much goes to earning. The routing runs on its own from there, moving your allocation to the best reserve as rates change. If you'd rather stay in the loop, you can set the policy to ask you to confirm each swap.",
  },
  {
    question: "Has Loyal been audited?",
    answer:
      "Loyal hasn't commissioned its own standalone audit yet, but it's built on primitives that have been audited heavily. Squads, which holds the funds and enforces the policy, and MagicBlock, which the privacy layer runs on, have each been through multiple independent audits, and the earning happens in Kamino, one of Solana's most-used lending protocols. The full Loyal stack is open-source, so you can review it directly.",
  },
  {
    question: "Can I keep my balance private while it earns?",
    answer:
      "Shielding and optimizing are two different paths. Shielded dollars earn the private baseline lending rate, covered on the yield on shielded assets page. The optimizer on this page works on your open balance, because routing across reserves and swapping stablecoins isn't run on shielded funds. You can use both: keep part of a balance shielded for privacy and put the rest into the optimizer for the best rate.",
  },
];

export default function EarnPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      {/* JSON-LD as script children (XSS-safe; React escapes <>&) — schema has no such chars */}
      <script type="application/ld+json">
        {JSON.stringify(softwareApplicationJsonLd)}
      </script>
      <script type="application/ld+json">
        {JSON.stringify(techArticleJsonLd)}
      </script>
      <script type="application/ld+json">
        {JSON.stringify(breadcrumbJsonLd)}
      </script>

      <LandingScrollAnimations />
      <LandingHeader />

      {/* Block 1 — Hero (dark) */}
      <Hero
        tone="dark"
        title="Earn the Best Available Stablecoin Yield on Solana, Automatically"
        body="Lending rates on Solana move all the time. Loyal routes your dollars to whichever reputable lending reserve currently pays the most, bounded by an on-chain policy, so you earn the best available rate without giving up custody. You deposit dollars, set how much goes to earning, and it works from there."
        cta={{ label: "Open the wallet", href: "https://app.askloyal.com" }}
        image={{
          // TODO: replace with /marketing/earn/hero-routing-diagram.<hash>.png
          // (brand-style redraw of the Kamino APY-spike chart from
          // loom-recordings/part-2-yield-routing/diagrams/01-kamino-market-overview.png).
          src: "/landing/figma/feature-yield-card.png",
          alt: "Loyal optimizer routing dollars to the highest-paying Kamino lending reserve on Solana",
        }}
      />

      {/* Block 2 — Section: Two ways your dollars earn with Loyal */}
      <Section
        title="Two ways your dollars earn with Loyal"
        description="Earning with Loyal comes in two forms, and you choose which fits."
        cards={[
          {
            size: "lg",
            body: (
              <>
                <strong>
                  Private and passive: your shielded dollars earn while they
                  sit.
                </strong>{" "}
                Dollars you hold and{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/private-payments"
                >
                  shield
                </Link>{" "}
                don&apos;t sit idle. The underlying tokens are put to work in
                Kamino lending while your balance stays private, earning the
                baseline lending rate with nothing for you to manage.
                That&apos;s the{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/yield"
                >
                  yield on shielded assets
                </Link>{" "}
                story.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                <strong>
                  Active and optimized: your dollars earn the most they can.
                </strong>{" "}
                Put your dollars into the optimizer and an{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/agents"
                >
                  agent
                </Link>{" "}
                continuously moves your allocation to the best-paying reserve
                instead of leaving it in one pool, swapping between
                risk-equivalent stablecoins to reach a better market.
                Optimizing runs on your open balance, not on shielded dollars.
              </>
            ),
          },
        ]}
      />

      {/* Block 3 — Section: Your stablecoins are all just dollars */}
      <Section
        title="Your stablecoins are all just dollars"
        cards={[
          {
            size: "lg",
            body: (
              <>
                USDC is reputable. PYUSD is PayPal&apos;s dollar. USDT is
                Tether&apos;s. USDS is a dollar too. For the purpose of earning
                lending yield, if holding one of these instead of another
                doesn&apos;t meaningfully change your risk, then they&apos;re
                interchangeable. They&apos;re all just dollars.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                Once you accept that, a question follows: why pin your dollars
                to one token in one lending reserve, when a different reserve,
                sometimes holding a different dollar, is paying more right now?
                There&apos;s no good reason. You see dollars. Under the hood,
                Loyal moves between risk-equivalent stablecoins to reach a
                better reserve, and when you withdraw, you get back the dollar
                asset you started with.
              </>
            ),
          },
        ]}
      />

      {/* Block 4 — Section: Why lending rates spike */}
      <Section
        title="Why lending rates spike (and how that's the opening)"
        description="This part is usually explained badly, so here it is plainly."
        cards={[
          {
            size: "lg",
            body: (
              <>
                A lending reserve has two numbers that matter: its{" "}
                <strong>total supply</strong> (how many dollars are deposited)
                and its <strong>utilization</strong> (what share of those
                dollars is currently borrowed). Lenders get paid out of what
                borrowers pay, so the rate a reserve offers depends on the
                balance between the two.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                Picture a large lender pulling money out. Supply drops, but the
                borrowers don&apos;t leave, so utilization jumps. The reserve
                is suddenly short on capital, so it{" "}
                <strong>raises the APY it pays</strong> to attract fresh
                deposits, sometimes many times higher, before new capital flows
                in and it settles. Those windows are the opening. Catching them
                by hand is impractical. Catching them automatically is the
                point of Loyal.
              </>
            ),
          },
        ]}
      />

      {/* Block 5 — Section: How Loyal routes to the best rate */}
      <Section
        title="How Loyal routes to the best rate"
        cards={[
          {
            size: "lg",
            body: (
              <>
                Moving from a worse reserve to a better one is mechanically
                simple. You <strong>withdraw</strong> from the first and{" "}
                <strong>deposit</strong> into the second, and that can happen
                in a single transaction. Sometimes the better market uses a
                different dollar, so the move also needs a{" "}
                <strong>swap</strong>, for example PYUSD into USDT, before the
                deposit. Withdraw, maybe swap, deposit. That&apos;s the whole
                motion.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                Loyal automates that motion across a{" "}
                <strong>whitelist of reserves it trusts</strong>, not every
                random pool on-chain. The optimizer watches the market, sees
                where the rate is moving, and routes your allocation there,
                repeatedly, as conditions change. You don&apos;t sign each move
                or babysit a dashboard. None of this is a new token or a yield
                product you have to hold; it&apos;s automation on top of your
                own dollars.
              </>
            ),
          },
        ]}
      />

      {/* Block 6 — CardsGrid (3 cols, muted): The three approaches we ruled out */}
      <CardsGrid
        title="Why not a big contract, a backend key, or a vault"
        description="There are a few obvious ways to automate this. We looked hard at each, and each one trades away something we weren't willing to give up."
        variant="muted"
        columns={3}
        cards={[
          {
            icon: <FileCode className="size-16 text-[#f9363c]" />,
            title: "A big custom contract",
            body: "Put all the routing logic into one large on-chain program and every reserve you add, every change in logic, means redeploying and re-auditing. The audit surface is large and permanent, and the design is rigid by construction. You spend forever maintaining a contract instead of capturing yield.",
          },
          {
            icon: <KeyRound className="size-16 text-[#f9363c]" />,
            title: "A backend private key",
            body: "Run a wallet in a bot and have it fire the transactions. It's flexible, and it's roughly how a sophisticated solo farmer would do it. But it puts a live private key in a server: if that key leaks, the funds are gone. Not something to hand a normal user, and at real size you'd end up back at a multisig with manual approvals anyway.",
          },
          {
            icon: <Vault className="size-16 text-[#f9363c]" />,
            title: "A manager-run vault",
            body: "Deposit into a managed lending vault and let a manager allocate for you. Fine for set-and-forget, especially institutional capital. But you give up custody to the manager, you often accept lock-up periods, and a vault can't move fast enough to catch the short windows where the real edge lives.",
          },
        ]}
      />

      {/* Block 7 — Section: How the policy keeps it safe (Loyal's answer) */}
      <Section
        title="How the policy keeps it safe"
        description="Loyal's answer keeps what's useful from those approaches and leaves out the risk."
        cards={[
          {
            size: "lg",
            body: (
              <>
                Instead of a big contract that manages all the routing,
                there&apos;s a <strong>thin helper contract</strong> that only
                bundles a move into a single transaction, constrained by a{" "}
                <strong>smart-account policy</strong> on{" "}
                <a
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="https://squads.so"
                  rel="noopener"
                  target="_blank"
                >
                  Squads
                </a>
                . The actions it can run are <strong>whitelisted intents</strong>:
                swap between approved stablecoins, deposit into approved
                reserves, withdraw from approved reserves. Each action is
                harmless on its own and easy to verify.
              </>
            ),
          },
          {
            size: "lg",
            body: (
              <>
                The policy constrains the intents so your balance{" "}
                <strong>can&apos;t decrease</strong>, which is why the
                yield-only operations are <strong>auto-approved</strong> by
                default. Loyal&apos;s backend can trigger those moves, but it
                never holds your key and can never step outside the whitelist.
                There&apos;s no private key sitting in a server waiting to be
                stolen, because the policy lives on-chain and the funds stay in
                your own smart account. If you want an extra layer, the policy
                can require you to confirm each swap.
              </>
            ),
          },
        ]}
      />

      {/* Block 8 — CardsGrid (muted, 2 cols): Risk */}
      <CardsGrid
        title="Understanding the risks"
        description="Plain stablecoin lending: no liquidations, no impermanent loss, no leverage. What's left is the ordinary risk any lender takes."
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <TrendingDown className="size-16 text-[#f9363c]" />,
            title: "Reserve smart-contract and depeg risk",
            body: "Your dollars sit in Kamino reserves that carry smart-contract risk, where an exploit or a bad-debt event could affect the principal, the same exposure every lender in that reserve takes. Because the strategy moves between stablecoins, a stablecoin losing its peg is also a genuine risk, which is why the whitelist is limited to reputable dollars and established reserves.",
          },
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: "Custody is not among these risks",
            body: "The automation is bounded by the on-chain policy, so even a worst-case compromise of Loyal's systems cannot move your funds outside the whitelisted intents or seize your balance. You hold the keys throughout.",
          },
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: "No liquidations, no impermanent loss",
            body: "The strategy holds no leveraged positions, so there are no liquidations, and no liquidity-provider positions, so there is no impermanent loss. It's plain lending, with a narrow risk profile.",
          },
          {
            icon: <KeyRound className="size-16 text-[#f9363c]" />,
            title: "Every part is open-source",
            body: (
              <>
                Loyal hasn&apos;t commissioned its own standalone audit yet,
                but the substrate has been audited heavily: Squads, which holds
                the funds and enforces the policy, and MagicBlock, which the
                privacy layer runs on. Every line of Loyal-specific code on top
                is{" "}
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

      {/* Block 9 — CardsGrid (muted, 2 cols): Who optimizes yield */}
      <CardsGrid
        title="Who optimizes yield with Loyal"
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <Building2 className="size-16 text-[#f9363c]" />,
            title: "Treasuries holding stablecoins",
            body: (
              <>
                If you&apos;re sitting on a stablecoin treasury, the difference
                between a parked rate and an optimized one compounds into real
                money over a year. Loyal earns the better rate automatically,
                without your team manually rotating positions and without
                handing custody to a vault manager. If you&apos;d rather keep
                part of the balance off public view,{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/yield"
                >
                  shielding
                </Link>{" "}
                earns the private baseline rate instead, so you can split a
                treasury between the two.
              </>
            ),
          },
          {
            icon: <Network className="size-16 text-[#f9363c]" />,
            title: "DAOs and on-chain orgs",
            body: (
              <>
                A DAO treasury can keep its idle stablecoins productive at the
                best available rate, governed by an on-chain policy the org
                controls, instead of trusting a single manager or running a
                risky backend key. Combine it with{" "}
                <Link
                  className="underline underline-offset-4 transition-colors hover:text-[#f9363c]"
                  href="/agents"
                >
                  Smart Account
                </Link>{" "}
                policies for scoped payouts.
              </>
            ),
          },
          {
            icon: <Banknote className="size-16 text-[#f9363c]" />,
            title: "Teams managing runway",
            body: "Stablecoin runway can earn the optimized rate while it waits to be spent, with no lock-up that traps it when payroll is due. You withdraw what you need, when you need it.",
          },
          {
            icon: <Sprout className="size-16 text-[#f9363c]" />,
            title: "Power users and farmers",
            body: "If you'd otherwise run your own backend to chase reserve spikes, Loyal gives you the same routing without a live key in a server and without a big custom contract of your own to maintain. The whitelist and the policy are yours to trust.",
          },
        ]}
      />

      {/* Block 10 — TextImageHero (text-left): How it's built */}
      <TextImageHero
        title="How it's built"
        body={
          <>
            The automation rides on{" "}
            <a
              className="underline underline-offset-4 transition-colors hover:text-white"
              href="https://squads.so"
              rel="noopener"
              target="_blank"
            >
              Squads
            </a>{" "}
            smart accounts, the most-deployed smart-account framework on
            Solana. Routing is a <strong>policy with whitelisted intents</strong>{" "}
            plus a thin helper contract that bundles a move into one
            transaction, rather than a big custom program. The lending itself
            happens in{" "}
            <a
              className="underline underline-offset-4 transition-colors hover:text-white"
              href="https://kamino.finance"
              rel="noopener"
              target="_blank"
            >
              Kamino
            </a>{" "}
            reserves, and the privacy layer Loyal is built on uses
            MagicBlock&apos;s ephemeral runtime, with the signer running in a
            hardware-isolated Confidential VM.
            <br />
            <br />
            The whole stack is in the loyal-app monorepo; read how the policy,
            the routing, and the Kamino integration fit together.
          </>
        }
        cta={{
          label: "Read the docs",
          href: "https://docs.askloyal.com",
        }}
        image={{
          src: "/marketing/agents/dev-sdk-card.53826a2b.png",
          alt: "Loyal open-source monorepo and SDK for stablecoin yield routing",
        }}
      />

      {/* Block 11 — TextImageHero (text-right): Start earning */}
      <TextImageHero
        layout="text-right"
        title="Start earning"
        body={
          <>
            Deposit dollars, set how much goes to earning, and Loyal routes it
            to the best available rate from there. Loyal lives in four
            places, all on the same Squads-based smart account: web app,
            Chrome extension, Telegram mini-app, and the Android app.{" "}
            <strong>Stay Loyal.</strong>
          </>
        }
        cta={{ label: "Get started", href: "https://app.askloyal.com" }}
        image={{
          src: "/landing/figma/get-started-extension-wallet.png",
          alt: "Loyal browser extension wallet showing an optimized stablecoin position",
        }}
      />

      <LandingFaq items={earnFaqs} />
      <LandingFooter />
    </main>
  );
}
