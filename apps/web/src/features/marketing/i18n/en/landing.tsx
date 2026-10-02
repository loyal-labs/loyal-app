import type { PageMeta } from "../types";

export const enLanding = {
  meta: {
    title: "Loyal: Solana Wallet That Earns Yield Automatically",
    description:
      "Self-custody Solana wallet that routes your stablecoins to the best available yield automatically. Agent guardrails, private transfers, open-source.",
    ogImageAlt:
      "Loyal: Solana wallet that earns stablecoin yield automatically",
  } satisfies PageMeta,
  hero: {
    headline: "Make your idle cash smarter",
    subtitle: (
      <>
        Connect your wallet once and earn the best available rate on your cash
        on Solana
        <sup className="text-[0.65em]">
          <a
            aria-label="Rate disclaimer"
            className="no-underline"
            href="#rate-footnote"
          >
            1
          </a>
        </sup>{" "}
        automatically
      </>
    ),
    startEarning: "Start earning",
    openWebApp: "Open web app",
    downloadLoyal: "Download Loyal",
    phoneAlt:
      "Loyal Earn screen showing 9.48% APY, autodeposit on, and $822.66 earned",
    animationAriaLabel:
      "Loyal app animation: connect a wallet, watch the balance grow, and set up autodeposit",
    moreInfo: "More info",
    // {label} is the stat label.
    loadingTemplate: "Loading {label}",
    statsAriaLabel: "Loyal Stats",
    stats: {
      aum: {
        label: "Earn AUM",
        tooltip:
          "Cumulative value deposited into our active Earn routing policies.",
      },
      volume: {
        label: "Optimization Volume",
        tooltip:
          "Total USDC reallocated by confirmed Earn optimizations. This measures routing throughput across reserves, so the same deposited dollar can add to volume again when it is moved by a later optimization.",
      },
      users: {
        label: "Total Users",
      },
    },
  },
  supportedBy: {
    title: "Supported by",
  },
  features: {
    automation: {
      alt: "Three steps: connect your wallet, set up Autodeposit, earn the best APY",
      text: "Discover powerful onchain automation without giving up ownership",
    },
    earn: {
      alt: "Loyal Earn screen on a phone showing $192 earned and a rising yield chart",
      text: "Always get the best low-risk Solana APY on your idle funds with Loyal automations",
    },
    actions: {
      alt: "Send, Receive, and Earn pills with a Privately toggle switched on",
      text: "Connect any wallet, enjoy one seamless experience",
    },
  },
  wallets: {
    title: "Multiple wallets, one smart account",
    startEarning: "Start earning",
    howItWorks: "How it works",
  },
  developers: {
    technology: {
      title: "Explore Solana’s latest technology behind Loyal",
      cta: "How it works",
    },
    builders: {
      title: "For Builders",
      cta: "Explore SDK",
    },
  },
  trust: {
    title: "Your funds are secured by Squads",
    standard:
      "The smart account standard on Solana, trusted by 450+ teams to secure over $15 billion. Loyal never holds your keys.",
    automation:
      "Earn's automation can only withdraw from and deposit into whitelisted Kamino reserves inside your own account. The worst it can do is pick a lower rate. No user funds lost since October 2025.",
    securedCta: "How your funds are secured",
    risksCta: "Earn risks",
  },
  blog: {
    title: "Latest from our team",
  },
  getStarted: {
    title: "Get started",
    platformAriaLabel: "Get started platform",
    segments: {
      Web: "Web",
      Mobile: "Mobile",
      Extension: "Extension",
    },
    previews: {
      Web: { alt: "Loyal web app wallet preview" },
      Mobile: { alt: "Loyal mobile app wallet preview" },
      Extension: { alt: "Loyal browser extension wallet preview" },
    },
    openWebApp: "Open web app",
    comingSoon: "Coming soon",
    seekerQrAriaLabel: "Seeker dApp Store QR code",
    showSeekerQrAriaLabel: "Show Seeker dApp Store QR code",
    seekerQrTitle: "Loyal Seeker dApp Store listing QR code",
    seekerOnly: "Only available on Seeker",
  },
};

export type LandingDict = typeof enLanding;
