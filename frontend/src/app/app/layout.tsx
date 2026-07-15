import type { Metadata } from "next";

import { AnalyticsBootstrap } from "@/components/analytics/AnalyticsBootstrap";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { WalletAutoReauth } from "@/components/auth/wallet-auto-reauth";
import { WalletConnectionProvider } from "@/components/solana/wallet-provider";
import { AuthSessionProvider } from "@/contexts/auth-session-context";
import { SignInModalProvider } from "@/contexts/sign-in-modal-context";
import { RealtimeSyncProvider } from "@/features/realtime-sync";
import { FeatureFlagsProvider } from "@/providers/feature-flags-provider";
import { AppWorkspaceShell } from "./app-workspace-shell";

export const metadata: Metadata = {
  title: "Loyal: Solana Wallet That Earns Yield Automatically",
  description:
    "Self-custody Solana wallet that routes your stablecoins to the best available yield automatically. Agent guardrails, private transfers, open-source.",
  // Landing CTAs now open the app at askloyal.com/app (same origin) for the
  // preloaded transition, but the canonical app URL stays the subdomain.
  alternates: {
    canonical: "https://app.askloyal.com",
  },
  openGraph: {
    title: "Loyal: Solana Wallet That Earns Yield Automatically",
    description:
      "Self-custody Solana wallet that routes your stablecoins to the best available yield automatically. Agent guardrails, private transfers, open-source.",
    url: "https://askloyal.com",
    type: "website",
    images: [
      {
        url: "https://askloyal.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "Loyal: Solana wallet that earns stablecoin yield automatically",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Loyal: Solana Wallet That Earns Yield Automatically",
    description:
      "Self-custody Solana wallet that routes your stablecoins to the best available yield automatically. Agent guardrails, private transfers, open-source.",
    images: [
      {
        url: "https://askloyal.com/og-image.png",
        alt: "Loyal: Solana wallet that earns stablecoin yield automatically",
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
            <RealtimeSyncProvider>
              <AppWorkspaceShell />
              {children}
            </RealtimeSyncProvider>
            <SignInModal />
          </SignInModalProvider>
        </FeatureFlagsProvider>
      </AuthSessionProvider>
    </WalletConnectionProvider>
  );
}
