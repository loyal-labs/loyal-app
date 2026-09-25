"use client";

import { useCallback, useEffect, useState } from "react";

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
    try {
      const response = await fetch(INVITE_PATH, {
        body: JSON.stringify({ code }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.ok) {
        setRedeemed(true);
        return "redeemed" as const;
      }
      // 400 invalid, 409 already used by another wallet: both read as
      // "Invalid code" in the design.
      return response.status === 400 || response.status === 409
        ? ("invalid" as const)
        : ("error" as const);
    } catch {
      return "error" as const;
    }
  }, []);

  return { redeem, redeemed };
}
