"use client";

import { useEffect, useRef } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";

import { useCherryRuntime } from "./runtime-context";

/** Opens the existing CAPTCHA + wallet-proof UI once; it does not bypass it. */
export function CherryAuthPrompt() {
  const runtime = useCherryRuntime();
  const { captcha } = usePublicEnv();
  const { isAuthenticated, isHydrated } = useAuthSession();
  const { isOpen, open } = useSignInModal();
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    if (
      runtime.mode !== "cherry_embedded" ||
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
  }, [captcha.mode, isAuthenticated, isHydrated, isOpen, open, runtime.mode]);

  return null;
}
