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
import type { AgentsDict } from "@/features/marketing/i18n/en/agents";
import type { CommonDict } from "@/features/marketing/i18n/en/common";
import type { Locale } from "@/features/marketing/i18n/locale";
import { buildBreadcrumbJsonLd } from "@/features/marketing/i18n/metadata";

export const AGENTS_OG_IMAGE = {
  url: "/marketing/agents/og-agents.13a73749.png",
  width: 1200,
  height: 630,
};

export function AgentsPage({
  locale,
  dict,
  common,
}: {
  locale: Locale;
  dict: AgentsDict;
  common: CommonDict;
}) {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd({
    locale,
    path: "/agents",
    copy: dict.breadcrumb,
  });

  return (
    <main className="min-h-screen overflow-x-clip bg-white text-black">
      {/* JSON-LD as script children (XSS-safe; React escapes <>&) — schema has no such chars */}
      <script type="application/ld+json">
        {JSON.stringify(breadcrumbJsonLd)}
      </script>

      <LandingScrollAnimations />
      <LandingHeader
        copy={common.header}
        languageSwitchLabel={common.languageSwitch.ariaLabel}
        locale={locale}
        path="/agents"
      />

      {/* Block 1 — Hero (dark) */}
      <Hero
        tone="dark"
        title={dict.hero.title}
        body={dict.hero.body}
        cta={{ label: dict.hero.cta, href: "https://app.askloyal.com" }}
        image={{
          src: "/marketing/agents/hero-permission-ladder.e365a2e4.png",
          alt: dict.hero.imageAlt,
        }}
      />

      {/* Block 2 — Section (why we built this) */}
      <Section
        title={dict.whyWeBuilt.title}
        cards={[
          { size: "lg", body: dict.whyWeBuilt.cards.problem },
          { size: "lg", body: dict.whyWeBuilt.cards.solution },
        ]}
      />

      {/* Block 3 — Section (what an agent wallet on Loyal is) */}
      <Section
        title={dict.whatItIs.title}
        cards={[
          { size: "lg", body: dict.whatItIs.cards.smartAccount },
          { size: "lg", body: dict.whatItIs.cards.identity },
        ]}
      />

      {/* Block 4 — Section-5 (three bold permission-tier cards) */}
      <CardsThree
        title={dict.tiers.title}
        description={dict.tiers.description}
        variant="bold"
        cards={[
          {
            icon: (
              <CircleDashed className="size-16 text-[#f9363c]" strokeWidth={1.5} />
            ),
            title: dict.tiers.cards.suggest.title,
            body: dict.tiers.cards.suggest.body,
          },
          {
            icon: <Dot className="size-16 text-[#f9363c]" strokeWidth={3} />,
            title: dict.tiers.cards.sign.title,
            body: dict.tiers.cards.sign.body,
          },
          {
            icon: <Crosshair className="size-16 text-white" />,
            title: dict.tiers.cards.execute.title,
            body: dict.tiers.cards.execute.body,
          },
        ]}
      />

      {/* Block 5 — Section-7 (two muted cards: spending limits + allowlists) */}
      <CardsTwo
        title={dict.limits.title}
        description={dict.limits.description}
        variant="muted"
        cards={[
          {
            icon: <Banknote className="size-16 text-[#f9363c]" />,
            title: dict.limits.cards.cap.title,
            body: dict.limits.cards.cap.body,
          },
          {
            icon: <ListChecks className="size-16 text-[#f9363c]" />,
            title: dict.limits.cards.allowlist.title,
            body: dict.limits.cards.allowlist.body,
          },
        ]}
      />

      {/* Block 6 — Section-14 (muted grid: what you can build) */}
      <CardsGrid
        title={dict.build.title}
        description={dict.build.description}
        variant="muted"
        cards={[
          {
            icon: <Wallet className="size-16 text-[#f9363c]" />,
            title: dict.build.cards.subscription.title,
            body: dict.build.cards.subscription.body,
          },
          {
            icon: <TrendingUp className="size-16 text-[#f9363c]" />,
            title: dict.build.cards.trading.title,
            body: dict.build.cards.trading.body,
          },
          {
            icon: <Sparkles className="size-16 text-[#f9363c]" />,
            title: dict.build.cards.social.title,
            body: dict.build.cards.social.body,
          },
          {
            icon: <Cpu className="size-16 text-[#f9363c]" />,
            title: dict.build.cards.mcp.title,
            body: dict.build.cards.mcp.body,
          },
          {
            icon: <BotMessageSquare className="size-16 text-[#f9363c]" />,
            title: dict.build.cards.treasury.title,
            body: dict.build.cards.treasury.body,
          },
          {
            icon: <ShoppingBag className="size-16 text-[#f9363c]" />,
            title: dict.build.cards.commerce.title,
            body: dict.build.cards.commerce.body,
          },
        ]}
      />

      {/* Block 7 — Section-16 (muted 2-col grid + closing: security model) */}
      <CardsGrid
        title={dict.security.title}
        description={dict.security.description}
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: dict.security.cards.onChain.title,
            body: dict.security.cards.onChain.body,
          },
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: dict.security.cards.squads.title,
            body: dict.security.cards.squads.body,
          },
          {
            icon: <KeyRound className="size-16 text-[#f9363c]" />,
            title: dict.security.cards.selfCustodial.title,
            body: dict.security.cards.selfCustodial.body,
          },
          {
            icon: <RotateCcw className="size-16 text-[#f9363c]" />,
            title: dict.security.cards.revocable.title,
            body: dict.security.cards.revocable.body,
          },
          {
            icon: <Eye className="size-16 text-[#f9363c]" />,
            title: dict.security.cards.noHiddenExecution.title,
            body: dict.security.cards.noHiddenExecution.body,
          },
        ]}
        closingStatement={dict.security.closingStatement}
      />

      {/* Block 9 — Section-19 (image-left feature row: get started) */}
      <TextImageHero
        layout="text-right"
        title={dict.getStarted.title}
        body={dict.getStarted.body}
        cta={{ label: dict.getStarted.cta, href: "https://app.askloyal.com" }}
        image={{
          src: "/landing/figma/get-started-extension-wallet.png",
          alt: dict.getStarted.imageAlt,
        }}
      />

      <LandingFaq
        heading={common.faq.heading}
        items={dict.faqs}
        locale={locale}
      />
      <LandingFooter
        copy={common.footer}
        languageSwitchLabel={common.languageSwitch.ariaLabel}
        locale={locale}
        path="/agents"
      />
    </main>
  );
}
