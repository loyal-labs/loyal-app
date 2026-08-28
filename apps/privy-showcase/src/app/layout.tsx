import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./styles.css";

export const metadata: Metadata = {
  title: "Loyal × Privy — Make money move itself",
  description:
    "One-time setup, four on-chain rules, zero further signatures: USDC routes itself between a Privy wallet, a Loyal smart account, and Kamino yield.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${GeistSans.variable} ${GeistMono.variable}`} lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
