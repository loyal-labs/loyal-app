"use client";

import { useLinkAccount, usePrivy } from "@privy-io/react-auth";
import { useIdentityToken } from "@privy-io/react-auth";
import { Mail } from "lucide-react";
import { useState } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";

/**
 * Shown in the Account modal when the Privy user has no email on file.
 * Opens Privy's link-email modal; on success re-issues the Loyal session so
 * `user.email` (and app_users.email) picks it up.
 */
export function PrivyEmailCard() {
  const { privyAppId } = usePublicEnv();
  if (!privyAppId) return null;
  return <Inner />;
}

function Inner() {
  const { authenticated, user: privyUser } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { user, refreshSession } = useAuthSession();
  const [busy, setBusy] = useState(false);
  const { linkEmail } = useLinkAccount({
    onSuccess: async () => {
      if (!identityToken || !user?.walletAddress) return;
      setBusy(true);
      try {
        await fetch("/api/auth/privy/complete", {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "privy-id-token": identityToken,
          },
          body: JSON.stringify({ walletAddress: user.walletAddress }),
        });
        await refreshSession();
      } finally {
        setBusy(false);
      }
    },
  });

  const hasEmail =
    Boolean(user?.email) ||
    privyUser?.linkedAccounts.some(
      (a) => a.type === "email" || a.type === "google_oauth"
    );
  if (!authenticated || hasEmail) return null;

  return (
    <button
      className="flex w-full items-center gap-3 rounded-[20px] bg-secondary px-4 py-3 text-left transition hover:bg-secondary/80 disabled:opacity-60"
      disabled={busy}
      onClick={linkEmail}
      type="button"
    >
      <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground text-sm">
          Add your email
        </span>
        <span className="block text-muted-foreground text-xs">
          For account updates and recovery.
        </span>
      </span>
    </button>
  );
}
