"use client";

import { useEffect, useRef } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import type { CaptchaConfig } from "@/lib/core/config/public";

/** Widget POSTs to `${endpoint}challenge` and `${endpoint}redeem` — the
 *  trailing slash is required. */
const CAP_API_ENDPOINT = "/api/cap/";

declare module "react" {
  // Custom-element JSX typing requires augmenting the JSX namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "cap-widget": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      > & { "data-cap-api-endpoint": string };
    }
  }
}

type CapWidgetProps = {
  onVerify: (token: string) => void;
};

function CapWidgetElement({ onVerify }: CapWidgetProps) {
  const elementRef = useRef<HTMLElement | null>(null);

  // Importing @cap.js/widget registers the <cap-widget> custom element and
  // touches window, so it loads lazily in the browser only; the already
  // rendered element upgrades in place when the definition lands.
  useEffect(() => {
    void import("@cap.js/widget");
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }
    const handleSolve = (event: Event) => {
      const token = (event as CustomEvent<{ token: string }>).detail?.token;
      if (token) {
        onVerify(token);
      }
    };
    element.addEventListener("solve", handleSolve);
    return () => element.removeEventListener("solve", handleSolve);
  }, [onVerify]);

  return (
    <cap-widget data-cap-api-endpoint={CAP_API_ENDPOINT} ref={elementRef} />
  );
}

type CapWidgetContentProps = CapWidgetProps & {
  captcha: CaptchaConfig;
};

export function CapWidgetContent({ captcha, onVerify }: CapWidgetContentProps) {
  if (captcha.mode === "disabled") {
    return null;
  }

  if (captcha.mode === "misconfigured") {
    return (
      <div className="py-3 text-center text-amber-700 text-sm">
        {captcha.reason}
      </div>
    );
  }

  // Sized and styled globally (globals.css `cap-widget` block) — a
  // full-width h-12 row matching the facelift card language.
  return <CapWidgetElement onVerify={onVerify} />;
}

export function CapWidget({ onVerify }: CapWidgetProps) {
  const publicEnv = usePublicEnv();

  return <CapWidgetContent captcha={publicEnv.captcha} onVerify={onVerify} />;
}
