import * as SecureStore from "expo-secure-store";

import type { DappHistoryEntry } from "../model/types";

const RECENT_HISTORY_KEY = "loyal.dappBrowser.recentHistory";
const MAX_HISTORY = 20;

export async function listRecentHistory(): Promise<DappHistoryEntry[]> {
  const raw = await SecureStore.getItemAsync(RECENT_HISTORY_KEY);
  return raw ? (JSON.parse(raw) as DappHistoryEntry[]) : [];
}

export async function recordRecentHistory(entry: DappHistoryEntry): Promise<void> {
  const current = await listRecentHistory();
  const next = [entry, ...current.filter((item) => item.origin !== entry.origin)].slice(
    0,
    MAX_HISTORY,
  );
  await SecureStore.setItemAsync(RECENT_HISTORY_KEY, JSON.stringify(next));
}
