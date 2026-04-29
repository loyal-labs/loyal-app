import type { Metadata } from "next";

import { AnalyticsBootstrap } from "@/components/analytics/AnalyticsBootstrap";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { WalletAutoReauth } from "@/components/auth/wallet-auto-reauth";
import { WalletConnectionProvider } from "@/components/solana/wallet-provider";
import { AuthSessionProvider } from "@/contexts/auth-session-context";
import { SignInModalProvider } from "@/contexts/sign-in-modal-context";
import { FeatureFlagsProvider } from "@/providers/feature-flags-provider";

export const metadata: Metadata = {
  title: "Loyal App",
  description: "The Loyal private intelligence and wallet app.",
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
            {children}
            <SignInModal />
          </SignInModalProvider>
        </FeatureFlagsProvider>
      </AuthSessionProvider>
    </WalletConnectionProvider>
  );
}
