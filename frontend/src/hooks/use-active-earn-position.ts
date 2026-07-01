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

const EARN_POSITION_CACHE_VERSION = 6;
const EARN_POSITION_REFRESH_DEBOUNCE_MS = 350;
const EARN_POSITION_RECONCILE_MIN_DELTA_RAW = BigInt(10_000);
const EARN_POSITION_RECONCILE_ENDPOINT =
  "/api/smart-accounts/yield-optimization/position/reconcile";

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

type ConfirmedEarnPositionResponse = {
  position: ActiveEarnPosition | null;
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

function parseEarnRawAmount(amountRaw: string | null | undefined): bigint | null {
  if (!amountRaw || !/^\d+$/.test(amountRaw)) {
    return null;
  }

  try {
    return BigInt(amountRaw);
  } catch {
    return null;
  }
}

function parseEarnObservedSlot(
  position: ActiveEarnPosition | null | undefined
): bigint | null {
  const observedSlot = position?.currentHolding.observedSlot;
  if (!observedSlot || !/^\d+$/.test(observedSlot)) {
    return null;
  }

  try {
    return BigInt(observedSlot);
  } catch {
    return null;
  }
}

function shouldKeepCurrentPositionOverConfirmed(args: {
  current: ActiveEarnPosition | null;
  confirmed: ActiveEarnPosition | null;
}): boolean {
  if (!args.current || !args.confirmed) {
    return false;
  }

  const currentSlot = parseEarnObservedSlot(args.current);
  const confirmedSlot = parseEarnObservedSlot(args.confirmed);
  if (
    currentSlot !== null &&
    confirmedSlot !== null &&
    currentSlot > confirmedSlot
  ) {
    return true;
  }

  const currentAmountRaw = parseEarnRawAmount(args.current.currentTotalAmountRaw);
  const confirmedAmountRaw = parseEarnRawAmount(
    args.confirmed.currentTotalAmountRaw
  );
  return (
    currentSlot !== null &&
    confirmedSlot === null &&
    currentAmountRaw !== null &&
    confirmedAmountRaw !== null &&
    currentAmountRaw > confirmedAmountRaw
  );
}

function getEarnPositionSourceSignature(
  position: ActiveEarnPosition | null | undefined
): string | null {
  if (!position) {
    return null;
  }

  const holdings =
    position.holdings && position.holdings.length > 0
      ? position.holdings
      : [
          {
            kind: "kamino" as const,
            liquidityMint: position.currentHolding.liquidityMint,
            market: position.currentHolding.market,
            reserve: position.currentHolding.reserve,
          },
        ];

  return holdings
    .map(
      (holding) =>
        [
          holding.kind,
          holding.liquidityMint,
          holding.market ?? "",
          holding.reserve ?? "",
        ].join(":")
    )
    .sort()
    .join("|");
}

function shouldRequestPositionReconciliation(args: {
  base: ActiveEarnPosition | null;
  rpc: ActiveEarnPosition | null;
}): boolean {
  if (!args.base || !args.rpc) {
    return false;
  }

  const baseAmountRaw = parseEarnRawAmount(args.base.currentTotalAmountRaw);
  const rpcAmountRaw = parseEarnRawAmount(args.rpc.currentTotalAmountRaw);
  if (baseAmountRaw !== null && rpcAmountRaw !== null) {
    const delta =
      baseAmountRaw > rpcAmountRaw
        ? baseAmountRaw - rpcAmountRaw
        : rpcAmountRaw - baseAmountRaw;
    if (delta >= EARN_POSITION_RECONCILE_MIN_DELTA_RAW) {
      return true;
    }
  }

  return (
    getEarnPositionSourceSignature(args.base) !==
    getEarnPositionSourceSignature(args.rpc)
  );
}

async function requestEarnPositionReconciliation() {
  const response = await fetch(EARN_POSITION_RECONCILE_ENDPOINT, {
    body: JSON.stringify({ force: true }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      payload?.error?.message ?? "Failed to reconcile Earn position."
    );
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

function isConfirmedEarnPositionResponse(
  data: unknown
): data is ConfirmedEarnPositionResponse {
  if (typeof data !== "object" || data === null || !("position" in data)) {
    return false;
  }

  const position = (data as { position: unknown }).position;
  if (position === null) {
    return true;
  }

  return (
    typeof position === "object" &&
    position !== null &&
    "currentTotalAmountRaw" in position &&
    "principalAmountRaw" in position &&
    "status" in position
  );
}

async function fetchConfirmedEarnPosition(): Promise<ActiveEarnPosition | null> {
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/position",
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to load confirmed Earn position.");
  }

  const data: unknown = await response.json();
  if (!isConfirmedEarnPositionResponse(data)) {
    throw new Error("Invalid confirmed Earn position response.");
  }

  return data.position;
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
  const [hasResolved, setHasResolved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [watchedAccounts, setWatchedAccounts] = useState<
    EarnRpcWatchedAccount[]
  >([]);
  const positionRef = useRef<ActiveEarnPosition | null>(null);
  const reconcileRequestKeyRef = useRef<string | null>(null);
  const suppressSubscriptionRefreshThroughSlotRef = useRef<bigint | null>(null);

  const canUseCache = Boolean(enabled && walletAddress && settingsPda);

  const setPosition = useCallback(
    (
      next:
        | ActiveEarnPosition
        | null
        | ((current: ActiveEarnPosition | null) => ActiveEarnPosition | null)
    ) => {
      setHasResolved(true);
      setIsLoading(false);
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
      setHasResolved(true);
      setIsLoading(false);
    },
    [settingsPda, solanaEnv, walletAddress]
  );

  const commitConfirmedPosition = useCallback(
    (nextPosition: ActiveEarnPosition | null) => {
      if (
        shouldKeepCurrentPositionOverConfirmed({
          current: positionRef.current,
          confirmed: nextPosition,
        })
      ) {
        setHasResolved(true);
        setIsLoading(false);
        return;
      }

      if (walletAddress && settingsPda) {
        writeEarnPositionCache({
          solanaEnv,
          walletAddress,
          settingsPda,
          position: nextPosition,
        });
      }
      positionRef.current = nextPosition;
      setWatchedAccounts([]);
      setPositionState(nextPosition);
      setHasResolved(true);
      setIsLoading(false);
    },
    [settingsPda, solanaEnv, walletAddress]
  );

  const refresh = useCallback(async () => {
    const currentPosition = positionRef.current;
    setIsLoading(true);
    try {
      const next = await readRpcPosition(currentPosition);
      if (!next) {
        setHasResolved(true);
        return currentPosition;
      }

      commitRpcPosition(next);
      return next.position;
    } finally {
      setIsLoading(false);
    }
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
          setHasResolved(true);
          setIsLoading(false);
          return;
        }
      }

      if (enabled && walletAddress) {
        setHasResolved(false);
        setIsLoading(true);
        return;
      }

      positionRef.current = null;
      setPositionState(null);
      setHasResolved(true);
      setIsLoading(false);
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
      setHasResolved(true);
    } else {
      positionRef.current = null;
      setPositionState(null);
      setHasResolved(false);
    }
    setIsLoading(true);

    let cancelled = false;
    const loadLivePosition = async () => {
      let confirmedPosition: ActiveEarnPosition | null | undefined;
      try {
        confirmedPosition = await fetchConfirmedEarnPosition();
      } catch (error) {
        console.warn(
          "[earn-position] failed to load confirmed active position",
          error
        );
      }
      if (cancelled) {
        return;
      }

      const basePosition =
        confirmedPosition !== undefined ? confirmedPosition : cached ?? null;
      const next = await readRpcPosition(basePosition);
      if (cancelled) {
        return;
      }
      if (next) {
        commitRpcPosition(next);
        if (
          shouldRequestPositionReconciliation({
            base: basePosition,
            rpc: next.position,
          })
        ) {
          const reconcileRequestKey = [
            basePosition?.currentTotalAmountRaw ?? "none",
            next.position?.currentTotalAmountRaw ?? "none",
            getEarnPositionSourceSignature(basePosition) ?? "none",
            getEarnPositionSourceSignature(next.position) ?? "none",
          ].join("|");
          if (reconcileRequestKeyRef.current !== reconcileRequestKey) {
            reconcileRequestKeyRef.current = reconcileRequestKey;
            requestEarnPositionReconciliation().catch((error) => {
              console.warn(
                "[earn-position] failed to reconcile stale confirmed position",
                error
              );
            });
          }
        }
        return;
      }

      if (confirmedPosition !== undefined) {
        commitConfirmedPosition(confirmedPosition);
        return;
      }

      setHasResolved(true);
      setIsLoading(false);
    };

    loadLivePosition().catch((error) => {
      if (cancelled) {
        return;
      }
      console.warn("[earn-position] failed to load live active position", error);
      setHasResolved(true);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    canUseCache,
    commitConfirmedPosition,
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
    hasResolved,
    isLoading,
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
