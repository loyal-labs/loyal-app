"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

// Demo-only Privy app (NEXT_PUBLIC_PRIVY_DEMO_APP_ID): email/Google, always dark, embedded Solana wallet
// created at login, and Privy's own confirmation UI for every signature so
// the demo shows the approvals a real user would see.
export function DemoPrivyProvider({ children }: { children: ReactNode }) {
  const { privyDemoAppId } = usePublicEnv();
  if (!privyDemoAppId) return children;
  return (
    <PrivyProvider
      appId={privyDemoAppId}
      config={{
        loginMethods: ["email", "google"],
        appearance: { theme: "#1D1B20", accentColor: "#FF5050" },
        embeddedWallets: {
          showWalletUIs: true,
          solana: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
