export type EarnRealtimeRefresh = {
  earnState: boolean;
  earnings: boolean;
  position: boolean;
  transactions: boolean;
};

type EarnRealtimeListener = (
  refresh: EarnRealtimeRefresh,
) => Promise<unknown> | unknown;

const listeners = new Set<EarnRealtimeListener>();

export function subscribeEarnRealtime(
  listener: EarnRealtimeListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function emitEarnRealtimeEvent(
  eventType?: string,
  state?: string,
): Promise<void> {
  const refresh: EarnRealtimeRefresh = {
    earnState: false,
    earnings: false,
    position: false,
    transactions: false,
  };
  if (!eventType) {
    refresh.earnState = true;
    refresh.earnings = true;
    refresh.position = true;
    refresh.transactions = true;
  } else if (eventType === "earn.autodeposit.configuration.changed") {
    refresh.earnState = true;
    refresh.transactions = true;
  } else if (eventType === "earn.autodeposit.execution.changed") {
    refresh.earnState = true;
    if (state === "pull_confirmed" || state === "completed" || state === "failed") {
      refresh.position = true;
      refresh.transactions = true;
    }
    refresh.earnings = state === "completed";
  } else if (eventType === "earn.position.changed") {
    refresh.position = true;
    refresh.earnings = true;
  } else if (eventType === "earn.transaction.recorded") {
    refresh.transactions = true;
    refresh.earnings = true;
  } else if (eventType === "earn.rebalance.confirmed") {
    refresh.position = true;
    refresh.transactions = true;
    refresh.earnings = true;
  } else {
    refresh.earnState = true;
  }
  await Promise.all([...listeners].map((listener) => listener(refresh)));
}
