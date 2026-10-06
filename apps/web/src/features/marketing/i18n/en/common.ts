import type {
  MarketingPageCopy,
  MarketingPageSlug,
} from "@/features/marketing/registry";

import type { FaqItem } from "../types";

export const enCommon = {
  header: {
    homeAriaLabel: "Loyal home",
    mainNavAriaLabel: "Main navigation",
    mobileNavAriaLabel: "Mobile navigation",
    openMenuAriaLabel: "Open menu",
    closeMenuAriaLabel: "Close menu",
    nav: {
      features: "Features",
      developers: "Developers",
      blog: "Blog",
      links: "Links",
    },
    features: {
      earn: { title: "Earn", description: "Best Stablecoin Yield on Solana" },
      agents: { title: "Agents", description: "Smart Accounts for AI Agents" },
    } satisfies Record<MarketingPageSlug, MarketingPageCopy>,
    noPages: "No marketing pages yet.",
    startEarning: "Start earning",
    openApp: "Open app",
  },
  languageSwitch: { ariaLabel: "Language" },
  footer: {
    homeAriaLabel: "Loyal home",
    columns: {
      documentation: { title: "Documentation", smartAccounts: "Smart Accounts" },
      legal: {
        title: "Legal",
        privacyPolicy: "Privacy Policy",
        trust: "Trust & Security",
        risks: "Risks",
        transparency: "Transparency",
      },
      contact: { title: "Contact" },
    },
    rateFootnote:
      "Based on rates available through supported protocols at the time of allocation. Rates are variable and not guaranteed.",
    copyright: "© 2026 Loyal. All rights reserved.",
    statusBadgeTitle: "Loyal status badge",
    wordmarkAlt: "Loyal",
  },
  faq: {
    heading: ["Questions?", "Answers."] as [string, string],
    items: [
      {
        question: "What is Loyal?",
        answer:
          "Loyal is a self-custody Solana wallet that puts your money to work. Idle stablecoins earn the best available lending rate automatically, and every wallet is a Smart Account with policies and spending caps, so apps and agents can never move funds you didn't approve.",
      },
      {
        question: "How do autodeposits work?",
        answer:
          "Deposit dollars and set how much goes to earning. Loyal routes that allocation to whichever reputable lending reserve currently pays the most and re-routes as rates move. The automation runs through an on-chain policy on your own smart account, so it never takes custody, and you can withdraw any time.",
      },
      {
        question: "Is Loyal safe? What are the risks?",
        answer:
          "Loyal Earn carries the risk of supplying stablecoins to Kamino: a reserve bug, bad debt, or the stablecoin losing its peg. Your funds stay in your own Squads smart account, and an on-chain policy lets the automation only withdraw from and deposit into whitelisted Kamino reserves, so the worst it can do is pick a lower rate. No user funds lost since October 2025. The full breakdown is at askloyal.com/risks.",
      },
      {
        question: "Does Loyal have its own smart contract?",
        answer:
          "Not in Loyal Earn today. Earn runs on the Squads Smart Account program and Kamino K-Lend, both audited by OtterSec. Loyal's own code is the off-chain automation and the apps, which are open source and bounded by the on-chain policy.",
      },
      {
        question: "Has Loyal been audited?",
        answer:
          "Loyal Earn has no audit of its own because it has no smart contract of its own to audit. A security audit reviews on-chain program code, and Earn deploys none. Your funds sit in the Squads Smart Account program and earn in Kamino K-Lend, both audited by OtterSec. What Loyal adds is a policy: configuration stored in your Squads account and enforced by the audited Squads program, listing the two instructions the automation may call (deposit and withdraw) and the Kamino reserves it may call them on. Anyone can read it on-chain. Loyal's off-chain automation is open source and hasn't been audited, but it can only submit transactions the policy allows, so a bug in it can't move funds out of your account.",
      },
      {
        question: "How can I use Loyal?",
        answer:
          "Start with the browser extension, web app, or mobile app, create a wallet, turn on earning, and approve only the permissions each app or agent needs.",
      },
      {
        question: "Can I create more than one wallet?",
        answer:
          "Yes. You can keep multiple wallets under one smart account and separate balances, apps, agents, and permissions by workflow.",
      },
      {
        question: "How can I connect my Loyal wallet with other apps?",
        answer:
          "Connect through the Loyal extension or supported wallet flows, then set the exact signing, spending, and execution permissions for that app.",
      },
      {
        question: "What are Smart Accounts?",
        answer:
          "Smart Accounts are programmable wallets that can enforce rules before a transaction is signed or executed, such as limits, allowed destinations, and agent permissions.",
      },
      {
        question: "Can I import my existing wallet into Loyal?",
        answer:
          "You will be able to bring existing wallets into Loyal flows while keeping clear separation between imported keys and delegated smart-account permissions.",
      },
      {
        question: "Can I use Loyal across devices and platforms?",
        answer:
          "Yes. Loyal runs in your browser, on the web, and on mobile, so the same account model follows you across devices.",
      },
    ] satisfies FaqItem[],
  },
};

export type CommonDict = typeof enCommon;
