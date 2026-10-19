"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/components/wallet-workspace/facelift/copy-text";
import { EarnModal } from "@/components/wallet-workspace/facelift/earn-modal";
import { earnToast } from "@/components/wallet-workspace/facelift/earn-toast";
import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import { MobileTabBar } from "@/components/wallet-workspace/facelift/mobile-tab-bar";
import { PaneReveal } from "@/components/wallet-workspace/facelift/pane-transitions";
import { PopDigits } from "@/components/wallet-workspace/facelift/pop-digits";
import type { WorkspacePage } from "@/components/wallet-workspace/facelift/shell";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { useIsNarrowViewport } from "@/components/wallet-workspace/facelift/use-is-narrow-viewport";

const ASSETS = "/wallet-workspace/facelift";

// Presentation fixtures only; rewards, eligibility and balances are not connected.
const QUESTS = [
  { title: "Follow Loyal on X", icon: "quests/quest-x.svg", state: "claim" },
  {
    title: "Join Telegram community",
    icon: "quests/quest-telegram.svg",
    state: "available",
  },
  {
    title: "Buy $LOYAL on Jupiter",
    icon: "quests/quest-jupiter.svg",
    state: "available",
  },
  {
    title: "Deposit at least $100 into Earn",
    icon: "earn-icon.svg",
    state: "available",
  },
  {
    title: "Set up Autodeposit",
    icon: "autodeposit-icon.svg",
    state: "locked",
  },
  { title: "Set up Autoswap", icon: "autoswap-icon.svg", state: "locked" },
  {
    title: "Link your email to your account",
    icon: "quests/quest-email.svg",
    state: "completed",
  },
] as const;

function Bone({ className = "size-5" }: { className?: string }) {
  return <ThemedIcon className={className} src={`${ASSETS}/icon-bone.svg`} />;
}

function Amount({ value }: { value: string }) {
  const [whole, fraction] = value.split(".");
  return (
    <PopDigits
      segments={[
        { text: whole },
        { text: `.${fraction}`, color: "var(--tertiary)" },
      ]}
    />
  );
}

function Multiplier({ value }: { value: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[13px] leading-4 text-muted-foreground">
      <ThemedIcon
        className="size-2.5"
        src={`${ASSETS}/quests/quest-multiplier.svg`}
      />
      ×{value}
    </span>
  );
}

function EarningCard({
  kind,
  inProgress,
  mobile,
  onAction,
}: {
  kind: "earn" | "loyal";
  inProgress: boolean;
  mobile: boolean;
  onAction: () => void;
}) {
  const isEarn = kind === "earn";
  const cooldown = inProgress && (mobile ? !isEarn : isEarn);
  const amount = inProgress
    ? isEarn || mobile
      ? "1,248.56"
      : "948.32"
    : "0.00";
  return (
    <article
      className={`flex h-[340px] min-w-0 flex-col rounded-3xl bg-accent p-4 ${
        cooldown ? "max-[795px]:h-[360px]" : "max-[795px]:h-[308px]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="size-11 shrink-0 rounded-[11px]"
            src={`${ASSETS}/${
              isEarn ? "earn-icon.svg" : "quests/loyal-token.png"
            }`}
          />
          <h2 className="text-[16px] leading-5">
            {isEarn ? "Keep cash in Earn" : "Hold $LOYAL"}
          </h2>
        </div>
        <InfoTooltip
          iconClassName="size-5"
          placement="bottom"
          text={
            isEarn
              ? "Keep cash in Earn to collect Bones. Your streak grows while you keep your deposit."
              : "Hold $LOYAL to collect Bones. Your streak grows while you keep your tokens."
          }
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col py-4">
        <div className="py-2">
          <p className="mb-1 text-[13px] leading-4 text-muted-foreground">
            {mobile && inProgress ? "Total earned" : "Bones earned"}
          </p>
          <p className="flex items-center gap-1 font-semibold text-[28px] leading-8 tabular-nums">
            <Amount value={amount} />
            <Bone className="size-5 text-tertiary" />
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 py-2">
          <div className="flex flex-col items-start gap-1">
            <p className="text-[13px] leading-4 text-muted-foreground">
              {isEarn ? "Earn balance" : "$LOYAL held"}
            </p>
            <p className="font-medium text-[16px] leading-5">
              <Amount value={inProgress ? "$1,248.56" : "$0.00"} />
            </p>
            <Multiplier value={inProgress && isEarn ? "1.25" : "0.25"} />
          </div>
          <div className="flex flex-col items-start gap-1">
            <p className="text-[13px] leading-4 text-muted-foreground">
              Streak
            </p>
            <p className="flex items-center gap-1 text-[16px] leading-5">
              <ThemedIcon
                className="size-5 text-tertiary"
                src={`${ASSETS}/quests/quest-streak.svg`}
              />
              {inProgress ? (isEarn || mobile ? "7D" : "4D") : "0D"}
            </p>
            <Multiplier value={inProgress ? "1.25" : "1.00"} />
          </div>
        </div>
        {cooldown && (
          <p className="mx-auto mt-auto max-w-[210px] pt-4 text-center text-[11px] leading-[13px] text-muted-foreground">
            Withdrawing liquidity will reset Bones to zero for the current
            claiming epoch
          </p>
        )}
      </div>
      <Button
        className={`t-hover h-12 w-full rounded-full px-4 text-[16px] leading-5 shadow-none disabled:opacity-100 ${
          inProgress && !cooldown
            ? "justify-between"
            : "bg-primary/[0.14] text-primary hover:bg-primary/20"
        }`}
        disabled={cooldown}
        onClick={onAction}
      >
        {inProgress ? (
          <>
            <span>{cooldown ? "Claim in 16h 59m" : "Claim"}</span>
            <span className="ml-auto flex items-center gap-1 font-semibold">
              +250.45 <Bone className="size-4" />
            </span>
          </>
        ) : isEarn ? (
          "Deposit to Earn"
        ) : (
          "Get $LOYAL"
        )}
      </Button>
    </article>
  );
}

export function QuestsPage({
  inProgress = false,
  onSelectPage,
  showActivityBadge = false,
}: {
  inProgress?: boolean;
  onSelectPage: (page: WorkspacePage) => void;
  showActivityBadge?: boolean;
}) {
  const mobile = useIsNarrowViewport();
  const [notice, setNotice] = useState<string | null>(null);
  const showPreviewNotice = () => setNotice("Quests are coming soon");
  const inviteButton = (
    <Button
      className="t-hover rounded-full bg-accent text-[13px] text-foreground shadow-none hover:bg-accent/80"
      onClick={() => setNotice("Have an invite code?")}
    >
      I have an invite code
    </Button>
  );
  const referral = (
    <button
      className="t-hover flex flex-col items-start rounded-2xl bg-accent px-4 py-2.5 text-left hover:bg-accent/80"
      onClick={async () => {
        const copied = await copyTextToClipboard("BXP68Q");
        if (copied) earnToast.success("Referral code copied");
        else earnToast.error("Could not copy referral code");
      }}
      type="button"
    >
      <span className="text-[13px] leading-4 text-muted-foreground">
        Referral code
      </span>
      <span className="mt-1 flex items-center gap-1 text-[16px] leading-5">
        BXP68Q
        <ThemedIcon
          className="size-4 text-tertiary"
          src={`${ASSETS}/icon-copy.svg`}
        />
      </span>
    </button>
  );

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 p-2 max-[795px]:p-0">
        <PaneReveal>
          <section
            aria-label="Quests"
            className="min-h-0 flex-1 overflow-y-auto rounded-3xl bg-card pb-6 max-[795px]:rounded-none"
          >
            <div className="mx-auto w-full max-w-[768px] px-2">
              <header className="flex items-center gap-2 py-2 pl-4 max-[795px]:pl-2">
                <h1 className="flex-1 py-2 font-semibold text-[24px] leading-7">
                  Quests
                </h1>
                {!inProgress && (
                  <div className="max-[795px]:hidden">{inviteButton}</div>
                )}
                <span className="flex size-11 items-center justify-center">
                  <InfoTooltip
                    placement="bottom"
                    text="Collect Bones by completing quests, keeping cash in Earn, and holding $LOYAL. Build a streak and progress through ranks."
                  />
                </span>
              </header>
              <div className="px-4 max-[795px]:px-2">
                <div className="flex items-end justify-between gap-3 pt-0.5">
                  <div className="flex flex-col items-start gap-2">
                    <span className="flex items-center gap-1.5 rounded-full bg-tertiary py-1 pr-1 pl-2 text-white">
                      <ThemedIcon
                        className="size-4"
                        src={`${ASSETS}/quests/quest-crown.svg`}
                      />
                      <span className="font-medium text-[16px] leading-5">
                        {inProgress ? "Scout" : "Pup"}
                      </span>
                      <span className="flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-[13px] leading-4 text-tertiary">
                        <ThemedIcon
                          className="size-2.5"
                          src={`${ASSETS}/quests/quest-multiplier.svg`}
                        />
                        ×{inProgress ? "1.25" : "0.25"}
                      </span>
                    </span>
                    <p className="flex items-center gap-1 font-semibold text-[40px] leading-[48px] tracking-[-0.44px] tabular-nums max-[795px]:text-[32px] max-[795px]:leading-10">
                      <Amount value={inProgress ? "11,250.62" : "0.00"} />
                      <Bone className="size-7 text-tertiary max-[795px]:size-6" />
                    </p>
                  </div>
                  <div className="max-[795px]:hidden">{referral}</div>
                </div>
                <div
                  aria-label="Progress to next rank"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={inProgress ? 39 : 0}
                  className="mt-4 h-4 overflow-hidden rounded-full bg-accent"
                  role="progressbar"
                >
                  <div
                    className="h-full min-w-4 rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: inProgress ? "39%" : "0%" }}
                  />
                </div>
                <div className="flex justify-end pt-3 pb-6">
                  <span className="relative flex items-center rounded-full bg-tertiary px-2 py-1 text-[13px] leading-4 text-white before:absolute before:-top-1 before:right-4 before:size-2 before:rotate-45 before:rounded-sm before:bg-tertiary">
                    {inProgress ? "9,260" : "10,000"}
                    <Bone className="mx-0.5 size-2.5" />
                    to {inProgress ? "Guardian" : "Scout"}
                  </span>
                </div>
                <div className="mb-2 grid grid-cols-2 items-stretch gap-2 min-[796px]:hidden">
                  {referral}
                  <div className="flex [&>button]:h-full [&>button]:w-full [&>button]:rounded-2xl">
                    {inviteButton}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 max-[795px]:grid-cols-1 max-[795px]:px-2">
                <EarningCard
                  inProgress={inProgress}
                  kind="earn"
                  mobile={mobile}
                  onAction={showPreviewNotice}
                />
                <EarningCard
                  inProgress={inProgress}
                  kind="loyal"
                  mobile={mobile}
                  onAction={showPreviewNotice}
                />
              </div>
              <div className="pt-6">
                {QUESTS.map((quest) => {
                  const disabled =
                    quest.state === "locked" || quest.state === "completed";
                  return (
                    <button
                      aria-label={`${quest.title}${
                        disabled ? `, ${quest.state}` : ""
                      }`}
                      className={`t-hover flex min-h-[60px] w-full items-center rounded-2xl px-4 text-left enabled:hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary ${
                        quest.state === "completed" ? "opacity-40" : ""
                      }`}
                      disabled={disabled}
                      key={quest.title}
                      onClick={showPreviewNotice}
                      type="button"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {quest.state === "completed" ? (
                        <span className="mr-3 flex size-11 shrink-0 items-center justify-center rounded-[11px] bg-primary">
                          <ThemedIcon
                            className="size-6 text-white"
                            src={`${ASSETS}/${quest.icon}`}
                          />
                        </span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt=""
                          className="mr-3 size-11 shrink-0"
                          src={`${ASSETS}/${quest.icon}`}
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
                        <span className="font-medium text-[16px] leading-5 tracking-[-0.176px]">
                          {quest.title}
                        </span>
                        <span className="flex items-center gap-1 text-[13px] leading-4 text-primary">
                          +250
                          <Bone className="size-2.5" />
                        </span>
                      </span>
                      <span className="ml-3 shrink-0">
                        {quest.state === "claim" ? (
                          <span className="inline-flex min-w-16 items-center justify-center rounded-full bg-primary px-4 py-2.5 font-medium text-[13px] leading-4 text-white">
                            Claim
                          </span>
                        ) : (
                          <ThemedIcon
                            className={`${
                              quest.state === "locked"
                                ? "mx-1 size-4"
                                : "size-6"
                            } text-tertiary`}
                            src={`${ASSETS}/${
                              quest.state === "locked"
                                ? "quests/quest-lock.svg"
                                : quest.state === "completed"
                                ? "icon-check.svg"
                                : "icon-chevron-right.svg"
                            }`}
                          />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </PaneReveal>
      </div>
      <MobileTabBar
        activeTab="quests"
        onSelect={onSelectPage}
        showActivityBadge={showActivityBadge}
      />
      <EarnModal
        buttonLabel="Got it"
        description="Rewards and invite codes aren’t available yet. Check back soon."
        isOpen={notice !== null}
        onAction={() => setNotice(null)}
        onClose={() => setNotice(null)}
        title={notice ?? "Quests are coming soon"}
        withMascot={false}
      />
    </>
  );
}
