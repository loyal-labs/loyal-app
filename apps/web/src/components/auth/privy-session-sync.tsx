"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";

/**
 * Keeps the Privy session in step with the Loyal session: when the Loyal
 * session goes away (any of the three logout buttons), log out of Privy too.
 * Lives inside AuthSessionProvider so it sees the same state the UI does.
 */
export function PrivySessionSync() {
  const { privyAppId } = usePublicEnv();
  if (!privyAppId) return null;
  return <Inner />;
}

function Inner() {
  const { isHydrated, isAuthenticated } = useAuthSession();
  const { ready, authenticated, logout } = usePrivy();
  const wasAuthenticated = useRef(false);

  useEffect(() => {
    if (!isHydrated || !ready) return;
    if (isAuthenticated) {
      wasAuthenticated.current = true;
      return;
    }
    if (wasAuthenticated.current && authenticated) {
      wasAuthenticated.current = false;
      void logout();
    }
  }, [authenticated, isAuthenticated, isHydrated, logout, ready]);

  return null;
}
