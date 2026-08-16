import { createContext, type ReactNode, useContext } from "react";

import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";

const AppReadyContext = createContext(false);

/**
 * True once every boot-time full-screen overlay is gone and the user is actually
 * looking at the app: the Lottie splash has finished (`splashDone`) AND the
 * wallet auth gate has dismissed (same condition WalletAuthGate uses to render
 * null). Screens use this to defer entrance animations until they're visible
 * instead of firing them behind the splash/lock screens.
 */
export function AppReadyProvider({
  splashDone,
  children,
}: {
  splashDone: boolean;
  children: ReactNode;
}) {
  const { state, onboardingReplayActive } = useWallet();
  const ready = splashDone && isWalletUnlocked(state) && !onboardingReplayActive;

  return (
    <AppReadyContext.Provider value={ready}>
      {children}
    </AppReadyContext.Provider>
  );
}

export function useAppReady(): boolean {
  return useContext(AppReadyContext);
}
