"use client";

import { useCallback, useEffect, useState } from "react";

import { createBrowserLifecycleTracker } from "@/features/observability/client";

const INVITE_PATH = "/api/smart-accounts/earn-max/invite";

export type EarnMaxInviteState = {
  /** null until the server answered for this wallet. */
  redeemed: boolean | null;
  redeem: (code: string) => Promise<"redeemed" | "invalid" | "error">;
};

export function useEarnMaxInvite(walletAddress: string | null): EarnMaxInviteState {
  const [redeemed, setRedeemed] = useState<boolean | null>(null);

  useEffect(() => {
    setRedeemed(null);
    if (!walletAddress) return;
    let cancelled = false;
    void fetch(INVITE_PATH, { cache: "no-store", credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { redeemed?: boolean } | null) => {
        if (!cancelled) setRedeemed(body?.redeemed === true);
      })
      .catch(() => {
        if (!cancelled) setRedeemed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const redeem = useCallback(async (code: string) => {
    // Never the code itself: only the outcome and HTTP status.
    const tracker = createBrowserLifecycleTracker({
      flowName: "earn_max.invite",
      flowVariant: "redeem",
    });
    tracker.start("redeem");
    try {
      const response = await fetch(INVITE_PATH, {
        body: JSON.stringify({ code }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.ok) {
        tracker.complete("redeem", { httpStatus: response.status });
        setRedeemed(true);
        return "redeemed" as const;
      }
      // 400 invalid, 409 already used by another wallet: both read as
      // "Invalid code" in the design.
      // request_failed + a 4xx status stays INFO (a mistyped code must not
      // page); a 5xx pages through the Errors alert.
      tracker.fail("redeem", {
        errorCode: "request_failed",
        httpStatus: response.status,
      });
      return response.status === 400 || response.status === 409
        ? ("invalid" as const)
        : ("error" as const);
    } catch {
      tracker.fail("redeem", { errorCode: "request_failed" });
      return "error" as const;
    }
  }, []);

  return { redeem, redeemed };
}
