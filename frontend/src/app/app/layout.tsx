import type { Metadata } from "next";

import { AnalyticsBootstrap } from "@/components/analytics/AnalyticsBootstrap";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { WalletAutoReauth } from "@/components/auth/wallet-auto-reauth";
import { WalletConnectionProvider } from "@/components/solana/wallet-provider";
import { Header } from "@/components/ui/header";
import { AuthSessionProvider } from "@/contexts/auth-session-context";
import { ChatModeProvider } from "@/contexts/chat-mode-context";
import { SignInModalProvider } from "@/contexts/sign-in-modal-context";
import { FeatureFlagsProvider } from "@/providers/feature-flags-provider";
import { UserChatsProvider } from "@/providers/user-chats";

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
            <UserChatsProvider>
              <ChatModeProvider>
                <AnalyticsBootstrap />
                <Header />
                {children}
                <SignInModal />
              </ChatModeProvider>
            </UserChatsProvider>
          </SignInModalProvider>
        </FeatureFlagsProvider>
      </AuthSessionProvider>
    </WalletConnectionProvider>
  );
}
