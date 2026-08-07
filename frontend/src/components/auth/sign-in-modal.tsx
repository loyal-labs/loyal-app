"use client";

import { Check, Copy, LogOut, Unplug, XIcon } from "lucide-react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthCapability } from "@/lib/auth/capability";
import { useAuthSession } from "@/contexts/auth-session-context";
import { useSignInModal } from "@/contexts/sign-in-modal-context";
import { useCherryRuntime } from "@/features/cherry/client/runtime-context";

import { WalletSignIn } from "./wallet-sign-in";

function ConnectedView() {
  const { publicKey, disconnect } = useWallet();
  const { logout, user } = useAuthSession();
  const { close } = useSignInModal();
  const { hasAuthSession, hasWalletConnection } = useAuthCapability();
  const cherryRuntime = useCherryRuntime();
  const [copied, setCopied] = useState(false);
  const address = publicKey?.toBase58() ?? user?.displayAddress ?? "";

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  return (
    <div className="flex flex-col gap-5 px-6 pb-6">
      <div className="rounded-[28px] bg-secondary p-4">
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-card">
            <Image
              alt=""
              className="h-full w-full object-cover"
              height={64}
              src="/agents/Agent-03.svg"
              width={64}
            />
            <span className="-right-1 -bottom-1 absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-secondary bg-positive">
              <Check aria-hidden="true" className="h-3.5 w-3.5 text-white" />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[22px] text-foreground leading-7">
              {hasWalletConnection ? "Connected" : "Signed in"}
            </p>
            <p className="mt-1 text-muted-foreground text-sm">
              Wallet workspace is ready.
            </p>
          </div>
        </div>

        {address ? (
          <button
            className="mt-4 flex w-full items-center gap-2 rounded-full bg-card px-4 py-3 text-left transition hover:bg-card/90"
            onClick={handleCopy}
            title="Copy address"
            type="button"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-sm">
              {address}
            </span>
            {copied ? (
              <Check className="h-4 w-4 shrink-0 text-positive" />
            ) : (
              <Copy className="h-4 w-4 shrink-0 text-tertiary" />
            )}
          </button>
        ) : null}
      </div>

      {cherryRuntime.mode === "standalone" ? (
        <div className="flex flex-col gap-2">
          {hasAuthSession ? (
            <button
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 font-medium text-background text-sm transition hover:bg-foreground/90"
              onClick={async () => {
                await Promise.allSettled([logout(), disconnect()]);
                close();
              }}
              type="button"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          ) : null}
          {hasWalletConnection ? (
            <button
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-destructive/15 px-4 font-medium text-destructive text-sm transition hover:bg-destructive/25"
              onClick={async () => {
                await disconnect();
                close();
              }}
              type="button"
            >
              <Unplug className="h-4 w-4" />
              Disconnect wallet
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SignInModal() {
  const { isOpen, close } = useSignInModal();
  const { hasAuthSession } = useAuthCapability();
  const cherryRuntime = useCherryRuntime();

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close();
      }
    },
    [close]
  );

  // transitions-dev "modal open/close": the raw Radix content carries the
  // t-modal hooks (like autodeposit-mock-sheet) instead of shadcn's
  // DialogContent, whose baked-in animate-in/out classes would fight the
  // recipe keyframes. t-modal-center keeps the scale below 640px too — this
  // surface stays centered on mobile, it never becomes a bottom sheet.
  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <DialogPortal>
        <DialogOverlay className="t-modal-overlay" />
        <DialogPrimitive.Content className="t-modal t-modal-center fixed top-[50%] left-[50%] z-[70] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] overflow-hidden rounded-[32px] border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.2)] outline-none sm:max-w-[480px]">
          {hasAuthSession ? (
            <>
              <DialogHeader className="px-6 pt-6 pb-5 text-left">
                <DialogTitle className="font-semibold text-[28px] text-foreground leading-8">
                  Account
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Signed in
                </DialogDescription>
              </DialogHeader>
              <ConnectedView />
            </>
          ) : (
            <>
              <DialogHeader className="px-6 pt-6 pb-5 text-left">
                <DialogTitle className="font-semibold text-[28px] text-foreground leading-8">
                  {cherryRuntime.mode === "cherry_embedded"
                    ? "Verify"
                    : "Connect"}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Complete verification, then choose your sign-in method.
                </DialogDescription>
              </DialogHeader>
              <div className="px-6 pb-6">
                <WalletSignIn />
              </div>
            </>
          )}
          <DialogClose className="absolute top-5 right-5 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-muted-foreground transition hover:bg-accent-active hover:text-foreground">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
