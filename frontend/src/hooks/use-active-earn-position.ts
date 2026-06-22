"use client";

import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  readClientCache,
  removeClientCache,
  writeClientCache,
} from "@/lib/client-cache/client-cache";
import {
  fetchEarnRpcHoldingsSnapshot,
  sumEarnRpcHoldingsAmountRaw,
  type EarnRpcHolding,
  type EarnRpcHoldingsSnapshot,
  type EarnRpcPolicyMetadata,
  type EarnRpcWatchedAccount,
} from "@/lib/yield-optimization/earn-rpc-holdings.client";

const EARN_POSITION_CACHE_VERSION = 5;
const EARN_POSITION_REFRESH_DEBOUNCE_MS = 350;

export type ActiveEarnPositionHolding = {
  amountRaw: string;
  kind: "idle" | "kamino";
  label: string;
  liquidityMint: string;
  market: string | null;
  marketName: string;
  observedAt: string;
  observedSlot: string;
  provenance: Record<string, string | null>;
  reserve: string | null;
  supplyApyBps: string | null;
};

export type ActiveEarnPosition = {
  currentSupplyApyBps: string | null;
  display: {
    label: string;
    marketName: string;
    mintSymbol: string;
  };
  initialHolding: {
    liquidityMint: string;
    market: string | null;
    reserve: string;
    supplyApyBps: string | null;
  };
  holdings?: ActiveEarnPositionHolding[];
  currentHolding: {
    amountRaw: string;
    liquidityMint: string;
    market: string | null;
    observedAt: string;
    observedSlot: string;
    provenance: {
      lastHoldingEventId: string | null;
      lastRebalanceDecisionId: string | null;
    };
    reserve: string;
  };
  currentTotalAmountRaw: string;
  principalAmountRaw: string;
  status: string;
};

export type EarnPositionCachePayload = {
  position: ActiveEarnPosition | null;
};

type LastEarnPositionCachePayload = {
  position: ActiveEarnPosition;
  settingsPda: string;
};

type EarnPositionConnection = Pick<
  Connection,
  "getMultipleAccountsInfoAndContext"
> &
  Partial<
    Pick<Connection, "onAccountChange" | "removeAccountChangeListener">
  >;

type RpcPositionRead = {
  position: ActiveEarnPosition | null;
  watchedAccounts: EarnRpcWatchedAccount[];
};

export function isActiveEarnPosition(
  position: ActiveEarnPosition | null | undefined
): position is ActiveEarnPosition {
  if (position?.status !== "active") {
    return false;
  }

  try {
    return BigInt(position.currentTotalAmountRaw) > BigInt(0);
  } catch {
    return false;
  }
}

export function getEarnPositionCacheKey(args: {
  solanaEnv: string;
  walletAddress: string;
  settingsPda: string;
}): string {
  return [
    "loyal",
    "earn-position",
    EARN_POSITION_CACHE_VERSION,
    args.solanaEnv,
    args.walletAddress,
    args.settingsPda,
  ].join(":");
}

function getLastEarnPositionCacheKey(args: {
  solanaEnv: string;
  walletAddress: string;
}): string {
  return [
    "loyal",
    "earn-position-last",
    EARN_POSITION_CACHE_VERSION,
    args.solanaEnv,
    args.walletAddress,
  ].join(":");
}

function readLastEarnPositionCache(args: {
  solanaEnv: string;
  walletAddress: string;
}): LastEarnPositionCachePayload | null {
  const key = getLastEarnPositionCacheKey(args);
  const payload = readClientCache<LastEarnPositionCachePayload>({
    key,
    version: EARN_POSITION_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    validate: (data): data is LastEarnPositionCachePayload =>
      typeof data === "object" &&
      data !== null &&
      "position" in data &&
      "settingsPda" in data,
  });
  return payload;
}

function writeLastEarnPositionCache(args: {
  solanaEnv: string;
  walletAddress: string;
  settingsPda: string;
  position: ActiveEarnPosition | null;
}) {
  const key = getLastEarnPositionCacheKey(args);
  if (!args.position) {
    removeClientCache({ key });
    return;
  }

  writeClientCache<LastEarnPositionCachePayload>({
    key,
    version: EARN_POSITION_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    data: {
      position: args.position,
      settingsPda: args.settingsPda,
    },
  });
}

export function readEarnPositionCache(args: {
  solanaEnv: string;
  walletAddress: string;
  settingsPda: string;
}): ActiveEarnPosition | null {
  const key = getEarnPositionCacheKey(args);
  const payload = readClientCache<EarnPositionCachePayload>({
    key,
    version: EARN_POSITION_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    settingsPda: args.settingsPda,
    validate: (data): data is EarnPositionCachePayload =>
      typeof data === "object" && data !== null && "position" in data,
  });
  return payload?.position ?? null;
}

export function writeEarnPositionCache(args: {
  solanaEnv: string;
  walletAddress: string;
  settingsPda: string;
  position: ActiveEarnPosition | null;
}) {
  const key = getEarnPositionCacheKey(args);
  if (!args.position) {
    removeClientCache({ key });
    writeLastEarnPositionCache(args);
    return;
  }

  writeClientCache<EarnPositionCachePayload>({
    key,
    version: EARN_POSITION_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    settingsPda: args.settingsPda,
    data: { position: args.position },
  });
  writeLastEarnPositionCache(args);
}

export function useActiveEarnPosition({
  connection,
  earnPolicy,
  enabled,
  programId,
  settingsPda,
  solanaEnv,
  walletAddress,
}: {
  connection?: EarnPositionConnection | null;
  earnPolicy?: EarnRpcPolicyMetadata | null;
  enabled: boolean;
  programId?: string | null;
  settingsPda: string | null | undefined;
  solanaEnv: string;
  walletAddress: string | null | undefined;
}) {
  const [position, setPositionState] = useState<ActiveEarnPosition | null>(
    null
  );
  const [watchedAccounts, setWatchedAccounts] = useState<
    EarnRpcWatchedAccount[]
  >([]);
  const positionRef = useRef<ActiveEarnPosition | null>(null);
  const suppressSubscriptionRefreshThroughSlotRef = useRef<bigint | null>(null);

  const canUseCache = Boolean(enabled && walletAddress && settingsPda);

  const setPosition = useCallback(
    (
      next:
        | ActiveEarnPosition
        | null
        | ((current: ActiveEarnPosition | null) => ActiveEarnPosition | null)
    ) => {
      setPositionState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        positionRef.current = resolved;
        if (walletAddress && settingsPda) {
          writeEarnPositionCache({
            solanaEnv,
            walletAddress,
            settingsPda,
            position: resolved,
          });
        }
        return resolved;
      });
    },
    [settingsPda, solanaEnv, walletAddress]
  );

  const readRpcPosition = useCallback(
    async (
      basePosition: ActiveEarnPosition | null
    ): Promise<RpcPositionRead | null> => {
      if (!connection || !programId || !earnPolicy || !settingsPda) {
        return null;
      }

      const snapshot = await fetchEarnRpcHoldingsSnapshot({
        cluster: resolveLoyalClusterForSolanaEnv(resolveSolanaEnv(solanaEnv)),
        connection,
        policy: earnPolicy,
        programId: new PublicKey(programId),
        settingsPda: new PublicKey(settingsPda),
      });

      return {
        position: applyEarnRpcSnapshotToPosition(basePosition, snapshot),
        watchedAccounts: snapshot.provenance.watchedAccounts,
      };
    },
    [connection, earnPolicy, programId, settingsPda, solanaEnv]
  );

  const commitRpcPosition = useCallback(
    (next: RpcPositionRead) => {
      if (walletAddress && settingsPda) {
        writeEarnPositionCache({
          solanaEnv,
          walletAddress,
          settingsPda,
          position: next.position,
        });
      }
      positionRef.current = next.position;
      setWatchedAccounts(next.watchedAccounts);
      setPositionState(next.position);
    },
    [settingsPda, solanaEnv, walletAddress]
  );

  const refresh = useCallback(async () => {
    const currentPosition = positionRef.current;
    const next = await readRpcPosition(currentPosition);
    if (!next) {
      return currentPosition;
    }

    commitRpcPosition(next);
    return next.position;
  }, [commitRpcPosition, readRpcPosition]);

  const suppressSubscriptionRefreshThroughSlot = useCallback(
    (slot: bigint | number | string | null | undefined) => {
      if (slot == null) {
        return;
      }

      try {
        const nextSlot = BigInt(slot);
        const current = suppressSubscriptionRefreshThroughSlotRef.current;
        if (current === null || nextSlot > current) {
          suppressSubscriptionRefreshThroughSlotRef.current = nextSlot;
        }
      } catch {
        // Ignore malformed slot hints; the subscription will refresh normally.
      }
    },
    []
  );

  useEffect(() => {
    if (!canUseCache || !walletAddress || !settingsPda) {
      setWatchedAccounts([]);
      if (enabled && walletAddress && !settingsPda) {
        const fallback = readLastEarnPositionCache({
          solanaEnv,
          walletAddress,
        });
        if (fallback?.position) {
          positionRef.current = fallback.position;
          setPositionState(fallback.position);
          return;
        }
      }

      if (enabled && walletAddress) {
        return;
      }

      positionRef.current = null;
      setPositionState(null);
      return;
    }

    const cached = readEarnPositionCache({
      solanaEnv,
      walletAddress,
      settingsPda,
    });
    if (cached) {
      positionRef.current = cached;
      setPositionState(cached);
    } else {
      positionRef.current = null;
      setPositionState(null);
    }

    let cancelled = false;
    const loadLivePosition = async () => {
      const next = await readRpcPosition(cached ?? null);
      if (cancelled) {
        return;
      }
      if (next) {
        commitRpcPosition(next);
      }
    };

    loadLivePosition().catch((error) => {
      if (cancelled) {
        return;
      }
      console.warn("[earn-position] failed to load live active position", error);
    });

    return () => {
      cancelled = true;
    };
  }, [
    canUseCache,
    commitRpcPosition,
    enabled,
    readRpcPosition,
    settingsPda,
    solanaEnv,
    walletAddress,
  ]);

  const watchAccountKey = watchedAccounts
    .filter((account) => account.kind !== "reserve")
    .map((account) => `${account.kind}:${account.pubkey}`)
    .join("|");

  useEffect(() => {
    const onAccountChange = connection?.onAccountChange?.bind(connection);
    const removeAccountChangeListener =
      connection?.removeAccountChangeListener?.bind(connection);
    if (
      !enabled ||
      !onAccountChange ||
      !removeAccountChangeListener ||
      !watchAccountKey
    ) {
      return;
    }

    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscriptionIds: number[] = [];
    const watchAccounts = watchAccountKey.split("|").map((entry) => {
      const separatorIndex = entry.indexOf(":");
      return new PublicKey(entry.slice(separatorIndex + 1));
    });

    const refreshFromSubscription = (
      _accountInfo?: unknown,
      context?: { slot?: number }
    ) => {
      const changedSlot =
        typeof context?.slot === "number" ? BigInt(context.slot) : null;
      const suppressThrough =
        suppressSubscriptionRefreshThroughSlotRef.current;
      if (
        changedSlot !== null &&
        suppressThrough !== null &&
        changedSlot <= suppressThrough
      ) {
        return;
      }

      if (closed || timer) {
        return;
      }

      timer = setTimeout(() => {
        timer = null;
        refresh().catch((error) => {
          if (!closed) {
            console.warn(
              "[earn-position] failed to refresh live active position",
              error
            );
          }
        });
      }, EARN_POSITION_REFRESH_DEBOUNCE_MS);
    };

    const subscribe = async () => {
      for (const account of watchAccounts) {
        const subscriptionId = await onAccountChange(
          account,
          refreshFromSubscription,
          "confirmed"
        );
        if (closed) {
          await removeAccountChangeListener(subscriptionId);
          continue;
        }

        subscriptionIds.push(subscriptionId);
      }
    };

    subscribe().catch((error) => {
      if (!closed) {
        console.warn(
          "[earn-position] failed to subscribe to live active position",
          error
        );
      }
    });

    return () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      for (const subscriptionId of subscriptionIds) {
        void removeAccountChangeListener(subscriptionId);
      }
    };
  }, [connection, enabled, refresh, watchAccountKey]);

  return {
    position,
    refresh,
    setPosition,
    suppressSubscriptionRefreshThroughSlot,
  };
}

export function applyEarnRpcSnapshotToPosition(
  position: ActiveEarnPosition | null | undefined,
  snapshot: EarnRpcHoldingsSnapshot
): ActiveEarnPosition | null {
  const totalAmountRaw = sumEarnRpcHoldingsAmountRaw(snapshot.holdings);
  if (totalAmountRaw <= BigInt(0)) {
    return null;
  }

  const primaryHolding =
    snapshot.holdings.find((holding) => holding.kind === "kamino") ??
    snapshot.holdings[0];
  if (!primaryHolding) {
    return null;
  }

  const activePosition = position ?? createPositionFromRpcHolding(primaryHolding);
  const currentHolding = {
    amountRaw: primaryHolding.amountRaw,
    liquidityMint: primaryHolding.liquidityMint,
    market: primaryHolding.market,
    observedAt: primaryHolding.observedAt,
    observedSlot: primaryHolding.observedSlot,
    provenance: {
      lastHoldingEventId:
        activePosition.currentHolding.provenance.lastHoldingEventId,
      lastRebalanceDecisionId:
        activePosition.currentHolding.provenance.lastRebalanceDecisionId,
    },
    reserve: primaryHolding.reserve ?? "",
  };

  return {
    ...activePosition,
    currentHolding,
    currentSupplyApyBps:
      snapshot.holdings.find((holding) => holding.kind === "kamino")
        ?.supplyApyBps ?? activePosition.currentSupplyApyBps,
    currentTotalAmountRaw: totalAmountRaw.toString(),
    display: {
      label: primaryHolding.label,
      marketName: primaryHolding.marketName,
      mintSymbol: "USDC",
    },
    holdings: snapshot.holdings,
    principalAmountRaw: deriveRpcSnapshotPrincipalAmountRaw(
      activePosition,
      totalAmountRaw
    ),
    status: "active",
  };
}

function deriveRpcSnapshotPrincipalAmountRaw(
  position: ActiveEarnPosition,
  totalAmountRaw: bigint
): string {
  try {
    const currentTotalAmountRaw = BigInt(position.currentTotalAmountRaw);
    const principalAmountRaw = BigInt(position.principalAmountRaw);
    if (
      principalAmountRaw === currentTotalAmountRaw &&
      currentTotalAmountRaw > totalAmountRaw
    ) {
      return totalAmountRaw.toString();
    }
  } catch {
    return position.principalAmountRaw;
  }

  return position.principalAmountRaw;
}

function createPositionFromRpcHolding(
  holding: EarnRpcHolding
): ActiveEarnPosition {
  const reserve = holding.reserve ?? "";
  return {
    currentHolding: {
      amountRaw: holding.amountRaw,
      liquidityMint: holding.liquidityMint,
      market: holding.market,
      observedAt: holding.observedAt,
      observedSlot: holding.observedSlot,
      provenance: {
        lastHoldingEventId: null,
        lastRebalanceDecisionId: null,
      },
      reserve,
    },
    currentSupplyApyBps: holding.supplyApyBps,
    currentTotalAmountRaw: holding.amountRaw,
    display: {
      label: holding.label,
      marketName: holding.marketName,
      mintSymbol: "USDC",
    },
    holdings: [holding],
    initialHolding: {
      liquidityMint: holding.liquidityMint,
      market: holding.market,
      reserve,
      supplyApyBps: holding.supplyApyBps,
    },
    principalAmountRaw: holding.amountRaw,
    status: "active",
  };
}
