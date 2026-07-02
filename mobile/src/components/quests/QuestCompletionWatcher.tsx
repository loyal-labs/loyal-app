import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import {
  fetchSolanaWeekQuestProgress,
  type SolanaWeekQuestKind,
  type SolanaWeekQuestProgressItem,
} from "@/lib/solana/earn/earn-api";
import { mmkv } from "@/lib/storage";
import { useWallet } from "@/lib/wallet/wallet-provider";

import {
  QuestCompleteNotification,
  type QuestCompleteVariant,
} from "./QuestCompleteNotification";

// All quest kinds that make up the Seeker Season set; "all complete" means
// every one of these is reported.
const ALL_KINDS: SolanaWeekQuestKind[] = [
  "earn_deposit",
  "first_autodeposit_sweep",
];
const POLL_INTERVAL_MS = 60_000;

// Celebration state is persisted per wallet so a completion is only celebrated
// once, and so progress already reported before this watcher first ran is
// seeded silently (no retroactive popup).
const initKey = (pk: string) => `quest-celebrate-init:${pk}`;
const kindKey = (pk: string, kind: string) => `quest-celebrated:${pk}:${kind}`;
const allKey = (pk: string) => `quest-celebrated-all:${pk}`;

// Action flows (e.g. a confirmed Earn deposit) call this so the mounted watcher
// re-checks progress immediately instead of waiting for the next poll tick —
// the quest completion row is already written by the time the confirm returns.
const nudgeListeners = new Set<() => void>();
export function nudgeQuestProgressCheck() {
  for (const listener of nudgeListeners) {
    listener();
  }
}

export function QuestCompletionWatcher() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [variant, setVariant] = useState<QuestCompleteVariant>("all");

  const handleProgress = useCallback(
    (quests: SolanaWeekQuestProgressItem[], pk: string) => {
      const reported = new Set(
        quests.filter((q) => q.status === "reported").map((q) => q.kind),
      );

      // First run for this wallet: seed what's already done, never celebrate it.
      if (!mmkv.getBoolean(initKey(pk))) {
        for (const kind of reported) mmkv.setBoolean(kindKey(pk, kind), true);
        if (ALL_KINDS.every((k) => reported.has(k))) {
          mmkv.setBoolean(allKey(pk), true);
        }
        mmkv.setBoolean(initKey(pk), true);
        return;
      }

      const newly = [...reported].filter(
        (kind) => !mmkv.getBoolean(kindKey(pk, kind)),
      );
      if (newly.length === 0) return;
      for (const kind of newly) mmkv.setBoolean(kindKey(pk, kind), true);

      const allDone = ALL_KINDS.every((k) => reported.has(k));
      if (allDone && !mmkv.getBoolean(allKey(pk))) {
        mmkv.setBoolean(allKey(pk), true);
        setVariant("all");
      } else {
        setVariant("single");
      }
      setVisible(true);
    },
    [],
  );

  useEffect(() => {
    if (!publicKey) return;
    const pk = publicKey;
    // Everything already celebrated on this device — nothing left to watch.
    if (mmkv.getBoolean(allKey(pk))) return;
    let active = true;

    const poll = async () => {
      try {
        const res = await fetchSolanaWeekQuestProgress(pk);
        if (active) handleProgress(res.quests, pk);
      } catch {
        // Keep the last snapshot; the next poll retries.
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void poll();
    });
    const nudge = () => void poll();
    nudgeListeners.add(nudge);

    return () => {
      active = false;
      clearInterval(interval);
      subscription.remove();
      nudgeListeners.delete(nudge);
    };
  }, [publicKey, handleProgress]);

  return (
    <QuestCompleteNotification
      visible={visible}
      variant={variant}
      onClose={() => {
        setVisible(false);
        // "Next" (a single task done) lands on the quests page so the user
        // sees the completed card and what's left; "Great" (all done) just
        // dismisses.
        if (variant === "single") {
          router.navigate("/(tabs)/quests");
        }
      }}
    />
  );
}
