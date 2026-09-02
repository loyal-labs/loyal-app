"use client";

import {
  getIdentityToken,
  useLinkAccount,
  useMfaEnrollment,
  usePrivy,
  useUnlinkEmail,
  useUnlinkOAuth,
} from "@privy-io/react-auth";
import { useExportWallet } from "@privy-io/react-auth/solana";
import { useUpdateEmail } from "@privy-io/react-auth/ui";
import { KeyRound, Mail, ShieldCheck, Wallet } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";

type PrivyAppConfig = { google_oauth?: boolean; mfa_methods?: string[] };
// Public, unauthenticated dashboard config; the SDK reads it but exposes no
// hook. ponytail: one fetch per mount, no cache — the panel is rarely open.
function usePrivyAppConfig(appId: string | undefined) {
  const [config, setConfig] = useState<PrivyAppConfig | null>(null);
  useEffect(() => {
    if (!appId) return;
    const ctrl = new AbortController();
    fetch(`https://auth.privy.io/api/v1/apps/${appId}`, {
      headers: { "privy-app-id": appId },
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setConfig(c as PrivyAppConfig))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [appId]);
  return config;
}

/**
 * Account panel body when Privy is on: linked email / Google, embedded-wallet
 * key export, MFA. Every Privy action runs in Privy's own modal; after a
 * link/unlink the Loyal session is re-issued so `user.email` follows.
 */
export function PrivyAccountPanel() {
  const { user: privyUser } = usePrivy();
  const { user, refreshSession } = useAuthSession();
  const { privyAppId } = usePublicEnv();
  const [busy, setBusy] = useState(false);
  const appConfig = usePrivyAppConfig(privyAppId);

  const resync = useCallback(async () => {
    if (!user?.walletAddress) return;
    setBusy(true);
    try {
      const identityToken = await getIdentityToken();
      if (!identityToken) return;
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
  }, [refreshSession, user?.walletAddress]);

  const { linkEmail, linkGoogle } = useLinkAccount({ onSuccess: resync });
  const { update: updateEmail } = useUpdateEmail();
  const { unlink: unlinkEmail } = useUnlinkEmail();
  const { unlink: unlinkOAuth } = useUnlinkOAuth();
  const { exportWallet } = useExportWallet();
  const { showMfaEnrollmentModal } = useMfaEnrollment();

  if (!privyUser) return null;
  const linked = privyUser.linkedAccounts;
  const email = linked.find((a) => a.type === "email");
  const google = linked.find((a) => a.type === "google_oauth");
  const embedded = linked.find(
    (a): a is Extract<typeof a, { type: "wallet" }> =>
      a.type === "wallet" &&
      a.chainType === "solana" &&
      a.walletClientType === "privy"
  );
  // Privy refuses to unlink the last linked account; mirror that in the UI.
  const canUnlink = linked.length > 1;
  const mfaOn = privyUser.mfaMethods.length > 0;
  // Dashboard toggles: rows for methods that are off would only error.
  const googleEnabled = appConfig?.google_oauth === true;
  const mfaEnabled = (appConfig?.mfa_methods?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-2">
      <Row
        action={email ? (canUnlink ? "Remove" : "Change") : "Add"}
        disabled={busy}
        icon={<Mail className="h-5 w-5" />}
        onClick={() =>
          email
            ? canUnlink
              ? unlinkEmail({ address: email.address }).then(resync)
              : updateEmail()
            : linkEmail()
        }
        subtitle={email ? email.address : "For account updates and recovery."}
        title="Email"
      />
      {google || googleEnabled ? (
        <Row
          action={google ? (canUnlink ? "Remove" : undefined) : "Link"}
          disabled={busy}
          icon={<GoogleMark />}
          onClick={() =>
            google
              ? canUnlink
                ? unlinkOAuth({
                    provider: "google",
                    subject: google.subject,
                  }).then(resync)
                : undefined
              : linkGoogle()
          }
          subtitle={google ? google.email ?? "Linked" : "Sign in with Google."}
          title="Google"
        />
      ) : null}
      {embedded ? (
        <Row
          action="Export"
          disabled={busy}
          icon={<KeyRound className="h-5 w-5" />}
          onClick={() => exportWallet({ address: embedded.address })}
          subtitle="Copy the private key of your loyal wallet."
          title="Wallet key"
        />
      ) : (
        <Row
          disabled
          icon={<Wallet className="h-5 w-5" />}
          subtitle="Signed in with your own wallet."
          title="Wallet"
        />
      )}
      {mfaEnabled || mfaOn ? (
        <Row
          action={mfaOn ? "Manage" : "Enable"}
          disabled={busy}
          icon={<ShieldCheck className="h-5 w-5" />}
          onClick={showMfaEnrollmentModal}
          subtitle={
            mfaOn
              ? "On — extra check before signing."
              : "Extra check before signing."
          }
          title="Two-factor"
        />
      ) : null}
    </div>
  );
}

function Row({
  action,
  disabled,
  icon,
  onClick,
  subtitle,
  title,
}: {
  action?: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick?: () => unknown;
  subtitle: string;
  title: string;
}) {
  const interactive = Boolean(onClick && action);
  return (
    <button
      className="flex w-full items-center gap-3 rounded-[20px] bg-secondary px-4 py-3 text-left transition enabled:hover:bg-secondary/80 disabled:cursor-default disabled:opacity-60"
      disabled={disabled || !interactive}
      onClick={() => void onClick?.()}
      type="button"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground text-sm">
          {title}
        </span>
        <span className="block truncate text-muted-foreground text-xs">
          {subtitle}
        </span>
      </span>
      {action ? (
        <span className="shrink-0 text-muted-foreground text-sm">{action}</span>
      ) : null}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
      <path
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9l3.3-2.5Z"
        fill="#FBBC05"
      />
      <path
        d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5L6.4 10c.8-2.3 3-4 5.6-4Z"
        fill="#EA4335"
      />
    </svg>
  );
}
