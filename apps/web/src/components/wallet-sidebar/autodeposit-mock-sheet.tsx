"use client";

import { Image as ImagePlaceholderIcon, Scan, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";

const MOCK_STEPS = [
  { description: "Description", title: "Title" },
  { description: "Description", title: "Title" },
  { description: "Description", title: "Title" },
];

const OPEN_EVENT = "loyal:autodeposit-mock-sheet-open";

/** Opens the sheet from anywhere; the surface is mounted once in the app shell
 * so it survives viewport-driven remounts of the pane that triggered it. */
export function openAutodepositMockSheet() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function AutodepositMockSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogPortal>
        <DialogOverlay className="t-modal-overlay" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="t-modal fixed z-[70] flex flex-col items-center overflow-hidden bg-white outline-none max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[calc(100dvh-24px)] max-sm:rounded-t-[20px] sm:left-1/2 sm:top-1/2 sm:max-h-[calc(100vh-32px)] sm:w-[420px] sm:max-w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px]"
        >
          <DialogTitle className="sr-only">Title</DialogTitle>

          {/* Desktop content */}
          <div className="hidden min-h-0 w-full flex-col items-start sm:flex">
            <div className="flex h-[452px] w-full items-center justify-center bg-[#f5f5f5]">
              <ImagePlaceholderIcon
                className="size-16 text-[#c7c7cc]"
                strokeWidth={1.5}
              />
            </div>
            <div className="flex w-full flex-col justify-center gap-3 px-5 pb-3 pt-5">
              <p className="text-[24px] font-semibold leading-6 tracking-[-0.48px] text-black">
                Title
              </p>
              <p className="text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
                Description Text
              </p>
            </div>
          </div>

          {/* Mobile content */}
          <div className="flex min-h-0 w-full flex-col items-start overflow-y-auto p-2 sm:hidden">
            <div className="flex w-full flex-col gap-7 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-24"
                src="/wallet-workspace/autodeposit-coil-icon.svg"
              />
              <div className="flex w-full flex-col gap-4 pr-4">
                <p className="text-[36px] font-semibold leading-10 tracking-[-0.72px] text-black">
                  Title
                </p>
                <p className="text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
                  Description
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col">
              {MOCK_STEPS.map((step, index) => (
                <div className="flex w-full px-3" key={index}>
                  <div className="flex py-2 pr-3">
                    <Scan
                      className="size-7 text-[rgba(60,60,67,0.3)]"
                      strokeWidth={1.5}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
                    <p className="text-[16px] font-medium leading-5 text-black">
                      {step.title}
                    </p>
                    <p className="text-[15px] leading-5 text-[rgba(60,60,67,0.6)]">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full bg-white px-5 pb-4 pt-2">
            <DialogClose asChild>
              <button
                className="flex h-[50px] w-full items-center justify-center rounded-full bg-black px-3 text-[17px] font-medium text-white transition-colors hover:bg-[#1a1a1a] sm:text-[16px]"
                type="button"
              >
                Action
              </button>
            </DialogClose>
          </div>

          <div className="absolute inset-x-0 top-0 flex items-center justify-end py-2 pr-2">
            <DialogClose asChild>
              <button
                aria-label="Close"
                className="flex size-11 items-center justify-center rounded-full bg-black/[0.04] text-[#3C3C43] transition-colors hover:bg-black/[0.08]"
                type="button"
              >
                <X size={22} />
              </button>
            </DialogClose>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
