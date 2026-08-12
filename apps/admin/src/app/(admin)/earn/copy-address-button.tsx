"use client";

import { Check, Copy, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function CopyAddressButton({ address }: { address: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2_000);
    } catch {
      setState("error");
      window.setTimeout(() => setState("idle"), 2_000);
    }
  }

  const label =
    state === "copied"
      ? "Copied"
      : state === "error"
      ? "Copy failed"
      : "Copy address";
  const Icon = state === "copied" ? Check : state === "error" ? X : Copy;

  return (
    <Button
      aria-label={`${label}: ${address}`}
      onClick={copyAddress}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}
