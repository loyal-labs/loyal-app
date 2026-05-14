import "./globals.css";

import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";

import { PublicEnvProvider } from "@/contexts/public-env-context";
import { createPublicEnv } from "@/lib/core/config/public";
import {
  resolveSolanaEnvOverride,
  SOLANA_ENV_OVERRIDE_COOKIE,
} from "@/lib/core/config/solana-env-override";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "Loyal — Solana Wallet with Agent Guardrails",
  description:
    "Solana wallet with smart-account guardrails for AI agents. Private transfers, yield on shielded USDC, fully open-source.",
  metadataBase: new URL("https://askloyal.com"),
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
  openGraph: {
    type: "website",
    url: "https://askloyal.com",
    title: "Loyal — Solana Wallet with Agent Guardrails",
    description:
      "Solana wallet with smart-account guardrails for AI agents. Private transfers, yield on shielded USDC, fully open-source.",
    images: [
      {
        url: "https://askloyal.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "Loyal — Solana wallet for AI agents and Telegram payments",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Loyal — Solana Wallet with Agent Guardrails",
    description:
      "Solana wallet with smart-account guardrails for AI agents. Private transfers, yield on shielded USDC, fully open-source.",
    images: [
      {
        url: "https://askloyal.com/og-image.png",
        alt: "Loyal — Solana wallet for AI agents and Telegram payments",
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
        <PublicEnvProvider value={publicEnv}>{children}</PublicEnvProvider>
      </body>
    </html>
  );
}
