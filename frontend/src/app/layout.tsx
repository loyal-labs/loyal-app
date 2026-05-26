import "./globals.css";

import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";

import { XPixelBootstrap } from "@/components/analytics/x-pixel-bootstrap";
import { PublicEnvProvider } from "@/contexts/public-env-context";
import { createPublicEnv } from "@/lib/core/config/public";
import {
  resolveSolanaEnvOverride,
  SOLANA_ENV_OVERRIDE_COOKIE,
} from "@/lib/core/config/solana-env-override";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";

const geistSans = GeistSans;
const geistMono = GeistMono;

const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://askloyal.com/#organization",
      name: "Loyal",
      legalName: "Loyal DAO LLC",
      url: "https://askloyal.com",
      logo: "https://askloyal.com/android-chrome-512x512.png",
      description:
        "Self-custody Solana smart-account wallet with on-chain guardrails for AI agents: spending caps, token whitelists, and approved-protocol allowlists. Plus private payments and yield on shielded balances.",
      foundingDate: "2025",
      foundingLocation: {
        "@type": "Place",
        name: "Marshall Islands",
      },
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "main@askloyal.com",
        url: "https://discord.askloyal.com",
      },
      sameAs: [
        "https://www.wikidata.org/wiki/Q139927376",
        "https://x.com/loyal_hq",
        "https://github.com/loyal-labs",
        "https://discord.askloyal.com",
        "https://t.me/loyal_tgchat",
        "https://medium.com/@askloyal",
        "https://chromewebstore.google.com/detail/cdienfadefhlaknmedckgifkjdbioack",
        "https://app.askloyal.com",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://askloyal.com/#website",
      url: "https://askloyal.com",
      name: "Loyal",
      publisher: { "@id": "https://askloyal.com/#organization" },
      inLanguage: "en-US",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://askloyal.com/#app",
      name: "Loyal",
      url: "https://askloyal.com",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web, Chrome, Android",
      description:
        "Solana wallet with smart-account guardrails for AI agents, private transfers, and yield on shielded balances. Available on web, Chrome extension, Telegram mini app, Android (Google Play), and Solana Mobile (Seeker).",
      publisher: { "@id": "https://askloyal.com/#organization" },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

export const metadata: Metadata = {
  title: "Loyal: Solana Wallet with Agent Guardrails",
  description:
    "Solana wallet with smart-account guardrails for AI agents. Private transfers, yield on shielded USDC, fully open-source.",
  metadataBase: new URL("https://askloyal.com"),
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    url: "https://askloyal.com/",
    siteName: "Loyal",
    locale: "en_US",
    title: "Loyal: Solana Wallet with Agent Guardrails",
    description:
      "Solana wallet with smart-account guardrails for AI agents. Private transfers, yield on shielded USDC, fully open-source.",
    images: [
      {
        url: "https://askloyal.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "Loyal: Solana wallet with smart-account guardrails for AI agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Loyal: Solana Wallet with Agent Guardrails",
    description:
      "Solana wallet with smart-account guardrails for AI agents. Private transfers, yield on shielded USDC, fully open-source.",
    images: [
      {
        url: "https://askloyal.com/og-image.png",
        alt: "Loyal: Solana wallet with smart-account guardrails for AI agents",
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const basePublicEnv = createPublicEnv(process.env);
  const cookieStore = await cookies();
  const override = resolveSolanaEnvOverride(
    cookieStore.get(SOLANA_ENV_OVERRIDE_COOKIE)?.value
  );
  const publicEnv = override
    ? {
        ...basePublicEnv,
        solanaEnv: override,
        solanaRpcEndpoint: getFrontendSolanaEndpoints(override).rpcEndpoint,
      }
    : basePublicEnv;

  return (
    <html className="dark" lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(siteJsonLd).replace(
              /</g,
              "\\u003c"
            ),
          }}
        />
        <PublicEnvProvider value={publicEnv}>
          <XPixelBootstrap />
          {children}
        </PublicEnvProvider>
      </body>
    </html>
  );
}
