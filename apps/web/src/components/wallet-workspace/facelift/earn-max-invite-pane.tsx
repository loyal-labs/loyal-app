"use client";

import { useEffect, useRef, useState } from "react";

import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";

const ASSET_BASE = "/wallet-workspace/facelift";
const CODE_LENGTH = 6;

type Status = "idle" | "checking" | "invalid" | "error";

// Figma 6015:74177 (empty) / 74280 (typing) / 74388 (checking) / 74497
// (invalid) / 74658 (mobile). Six cells, auto-submit on the sixth
// character; no button and no success screen — a valid code reveals the
// normal Earn MAX view.
export function EarnMaxInvitePane({
  apyBadgeLabel,
  onBack,
  onRedeem,
  tooltipText,
}: {
  apyBadgeLabel: string;
  onBack: () => void;
  onRedeem: (code: string) => Promise<"redeemed" | "invalid" | "error">;
  tooltipText: string;
}) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (value: string) => {
    setStatus("checking");
    const result = await onRedeem(value);
    if (result === "redeemed") return;
    setStatus(result === "invalid" ? "invalid" : "error");
    inputRef.current?.focus();
  };

  const handleChange = (raw: string) => {
    if (status === "checking") return;
    const next = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, CODE_LENGTH);
    setCode(next);
    setStatus("idle");
    if (next.length === CODE_LENGTH) void submit(next);
  };

  const isError = status === "invalid" || status === "error";
  const focusIndex =
    status === "idle" ? Math.min(code.length, CODE_LENGTH - 1) : -1;

  return (
    <section className="relative flex h-full min-w-0 flex-1 flex-col items-center rounded-3xl bg-card max-[795px]:rounded-none">
      <header className="flex w-full items-center p-2">
        <button
          aria-label="Back"
          className="t-hover hidden size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent max-[795px]:flex"
          onClick={onBack}
          type="button"
        >
          <ThemedIcon
            className="size-6 text-muted-foreground"
            src={`${ASSET_BASE}/icon-arrow-left.svg`}
          />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-start py-2 pl-4 max-[795px]:pl-1">
          <div className="flex items-center gap-2">
            <h1 className="whitespace-nowrap font-semibold text-[24px] text-foreground leading-7 max-[795px]:text-[20px] max-[795px]:leading-6">
              Earn MAX
            </h1>
            <span className="max-[795px]:hidden">
              <InfoTooltip
                iconClassName="size-6"
                placement="bottom"
                text={tooltipText}
              />
            </span>
          </div>
          <span className="hidden items-center rounded-md bg-positive/[0.14] px-1 py-px max-[795px]:inline-flex">
            <span className="whitespace-nowrap pt-px font-medium text-[11px] text-positive leading-[13px] tracking-[0.06px]">
              {apyBadgeLabel}
            </span>
          </span>
        </div>
        <span className="hidden size-11 shrink-0 items-center justify-center max-[795px]:flex">
          <InfoTooltip iconClassName="size-6" placement="bottom" text={tooltipText} />
        </span>
      </header>

      <div className="flex w-full flex-1 flex-col items-center justify-center pb-16 max-[795px]:justify-start">
        <div className="flex w-full flex-col items-center gap-3 p-8 text-center">
          <h2 className="w-[232px] font-bold text-[28px] text-foreground uppercase leading-8 tracking-[-0.28px]">
            Earn MAX is invite only
          </h2>
          <p className="w-[192px] text-[16px] text-muted-foreground leading-5 tracking-[-0.16px]">
            If you have an invite code, enter it below
          </p>
        </div>

        {/* One real input under six drawn cells: keeps paste, mobile
            keyboards and autofill working without per-cell focus juggling. */}
        <label className="relative flex w-full flex-col items-center">
          <input
            aria-invalid={isError}
            aria-label="Invite code"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            autoCorrect="off"
            className="absolute inset-0 h-[60px] w-full cursor-text opacity-0"
            disabled={status === "checking"}
            maxLength={CODE_LENGTH}
            onChange={(event) => handleChange(event.target.value)}
            ref={inputRef}
            spellCheck={false}
            value={code}
          />
          <span aria-hidden="true" className="flex justify-center gap-1">
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <span
                className={`flex h-[60px] w-11 items-center justify-center rounded-3xl font-semibold text-[20px] uppercase leading-5 tracking-[-0.2px] ${
                  isError
                    ? "bg-destructive/[0.14] text-destructive"
                    : status === "checking"
                    ? "bg-foreground/[0.04] text-muted-foreground"
                    : "bg-foreground/[0.04] text-foreground"
                } ${index === focusIndex ? "border border-foreground" : ""}`}
                key={index}
              >
                {code[index] ?? ""}
              </span>
            ))}
          </span>
          <span
            className={`flex w-full justify-center px-6 pt-4 text-[16px] text-destructive leading-5 tracking-[-0.16px] ${
              isError ? "" : "opacity-0"
            }`}
            role={isError ? "alert" : undefined}
          >
            {status === "error" ? "Something went wrong. Try again" : "Invalid code"}
          </span>
        </label>
      </div>
    </section>
  );
}
