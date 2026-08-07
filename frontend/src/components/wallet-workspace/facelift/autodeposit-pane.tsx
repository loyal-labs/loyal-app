"use client";

import {
  ArrowRightLeft,
  CalendarClock,
  Radar,
  Undo2,
  Wallet,
} from "lucide-react";
import { useState } from "react";

import { sanitizeBucksAmountInput } from "@/components/wallet-sidebar/earn-detail-view";
import {
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import {
  FlowDiagram,
  FlowExplainerAside,
  FlowExplainerOverlay,
  type FlowStep,
} from "@/components/wallet-workspace/facelift/flow-explainer";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { useStablecoinsUsd } from "@/components/wallet-workspace/facelift/use-stablecoins-usd";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";

const ASSET_BASE = "/wallet-workspace/facelift";

function parseAmountUsd(value: string) {
  return Number.parseFloat(value.replace(/,/g, "")) || 0;
}

const AUTODEPOSIT_DOCS_URL = "https://docs.askloyal.com/earn/autodeposit";

// The pipeline a sweep travels, told as steps (user-docs/earn/autodeposit.mdx
// "Execution"), with the trust facts the old flat rows carried — the on-chain
// primitive, the permission scope, and how it's undone — folded into the
// step bodies. Mirrors mobile's AutodepositInfoSheet content.
const AUTODEPOSIT_STEPS: readonly FlowStep[] = [
  {
    Icon: Wallet,
    body: "Pick how much of your stablecoins to keep liquid. Everything above that floor is eligible for Earn — change it anytime.",
    title: "You set the amount to keep",
  },
  {
    Icon: Radar,
    body: "A native Solana subscription — a standard, auditable on-chain permission — notices when your balance rises above the floor.",
    title: "Loyal watches your wallet",
  },
  {
    Icon: CalendarClock,
    body: "The eligible amount is queued while Loyal re-verifies your balance and the on-chain limits. You can also execute it right away.",
    title: "The surplus gets scheduled",
  },
  {
    Icon: ArrowRightLeft,
    body: "Your smart account moves the surplus along one approved path into Kamino reserves — no signing each time.",
    title: "Deposited for you",
  },
  {
    Icon: Undo2,
    body: "The deposit starts earning immediately. Delete Autodeposit anytime to revoke its permission and get back the SOL held as rent.",
    title: "Earning — and reversible",
  },
];

// "How Autodeposit works" as an overlay: card next to the sidebar below
// 1204px (Figma 4693:69792), bottom sheet on mobile (Figma 4693:71793) —
// where it rises on the panel-reveal clock like a native sheet.
// Also reachable from the Earn screen's mobile "?" (Figma 4693:70364).
export function AutodepositInfoOverlay({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <FlowExplainerOverlay
      isOpen={isOpen}
      onClose={onClose}
      title="How Autodeposit works"
    >
      <FlowDiagram docsHref={AUTODEPOSIT_DOCS_URL} steps={AUTODEPOSIT_STEPS} />
    </FlowExplainerOverlay>
  );
}

// Figma 4693:69332 (create, wide) / 4693:75306 (edit: Delete + Confirm) /
// 4693:75556 (edit, unchanged: "No changes yet") / 4693:69662+69792 (narrow:
// ? in the header opens the info panel as an overlay). Create/Confirm run
// through data.actions.saveAutodeposit (floor-only edits are a signature-less
// rebaseline, like the OG); Delete is the two-click close flow.
export function AutodepositPane({
  data,
  onBack,
}: {
  data: EarnPositionData;
  onBack: () => void;
}) {
  const autodeposit = data.autodepositConfig;
  const { actions } = data;
  const isEdit = Boolean(autodeposit);
  const initialAmount = autodeposit
    ? sanitizeBucksAmountInput(
        autodeposit.keepAmount.replace(/\.00$/, ""),
        ""
      ) ?? ""
    : "";
  const [amount, setAmount] = useState(initialAmount);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const { isBalanceHidden } = useBalanceVisibility();
  // Delete is two-click, mirroring the OG's close-review screen: the first
  // click flips the rule to "closing" (and pre-prepares the close tx), the
  // second signs it. Backing out dismisses like the OG's review dismiss.
  const isDeleteArmed = autodeposit?.state === "closing";
  const isSaving = actions.isAutodepositPending;
  const handleDelete = async () => {
    if (!isDeleteArmed) {
      actions.requestAutodepositClose();
      return;
    }
    const didClose = await actions.confirmAutodepositClose();
    if (didClose) {
      onBack();
    }
  };
  const handleBack = () => {
    if (isDeleteArmed) {
      actions.dismissAutodepositClose();
    }
    onBack();
  };
  const handleSave = async () => {
    const didSave = await actions.saveAutodeposit(amount || "0");
    if (didSave) {
      onBack();
    }
  };

  const stablecoinsUsd = useStablecoinsUsd();
  const stablecoinsBalance = splitUsdBalance(stablecoinsUsd);
  const earnBalance = splitUsdBalance(data.earnBalanceUsd);
  const addressLabel = data.walletAddress
    ? `${data.walletAddress.slice(0, 4)}…${data.walletAddress.slice(-4)}`
    : "";

  const hasChanges =
    !isEdit ||
    parseAmountUsd(amount) !== parseAmountUsd(autodeposit?.keepAmount ?? "0");

  const handleAmountChange = (rawValue: string) => {
    const sanitized = sanitizeBucksAmountInput(rawValue, amount);
    if (sanitized !== null) {
      setAmount(sanitized);
    }
  };

  return (
    <>
      <section className="flex h-full min-w-0 flex-1 flex-col overflow-clip rounded-3xl bg-card max-[795px]:rounded-none">
        <header className="flex w-full items-center p-2">
          <div className="pr-3">
            <button
              aria-label="Back"
              className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-accent"
              onClick={handleBack}
              type="button"
            >
              <ThemedIcon
                className="size-6 text-muted-foreground"
                src={`${ASSET_BASE}/icon-arrow-left.svg`}
              />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 py-2">
            <h1 className="truncate font-semibold text-[20px] text-foreground leading-6">
              Autodeposit
            </h1>
            <button
              aria-label="How Autodeposit works"
              className="t-hover -m-2.5 flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent min-[1204px]:hidden"
              onClick={() => setIsInfoOpen(true)}
              type="button"
            >
              <ThemedIcon
                className="size-6 text-tertiary"
                src={`${ASSET_BASE}/icon-question.svg`}
              />
            </button>
          </div>
          {isEdit ? (
            <div className="flex items-start pl-3">
              <button
                className="t-hover flex items-center justify-center gap-2 rounded-full bg-destructive/[0.08] p-2.5 enabled:hover:-translate-y-0.5 enabled:hover:bg-destructive/[0.14] enabled:active:translate-y-0 disabled:opacity-60"
                disabled={isSaving}
                onClick={() => void handleDelete()}
                type="button"
              >
                <ThemedIcon
                  className="size-6 text-destructive"
                  src={`${ASSET_BASE}/icon-trash-red.svg`}
                />
                <span className="whitespace-nowrap pr-2.5 font-medium text-destructive text-[16px] leading-5">
                  <TextSwap
                    text={isDeleteArmed ? "Confirm delete" : "Delete"}
                  />
                </span>
              </button>
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 w-full flex-1 flex-col">
          <div className="flex w-full flex-1 flex-col">
            <div className="w-full p-2">
              <label className="flex w-full flex-col gap-0.5 rounded-2xl px-4 py-2">
                <span className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
                  Deposit anything above
                </span>
                <span className="flex h-12 w-full items-baseline">
                  <span className="font-semibold text-[40px] text-foreground leading-[48px]">
                    $
                  </span>
                  <input
                    autoFocus
                    className="min-w-0 flex-1 border-none bg-transparent font-semibold text-[40px] text-foreground leading-[48px] outline-none placeholder:text-tertiary"
                    inputMode="decimal"
                    onChange={(event) => handleAmountChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.repeat) {
                        return;
                      }
                      event.preventDefault();
                      if (hasChanges && !isSaving) {
                        void handleSave();
                      }
                    }}
                    placeholder="0"
                    type="text"
                    value={amount}
                  />
                </span>
              </label>
            </div>

            <div className="w-full px-2">
              <div className="flex w-full items-start px-4">
                <div className="flex items-center py-1 pr-2">
                  <ThemedIcon
                    className="size-6 text-primary"
                    src={`${ASSET_BASE}/icon-exclamation-circle.svg`}
                  />
                </div>
                <p className="min-w-0 max-w-[400px] flex-1 py-2 text-primary text-[13px] leading-4">
                  Any stablecoins above this amount will automatically go to
                  Earn
                </p>
              </div>
            </div>
          </div>

          <div className="relative flex h-36 w-full flex-col gap-1 overflow-clip p-2">
            <div className="flex w-full items-center rounded-2xl px-4">
              <div className="py-2 pr-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-11"
                  src={`${ASSET_BASE}/stablecoins-icon.svg`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                <span className="truncate text-[13px] leading-4 text-muted-foreground">
                  {`from Stablecoins · ${addressLabel}`}
                </span>
                <p className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
                  <ScrambleText
                    isHidden={isBalanceHidden}
                    text={stablecoinsBalance.balanceWhole}
                  />
                  <span className="text-tertiary">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={stablecoinsBalance.balanceFraction}
                    />
                  </span>
                </p>
              </div>
            </div>

            <div className="flex w-full items-center rounded-2xl px-4">
              <div className="py-2 pr-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-11"
                  src={`${ASSET_BASE}/earn-icon.svg`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                  to Earn
                </span>
                <p className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
                  <ScrambleText
                    isHidden={isBalanceHidden}
                    text={earnBalance.balanceWhole}
                  />
                  <span className="text-tertiary">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={earnBalance.balanceFraction}
                    />
                  </span>
                </p>
              </div>
            </div>

            <div className="-translate-y-1/2 absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 rounded-xl bg-border" />
          </div>
        </div>

        <div className="w-full bg-card px-4 pt-2 pb-4">
          {actions.autodepositError ? (
            <p className="px-4 pb-2 text-[13px] leading-4 text-destructive">
              {actions.autodepositError}
            </p>
          ) : null}
          {/* One persistent pill so the label swaps in place (transitions.dev
              text states swap); disabled stands in for the old inert div. */}
          <button
            className={`t-hover flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 ${
              hasChanges
                ? "bg-foreground text-background enabled:hover:-translate-y-0.5 enabled:hover:bg-foreground/90 enabled:active:translate-y-0"
                : "bg-accent text-muted-foreground"
            }`}
            disabled={!hasChanges || isSaving}
            onClick={() => void handleSave()}
            type="button"
          >
            <TextSwap
              text={
                isSaving
                  ? isDeleteArmed
                    ? "Deleting…"
                    : "Saving…"
                  : hasChanges
                  ? isEdit
                    ? "Confirm"
                    : "Create Autodeposit"
                  : "No changes yet"
              }
            />
          </button>
        </div>
      </section>

      {/* Info panel: fixed right pane on wide viewports (Figma 4693:69387),
          overlay via the header ? below 1204px (Figma 4693:69792). */}
      <FlowExplainerAside title="How Autodeposit works">
        <FlowDiagram
          docsHref={AUTODEPOSIT_DOCS_URL}
          steps={AUTODEPOSIT_STEPS}
        />
      </FlowExplainerAside>

      <AutodepositInfoOverlay
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
      />
    </>
  );
}
