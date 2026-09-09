import { PrivyProvider } from "@privy-io/expo";
import type { ReactNode } from "react";

import { env } from "@/config/env";

export function isPrivyConfigured(): boolean {
  return env.privyAppId.length > 0;
}

// Mounts Privy only when configured. Every Privy hook consumer must either
// guard with `isPrivyConfigured()` or render below this provider only when it
// is configured, since the hooks throw without a provider.
export function PrivyProviderRoot({ children }: { children: ReactNode }) {
  if (!isPrivyConfigured()) return <>{children}</>;
  return (
    <PrivyProvider
      appId={env.privyAppId}
      clientId={env.privyClientId || undefined}
      config={{ embedded: { solana: { createOnLogin: "off" } } }}
    >
      {children}
    </PrivyProvider>
  );
}
