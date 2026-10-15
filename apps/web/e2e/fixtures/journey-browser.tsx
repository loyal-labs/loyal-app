import React from "react";
import { PrivyAuthProvider } from "../../src/components/auth/privy-provider";
import { AuthProbe } from "./auth-browser";
import { PrivyAuthController } from "../../src/components/auth/privy-session-sync";
import { SignInModalProvider } from "../../src/contexts/sign-in-modal-context";
import { SwapProbe } from "./swap-browser";
import { createRoot } from "react-dom/client";
import {
  AuthSessionProvider,
  useAuthSession,
} from "../../src/contexts/auth-session-context";
import { PublicEnvProvider } from "../../src/contexts/public-env-context";
import { createPublicEnv } from "../../src/lib/core/config/public";
import {
  createBrowserLifecycleTracker,
  createAuthenticatedActionTracker,
  lifecycleFlowHeaders,
  resetBrowserJourneys,
} from "../../src/features/observability/client";
import { initJourneyDatadog } from "../../src/features/observability/datadog.client";
import { isDepositVisible } from "../../src/features/observability/deposit-visibility";
import { classifyTransactionFailure } from "../../src/features/observability/transaction-failure";

// Browser contract fixture: wallet, RPC and Privy are controlled boundaries.
// No product route, key material or network transaction is exposed here.
Object.assign(window, {
  journeyFixture: {
    create: createBrowserLifecycleTracker,
    authenticatedAction: createAuthenticatedActionTracker,
    headers: lifecycleFlowHeaders,
    reset: resetBrowserJourneys,
    datadog: (config: { applicationId: string; clientToken: string }) =>
      initJourneyDatadog({
        ...createPublicEnv({
          NEXT_PUBLIC_APP_ENVIRONMENT: "local",
          NEXT_PUBLIC_SOLANA_ENV: "mainnet",
        }),
        datadogApplicationId: config.applicationId,
        datadogClientToken: config.clientToken,
      }),
    visible: isDepositVisible,
    classify: classifyTransactionFailure,
  },
});

function SessionProbe() {
  const session = useAuthSession();
  return (
    <div>
      <output aria-label="Session state">
        {!session.isHydrated
          ? "Loading"
          : session.isAuthenticated
          ? "Authenticated"
          : "Anonymous"}
      </output>
      <button onClick={() => void session.refreshSession()}>
        Refresh session
      </button>
      <button onClick={() => void session.logout()}>Logout</button>
    </div>
  );
}
createRoot(document.getElementById("auth")!).render(
  <PublicEnvProvider
    value={createPublicEnv({
      NEXT_PUBLIC_APP_ENVIRONMENT: "local",
      NEXT_PUBLIC_SOLANA_ENV: "mainnet",
      NEXT_PUBLIC_JUPITER_API_KEY: "controlled-fixture-not-a-credential",
      NEXT_PUBLIC_PRIVY_APP_ID:
        window.location.pathname === "/auth"
          ? "controlled-privy-fixture"
          : undefined,
    })}
  >
    <AuthSessionProvider>
      <SessionProbe />
      {window.location.pathname === "/auth" && (
        <SignInModalProvider>
          <PrivyAuthProvider>
            <PrivyAuthController>
              <AuthProbe />
            </PrivyAuthController>
          </PrivyAuthProvider>
        </SignInModalProvider>
      )}
      {window.location.pathname === "/swap" && <SwapProbe />}
    </AuthSessionProvider>
  </PublicEnvProvider>
);
