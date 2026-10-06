import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  CircleCheck,
  FileText,
  ShieldCheck,
  Telescope,
} from "lucide-react";

import { LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { LandingHeader } from "@/components/landing-header";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";
import { CardsGrid } from "@/features/marketing/blocks/cards-grid";
import { CardsThree } from "@/features/marketing/blocks/cards-three";
import { Hero } from "@/features/marketing/blocks/hero";
import type { CommonDict } from "@/features/marketing/i18n/en/common";
import type { RisksDict } from "@/features/marketing/i18n/en/risks";
import type { Locale } from "@/features/marketing/i18n/locale";
import { buildBreadcrumbJsonLd } from "@/features/marketing/i18n/metadata";

export const RISKS_OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
};

export const RISKS_LINK_CLASS =
  "underline underline-offset-4 transition-colors hover:text-[#f9363c]";

export function RisksPage({
  locale,
  dict,
  common,
}: {
  locale: Locale;
  dict: RisksDict;
  common: CommonDict;
}) {
  const breadcrumbJsonLd = buildBreadcrumbJsonLd({
    locale,
    path: "/risks",
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
        locale={locale}
      />

      {/* Hero is light, so the notice sits directly under the header on white */}
      {dict.legalNotice ? (
        <p className="mx-auto w-full max-w-[1560px] px-4 pt-6 text-[16px] leading-[1.3] text-black/60 lg:px-6">
          {dict.legalNotice}
        </p>
      ) : null}

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

      {/* Block 2 — What the automation can and can't do */}
      <CardsGrid
        title={dict.automation.title}
        description={dict.automation.description}
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <ArrowUpFromLine className="size-16 text-[#f9363c]" />,
            title: dict.automation.cards.withdraw.title,
            body: dict.automation.cards.withdraw.body,
          },
          {
            icon: <ArrowDownToLine className="size-16 text-[#f9363c]" />,
            title: dict.automation.cards.deposit.title,
            body: dict.automation.cards.deposit.body,
          },
          {
            icon: <Ban className="size-16 text-[#f9363c]" />,
            title: dict.automation.cards.blocked.title,
            body: dict.automation.cards.blocked.body,
          },
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: dict.automation.cards.keys.title,
            body: dict.automation.cards.keys.body,
          },
        ]}
      />

      {/* Block 3 — Where the risk sits (table) */}
      <RiskTable
        title={dict.riskTable.title}
        description={dict.riskTable.description}
        headers={dict.table.risk}
        rows={dict.riskRows}
      />

      {/* Block 4 — Comparison (table) */}
      <CompareTable
        title={dict.compareTable.title}
        description={dict.compareTable.description}
        headers={dict.table.compare}
        rows={dict.compareRows}
      />

      {/* Block 5 — Markets */}
      <CardsGrid
        title={dict.markets.title}
        description={dict.markets.description}
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: dict.markets.cards.whitelisted.title,
            body: dict.markets.cards.whitelisted.body,
          },
          {
            icon: <Telescope className="size-16 text-[#f9363c]" />,
            title: dict.markets.cards.noQuiet.title,
            body: dict.markets.cards.noQuiet.body,
          },
        ]}
        closingStatement={dict.markets.closing}
      />

      {/* Block 6 — Track record */}
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
            title: dict.trackRecord.cards.audits.title,
            body: dict.trackRecord.cards.audits.body,
          },
        ]}
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
        path="/risks"
      />
    </main>
  );
}

function TableSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex w-full justify-center bg-white">
      <div className="flex w-full max-w-[1560px] flex-col px-6 py-20 lg:py-[128px]">
        <div className="grid grid-cols-1 gap-5 pb-12 md:grid-cols-2 md:items-start md:gap-x-6 md:pb-16">
          <h2 className="text-[40px] font-semibold leading-none tracking-[-0.02em] text-black md:max-w-[600px] md:text-[56px] md:leading-[0.95] md:tracking-[-1.12px] lg:text-[64px] lg:leading-[64px] lg:tracking-[-1.28px]">
            {title}
          </h2>
          <p className="text-[20px] leading-[1.2] tracking-[-0.02em] text-black md:max-w-[700px] md:pr-10 md:text-[24px] md:tracking-[-0.48px] lg:text-[32px] lg:tracking-[-0.64px]">
            {description}
          </p>
        </div>
        <div className="overflow-x-auto rounded-[24px] bg-[#f5f5f5]">
          {children}
        </div>
      </div>
    </section>
  );
}

const TH_CLASS =
  "px-6 py-5 text-left text-[16px] font-semibold leading-[1.2] text-black lg:text-[20px]";
const TD_CLASS =
  "px-6 py-5 align-top text-[16px] leading-[1.3] text-black/60 lg:text-[18px]";

function RiskTable({
  title,
  description,
  headers,
  rows,
}: {
  title: string;
  description: string;
  headers: RisksDict["table"]["risk"];
  rows: RisksDict["riskRows"];
}) {
  return (
    <TableSection description={description} title={title}>
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="border-b border-black/10">
            <th className={TH_CLASS} scope="col">
              {headers.layer}
            </th>
            <th className={TH_CLASS} scope="col">
              {headers.failure}
            </th>
            <th className={TH_CLASS} scope="col">
              {headers.containment}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className="border-b border-black/10 last:border-0"
              key={row.layer}
            >
              <th
                className={`${TD_CLASS} text-left font-semibold text-black`}
                scope="row"
              >
                {row.layer}
              </th>
              <td className={TD_CLASS}>{row.failure}</td>
              <td className={TD_CLASS}>{row.containment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableSection>
  );
}

function CompareTable({
  title,
  description,
  headers,
  rows,
}: {
  title: string;
  description: string;
  headers: RisksDict["table"]["compare"];
  rows: RisksDict["compareRows"];
}) {
  return (
    <TableSection description={description} title={title}>
      <table className="w-full min-w-[880px] border-collapse">
        <thead>
          <tr className="border-b border-black/10">
            <th className={TH_CLASS} scope="col">
              <span className="sr-only">{headers.property}</span>
            </th>
            <th className={TH_CLASS} scope="col">
              {headers.loyal}
            </th>
            <th className={TH_CLASS} scope="col">
              {headers.kamino}
            </th>
            <th className={TH_CLASS} scope="col">
              {headers.aave}
            </th>
            <th className={TH_CLASS} scope="col">
              {headers.exchange}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className="border-b border-black/10 last:border-0"
              key={row.label}
            >
              <th
                className={`${TD_CLASS} text-left font-semibold text-black`}
                scope="row"
              >
                {row.label}
              </th>
              <td className={`${TD_CLASS} text-black`}>{row.loyal}</td>
              <td className={TD_CLASS}>{row.kamino}</td>
              <td className={TD_CLASS}>{row.aave}</td>
              <td className={TD_CLASS}>{row.exchange}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableSection>
  );
}
