"use client";

import { Lock, MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { splitEarnBalanceDisplay } from "@/components/wallet-sidebar/earn-detail-view";
import {
  ScrambledPopDigits,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { DepositPane } from "@/components/wallet-workspace/facelift/deposit-pane";
import {
  EarnActivityCard,
  type ExecuteNowControls,
} from "@/components/wallet-workspace/facelift/earn-activity-card";
import {
  type ChartTab,
  EarnChartPane,
} from "@/components/wallet-workspace/facelift/earn-chart-pane";
import { InfoTooltip } from "@/components/wallet-workspace/facelift/info-tooltip";
import {
  MiddlePaneSlide,
  PaneReveal,
} from "@/components/wallet-workspace/facelift/pane-transitions";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";

const ASSET_BASE = "/wallet-workspace/facelift";

// Mocked Earn MAX display values — UI mock only, no backend yet.
export const EARN_MAX_BALANCE_USD = 24_232.56;
export const EARN_MAX_APY_LABEL = "20.48% APY";

// Never runs: the mock passes no scheduled sweeps to the activity card.
const NOOP_EXECUTE_NOW: ExecuteNowControls = {
  error: null,
  isPending: false,
  progressBySlot: {},
  run: () => Promise.resolve(false),
};

function ApyPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-positive/[0.14] px-2 py-0.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden="true"
        className="h-4 w-2.5"
        src="/wallet-workspace/earn-flash.svg"
      />
      <span className="whitespace-nowrap font-medium text-[13px] text-positive leading-4 tracking-[0.06px]">
        {EARN_MAX_APY_LABEL}
      </span>
    </span>
  );
}

// Dashed-circle placeholder tile — strategy art is not designed yet.
function DashedIconTile() {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-selected">
      <span
        aria-hidden="true"
        className="size-5 rounded-full border-2 border-dashed border-tertiary"
      />
    </span>
  );
}

// Placeholder Info & FAQs card (Earn MAX design) — real copy comes later.
export function EarnMaxInfoFaqsCard({
  className = "",
}: {
  className?: string;
}) {
  return (
    <section
      className={`flex w-full flex-col overflow-clip rounded-3xl bg-card ${className}`}
    >
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-foreground leading-6">
          Info & FAQs
        </h2>
      </header>
      <div className="flex min-h-40 w-full flex-1 items-center justify-center pb-6">
        <p className="text-[20px] text-muted-foreground leading-6">Content</p>
      </div>
    </section>
  );
}

// Deposit-screen right pane: the Info & FAQs card fills the slot the chart
// column vacates (same split FlowExplainerAside uses).
function EarnMaxInfoFaqsAside() {
  return (
    <aside className="hidden h-full w-[400px] shrink-0 flex-col min-[1204px]:flex">
      <EarnMaxInfoFaqsCard className="flex-1 shrink" />
    </aside>
  );
}

// Earn MAX center pane — mirrors EarnPositionPane's structure with mocked
// balance and strategy cards; the transactions list is the real Earn one.
function EarnMaxPositionPane({
  data,
  onDeposit,
  onViewAllActivity,
}: {
  data: EarnPositionData;
  onDeposit: () => void;
  onViewAllActivity: () => void;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const balance = splitEarnBalanceDisplay(EARN_MAX_BALANCE_USD);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-y-auto">
        <section className="flex w-full shrink-0 flex-col overflow-clip rounded-3xl bg-card max-[795px]:rounded-t-none">
          <header className="flex w-full items-center p-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-4">
              <h1 className="whitespace-nowrap font-semibold text-[24px] text-foreground leading-7">
                Earn MAX
              </h1>
              <InfoTooltip
                iconClassName="size-6"
                placement="bottom"
                text="Earn MAX strategies. Coming soon."
              />
            </div>
            <div className="flex shrink-0 items-start gap-2 pl-3 max-[795px]:hidden">
              <button
                className="t-hover flex items-center justify-center gap-2 rounded-full bg-accent p-2.5 hover:-translate-y-0.5 hover:bg-accent-active active:translate-y-0"
                // TODO(earn-max): no Earn MAX withdraw design yet — mock no-op.
                onClick={() => undefined}
                type="button"
              >
                <ThemedIcon
                  className="size-6 text-muted-foreground"
                  src={`${ASSET_BASE}/icon-withdraw-arrow.svg`}
                />
                <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-foreground leading-5">
                  Withdraw
                </span>
              </button>
              <button
                className="t-hover flex items-center justify-center gap-2 rounded-full bg-foreground p-2.5 hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
                onClick={onDeposit}
                type="button"
              >
                <ThemedIcon
                  className="size-6 text-background"
                  src={`${ASSET_BASE}/icon-plus.svg`}
                />
                <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-background leading-5">
                  Deposit
                </span>
              </button>
            </div>
          </header>

          <div className="w-full p-2">
            <div className="flex h-[86px] w-full flex-col items-start gap-0.5 rounded-[20px] px-4 py-2">
              <p className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
                Balance
              </p>
              <p
                className="whitespace-nowrap font-semibold text-[40px] leading-[46px] [font-variant-numeric:tabular-nums] max-[760px]:text-[clamp(30px,9.5vw,40px)] max-[760px]:leading-[1.08]"
                style={{
                  color: isBalanceHidden
                    ? "var(--tertiary)"
                    : "var(--foreground)",
                }}
              >
                <ScrambledPopDigits
                  isHidden={isBalanceHidden}
                  segments={[
                    { text: balance.whole },
                    { color: "var(--tertiary)", text: balance.fraction },
                  ]}
                />
              </p>
            </div>
          </div>

          <div className="w-full p-2 pt-0">
            <div className="grid w-full grid-cols-2 gap-2 max-[560px]:grid-cols-1">
              <div className="flex flex-col gap-6 rounded-3xl bg-accent p-4">
                <div className="flex w-full items-start justify-between">
                  <DashedIconTile />
                  <div className="flex items-center gap-1">
                    <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                      Low risk
                    </span>
                    <button
                      aria-label="Looping options"
                      className="t-hover flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent-active"
                      // TODO(earn-max): strategy menu not designed yet.
                      onClick={() => undefined}
                      type="button"
                    >
                      <MoreHorizontal className="size-5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-[16px] text-foreground leading-5">
                      Looping
                    </span>
                    <ApyPill />
                  </span>
                  <span className="flex items-baseline gap-1 whitespace-nowrap">
                    <span className="font-semibold text-[20px] text-foreground leading-6">
                      $14,777
                      <span className="text-tertiary">.14</span>
                    </span>
                    <span className="text-[13px] leading-4">
                      <span className="text-positive">+$125.76</span>
                      <span className="text-muted-foreground">{" · 30D"}</span>
                    </span>
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-6 rounded-3xl bg-accent p-4">
                <div className="flex w-full items-start justify-between">
                  <DashedIconTile />
                  <Lock
                    aria-hidden="true"
                    className="size-5 text-muted-foreground"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-[16px] text-muted-foreground leading-5">
                    Delta Neutral
                  </span>
                  <span className="font-semibold text-[20px] text-muted-foreground leading-6">
                    $0.00
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <EarnActivityCard
          executeNow={NOOP_EXECUTE_NOW}
          holdings={[]}
          onSelectTransaction={() => undefined}
          onViewAllActivity={onViewAllActivity}
          onWithdrawSource={() => undefined}
          pendingSignatures={[]}
          placeholderSecondaryTab="Label"
          refreshKey={data.actions.earnTransactionsRefreshKey}
          scheduledSweeps={[]}
          selectedTransactionId={null}
          settingsPda={data.settingsPda}
          walletAddress={data.walletAddress}
        />
      </div>
    </div>
  );
}

// Earn MAX page — self-contained "main | deposit" view state; reuses the real
// EarnChartPane (with the Info & FAQs card in the stats slot) and the
// DepositPane in its Earn MAX mock variant.
export function EarnMaxPage({
  chartTab,
  data,
  isChartExpanded,
  onChartExpandedChange,
  onSelectChartTab,
  onViewAllActivity,
}: {
  chartTab: ChartTab | null;
  data: EarnPositionData;
  isChartExpanded: boolean;
  onChartExpandedChange: (isExpanded: boolean) => void;
  onSelectChartTab: (tab: ChartTab) => void;
  onViewAllActivity: () => void;
}) {
  const [view, setView] = useState<"main" | "deposit">("main");

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-2 p-2 max-[795px]:gap-0 max-[795px]:p-0">
      <MiddlePaneSlide
        actionPane={
          view === "deposit" ? (
            <DepositPane
              data={data}
              earnMaxAside={<EarnMaxInfoFaqsAside />}
              onBack={() => setView("main")}
              onOpenChart={() => onChartExpandedChange(true)}
            />
          ) : null
        }
      >
        <PaneReveal>
          <EarnMaxPositionPane
            data={data}
            onDeposit={() => setView("deposit")}
            onViewAllActivity={onViewAllActivity}
          />
        </PaneReveal>
      </MiddlePaneSlide>
      <EarnChartPane
        earnData={data}
        hideAside={view === "deposit"}
        isExpanded={isChartExpanded}
        onExpandedChange={onChartExpandedChange}
        onSelectTab={onSelectChartTab}
        selectedTab={chartTab}
        statsPanel={<EarnMaxInfoFaqsCard className="min-h-60 shrink-0" />}
      />
    </div>
  );
}
