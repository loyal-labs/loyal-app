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

import { WalletSignIn } from "./wallet-sign-in";

function ConnectedView() {
  const { publicKey, disconnect } = useWallet();
  const { logout, user } = useAuthSession();
  const { close } = useSignInModal();
  const { hasAuthSession, hasWalletConnection } = useAuthCapability();
  const [copied, setCopied] = useState(false);
  const address = publicKey?.toBase58() ?? user?.displayAddress ?? "";

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [address]);

  return (
    <div className="flex flex-col gap-5 px-6 pb-6">
      <div className="rounded-[28px] bg-[#f5f5f5] p-4">
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white">
            <Image
              alt=""
              className="h-full w-full object-cover"
              height={64}
              src="/agents/Agent-03.svg"
              width={64}
            />
            <span className="-right-1 -bottom-1 absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-[#f5f5f5] bg-[#24c45a]">
              <Check aria-hidden="true" className="h-3.5 w-3.5 text-white" />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[22px] text-neutral-950 leading-7">
              {hasWalletConnection ? "Connected" : "Signed in"}
            </p>
            <p className="mt-1 text-neutral-500 text-sm">
              Wallet workspace is ready.
            </p>
          </div>
        </div>

        {address ? (
          <button
            className="mt-4 flex w-full items-center gap-2 rounded-full bg-white px-4 py-3 text-left transition hover:bg-neutral-50"
            onClick={handleCopy}
            title="Copy address"
            type="button"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-neutral-500 text-sm">
              {address}
            </span>
            {copied ? (
              <Check className="h-4 w-4 shrink-0 text-[#24c45a]" />
            ) : (
              <Copy className="h-4 w-4 shrink-0 text-neutral-400" />
            )}
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        {hasAuthSession ? (
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-neutral-950 px-4 font-medium text-sm text-white transition hover:bg-neutral-800"
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
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#fde8e9] px-4 font-medium text-[#f9363c] text-sm transition hover:bg-[#fadadb]"
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
    </div>
  );
}

export function SignInModal() {
  const { isOpen, close } = useSignInModal();
  const { hasAuthSession } = useAuthCapability();

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
        <DialogPrimitive.Content className="t-modal t-modal-center fixed top-[50%] left-[50%] z-[70] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] overflow-hidden rounded-[32px] border border-black/10 bg-white text-neutral-950 shadow-[0_24px_70px_rgba(0,0,0,0.2)] outline-none sm:max-w-[480px]">
          {hasAuthSession ? (
            <>
              <DialogHeader className="px-6 pt-6 pb-5 text-left">
                <DialogTitle className="font-semibold text-[28px] text-neutral-950 leading-8">
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
                <DialogTitle className="font-semibold text-[28px] text-neutral-950 leading-8">
                  Connect
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
          <DialogClose className="absolute top-5 right-5 flex h-11 w-11 items-center justify-center rounded-full bg-black/[0.04] text-neutral-500 transition hover:bg-black/[0.08] hover:text-neutral-900">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
