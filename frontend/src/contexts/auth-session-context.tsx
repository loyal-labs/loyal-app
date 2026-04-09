"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthSessionUser } from "@loyal-labs/auth-core";

import { usePublicEnv } from "@/contexts/public-env-context";
import {
  createAuthApiClient,
  type AuthApiClient,
} from "@/lib/auth/client";
import type { WalletSessionResponse } from "@/features/identity/wallet-session-contracts";
import { shouldRecheckAuthSession } from "@/contexts/auth-session-refresh";
import { resetAuthenticatedUser, trackAuthLogout } from "@/lib/core/analytics";

type AuthSessionContextValue = {
  isAuthenticated: boolean;
  isHydrated: boolean;
  user: AuthSessionUser | null;
  session: WalletSessionResponse["session"] | null;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);
const AuthApiClientContext = createContext<AuthApiClient | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const publicEnv = usePublicEnv();
  const [sessionState, setSessionState] = useState<WalletSessionResponse | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const lastSessionCheckAtRef = useRef<number | null>(null);
  const authApiClient = useMemo(() => createAuthApiClient(), []);

  const user = sessionState?.user ?? null;
  const session = sessionState?.session ?? null;

  const hydrateSession = useCallback(async () => {
    try {
      const nextSession = await authApiClient.getSession();
      setSessionState(nextSession);
    } finally {
      lastSessionCheckAtRef.current = Date.now();
    }
  }, [authApiClient]);

  const refreshSession = useCallback(async () => {
    try {
      const nextSession = await authApiClient.refreshSession();
      setSessionState(nextSession);
    } finally {
      lastSessionCheckAtRef.current = Date.now();
    }
  }, [authApiClient]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSessionState() {
      try {
        const nextSession = await authApiClient.getSession();
        if (!cancelled) {
          setSessionState(nextSession);
        }
      } catch {
        if (!cancelled) {
          setSessionState(null);
        }
      } finally {
        if (!cancelled) {
          lastSessionCheckAtRef.current = Date.now();
          setIsHydrated(true);
        }
      }
    }

    void hydrateSessionState();

    return () => {
      cancelled = true;
    };
  }, [authApiClient]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const refreshOnReturn = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }

      if (!shouldRecheckAuthSession(lastSessionCheckAtRef.current)) {
        return;
      }

      if (!session) {
        void hydrateSession().catch(() => {});
        return;
      }

      const expiresAt = Date.parse(session.expiresAt);
      if (!Number.isNaN(expiresAt) && expiresAt <= Date.now()) {
        void hydrateSession().catch(() => {});
        return;
      }

      const refreshAfter = Date.parse(session.refreshAfter);
      if (!Number.isNaN(refreshAfter) && refreshAfter <= Date.now()) {
        void refreshSession().catch(() => {});
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshOnReturn();
      }
    };

    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hydrateSession, isHydrated, refreshSession, session]);

  useEffect(() => {
    if (!isHydrated || user === null) {
      return;
    }

    console.log("[auth-session] signed-in user claims", {
      authMethod: user.authMethod,
      subjectAddress: user.subjectAddress,
      displayAddress: user.displayAddress,
      smartAccountAddress: user.smartAccountAddress ?? null,
      settingsPda: user.settingsPda ?? null,
      walletAddress: user.walletAddress ?? null,
      provider: user.provider ?? null,
      claimKeys: Object.keys(user),
      rawUser: user,
    });
  }, [isHydrated, user]);

  const logout = useCallback(async () => {
    trackAuthLogout(publicEnv, user);
    await authApiClient.logout();
    resetAuthenticatedUser();
    setSessionState(null);
  }, [authApiClient, publicEnv, user]);

  const value = useMemo(
    () => ({
      isAuthenticated: user !== null,
      isHydrated,
      session,
      user,
      refreshSession,
      logout,
    }),
    [isHydrated, logout, refreshSession, session, user]
  );

  return (
    <AuthApiClientContext.Provider value={authApiClient}>
      <AuthSessionContext.Provider value={value}>
        {children}
      </AuthSessionContext.Provider>
    </AuthApiClientContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }

  return context;
}

export function useAuthApiClient() {
  const context = useContext(AuthApiClientContext);
  if (!context) {
    throw new Error("useAuthApiClient must be used within an AuthSessionProvider");
  }

  return context;
}
