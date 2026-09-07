"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";

import { CherryPrivyAuthController } from "./privy-sign-in";
import { useCherryRuntime } from "./runtime-context";

/**
 * Cherry sign-in entry. With Privy on, runs the headless SIWS flow; with
 * Privy off, opens the legacy CAPTCHA + wallet-proof UI once (no bypass).
 */
export function CherryAuthPrompt({ children }: { children: ReactNode }) {
  const runtime = useCherryRuntime();
  const { privyAppId } = usePublicEnv();
  if (runtime.mode !== "cherry_embedded") {
    return children;
  }
  if (privyAppId) {
    return <CherryPrivyAuthController>{children}</CherryPrivyAuthController>;
  }
  return (
    <>
      <LegacyCherryAuthPrompt />
      {children}
    </>
  );
}

function LegacyCherryAuthPrompt() {
  const { captcha } = usePublicEnv();
  const { isAuthenticated, isHydrated } = useAuthSession();
  const { isOpen, open } = useSignInModal();
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    if (
      captcha.mode !== "widget" ||
      !isHydrated ||
      isAuthenticated ||
      isOpen ||
      hasOpenedRef.current
    ) {
      return;
    }

    hasOpenedRef.current = true;
    open();
  }, [captcha.mode, isAuthenticated, isHydrated, isOpen, open]);

  return null;
}
