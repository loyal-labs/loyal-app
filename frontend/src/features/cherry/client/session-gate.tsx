"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";

import { useCherryRuntime } from "./runtime-context";
import { isVerifiedCherryAuthSessionMatch } from "./runtime-contract";
import { CherryStatusScreen } from "./status-screen";

export function CherrySessionGate({ children }: { children: ReactNode }) {
  const runtime = useCherryRuntime();
  const { isHydrated, logout, user } = useAuthSession();
  const logoutStartedRef = useRef(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const sessionMismatch =
    runtime.mode === "cherry_mobile" &&
    isHydrated &&
    user !== null &&
    !isVerifiedCherryAuthSessionMatch(
      runtime.verifiedWalletAddress,
      user.walletAddress ?? null
    );

  useEffect(() => {
    if (!sessionMismatch) {
      logoutStartedRef.current = false;
      setLogoutFailed(false);
      return;
    }
    if (logoutStartedRef.current) {
      return;
    }

    logoutStartedRef.current = true;
    void logout().catch(() => setLogoutFailed(true));
  }, [logout, sessionMismatch]);

  if (runtime.mode !== "cherry_mobile") {
    return children;
  }
  if (!isHydrated) {
    return <CherryStatusScreen message="Checking your Loyal session…" />;
  }
  if (sessionMismatch) {
    return (
      <CherryStatusScreen
        message={
          logoutFailed
            ? "Loyal could not switch accounts. Reopen the Mini App."
            : "Matching your Loyal account to Cherry…"
        }
      />
    );
  }

  return children;
}
