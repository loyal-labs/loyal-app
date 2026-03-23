"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createAuthClient } from "@loyal-labs/auth-core";
import type { AuthSessionUser } from "@loyal-labs/auth-core";

import { usePublicEnv } from "@/contexts/public-env-context";
import { createAuthApiClient } from "@/lib/auth/client";
import { resetAuthenticatedUser, trackAuthLogout } from "@/lib/core/analytics";
import type { AuthApiClient } from "@/lib/auth/client";

type AuthSessionContextValue = {
  isAuthenticated: boolean;
  isHydrated: boolean;
  user: AuthSessionUser | null;
  refreshSession: () => Promise<void>;
  setAuthenticatedUser: (user: AuthSessionUser) => void;
  logout: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);
const AuthApiClientContext = createContext<AuthApiClient | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const publicEnv = usePublicEnv();
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const authApiClient = useMemo(
    () =>
      createAuthApiClient(
        createAuthClient({
          authBaseUrl: publicEnv.gridAuthBaseUrl ?? "",
        })
      ),
    [publicEnv.gridAuthBaseUrl]
  );

  const refreshSession = useCallback(async () => {
    const nextUser = await authApiClient.getSession();
    setUser(nextUser);
  }, [authApiClient]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      try {
        const nextUser = await authApiClient.getSession();
        if (!cancelled) {
          setUser(nextUser);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    }

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [authApiClient]);

  useEffect(() => {
    if (!isHydrated || user === null) {
      return;
    }

    console.log("[auth-session] signed-in user claims", {
      authMethod: user.authMethod,
      email: user.email,
      gridUserId: user.gridUserId,
      subjectAddress: user.subjectAddress,
      displayAddress: user.displayAddress,
      smartAccountAddress: user.smartAccountAddress ?? null,
      walletAddress: user.walletAddress ?? null,
      passkeyAccount: user.passkeyAccount ?? null,
      provider: user.provider ?? null,
      claimKeys: Object.keys(user),
      rawUser: user,
    });
  }, [isHydrated, user]);

  const setAuthenticatedUser = useCallback((nextUser: AuthSessionUser) => {
    setUser(nextUser);
  }, []);

  const logout = useCallback(async () => {
    trackAuthLogout(publicEnv, user);
    await authApiClient.logout();
    resetAuthenticatedUser();
    setUser(null);
  }, [authApiClient, publicEnv, user]);

  const value = useMemo(
    () => ({
      isAuthenticated: user !== null,
      isHydrated,
      user,
      refreshSession,
      setAuthenticatedUser,
      logout,
    }),
    [isHydrated, refreshSession, setAuthenticatedUser, user, logout]
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
