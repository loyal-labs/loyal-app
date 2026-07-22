"use client";

import { useState } from "react";

import { AutodepositPane } from "@/components/wallet-workspace/facelift/autodeposit-pane";
import {
  BalanceVisibilityProvider,
  HiddenBalanceFilterDefs,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { DepositPane } from "@/components/wallet-workspace/facelift/deposit-pane";
import { EarnChartPane } from "@/components/wallet-workspace/facelift/earn-chart-pane";
import { EarnEmptyPane } from "@/components/wallet-workspace/facelift/earn-empty-pane";
import { EarnPositionPane } from "@/components/wallet-workspace/facelift/earn-position-pane";
import { FaceliftSidebar } from "@/components/wallet-workspace/facelift/sidebar";
import { useEarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { WithdrawPane } from "@/components/wallet-workspace/facelift/withdraw-pane";
import { useAuthCapability } from "@/lib/auth/capability";

type MiddleView = "earn" | "deposit" | "withdraw" | "autodeposit";

// Figma 4693:64818 — fixed 3-pane workspace: 360px sidebar on the gray shell,
// fluid middle panel, 400px right panel. Panes are intentionally not resizable.
// Below 1204px the right pane would force the dog under its 420px natural size,
// so it hides (Figma 4693:65423) and the middle header shows a chart button
// that opens the expanded chart overlay instead.
export function WorkspaceFaceliftShell() {
  const [isChartExpanded, setIsChartExpanded] = useState(false);
  const [middleView, setMiddleView] = useState<MiddleView>("earn");
  const { isSignedIn } = useAuthCapability();
  const earnData = useEarnPositionData();
  // Deposit requires a session; fall back to the Earn state on sign-out.
  const activeMiddleView: MiddleView = isSignedIn ? middleView : "earn";
  // Avoid flashing the zero-state headline while the position is still
  // resolving for a signed-in smart account.
  const isPositionLoading =
    isSignedIn && Boolean(earnData.settingsPda) && !earnData.hasResolvedPosition;

  return (
    <BalanceVisibilityProvider>
      <div className="flex h-dvh w-full overflow-clip bg-[#f5f5f5] text-black">
        <HiddenBalanceFilterDefs />
        <FaceliftSidebar earnBalanceUsd={earnData.earnBalanceUsd} />
        <div className="flex h-full min-w-0 flex-1 gap-2 p-2">
          {activeMiddleView === "withdraw" ? (
            <WithdrawPane data={earnData} onBack={() => setMiddleView("earn")} />
          ) : activeMiddleView === "autodeposit" ? (
            <AutodepositPane
              data={earnData}
              onBack={() => setMiddleView("earn")}
            />
          ) : activeMiddleView === "deposit" ? (
            <DepositPane onBack={() => setMiddleView("earn")} />
          ) : earnData.hasPosition ? (
            <EarnPositionPane
              data={earnData}
              onDeposit={() => setMiddleView("deposit")}
              onOpenAutodeposit={() => setMiddleView("autodeposit")}
              onWithdraw={() => setMiddleView("withdraw")}
            />
          ) : isPositionLoading ? (
            <section className="flex h-full min-w-0 flex-1 animate-pulse rounded-3xl bg-white" />
          ) : (
            <EarnEmptyPane
              onDeposit={() => setMiddleView("deposit")}
              onOpenChart={() => setIsChartExpanded(true)}
            />
          )}
          {activeMiddleView === "withdraw" ||
          activeMiddleView === "autodeposit" ? null : (
            <EarnChartPane
              earnData={earnData}
              isExpanded={isChartExpanded}
              onExpandedChange={setIsChartExpanded}
            />
          )}
        </div>
      </div>
    </BalanceVisibilityProvider>
  );
}
