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
  title: "Loyal: Private Wallets for Agentic Finance",
  description:
    "Keep funds private, authorize agent workflows, and run one smart account across wallets.",
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
    url: "https://askloyal.com/",
    title: "Loyal: Private Wallets for Agentic Finance",
    description:
      "Keep funds private, authorize agent workflows, and run one smart account across wallets.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Loyal network visual",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Loyal: Private Wallets for Agentic Finance",
    description:
      "Keep funds private, authorize agent workflows, and run one smart account across wallets.",
    images: [
      {
        url: "/og-image.png",
        alt: "Loyal private intelligence preview",
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
