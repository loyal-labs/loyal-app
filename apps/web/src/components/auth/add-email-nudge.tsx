"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Mail, X } from "lucide-react";
import { useEffect, useState } from "react";

import { usePrivyAuth } from "@/components/auth/privy-session-sync";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useCherryRuntime } from "@/features/cherry/client/runtime-context";

// One-time nudge for users signed in through the legacy wallet flow (no Privy
// user yet). "Add" runs the same wallet through Privy and asks for an email;
// the cross remembers the dismissal. Expands/collapses on the accordion
// recipe so it never snaps the layout.
const DISMISSED_KEY = "loyal:add-email-nudge-dismissed";

export function AddEmailNudge() {
  const { privyAppId } = usePublicEnv();
  const cherryRuntime = useCherryRuntime();
  const { isHydrated, isAuthenticated } = useAuthSession();
  const { ready, authenticated } = usePrivy();
  const privyAuth = usePrivyAuth();
  const [isOpen, setIsOpen] = useState(false);

  const eligible =
    Boolean(privyAppId) &&
    cherryRuntime.mode === "standalone" &&
    isHydrated &&
    isAuthenticated &&
    ready &&
    !authenticated;

  useEffect(() => {
    setIsOpen(eligible && localStorage.getItem(DISMISSED_KEY) !== "1");
  }, [eligible]);

  if (!privyAppId) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setIsOpen(false);
  };

  return (
    <div className="t-acc w-full" data-open={isOpen ? "true" : "false"}>
      <div className="t-acc-panel">
        <div className="t-acc-panel-inner">
          <div className="flex items-center rounded-2xl bg-accent py-1 pr-2 pl-4">
            <span className="mr-3 flex size-11 shrink-0 items-center justify-center text-tertiary">
              <Mail className="size-6" />
            </span>
            <span className="min-w-0 flex-1 py-2">
              <span className="block font-medium text-[16px] text-foreground leading-5">
                Add your email
              </span>
              <span className="block truncate text-muted-foreground text-[13px] leading-4">
                Updates and recovery.
              </span>
            </span>
            <button
              className="t-hover ml-3 shrink-0 rounded-full bg-foreground px-4 py-2.5 font-medium text-[13px] text-background leading-4 enabled:hover:-translate-y-0.5 enabled:hover:bg-foreground/90 enabled:active:translate-y-0 disabled:opacity-40"
              disabled={!privyAuth || privyAuth.step !== "idle"}
              onClick={() => privyAuth?.addEmail()}
              type="button"
            >
              Add
            </button>
            <button
              aria-label="Dismiss"
              className="t-hover ml-1 flex size-9 shrink-0 items-center justify-center rounded-3xl text-tertiary hover:bg-accent-selected"
              onClick={dismiss}
              type="button"
            >
              <X className="size-5" />
            </button>
          </div>
          {/* Gap to whatever follows (room for the banner carousel dots on
              mobile); inside the panel so it collapses too. */}
          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}
