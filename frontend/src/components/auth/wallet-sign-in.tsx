"use client";

import { useEffect, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

import { TurnstileWidget } from "./turnstile-widget";
import { WalletTab } from "./wallet-tab";

/**
 * Wallet sign-in content (wallet list first, then captcha). Shared between the
 * sign-in modal and the on-page signed-out pane so the Turnstile coordination
 * lives in one place.
 */
export function WalletSignIn() {
  const publicEnv = usePublicEnv();
  const turnstileMode = publicEnv.turnstile.mode;
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  // Auto-resolve only for misconfigured environments. In bypass (local dev)
  // mode we keep the widget visible so the developer can click the bypass
  // button — it confirms the captcha is wired into the login flow.
  useEffect(() => {
    if (turnstileMode === "misconfigured" && captchaToken === null) {
      setCaptchaToken("captcha-skipped");
    }
  }, [captchaToken, turnstileMode]);

  return (
    <div className="flex flex-col gap-4">
      <WalletTab
        onTurnstileConsumed={() => setCaptchaToken(null)}
        turnstileToken={captchaToken}
      />
      {captchaToken === null ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-neutral-500 text-sm">
            Complete verification to continue
          </p>
          <TurnstileWidget onVerify={setCaptchaToken} />
        </div>
      ) : null}
    </div>
  );
}
