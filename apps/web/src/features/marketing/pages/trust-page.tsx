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
import type { CommonDict } from "@/features/marketing/i18n/en/common";
import type { TrustDict } from "@/features/marketing/i18n/en/trust";
import type { Locale } from "@/features/marketing/i18n/locale";
import { buildBreadcrumbJsonLd } from "@/features/marketing/i18n/metadata";

// TODO: replace with /marketing/trust/og-trust.<hash>.png once the designer
// ships the per-page 1200x630 card.
export const TRUST_OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
};

export const TRUST_LINK_CLASS =
  "underline underline-offset-4 transition-colors hover:text-[#f9363c]";

export function TrustPage({
  locale,
  dict,
  common,
}: {
  locale: Locale;
  dict: TrustDict;
  common: CommonDict;
}) {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd({
    locale,
    path: "/trust",
    copy: dict.breadcrumb,
  });

  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      {/* JSON-LD as script children (XSS-safe; React escapes <>&) — schema has no such chars */}
      <script type="application/ld+json">
        {JSON.stringify(breadcrumbJsonLd)}
      </script>

      <LandingScrollAnimations />
      <LandingHeader copy={common.header} locale={locale} />

      {/* Block 1 — Hero (light) */}
      <Hero
        tone="light"
        title={dict.hero.title}
        body={dict.hero.body}
        cta={{ label: dict.hero.cta, href: "https://app.askloyal.com" }}
        image={{
          src: "/landing/figma/get-started-extension-wallet.png",
          alt: dict.hero.imageAlt,
        }}
      />

      {/* Block 2 — What secures your funds */}
      <CardsGrid
        title={dict.secures.title}
        description={dict.secures.description}
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: dict.secures.cards.squads.title,
            body: dict.secures.cards.squads.body,
          },
          {
            icon: <TrendingUp className="size-16 text-[#f9363c]" />,
            title: dict.secures.cards.kamino.title,
            body: dict.secures.cards.kamino.body,
          },
          {
            icon: <KeyRound className="size-16 text-[#f9363c]" />,
            title: dict.secures.cards.nonCustodial.title,
            body: dict.secures.cards.nonCustodial.body,
          },
          {
            icon: <ListChecks className="size-16 text-[#f9363c]" />,
            title: dict.secures.cards.policy.title,
            body: dict.secures.cards.policy.body,
          },
        ]}
      />

      {/* Block 3 — No lock-in */}
      <TextImageHero
        title={dict.noLockIn.title}
        body={dict.noLockIn.body}
        cta={{
          label: dict.noLockIn.cta,
          href: "https://docs.askloyal.com/faq",
        }}
        image={{
          src: "/marketing/agents/dev-sdk-card.53826a2b.png",
          alt: dict.noLockIn.imageAlt,
        }}
      />

      {/* Block 4 — Verify it yourself */}
      <CardsGrid
        title={dict.verify.title}
        description={dict.verify.description}
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: dict.verify.cards.accounts.title,
            body: dict.verify.cards.accounts.body,
          },
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: dict.verify.cards.clients.title,
            body: dict.verify.cards.clients.body,
          },
        ]}
        closingStatement={dict.verify.closing}
      />

      {/* Block 5 — Track record */}
      <CardsThree
        title={dict.trackRecord.title}
        description={dict.trackRecord.description}
        variant="muted"
        cards={[
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: dict.trackRecord.cards.incidents.title,
            body: dict.trackRecord.cards.incidents.body,
          },
          {
            icon: <Activity className="size-16 text-[#f9363c]" />,
            title: dict.trackRecord.cards.aum.title,
            body: dict.trackRecord.cards.aum.body,
          },
          {
            icon: <FileText className="size-16 text-[#f9363c]" />,
            title: dict.trackRecord.cards.reports.title,
            body: dict.trackRecord.cards.reports.body,
          },
        ]}
      />

      {/* Block 6 — On the record */}
      <CardsGrid
        title={dict.onTheRecord.title}
        description={dict.onTheRecord.description}
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <FileText className="size-16 text-[#f9363c]" />,
            title: dict.onTheRecord.cards.blockworks.title,
            body: dict.onTheRecord.cards.blockworks.body,
          },
          {
            icon: <Landmark className="size-16 text-[#f9363c]" />,
            title: dict.onTheRecord.cards.metadao.title,
            body: dict.onTheRecord.cards.metadao.body,
          },
        ]}
        closingStatement={
          <span className="block text-[16px] leading-[1.4] tracking-[-0.02em] text-black/40 lg:text-[20px] lg:tracking-[-0.4px]">
            {dict.onTheRecord.closing}
          </span>
        }
      />

      <LandingFaq
        heading={common.faq.heading}
        items={common.faq.items}
        locale={locale}
      />
      <LandingFooter copy={common.footer} locale={locale} />
    </main>
  );
}
