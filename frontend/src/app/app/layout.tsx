import type { Metadata } from "next";

import { AnalyticsBootstrap } from "@/components/analytics/AnalyticsBootstrap";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { WalletAutoReauth } from "@/components/auth/wallet-auto-reauth";
import { WalletConnectionProvider } from "@/components/solana/wallet-provider";
import { AuthSessionProvider } from "@/contexts/auth-session-context";
import { SignInModalProvider } from "@/contexts/sign-in-modal-context";
import { FeatureFlagsProvider } from "@/providers/feature-flags-provider";
import { AppWorkspaceShell } from "./app-workspace-shell";

export const metadata: Metadata = {
  title: "Loyal — Solana Wallet with Agent Guardrails",
  description:
    "Solana wallet with smart-account guardrails for AI agents. Private transfers, yield on shielded USDC, fully open-source.",
  // Landing CTAs now open the app at askloyal.com/app (same origin) for the
  // preloaded transition, but the canonical app URL stays the subdomain.
  alternates: {
    canonical: "https://app.askloyal.com",
  },
  openGraph: {
    title: "Loyal — Solana Wallet with Agent Guardrails",
    description:
      "Solana wallet with smart-account guardrails for AI agents. Private transfers, yield on shielded USDC, fully open-source.",
    url: "https://askloyal.com",
    type: "website",
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

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <WalletConnectionProvider>
      <AuthSessionProvider>
        <FeatureFlagsProvider>
          <SignInModalProvider>
            <WalletAutoReauth />
            <AnalyticsBootstrap />
            {/* Header/main nav is hidden for the wallet workspace redesign. */}
            <AppWorkspaceShell />
            {children}
            <SignInModal />
          </SignInModalProvider>
        </FeatureFlagsProvider>
      </AuthSessionProvider>
    </WalletConnectionProvider>
  );
}
