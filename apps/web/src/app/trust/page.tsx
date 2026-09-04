import type { Metadata } from "next";
import Link from "next/link";

import {
  Activity,
  CircleCheck,
  FileText,
  KeyRound,
  Landmark,
  ListChecks,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { LandingHeader } from "@/components/landing-header";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";
import { CardsGrid } from "@/features/marketing/blocks/cards-grid";
import { CardsThree } from "@/features/marketing/blocks/cards-three";
import { Hero } from "@/features/marketing/blocks/hero";
import { TextImageHero } from "@/features/marketing/blocks/text-image";

const PAGE_TITLE = "Trust and Security | Loyal";
const PAGE_DESCRIPTION =
  "Loyal is non-custodial by architecture. Your account is a Squads smart account, your yield comes from Kamino, and your funds keep working whether or not Loyal does.";
// TODO: replace with /marketing/trust/og-trust.<hash>.png once the designer
// ships the per-page 1200x630 card.
const OG_IMAGE = "/og-image.png";

const LINK_CLASS =
  "underline underline-offset-4 transition-colors hover:text-[#f9363c]";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/trust" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/trust",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Loyal trust and security",
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
      name: "Trust",
      item: "https://askloyal.com/trust",
    },
  ],
};

export default function TrustPage() {
  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      {/* JSON-LD as script children (XSS-safe; React escapes <>&) — schema has no such chars */}
      <script type="application/ld+json">
        {JSON.stringify(breadcrumbJsonLd)}
      </script>

      <LandingScrollAnimations />
      <LandingHeader />

      {/* Block 1 — Hero (light) */}
      <Hero
        tone="light"
        title="Your funds don't depend on Loyal"
        body="Your keys stay yours. Your account is a Squads smart account and your yield comes from Kamino, the same infrastructure that secures billions on Solana. Everything keeps working whether or not we do."
        cta={{ label: "Open the wallet", href: "https://app.askloyal.com" }}
        image={{
          src: "/landing/figma/get-started-extension-wallet.png",
          alt: "Loyal browser extension wallet showing an account balance",
        }}
      />

      {/* Block 2 — What secures your funds */}
      <CardsGrid
        title="What secures your funds"
        description="Most of what stands between you and your money is infrastructure that already secures billions on Solana."
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: "Squads",
            body: "Your account is a Squads V4 smart account. Open source, audited, and the most widely used smart account program on Solana.",
          },
          {
            icon: <TrendingUp className="size-16 text-[#f9363c]" />,
            title: "Kamino",
            body: "Yield comes from Kamino lending vaults, the same infrastructure Phantom and Anchorage route to.",
          },
          {
            icon: <KeyRound className="size-16 text-[#f9363c]" />,
            title: "Non-custodial",
            body: "Loyal never holds your private keys and has no signing authority over your account.",
          },
          {
            icon: <ListChecks className="size-16 text-[#f9363c]" />,
            title: "Policy on-chain",
            body: "Spending caps, token allowlists and approved programs are enforced by the Squads program, not by our servers.",
          },
        ]}
      />

      {/* Block 3 — No lock-in */}
      <TextImageHero
        title="No lock-in"
        body={
          <>
            Your smart account lives on the Squads program. It doesn&apos;t
            depend on our frontend, our API, or our permission. Any Solana
            client can reach it, including the CLI on your own machine.
          </>
        }
        cta={{
          label: "What happens if Loyal disappears",
          href: "https://docs.askloyal.com/faq",
        }}
        image={{
          src: "/marketing/agents/dev-sdk-card.53826a2b.png",
          alt: "Loyal SDK quick-start, showing the client libraries that talk to the on-chain programs",
        }}
      />

      {/* Block 4 — Verify it yourself */}
      <CardsGrid
        title="Verify it yourself"
        description={
          <>
            Everything is open source under AGPL-3.0. The wallet, the extension,
            the SDKs and the on-chain programs. Read the code, build it yourself,
            or fork the whole thing. State lives on-chain, so a fork stays
            compatible with everything else.
          </>
        }
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: "Smart accounts",
            body: "Live on Solana mainnet, on the audited Squads program.",
          },
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: "Open-source clients",
            body: "The wallet, the extension, and the SDKs are all public repositories you can build and run yourself.",
          },
        ]}
        closingStatement={
          <>
            Read every line at{" "}
            <Link className={LINK_CLASS} href="https://github.com/loyal-labs">
              github.com/loyal-labs
            </Link>
            .
          </>
        }
      />

      {/* Block 5 — Track record */}
      <CardsThree
        title="Track record"
        description="Numbers you can check rather than claims you have to take on faith."
        variant="muted"
        cards={[
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: "Zero incidents",
            body: "No loss of user funds since launch in October 2025.",
          },
          {
            icon: <Activity className="size-16 text-[#f9363c]" />,
            title: "Live assets under management",
            body: (
              <>
                Updated in real time at{" "}
                <Link className={LINK_CLASS} href="https://stats.askloyal.com">
                  stats.askloyal.com
                </Link>
                .
              </>
            ),
          },
          {
            icon: <FileText className="size-16 text-[#f9363c]" />,
            title: "Quarterly transparency reports",
            body: (
              <>
                Published every quarter since Q4 2025, with treasury addresses
                and balances.{" "}
                <Link
                  className={LINK_CLASS}
                  href="https://docs.askloyal.com/transparency/q2-2026"
                >
                  Read the latest
                </Link>
                .
              </>
            ),
          },
        ]}
      />

      {/* Block 6 — On the record */}
      <CardsGrid
        title="On the record"
        description="Loyal discloses more than it has to, in places where the disclosure is checkable by someone other than us."
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <FileText className="size-16 text-[#f9363c]" />,
            title: "Blockworks B2 disclosure",
            body: (
              <>
                One of 35 protocols with a complete B2 transparency disclosure,
                alongside Jupiter, dYdX and Morpho. Filed and current for H1
                2026.{" "}
                <Link
                  className={LINK_CLASS}
                  href="https://blockworks.com/token-transparency/filing/loyal/loyal-2026-h1-b2-v1.0"
                >
                  Read the filing
                </Link>
                .
              </>
            ),
          },
          {
            icon: <Landmark className="size-16 text-[#f9363c]" />,
            title: "MetaDAO",
            body: (
              <>
                The October 2025 ICO drew $75.9M in commitments against a $500K
                target, 151x oversubscribed. The treasury is governed by
                futarchy, not a founder wallet.{" "}
                <Link
                  className={LINK_CLASS}
                  href="https://www.metadao.fi/projects/loyal/fundraise"
                >
                  See the raise
                </Link>
                .
              </>
            ),
          },
        ]}
        closingStatement={
          <span className="block text-[16px] leading-[1.4] tracking-[-0.02em] text-black/40 lg:text-[20px] lg:tracking-[-0.4px]">
            Also featured by Solana Mobile and backed by Superteam.
          </span>
        }
      />

      <LandingFaq />
      <LandingFooter />
    </main>
  );
}
