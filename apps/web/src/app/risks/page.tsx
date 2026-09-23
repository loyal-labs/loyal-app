import type { Metadata } from "next";
import Link from "next/link";

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

import { type FaqItem, LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { LandingHeader } from "@/components/landing-header";
import { LandingScrollAnimations } from "@/components/landing-scroll-animations";
import { CardsGrid } from "@/features/marketing/blocks/cards-grid";
import { CardsThree } from "@/features/marketing/blocks/cards-three";
import { Hero } from "@/features/marketing/blocks/hero";

const PAGE_TITLE = "Loyal Earn Risks | Loyal";
const PAGE_DESCRIPTION =
  "Every way a Loyal Earn deposit can lose money, what the automation is allowed to do, and what it can't. Earn lends your stablecoins on Kamino from your own Squads smart account.";
const OG_IMAGE = "/og-image.png";

const LINK_CLASS =
  "underline underline-offset-4 transition-colors hover:text-[#f9363c]";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/risks" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/risks",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [
      { url: OG_IMAGE, width: 1200, height: 630, alt: "Loyal Earn risks" },
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
      name: "Risks",
      item: "https://askloyal.com/risks",
    },
  ],
};

type RiskRow = {
  layer: string;
  failure: string;
  containment: string;
};

// Every layer a Loyal Earn deposit touches, in the order money flows through
// them. Keep this in sync with the Earn policy in packages/loyal-actions.
const RISK_ROWS: RiskRow[] = [
  {
    layer: "Kamino lending reserves",
    failure:
      "A smart-contract bug, or bad debt if a borrower's collateral in that market fails and liquidation doesn't cover the loan. When a reserve is fully borrowed, withdrawals wait until liquidity returns.",
    containment:
      "Earn only uses five isolated Kamino markets. A problem in one market doesn't reach deposits in another. Same exposure as supplying to Kamino yourself.",
  },
  {
    layer: "The stablecoin you deposit",
    failure: "The coin loses its peg, or the issuer freezes it.",
    containment:
      "Earn keeps your allocation in the stablecoin you deposited. It doesn't swap you into other dollars.",
  },
  {
    layer: "Squads Smart Account program",
    failure:
      "A bug in the program that holds your account and enforces the policy.",
    containment:
      "Audited by OtterSec and used across Solana. Loyal doesn't modify it.",
  },
  {
    layer: "Loyal's automation",
    failure:
      "It picks a lower-paying reserve, or stops rebalancing if Loyal's servers go down.",
    containment:
      "The worst case is a lower rate. The on-chain policy only lets it withdraw from and deposit into whitelisted Kamino reserves, with your account as the owner on both sides.",
  },
  {
    layer: "Loyal the company",
    failure: "Loyal shuts down.",
    containment:
      "Your funds stay in your smart account. Any Solana client, including the CLI, can withdraw them.",
  },
];

type CompareRow = {
  label: string;
  loyal: string;
  kamino: string;
  aave: string;
  exchange: string;
};

const COMPARE_ROWS: CompareRow[] = [
  {
    label: "Who holds the funds",
    loyal: "You, in your own smart account",
    kamino: "You",
    aave: "You",
    exchange: "The exchange",
  },
  {
    label: "Lending-contract risk",
    loyal: "Kamino",
    kamino: "Kamino",
    aave: "Aave",
    exchange: "Whatever the exchange uses, undisclosed",
  },
  {
    label: "Leverage or liquidation",
    loyal: "None, supply only",
    kamino: "None if you only supply",
    aave: "None if you don't borrow",
    exchange: "Depends on product",
  },
  {
    label: "Extra layer on top",
    loyal: "Automation bounded by an on-chain policy",
    kamino: "None",
    aave: "None",
    exchange: "Exchange solvency and withdrawal limits",
  },
  {
    label: "Rate",
    loyal: "Best whitelisted reserve, rebalanced automatically",
    kamino: "The one reserve you picked",
    aave: "The one market you picked",
    exchange: "Set by the exchange",
  },
  {
    label: "Live since",
    loyal: "October 2025",
    kamino: "2023",
    aave: "2020",
    exchange: "Varies",
  },
];

const pageFaqs: FaqItem[] = [
  {
    question: "Is Loyal Earn safe?",
    answer:
      "Loyal Earn carries the risk of supplying stablecoins to Kamino, plus a bounded automation layer. Your funds stay in your own Squads smart account, and an on-chain policy lets the automation do exactly two things: withdraw from and deposit into whitelisted Kamino reserves. The remaining risks are a Kamino reserve failing, the stablecoin losing its peg, and a Squads program bug. No user funds have been lost since launch in October 2025.",
  },
  {
    question: "Does Loyal have its own smart contract?",
    answer:
      "Not in Loyal Earn today. Earn runs on two externally audited programs: the Squads Smart Account program, which holds your account and enforces the policy, and Kamino K-Lend, which pays the yield. Loyal's own code is the off-chain automation and the apps, which are open source.",
  },
  {
    question: "What is the worst Loyal's automation can do?",
    answer:
      "Route your deposit to a lower-paying whitelisted reserve, or stop rebalancing if Loyal's servers go down. It can't send funds out of your smart account, borrow, trade into other tokens, or change its own policy, because the Squads program rejects any transaction outside the policy.",
  },
  {
    question: "Is Loyal Earn riskier than depositing into Kamino myself?",
    answer:
      "The lending risk is the same, because your stablecoins sit in the same Kamino reserves. Earn adds an automation layer that can only move funds between whitelisted reserves inside your own account. In exchange, you get the best-paying reserve without watching rates yourself.",
  },
  {
    question: "Can I always withdraw?",
    answer:
      "There's no lock-up, and you can withdraw any time. The one limit comes from Kamino: if a reserve is fully borrowed, withdrawals from it wait until borrowers repay or new deposits arrive. That applies to every lender in the reserve, not only Loyal users.",
  },
  {
    question: "Has Loyal been audited?",
    answer:
      "Loyal Earn has no audit of its own because it has no smart contract of its own to audit. A security audit reviews on-chain program code, and Earn deploys none. Your funds sit in the Squads Smart Account program and earn in Kamino K-Lend, both audited by OtterSec. What Loyal adds is a policy: configuration stored in your Squads account and enforced by the audited Squads program, listing the two instructions the automation may call (deposit and withdraw) and the Kamino reserves it may call them on. Anyone can read it on-chain. Loyal's off-chain automation is open source and hasn't been audited, but it can only submit transactions the policy allows, so a bug in it can't move funds out of your account.",
  },
  {
    question: "Does Loyal protect against a Kamino exploit?",
    answer:
      "Not automatically yet. Loyal Watchdog, in development with Webacy, will watch connected protocols for health drops and hack signals and pull funds back into your own account through a whitelisted policy. Until it ships, a Kamino exploit affects Earn deposits the same way it affects any Kamino lender.",
  },
];

export default function RisksPage() {
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
        title="Loyal Earn risks, in plain terms"
        body="Earn lends your stablecoins on Kamino from your own Squads smart account. This page lists every way that can lose money, what the automation is allowed to do, and what it can't."
        cta={{ label: "Open the wallet", href: "https://app.askloyal.com" }}
        image={{
          src: "/landing/figma/get-started-extension-wallet.png",
          alt: "Loyal browser extension wallet showing an account balance",
        }}
      />

      {/* Block 2 — What the automation can and can't do */}
      <CardsGrid
        title="What the automation can do"
        description="The Squads program checks every transaction against your policy and rejects anything outside it. Earn's policy allows two instructions."
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <ArrowUpFromLine className="size-16 text-[#f9363c]" />,
            title: "Withdraw from a whitelisted Kamino reserve",
            body: "Only from the five approved Kamino markets, only in the stablecoin you deposited, and only back into your own smart account.",
          },
          {
            icon: <ArrowDownToLine className="size-16 text-[#f9363c]" />,
            title: "Deposit into a whitelisted Kamino reserve",
            body: "Plain supply, with your smart account as the owner. The policy doesn't allow borrowing, so there's no leverage and nothing to liquidate.",
          },
          {
            icon: <Ban className="size-16 text-[#f9363c]" />,
            title: "Everything else is blocked",
            body: "It can't send funds to another address, swap into other tokens, borrow, touch any other program, or rewrite its own policy.",
          },
          {
            icon: <ShieldCheck className="size-16 text-[#f9363c]" />,
            title: "Your keys never leave you",
            body: "Loyal never holds your private keys. Only your key can withdraw your balance to another wallet.",
          },
        ]}
      />

      {/* Block 3 — Where the risk sits (table) */}
      <RiskTable
        title="Where the risk sits"
        description="Every layer your deposit touches, what could go wrong there, and how far it can reach."
      />

      {/* Block 4 — Comparison (table) */}
      <CompareTable
        title="Compared with the alternatives"
        description="Earn has the same lending risk as supplying to Kamino directly. The differences are custody, rate and track record."
      />

      {/* Block 5 — Markets */}
      <CardsGrid
        title="The five markets Earn uses"
        description="Kamino markets are isolated. A lender in one market is exposed to the collateral accepted in that market and nothing else."
        variant="muted"
        columns={2}
        cards={[
          {
            icon: <CircleCheck className="size-16 text-[#f9363c]" />,
            title: "Whitelisted markets",
            body: "Kamino Main, Figure, Maple, OnRe and Ethena. Market parameters, collateral and utilization are public on Kamino.",
          },
          {
            icon: <Telescope className="size-16 text-[#f9363c]" />,
            title: "Nothing riskier gets added quietly",
            body: "The whitelist lives in your on-chain policy. Adding a market means a new policy, which you'd have to approve.",
          },
        ]}
        closingStatement={
          <>
            Check the markets yourself on{" "}
            <Link className={LINK_CLASS} href="https://kamino.finance">
              kamino.finance
            </Link>
            .
          </>
        }
      />

      {/* Block 6 — Track record */}
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
            title: "Audits",
            body: (
              <>
                Earn has no contract of its own to audit. Squads Smart Account
                and Kamino K-Lend, which hold and lend your funds, were each
                assessed by OtterSec.{" "}
                <Link
                  className={LINK_CLASS}
                  href="https://docs.askloyal.com/trust/audits-and-deployments"
                >
                  See the reports
                </Link>
                .
              </>
            ),
          },
        ]}
      />

      <LandingFaq items={pageFaqs} />
      <LandingFooter />
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
}: {
  title: string;
  description: string;
}) {
  return (
    <TableSection description={description} title={title}>
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="border-b border-black/10">
            <th className={TH_CLASS} scope="col">
              Layer
            </th>
            <th className={TH_CLASS} scope="col">
              What could go wrong
            </th>
            <th className={TH_CLASS} scope="col">
              How far it reaches
            </th>
          </tr>
        </thead>
        <tbody>
          {RISK_ROWS.map((row) => (
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
}: {
  title: string;
  description: string;
}) {
  return (
    <TableSection description={description} title={title}>
      <table className="w-full min-w-[880px] border-collapse">
        <thead>
          <tr className="border-b border-black/10">
            <th className={TH_CLASS} scope="col">
              <span className="sr-only">Property</span>
            </th>
            <th className={TH_CLASS} scope="col">
              Loyal Earn
            </th>
            <th className={TH_CLASS} scope="col">
              Kamino directly
            </th>
            <th className={TH_CLASS} scope="col">
              Aave, supply only
            </th>
            <th className={TH_CLASS} scope="col">
              Exchange earn product
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((row) => (
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
