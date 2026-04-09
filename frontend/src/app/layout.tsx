import "./globals.css";

import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AnalyticsBootstrap } from "@/components/analytics/AnalyticsBootstrap";
import { SignInModal } from "@/components/auth/sign-in-modal";
import { WalletAutoReauth } from "@/components/auth/wallet-auto-reauth";
import { WalletConnectionProvider } from "@/components/solana/wallet-provider";
import { Header } from "@/components/ui/header";
import { AuthSessionProvider } from "@/contexts/auth-session-context";
import { ChatModeProvider } from "@/contexts/chat-mode-context";
import { PublicEnvProvider } from "@/contexts/public-env-context";
import { SignInModalProvider } from "@/contexts/sign-in-modal-context";
import { UserChatsProvider } from "@/providers/user-chats";
import { createPublicEnv } from "@/lib/core/config/public";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "Loyal: Privacy Preserving Intelligence",
  description:
    "True private intelligence network: open-source privacy-preserving AI with confidential compute in TEE and attested runtimes.",
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
    title: "Loyal: Privacy Preserving Intelligence",
    description:
      "True private intelligence network: open-source privacy-preserving AI with confidential compute in TEE and attested runtimes.",
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
    title: "Loyal: Privacy Preserving Intelligence",
    description:
      "True private intelligence network: open-source privacy-preserving AI with confidential compute in TEE and attested runtimes.",
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
        <PublicEnvProvider value={publicEnv}>
          <WalletConnectionProvider>
            <AuthSessionProvider>
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
            </AuthSessionProvider>
          </WalletConnectionProvider>
        </PublicEnvProvider>
      </body>
    </html>
  );
}
