"use client";

import { useEffect, useId, useRef, useState } from "react";

import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";

import styles from "./earn-max-invite-pane.module.css";

const ASSET_BASE = "/wallet-workspace/facelift";
const CODE_LENGTH = 6;

type InviteError = "invalid" | "error";

// Figma 6015:74177 (empty) / 74280 (typing) / 74388 (checking) / 74497
// (invalid) / 74658 (mobile). Six cells, auto-submit on the sixth
// character; no button and no success screen — a valid code reveals the
// normal Earn MAX view.
export function EarnMaxInvitePane({
  onBack,
  onRedeem,
  tooltipText,
}: {
  onBack: () => void;
  onRedeem: (code: string) => Promise<"redeemed" | "invalid" | "error">;
  tooltipText: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<InviteError | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [caret, setCaret] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLSpanElement>(null);
  const submittingRef = useRef(false);
  const errorId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (value: string) => {
    if (submittingRef.current || value.length !== CODE_LENGTH) return;
    submittingRef.current = true;
    setIsChecking(true);
    try {
      const result = await onRedeem(value);
      if (result === "redeemed") return;
      setError(result);
      if (result === "invalid" && rowRef.current) {
        rowRef.current.classList.remove(styles.shaking);
        void rowRef.current.offsetWidth;
        rowRef.current.classList.add(styles.shaking);
      }
    } catch {
      setError("error");
    } finally {
      submittingRef.current = false;
      setIsChecking(false);
    }
  };

  const handleChange = (raw: string) => {
    if (submittingRef.current) return;
    const next = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, CODE_LENGTH);
    if (next === code) return;
    setCode(next);
    setError(null);
    rowRef.current?.classList.remove(styles.shaking);
    if (next.length === CODE_LENGTH) void submit(next);
  };

  const isInvalid = error === "invalid";
  const focusIndex = isFocused ? Math.min(caret, CODE_LENGTH - 1) : -1;

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
        </div>
        <span className="hidden size-11 shrink-0 items-center justify-center max-[795px]:flex">
          <InfoTooltip
            iconClassName="size-6"
            placement="bottom"
            text={tooltipText}
          />
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
        <label
          className={`${styles.field} relative flex w-full flex-col items-center`}
        >
          <input
            aria-busy={isChecking}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={isInvalid}
            aria-label="Invite code"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            autoCorrect="off"
            className="absolute top-0 h-[60px] w-[284px] cursor-text text-[20px] opacity-0"
            enterKeyHint="go"
            onBlur={() => setIsFocused(false)}
            onChange={(event) => handleChange(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit(code);
              }
            }}
            onSelect={(event) =>
              setCaret(event.currentTarget.selectionStart ?? code.length)
            }
            readOnly={isChecking}
            ref={inputRef}
            spellCheck={false}
            value={code}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none flex justify-center gap-1"
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) {
                event.currentTarget.classList.remove(styles.shaking);
              }
            }}
            ref={rowRef}
          >
            {Array.from({ length: CODE_LENGTH }, (_, index) => (
              <span
                className={`${
                  styles.cell
                } flex h-[60px] w-11 items-center justify-center rounded-3xl border font-semibold text-[20px] uppercase leading-5 tracking-[-0.2px] ${
                  isInvalid
                    ? "bg-destructive/[0.14] text-destructive"
                    : isChecking
                    ? "bg-foreground/[0.04] text-muted-foreground"
                    : "bg-foreground/[0.04] text-foreground"
                } ${
                  index === focusIndex
                    ? "border-foreground"
                    : "border-transparent"
                }`}
                key={index}
              >
                <span className="t-digit-group is-animating">
                  <span className="t-digit" key={code[index] ?? ""}>
                    {code[index] ?? ""}
                  </span>
                </span>
              </span>
            ))}
          </span>
          <span
            className={`${styles.message} flex min-h-9 w-full justify-center px-6 pt-4 text-[16px] text-destructive leading-5 tracking-[-0.16px]`}
            data-visible={error !== null}
            id={errorId}
            role="alert"
          >
            {error === "error"
              ? "Could not check code. Press Enter to retry"
              : error === "invalid"
              ? "Invalid code"
              : ""}
          </span>
          <span className="sr-only" role="status">
            {isChecking ? "Checking code" : ""}
          </span>
        </label>
      </div>
    </section>
  );
}
