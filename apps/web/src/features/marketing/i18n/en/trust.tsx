import Link from "next/link";

import { TRUST_LINK_CLASS } from "../../pages/trust-page";
import type { BreadcrumbCopy, PageMeta } from "../types";

export const enTrust = {
  meta: {
    title: "Trust and Security | Loyal",
    description:
      "Loyal is non-custodial by architecture. Your account is a Squads smart account, your yield comes from Kamino, and your funds keep working whether or not Loyal does.",
    ogImageAlt: "Loyal trust and security",
  } satisfies PageMeta,
  breadcrumb: { home: "Home", page: "Trust" } satisfies BreadcrumbCopy,
  hero: {
    title: "Your funds don't depend on Loyal",
    body: "Your keys stay yours. Your account is a Squads smart account and your yield comes from Kamino, the same infrastructure that secures billions on Solana. Everything keeps working whether or not we do.",
    cta: "Open the wallet",
    imageAlt: "Loyal browser extension wallet showing an account balance",
  },
  secures: {
    title: "What secures your funds",
    description: (
      <>
        Most of what stands between you and your money is infrastructure that
        already secures billions on Solana. For what can still go wrong, see{" "}
        <Link className={TRUST_LINK_CLASS} href="/risks">
          Earn risks
        </Link>
        .
      </>
    ),
    cards: {
      squads: {
        title: "Squads",
        body: "Your account runs on the Squads Smart Account program. Open source, audited by OtterSec, and the most widely used smart account standard on Solana.",
      },
      kamino: {
        title: "Kamino",
        body: "Yield comes from Kamino lending vaults, the same infrastructure Phantom and Anchorage route to.",
      },
      nonCustodial: {
        title: "Non-custodial",
        body: "Loyal never holds your private keys and has no signing authority over your account.",
      },
      policy: {
        title: "Policy on-chain",
        body: "Spending caps, token allowlists and approved programs are enforced by the Squads program, not by our servers.",
      },
    },
  },
  noLockIn: {
    title: "No lock-in",
    body: (
      <>
        Your smart account lives on the Squads program. It doesn&apos;t depend on our
        frontend, our API, or our permission. Any Solana client can reach it,
        including the CLI on your own machine.
      </>
    ),
    cta: "What happens if Loyal disappears",
    ctaHref: "https://docs.askloyal.com/faq",
    imageAlt:
      "Loyal SDK quick-start, showing the client libraries that talk to the on-chain programs",
  },
  verify: {
    title: "Verify it yourself",
    description: (
      <>
        Everything Loyal writes is open source under AGPL-3.0: the wallet, the
        extension, the SDKs and the automation. Read the code, build it
        yourself, or fork the whole thing. State lives on-chain, so a fork stays
        compatible with everything else.
      </>
    ),
    cards: {
      accounts: {
        title: "Smart accounts",
        body: "Live on Solana mainnet, on the audited Squads Smart Account program.",
      },
      clients: {
        title: "Open-source clients",
        body: "The wallet, the extension, and the SDKs are all public repositories you can build and run yourself.",
      },
    },
    closing: (
      <>
        Read every line at{" "}
        <Link className={TRUST_LINK_CLASS} href="https://github.com/loyal-labs">
          github.com/loyal-labs
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
              className={TRUST_LINK_CLASS}
              href="https://stats.askloyal.com"
            >
              stats.askloyal.com
            </Link>
            .
          </>
        ),
      },
      reports: {
        title: "Quarterly transparency reports",
        body: (
          <>
            Published every quarter since Q4 2025, with treasury addresses and
            balances.{" "}
            <Link
              className={TRUST_LINK_CLASS}
              href="https://docs.askloyal.com/transparency/q2-2026"
            >
              Read the latest
            </Link>
            .
          </>
        ),
      },
    },
  },
  onTheRecord: {
    title: "On the record",
    description:
      "Loyal discloses more than it has to, in places where the disclosure is checkable by someone other than us.",
    cards: {
      blockworks: {
        title: "Blockworks B2 disclosure",
        body: (
          <>
            One of 35 protocols with a complete B2 transparency disclosure,
            alongside Jupiter, dYdX and Morpho. Filed and current for H1 2026.{" "}
            <Link
              className={TRUST_LINK_CLASS}
              href="https://blockworks.com/token-transparency/filing/loyal/loyal-2026-h1-b2-v1.0"
            >
              Read the filing
            </Link>
            .
          </>
        ),
      },
      metadao: {
        title: "MetaDAO",
        body: (
          <>
            The October 2025 ICO drew $75.9M in commitments against a $500K
            target, 151x oversubscribed. The treasury is governed by futarchy,
            not a founder wallet.{" "}
            <Link
              className={TRUST_LINK_CLASS}
              href="https://www.metadao.fi/projects/loyal/fundraise"
            >
              See the raise
            </Link>
            .
          </>
        ),
      },
    },
    closing: "Also featured by Solana Mobile and backed by Superteam.",
  },
};

export type TrustDict = typeof enTrust;
