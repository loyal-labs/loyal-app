"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  groupEarnTransactions,
  resolveEarnTransactionDisplayTimeZone,
} from "@/components/wallet-workspace/earn-transactions-pane";
import {
  GroupHeader,
  TransactionRow,
} from "@/components/wallet-workspace/facelift/earn-activity-card";
import { MobileTabBar } from "@/components/wallet-workspace/facelift/mobile-tab-bar";
import { PaneReveal } from "@/components/wallet-workspace/facelift/pane-transitions";
import type { WorkspacePage } from "@/components/wallet-workspace/facelift/shell";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import {
  StaggerLine,
  StaggerReveal,
} from "@/components/wallet-workspace/facelift/stagger-reveal";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { EarnTransactionDetailPane } from "@/components/wallet-workspace/facelift/transaction-detail-pane";
import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  fetchEarnTransactions,
  type EarnTransactionItem,
} from "@/lib/yield-optimization/earn-transactions.client";

const ASSET_BASE = "/wallet-workspace/facelift";

// Rows revealed per scroll step; the full list is already client-side (the
// earn-transactions response has no pagination), so "loading on scroll" is
// windowed rendering over the shared 5-minute cache.
const PAGE_SIZE = 30;

// Activity screen: the Earn feed in full — deposits, withdrawals and
// rebalances rendered with the same rows as the Earn page's activity card,
// date-grouped, extending as the user scrolls. Data comes through
// fetchEarnTransactions, so Earn ↔ Activity switches reuse one cache and the
// realtime stack's refreshKey bump refetches after a confirmed mutation.
export function ActivityPage({
  onSelectPage,
  refreshKey,
  settingsPda,
  walletAddress,
}: {
  onSelectPage: (page: WorkspacePage) => void;
  refreshKey: number;
  settingsPda: string | null | undefined;
  walletAddress: string | null;
}) {
  const publicEnv = usePublicEnv();
  const { isAuthenticated, isHydrated } = useAuthSession();
  const [items, setItems] = useState<EarnTransactionItem[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedItem, setSelectedItem] = useState<EarnTransactionItem | null>(
    null
  );
  // Keeps the last detail rendered through the sheet's close animation so
  // deselecting doesn't slide out an empty sheet.
  const lastItemRef = useRef<EarnTransactionItem | null>(null);
  if (selectedItem) {
    lastItemRef.current = selectedItem;
  }
  const sheetItem = selectedItem ?? lastItemRef.current;

  // An open detail owns Esc: preventDefault marks it handled so the shell's
  // Esc → Earn handoff (checked via microtask) stays put until the second
  // press.
  useEffect(() => {
    if (!selectedItem) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedItem(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedItem]);

  useEffect(() => {
    if (!(isAuthenticated && isHydrated && settingsPda && walletAddress)) {
      return;
    }
    let isCurrent = true;
    fetchEarnTransactions({
      settingsPda,
      solanaEnv: publicEnv.solanaEnv,
      walletAddress,
    })
      .then((response) => {
        if (isCurrent) {
          setItems(response.transactions);
          setHasError(false);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setHasError(true);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [
    isAuthenticated,
    isHydrated,
    publicEnv.solanaEnv,
    refreshKey,
    settingsPda,
    walletAddress,
  ]);

  const groups = useMemo(
    () =>
      groupEarnTransactions(
        (items ?? []).slice(0, visibleCount),
        resolveEarnTransactionDisplayTimeZone()
      ),
    [items, visibleCount]
  );
  const hasMore = items !== null && items.length > visibleCount;

  // Extends the window when the tail sentinel nears the viewport. Re-created
  // per visibleCount so a still-intersecting sentinel (list shorter than the
  // viewport) re-fires through the fresh observer's initial callback.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!(sentinel && hasMore)) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + PAGE_SIZE);
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visibleCount]);

  // Only the first loaded batch rides the mount stagger; groups appearing on
  // scroll-extends or refetches render in place with no reveal (they enter
  // off-screen anyway). Same decide-once mechanics as the earn activity card.
  const hasRenderedRowsRef = useRef(false);
  const groupKindsRef = useRef(new Map<string, "plain" | "stagger">());
  useEffect(() => {
    if (groups.length > 0) {
      hasRenderedRowsRef.current = true;
    }
  }, [groups]);
  const resolveGroupKind = (key: string): "plain" | "stagger" => {
    const kinds = groupKindsRef.current;
    const existing = kinds.get(key);
    if (existing) {
      return existing;
    }
    const kind = hasRenderedRowsRef.current ? "plain" : "stagger";
    kinds.set(key, kind);
    return kind;
  };

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-1 gap-2 p-2 max-[795px]:gap-0 max-[795px]:p-0">
        <PaneReveal>
          <section className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto rounded-3xl bg-card max-[795px]:rounded-none">
            <header className="flex w-full shrink-0 items-center p-2">
              <div className="flex min-w-0 flex-1 items-center py-2.5 pl-4">
                <h1 className="truncate whitespace-nowrap font-semibold text-[20px] text-foreground leading-6 max-[795px]:text-[24px] max-[795px]:leading-7">
                  Activity
                </h1>
              </div>
            </header>
            <div className="flex w-full flex-1 flex-col px-2 pb-2">
              {items === null && !hasError ? (
                // transitions.dev skeleton pulse, same rows the earn activity
                // card skeletons with.
                <div className="t-skel-rows flex flex-col gap-2 px-2 py-1">
                  {[0, 1, 2].map((index) => (
                    <div
                      className="h-[66px] w-full rounded-2xl bg-accent"
                      key={index}
                    />
                  ))}
                </div>
              ) : null}
              {items === null && hasError ? (
                <p className="px-4 py-3 text-[13px] leading-4 text-muted-foreground">
                  Failed to load transactions.
                </p>
              ) : null}
              {items !== null && items.length === 0 ? (
                <p className="px-4 py-8 text-center text-[14px] leading-5 text-muted-foreground">
                  No activity yet
                </p>
              ) : null}
              {items !== null && groups.length > 0 ? (
                <StaggerReveal className="flex w-full flex-col">
                  {(() => {
                    let lineIndex = 0;
                    return groups.map((group) => {
                      const content = (
                        <>
                          <GroupHeader label={group.date} />
                          {group.items.map((item) => (
                            <TransactionRow
                              isSelected={selectedItem?.id === item.id}
                              item={item}
                              key={item.id}
                              onSelect={() => setSelectedItem(item)}
                            />
                          ))}
                        </>
                      );
                      return resolveGroupKind(group.date) === "stagger" ? (
                        <StaggerLine index={lineIndex++} key={group.date}>
                          {content}
                        </StaggerLine>
                      ) : (
                        <div key={group.date}>{content}</div>
                      );
                    });
                  })()}
                </StaggerReveal>
              ) : null}
              {hasMore ? (
                <div
                  aria-hidden="true"
                  className="h-px w-full shrink-0"
                  ref={sentinelRef}
                />
              ) : null}
            </div>
          </section>
        </PaneReveal>
        {selectedItem ? (
          <aside className="hidden h-full w-[400px] shrink-0 flex-col overflow-clip rounded-3xl bg-card min-[1204px]:flex">
            {/* Keyed by tx so switching rows replays the reveal — same as
                the send flow's per-step PaneReveal. */}
            <PaneReveal key={selectedItem.id}>
              <EarnTransactionDetailPane
                item={selectedItem}
                onClose={() => setSelectedItem(null)}
                walletAddress={walletAddress}
              />
            </PaneReveal>
          </aside>
        ) : (
          <aside className="hidden h-full w-[400px] shrink-0 flex-col items-center justify-center overflow-clip rounded-3xl border-2 border-border border-dashed min-[1204px]:flex">
            <div className="flex w-full flex-col items-center gap-4 px-6">
              <ThemedIcon
                className="size-11 text-tertiary"
                src={`${ASSET_BASE}/icon-cursor-click.svg`}
              />
              <p className="text-center text-[16px] leading-5 text-muted-foreground tracking-[-0.176px]">
                Select a transaction to view its details
              </p>
            </div>
          </aside>
        )}
      </div>
      <MobileTabBar activeTab="activity" onSelect={onSelectPage} />
      {/* Below 1204px the right pane is gone, so the same selection opens the
          detail as a sheet: a 400px right-pinned card on the dark scrim, a
          full bottom sheet on the white one below 796px. On desktop the scrim
          is display:none, so the mounted sheet is inert while the aside shows
          the detail. */}
      <SheetReveal
        isOpen={selectedItem !== null}
        onClose={() => setSelectedItem(null)}
        scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8 min-[1204px]:hidden"
        sheetClassName="ml-auto flex h-full w-[400px] min-w-0 flex-col overflow-clip rounded-3xl bg-card max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
      >
        {sheetItem ? (
          <EarnTransactionDetailPane
            item={sheetItem}
            key={sheetItem.id}
            onClose={() => setSelectedItem(null)}
            walletAddress={walletAddress}
          />
        ) : null}
      </SheetReveal>
    </>
  );
}
