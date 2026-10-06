import Link from "next/link";

import { RISKS_LINK_CLASS } from "../../pages/risks-page";
import type {
  BreadcrumbCopy,
  CompareRow,
  FaqItem,
  PageMeta,
  RiskRow,
} from "../types";

export const enRisks = {
  meta: {
    title: "Loyal Earn Risks | Loyal",
    description:
      "Every way a Loyal Earn deposit can lose money, what the automation is allowed to do, and what it can't. Earn lends your stablecoins on Kamino from your own Squads smart account.",
    ogImageAlt: "Loyal Earn risks",
  } satisfies PageMeta,
  breadcrumb: { home: "Home", page: "Risks" } satisfies BreadcrumbCopy,
  // Empty in English. Translations may set a notice rendered above the page body.
  legalNotice: "",
  hero: {
    title: "Loyal Earn risks, in plain terms",
    body: "Earn lends your stablecoins on Kamino from your own Squads smart account. This page lists every way that can lose money, what the automation is allowed to do, and what it can't.",
    cta: "Open the wallet",
    imageAlt: "Loyal browser extension wallet showing an account balance",
  },
  automation: {
    title: "What the automation can do",
    description:
      "The Squads program checks every transaction against your policy and rejects anything outside it. Earn's policy allows two instructions.",
    cards: {
      withdraw: {
        title: "Withdraw from a whitelisted Kamino reserve",
        body: "Only from the five approved Kamino markets, only in the stablecoin you deposited, and only back into your own smart account.",
      },
      deposit: {
        title: "Deposit into a whitelisted Kamino reserve",
        body: "Plain supply, with your smart account as the owner. The policy doesn't allow borrowing, so there's no leverage and nothing to liquidate.",
      },
      blocked: {
        title: "Everything else is blocked",
        body: "It can't send funds to another address, swap into other tokens, borrow, touch any other program, or rewrite its own policy.",
      },
      keys: {
        title: "Your keys never leave you",
        body: "Loyal never holds your private keys. Only your key can withdraw your balance to another wallet.",
      },
    },
  },
  riskTable: {
    title: "Where the risk sits",
    description:
      "Every layer your deposit touches, what could go wrong there, and how far it can reach.",
  },
  compareTable: {
    title: "Compared with the alternatives",
    description:
      "Earn has the same lending risk as supplying to Kamino directly. The differences are custody, rate and track record.",
  },
  table: {
    risk: {
      layer: "Layer",
      failure: "What could go wrong",
      containment: "How far it reaches",
    },
    compare: {
      property: "Property",
      loyal: "Loyal Earn",
      kamino: "Kamino directly",
      aave: "Aave, supply only",
      exchange: "Exchange earn product",
    },
  },
  markets: {
    title: "The five markets Earn uses",
    description:
      "Kamino markets are isolated. A lender in one market is exposed to the collateral accepted in that market and nothing else.",
    cards: {
      whitelisted: {
        title: "Whitelisted markets",
        body: "Kamino Main, Figure, Maple, OnRe and Ethena. Market parameters, collateral and utilization are public on Kamino.",
      },
      noQuiet: {
        title: "Nothing riskier gets added quietly",
        body: "The whitelist lives in your on-chain policy. Adding a market means a new policy, which you'd have to approve.",
      },
    },
    closing: (
      <>
        Check the markets yourself on{" "}
        <Link className={RISKS_LINK_CLASS} href="https://kamino.finance">
          kamino.finance
        </Link>
        .
      </>
    ),
  },
  trackRecord: {
    title: "Track record",
    description:
      "Numbers you can check rather than claims you have to take on faith.",
    cards: {
      incidents: {
        title: "Zero incidents",
        body: "No loss of user funds since launch in October 2025.",
      },
      aum: {
        title: "Live assets under management",
        body: (
          <>
            Updated in real time at{" "}
            <Link
              className={RISKS_LINK_CLASS}
              href="https://stats.askloyal.com"
            >
              stats.askloyal.com
            </Link>
            .
          </>
        ),
      },
      audits: {
        title: "Audits",
        body: (
          <>
            Earn has no contract of its own to audit. Squads Smart Account and
            Kamino K-Lend, which hold and lend your funds, were each assessed by
            OtterSec.{" "}
            <Link
              className={RISKS_LINK_CLASS}
              href="https://docs.askloyal.com/trust/audits-and-deployments"
            >
              See the reports
            </Link>
            .
          </>
        ),
      },
    },
  },
  // Every layer a Loyal Earn deposit touches, in the order money flows through
  // them. Keep this in sync with the Earn policy in packages/loyal-actions.
  riskRows: [
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
  ] satisfies RiskRow[],
  compareRows: [
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
  ] satisfies CompareRow[],
  faqs: [
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
  ] satisfies FaqItem[],
};

export type RisksDict = typeof enRisks;
