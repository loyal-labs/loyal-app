import "./globals.css";

import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { PublicEnvProvider } from "@/contexts/public-env-context";
import { createPublicEnv } from "@/lib/core/config/public";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const publicEnv = createPublicEnv(process.env);

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
