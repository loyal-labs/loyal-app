"use client";

import { useEffect, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

import { CapWidget } from "./cap-widget";
import { WalletTab } from "./wallet-tab";

/**
 * Wallet sign-in content (captcha first, then the wallet list). Shared
 * between the sign-in modal and the on-page signed-out pane so the captcha
 * coordination lives in one place.
 */
export function WalletSignIn() {
  const publicEnv = usePublicEnv();
  const captchaMode = publicEnv.captcha.mode;
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  // Auto-resolve only for misconfigured environments (no CAP_SECRET); in
  // widget mode every env — localhost and previews included — runs the real
  // captcha, since Cap is same-origin with no domain allowlist.
  useEffect(() => {
    if (captchaMode === "misconfigured" && captchaToken === null) {
      setCaptchaToken("captcha-skipped");
    }
  }, [captchaToken, captchaMode]);

  // Collapse the verification block a beat AFTER solving so the widget's
  // checkmark lands before the accordion folds; a consumed token (sign-in
  // attempt) reopens it immediately.
  const [isCollapsed, setIsCollapsed] = useState(false);
  useEffect(() => {
    if (captchaToken === null) {
      setIsCollapsed(false);
      return;
    }
    const timer = setTimeout(() => setIsCollapsed(true), 600);
    return () => clearTimeout(timer);
  }, [captchaToken]);

  // The widget stays mounted through the collapse (so its checkmark is
  // visible while folding), but a fresh solve needs a fresh widget — remount
  // it whenever a consumed token reopens the block.
  const [widgetEpoch, setWidgetEpoch] = useState(0);

  return (
    <div className="flex flex-col">
      <div className="t-acc" data-open={isCollapsed ? "false" : "true"}>
        <div className="t-acc-panel">
          <div className="t-acc-panel-inner">
            <div className="flex flex-col gap-3 pb-4">
              <p className="text-muted-foreground text-sm">
                Complete verification to continue
              </p>
              <CapWidget key={widgetEpoch} onVerify={setCaptchaToken} />
            </div>
          </div>
        </div>
      </div>
      <p className="pb-4 text-muted-foreground text-sm">
        Choose your preferred sign-in method.
      </p>
      <WalletTab
        captchaToken={captchaToken}
        onCaptchaConsumed={() => {
          setCaptchaToken(null);
          setWidgetEpoch((epoch) => epoch + 1);
        }}
      />
    </div>
  );
}
