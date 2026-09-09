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
  assertEarnProjectionDoesNotRegress,
  bindEarnAccountingTargets,
  type EarnAccountingTarget,
  type EarnPositionMutation,
  type EarnProjectedPosition,
  isEarnMutationCovered,
  parseEarnConfirmationSlot,
  recoverEarnMutationEvidence,
} from "@/lib/yield-optimization/earn-position-accounting.client";
import {
  readEarnPositionRecovery,
  writeEarnPositionRecovery,
} from "@/lib/yield-optimization/earn-position-recovery.client";
import { resolveEarnPositionDisplay } from "@/lib/yield-optimization/earn-position-display";
import {
  type EarnRpcHolding,
  type EarnRpcHoldingsSnapshot,
  type EarnRpcPolicyMetadata,
  type EarnRpcWatchedAccount,
  fetchEarnRpcHoldingsSnapshot,
  sumEarnRpcHoldingsAmountRaw,
} from "@/lib/yield-optimization/earn-rpc-holdings.client";

const EARN_POSITION_CACHE_VERSION = 6;
const EARN_POSITION_REFRESH_DEBOUNCE_MS = 350;
const EARN_POSITION_INITIAL_LOAD_MAX_ATTEMPTS = 2;
const EARN_POSITION_INITIAL_LOAD_RETRY_DELAY_MS = 2_000;

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
  sourceId: string;
  supplyApyBps: string | null;
  tokenProgramId: string;
};

export type ActiveEarnPosition = {
  lastConfirmedSlot?: string | null;
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
  Partial<Pick<Connection, "onAccountChange" | "removeAccountChangeListener">>;

type RpcPositionRead = {
  observedSlot: bigint;
  position: ActiveEarnPosition | null;
  watchedAccounts: EarnRpcWatchedAccount[];
};

type ConfirmedEarnPositionResponse = {
  position: ActiveEarnPosition | null;
  projectedPositions?: EarnProjectedPosition[];
};

export function isActiveEarnPosition(
  position: ActiveEarnPosition | null | undefined
): position is ActiveEarnPosition {
  if (position?.status !== "active") {
    return false;
  }

  if (position.holdings) {
    return position.holdings.some((holding) => {
      try {
        return BigInt(holding.amountRaw) > BigInt(0);
      } catch {
        return false;
      }
    });
  }

  try {
    return BigInt(position.currentTotalAmountRaw) > BigInt(0);
  } catch {
    return false;
  }
}

function parseEarnRawAmount(
  amountRaw: string | null | undefined
): bigint | null {
  if (!(amountRaw && /^\d+$/.test(amountRaw))) {
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
  if (!(observedSlot && /^\d+$/.test(observedSlot))) {
    return null;
  }

  try {
    return BigInt(observedSlot);
  } catch {
    return null;
  }
}

function hasRpcObservedHoldings(
  position: ActiveEarnPosition | null | undefined
): boolean {
  return (
    position?.holdings?.some(
      (holding) => holding.provenance.source === "rpc_getMultipleAccounts"
    ) ?? false
  );
}

function shouldKeepCurrentPositionOverConfirmed(args: {
  current: ActiveEarnPosition | null;
  confirmed: ActiveEarnPosition | null;
}): boolean {
  if (!(args.current && args.confirmed)) {
    return hasRpcObservedHoldings(args.current);
  }

  if (hasRpcObservedHoldings(args.current)) {
    return true;
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

  const currentAmountRaw = parseEarnRawAmount(
    args.current.currentTotalAmountRaw
  );
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

// RPC owns the live amount, not the principal ledger. Adopt projected basis
// only once the relevant rows cover every locally confirmed mutation.
function mergeProjectedMetadata(
  current: ActiveEarnPosition | null,
  projected: ActiveEarnPosition | null | undefined,
  accountingCovered: boolean
): ActiveEarnPosition | null {
  if (!current || !projected || !accountingCovered) {
    return current;
  }
  return {
    ...current,
    initialHolding: projected.initialHolding,
    lastConfirmedSlot: projected.lastConfirmedSlot,
    principalAmountRaw: projected.principalAmountRaw,
  };
}

export function resolveFailedEarnPositionLoad(args: {
  attempt: number;
  cachedPosition: ActiveEarnPosition | null;
  confirmedPosition: ActiveEarnPosition | null | undefined;
  currentPosition: ActiveEarnPosition | null;
}):
  | { kind: "confirmed"; position: ActiveEarnPosition }
  | { kind: "preserve-existing" }
  | { kind: "retry" }
  | { kind: "unresolved" } {
  if (args.confirmedPosition) {
    return { kind: "confirmed", position: args.confirmedPosition };
  }
  if (args.cachedPosition ?? args.currentPosition) {
    return { kind: "preserve-existing" };
  }
  if (args.attempt + 1 < EARN_POSITION_INITIAL_LOAD_MAX_ATTEMPTS) {
    return { kind: "retry" };
  }
  return { kind: "unresolved" };
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

async function fetchConfirmedEarnPosition(): Promise<ConfirmedEarnPositionResponse> {
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

  return data;
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
  const refreshDirtyRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const positionScope = [
    enabled ? "enabled" : "disabled",
    solanaEnv,
    walletAddress ?? "no-wallet",
    settingsPda ?? "no-settings",
  ].join(":");
  const activePositionScopeRef = useRef(positionScope);
  const refreshInFlightRef = useRef<Promise<ActiveEarnPosition | null> | null>(
    null
  );
  const refreshInFlightScopeRef = useRef<string | null>(null);
  const suppressSubscriptionRefreshThroughSlotRef = useRef<bigint | null>(null);
  const projectedRowsRef = useRef<EarnProjectedPosition[]>([]);
  const adoptedRowsRef = useRef<EarnProjectedPosition[]>([]);
  const adoptedPrincipalRef = useRef("0");
  const mutationsRef = useRef<EarnPositionMutation[]>([]);
  const rpcObservedSlotRef = useRef<bigint | null>(null);
  const hydratedScopeRef = useRef<string | null>(null);

  // Advance identity synchronously during render. A response that resolves
  // between this render and passive-effect cleanup must not commit into the
  // newly selected wallet/settings scope (including a rapid A -> B -> A).
  if (activePositionScopeRef.current !== positionScope) {
    activePositionScopeRef.current = positionScope;
    refreshGenerationRef.current += 1;
    refreshDirtyRef.current = false;
    refreshInFlightRef.current = null;
    refreshInFlightScopeRef.current = null;
    suppressSubscriptionRefreshThroughSlotRef.current = null;
    projectedRowsRef.current = [];
    adoptedRowsRef.current = [];
    adoptedPrincipalRef.current = "0";
    mutationsRef.current = [];
    rpcObservedSlotRef.current = null;
    positionRef.current = null;
    hydratedScopeRef.current = null;
  }

  if (hydratedScopeRef.current !== positionScope) {
    hydratedScopeRef.current = positionScope;
    const saved = enabled && walletAddress && settingsPda
      ? readEarnPositionRecovery(positionScope) : null;
    positionRef.current = saved?.position ?? null;
    if (saved) {
      mutationsRef.current = [...saved.mutations];
      projectedRowsRef.current = saved.projectedRows;
      adoptedRowsRef.current = saved.adoptedRows;
      adoptedPrincipalRef.current = saved.adoptedPrincipal;
      rpcObservedSlotRef.current = parseEarnConfirmationSlot(saved.rpcObservedSlot);
      suppressSubscriptionRefreshThroughSlotRef.current = parseEarnConfirmationSlot(saved.slotFloor);
    }
    setPositionState(positionRef.current);
    setHasResolved(saved !== null);
  }

  const persistRecovery = useCallback(() => {
    if (!(enabled && walletAddress && settingsPda) || activePositionScopeRef.current !== positionScope) return;
    writeEarnPositionRecovery(positionScope, {
      position: positionRef.current,
      mutations: mutationsRef.current,
      projectedRows: projectedRowsRef.current,
      adoptedRows: adoptedRowsRef.current,
      adoptedPrincipal: adoptedPrincipalRef.current,
      rpcObservedSlot: rpcObservedSlotRef.current?.toString() ?? null,
      slotFloor: suppressSubscriptionRefreshThroughSlotRef.current?.toString() ?? null,
    });
  }, [enabled, walletAddress, settingsPda, positionScope]);

  const canUseCache = Boolean(enabled && walletAddress && settingsPda);

  const setPosition = useCallback(
    (
      next:
        | ActiveEarnPosition
        | null
        | ((current: ActiveEarnPosition | null) => ActiveEarnPosition | null),
      mutation?: EarnPositionMutation
    ) => {
      if (activePositionScopeRef.current !== positionScope) {
        return;
      }
      if (
        mutation?.signature &&
        mutationsRef.current.some((prior) => prior.signature === mutation.signature)
      ) {
        return;
      }
      // Local confirmation supersedes reads already in flight, including a
      // full-withdrawal null tombstone. Update the ref synchronously.
      refreshGenerationRef.current += 1;
      refreshInFlightRef.current = null;
      refreshInFlightScopeRef.current = null;
      const current = positionRef.current;
      let resolved = typeof next === "function" ? next(current) : next;
      if (mutation) {
        const principalCovered = isEarnMutationCovered(
          adoptedRowsRef.current, mutation
        );
        if (principalCovered && resolved) {
          resolved = {
            ...resolved,
            principalAmountRaw: adoptedPrincipalRef.current,
          };
        }
        mutationsRef.current.push(mutation);
        const slot = parseEarnConfirmationSlot(mutation.confirmedSlot);
        if (slot !== null) {
          const floor = suppressSubscriptionRefreshThroughSlotRef.current;
          suppressSubscriptionRefreshThroughSlotRef.current =
            floor === null || slot > floor ? slot : floor;
          // A complete RPC snapshot can already include this transaction.
          // Preserve its amount, but still apply the unprojected principal delta.
          if (
            (rpcObservedSlotRef.current !== null &&
              rpcObservedSlotRef.current >= slot) ||
            (rpcObservedSlotRef.current === null && principalCovered)
          ) {
            resolved = current
              ? {
                  ...current,
                  principalAmountRaw: principalCovered
                    ? adoptedPrincipalRef.current
                    : resolved?.principalAmountRaw ?? "0",
                }
              : null;
          }
        }
      }
      positionRef.current = resolved;
      persistRecovery();
      setHasResolved(true);
      setIsLoading(false);
      setPositionState(resolved);
      if (walletAddress && settingsPda) {
        writeEarnPositionCache({
          solanaEnv,
          walletAddress,
          settingsPda,
          position: resolved,
        });
      }
    },
    [persistRecovery, positionScope, settingsPda, solanaEnv, walletAddress]
  );

  const captureAccountingTargets = useCallback(
    (targets: EarnAccountingTarget[]) =>
      bindEarnAccountingTargets(targets, projectedRowsRef.current),
    []
  );

  const isAccountingCovered = useCallback(
    (response: ConfirmedEarnPositionResponse) => {
      assertEarnProjectionDoesNotRegress(
        projectedRowsRef.current, response.projectedPositions ?? []
      );
      if (mutationsRef.current.length) {
        return mutationsRef.current.every((mutation) =>
          isEarnMutationCovered(response.projectedPositions ?? [], mutation)
        );
      }
      const floor = suppressSubscriptionRefreshThroughSlotRef.current;
      return floor === null ||
        (parseEarnRawAmount(response.position?.lastConfirmedSlot) ?? BigInt(-1)) >= floor;
    },
    []
  );

  const retainProjectionEvidence = useCallback(
    (response: ConfirmedEarnPositionResponse, covered: boolean) => {
      if (!response.projectedPositions) return;
      projectedRowsRef.current = response.projectedPositions;
      if (covered) {
        adoptedRowsRef.current = response.projectedPositions;
        adoptedPrincipalRef.current = response.position?.principalAmountRaw ?? "0";
      }
    },
    []
  );

  const readRpcPosition = useCallback(
    async (
      basePosition: ActiveEarnPosition | null
    ): Promise<RpcPositionRead | null> => {
      if (!(connection && programId && earnPolicy && settingsPda)) {
        return null;
      }

      // A WS-confirmed action can lack metadata. Never replace its amount
      // with an unfenced read while exact signature evidence is unavailable.
      if (mutationsRef.current.some((mutation) =>
        parseEarnConfirmationSlot(mutation.confirmedSlot) === null)) {
        throw new Error("Earn confirmation slot evidence is still pending.");
      }
      const slotFloor = suppressSubscriptionRefreshThroughSlotRef.current;
      const snapshot = await fetchEarnRpcHoldingsSnapshot({
        cluster: resolveLoyalClusterForSolanaEnv(resolveSolanaEnv(solanaEnv)),
        connection,
        minContextSlot: slotFloor === null ? undefined : Number(slotFloor),
        requireCompleteReserveReads: true,
        policy: earnPolicy,
        programId: new PublicKey(programId),
        settingsPda: new PublicKey(settingsPda),
      });

      return {
        observedSlot: BigInt(snapshot.observedSlot),
        position: applyEarnRpcSnapshotToPosition(basePosition, snapshot),
        watchedAccounts: snapshot.provenance.watchedAccounts,
      };
    },
    [connection, earnPolicy, programId, settingsPda, solanaEnv]
  );

  const commitRpcPosition = useCallback(
    (next: RpcPositionRead) => {
      if (activePositionScopeRef.current !== positionScope) {
        return;
      }
      const slotFloor = suppressSubscriptionRefreshThroughSlotRef.current;
      if (slotFloor !== null && next.observedSlot < slotFloor) {
        throw new Error("Earn RPC snapshot predates the confirmed transaction.");
      }
      if (walletAddress && settingsPda) {
        writeEarnPositionCache({
          solanaEnv,
          walletAddress,
          settingsPda,
          position: next.position,
        });
      }
      rpcObservedSlotRef.current = next.observedSlot;
      positionRef.current = next.position;
      persistRecovery();
      setWatchedAccounts(next.watchedAccounts);
      setPositionState(next.position);
      setHasResolved(true);
      setIsLoading(false);
    },
    [persistRecovery, positionScope, settingsPda, solanaEnv, walletAddress]
  );

  const commitConfirmedPosition = useCallback(
    (response: ConfirmedEarnPositionResponse) => {
      let nextPosition = response.position;
      if (activePositionScopeRef.current !== positionScope) {
        return;
      }
      const covered = isAccountingCovered(response);
      retainProjectionEvidence(response, covered);
      // Null REST alone cannot acknowledge a full exit; closed target rows can.
      if (!covered) {
        persistRecovery();
        setHasResolved(true);
        setIsLoading(false);
        return;
      }
      const keepRpc = rpcObservedSlotRef.current !== null || shouldKeepCurrentPositionOverConfirmed({
        current: positionRef.current,
        confirmed: nextPosition,
      });
      if (keepRpc) {
        nextPosition = mergeProjectedMetadata(
          positionRef.current,
          nextPosition,
          covered
        );
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
      persistRecovery();
      if (!keepRpc) {
        setWatchedAccounts([]);
      }
      setPositionState(nextPosition);
      setHasResolved(true);
      setIsLoading(false);
    },
    [isAccountingCovered, persistRecovery, retainProjectionEvidence, positionScope, settingsPda, solanaEnv, walletAddress]
  );

  const refresh = useCallback(() => {
    if (activePositionScopeRef.current !== positionScope) {
      return Promise.reject(new Error("Earn position refresh was superseded."));
    }
    if (
      refreshInFlightRef.current &&
      refreshInFlightScopeRef.current === positionScope
    ) {
      refreshDirtyRef.current = true;
      return refreshInFlightRef.current;
    }

    const generation = refreshGenerationRef.current;
    const run = async (): Promise<ActiveEarnPosition | null> => {
      let result = positionRef.current;
      let lastError: unknown;
      setIsLoading(true);
      try {
        do {
          refreshDirtyRef.current = false;
          lastError = undefined;
          try {
            // SSE is an invalidation: refetch the canonical ledger as well
            // as live holdings, otherwise cached principal never catches up.
            const projected = await fetchConfirmedEarnPosition();
            if (generation !== refreshGenerationRef.current || activePositionScopeRef.current !== positionScope) {
              throw new Error("Earn position refresh was superseded.");
            }
            if (mutationsRef.current.some((mutation) =>
              !isEarnMutationCovered(projected.projectedPositions ?? [], mutation))) {
              const history = await fetch("/api/smart-accounts/earn-transactions", { cache: "no-store" })
                .then(async (response) => response.ok ? response.json() : null)
                .catch(() => null);
              if (generation !== refreshGenerationRef.current || activePositionScopeRef.current !== positionScope) {
                throw new Error("Earn position refresh was superseded.");
              }
              mutationsRef.current = mutationsRef.current.map((mutation) =>
                recoverEarnMutationEvidence(mutation, projected.projectedPositions ?? [], history));
              for (const mutation of mutationsRef.current) {
                const slot = parseEarnConfirmationSlot(mutation.confirmedSlot);
                const floor = suppressSubscriptionRefreshThroughSlotRef.current;
                if (slot !== null && (floor === null || slot > floor)) {
                  suppressSubscriptionRefreshThroughSlotRef.current = slot;
                }
              }
              persistRecovery();
            }
            const covered = isAccountingCovered(projected);
            // Retain row high-waters even if the balance read fails, but do not
            // mark principal adopted until a position commit actually succeeds.
            retainProjectionEvidence(projected, false);
            persistRecovery();
            const base = mergeProjectedMetadata(
              positionRef.current,
              projected.position,
              covered
            );
            const next = await readRpcPosition(base);
            if (
              generation !== refreshGenerationRef.current ||
              activePositionScopeRef.current !== positionScope
            ) {
              throw new Error("Earn position refresh was superseded.");
            }
            if (next) {
              next.position = mergeProjectedMetadata(
                next.position,
                projected.position,
                covered
              );
              commitRpcPosition(next);
              retainProjectionEvidence(projected, covered);
              persistRecovery();
              result = next.position;
            } else {
              commitConfirmedPosition(projected);
              result = positionRef.current;
            }
            if (!covered && mutationsRef.current.length > 0) {
              // Live amount may be ready before the ledger. Keep the resource
              // retryable rather than acknowledging an unprojected principal.
              throw new Error("Earn accounting projection is still pending.");
            }
          } catch (error) {
            lastError = error;
          }
        } while (
          refreshDirtyRef.current &&
          generation === refreshGenerationRef.current &&
          activePositionScopeRef.current === positionScope
        );

        if (
          generation !== refreshGenerationRef.current ||
          activePositionScopeRef.current !== positionScope
        ) {
          throw new Error("Earn position refresh was superseded.");
        }
        if (lastError !== undefined) {
          throw lastError;
        }
        return result;
      } finally {
        if (
          generation === refreshGenerationRef.current &&
          activePositionScopeRef.current === positionScope
        ) {
          setIsLoading(false);
        }
      }
    };

    const promise = run().finally(() => {
      if (refreshInFlightRef.current === promise) {
        refreshInFlightRef.current = null;
        refreshInFlightScopeRef.current = null;
      }
    });
    refreshInFlightRef.current = promise;
    refreshInFlightScopeRef.current = positionScope;
    return promise;
  }, [
    commitConfirmedPosition,
    commitRpcPosition,
    isAccountingCovered,
    persistRecovery,
    retainProjectionEvidence,
    positionScope,
    readRpcPosition,
  ]);

  const suppressSubscriptionRefreshThroughSlot = useCallback(
    (slot: bigint | number | string | null | undefined) => {
      if (slot == null || activePositionScopeRef.current !== positionScope) {
        return;
      }

      try {
        const nextSlot = BigInt(slot);
        if (nextSlot < BigInt(0) || nextSlot > BigInt(Number.MAX_SAFE_INTEGER)) {
          return;
        }
        const current = suppressSubscriptionRefreshThroughSlotRef.current;
        if (current === null || nextSlot > current) {
          suppressSubscriptionRefreshThroughSlotRef.current = nextSlot;
          refreshGenerationRef.current += 1;
          refreshInFlightRef.current = null;
          refreshInFlightScopeRef.current = null;
          persistRecovery();
        }
      } catch {
        // Ignore malformed slot hints; the subscription will refresh normally.
      }
    },
    [persistRecovery, positionScope]
  );

  useEffect(() => {
    if (!(canUseCache && walletAddress && settingsPda)) {
      setWatchedAccounts([]);
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

    const recovery = readEarnPositionRecovery(positionScope);
    const cached = recovery ? recovery.position : readEarnPositionCache({
      solanaEnv,
      walletAddress,
      settingsPda,
    });
    if (recovery || cached) {
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
    const generation = refreshGenerationRef.current;
    const isSuperseded = () =>
      cancelled ||
      activePositionScopeRef.current !== positionScope ||
      generation !== refreshGenerationRef.current;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const handleUnexpectedLoadError = (error: unknown) => {
      if (isSuperseded()) {
        return;
      }
      console.warn(
        "[earn-position] failed to load live active position",
        error
      );
      setHasResolved(Boolean(cached ?? positionRef.current));
      setIsLoading(false);
    };
    const loadLivePosition = async (attempt = 0) => {
      const confirmedPositionPromise = fetchConfirmedEarnPosition().catch(
        (error) => {
          console.warn(
            "[earn-position] failed to load confirmed active position",
            error
          );
          return undefined;
        }
      );
      const rpcBasePosition = cached ?? positionRef.current;
      let next: RpcPositionRead | null;
      try {
        next = await readRpcPosition(rpcBasePosition);
      } catch (error) {
        const confirmedPosition = await confirmedPositionPromise;
        if (isSuperseded()) {
          return;
        }
        console.warn(
          "[earn-position] failed to load live active position",
          error
        );
        const resolution = resolveFailedEarnPositionLoad({
          attempt,
          cachedPosition: cached,
          confirmedPosition: confirmedPosition?.position,
          currentPosition: positionRef.current,
        });
        if (resolution.kind === "confirmed") {
          commitConfirmedPosition(confirmedPosition!);
          return;
        }
        if (resolution.kind === "preserve-existing") {
          setHasResolved(true);
          setIsLoading(false);
          return;
        }
        setHasResolved(false);
        if (resolution.kind === "retry") {
          setIsLoading(true);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void loadLivePosition(attempt + 1).catch(
              handleUnexpectedLoadError
            );
          }, EARN_POSITION_INITIAL_LOAD_RETRY_DELAY_MS);
          return;
        }
        setIsLoading(false);
        return;
      }
      if (isSuperseded()) {
        return;
      }
      if (next) {
        // Show confirmed RPC exposure immediately; a slow projection read
        // must not delay the local balance. Adopt only ledger metadata later.
        commitRpcPosition(next);
        const projected = await confirmedPositionPromise;
        if (isSuperseded()) {
          return;
        }
        if (projected) {
          commitConfirmedPosition(projected);
        }
        return;
      }

      const confirmedPosition = await confirmedPositionPromise;
      if (isSuperseded()) {
        return;
      }
      if (confirmedPosition !== undefined) {
        commitConfirmedPosition(confirmedPosition);
        return;
      }

      setHasResolved(true);
      setIsLoading(false);
    };

    // Reopened proofs must pass the same fenced recovery path as invalidations.
    if (recovery) {
      void refresh().catch(() => {
        if (!isSuperseded()) { setHasResolved(true); setIsLoading(false); }
      });
    } else {
      void loadLivePosition().catch(handleUnexpectedLoadError);
    }

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [
    canUseCache,
    commitConfirmedPosition,
    commitRpcPosition,
    enabled,
    readRpcPosition,
    refresh,
    positionScope,
    settingsPda,
    solanaEnv,
    walletAddress,
  ]);

  useEffect(() => {
    if (!canUseCache) return;
    // Projection may land after the last SSE/account invalidation. Retry only
    // read-only evidence; confirmed optimism never expires or resends writes.
    const timer = setInterval(() => {
      if (mutationsRef.current.some((mutation) =>
        !isEarnMutationCovered(adoptedRowsRef.current, mutation)) ||
        (suppressSubscriptionRefreshThroughSlotRef.current !== null &&
          (rpcObservedSlotRef.current === null || rpcObservedSlotRef.current < suppressSubscriptionRefreshThroughSlotRef.current))) {
        void refresh().catch(() => {});
      }
    }, EARN_POSITION_INITIAL_LOAD_RETRY_DELAY_MS);
    return () => clearInterval(timer);
  }, [canUseCache, refresh]);

  const watchAccountKey = watchedAccounts
    .filter((account) => account.kind !== "reserve")
    .map((account) => `${account.kind}:${account.pubkey}`)
    .join("|");

  useEffect(() => {
    const onAccountChange = connection?.onAccountChange?.bind(connection);
    const removeAccountChangeListener =
      connection?.removeAccountChangeListener?.bind(connection);
    if (
      !(
        enabled &&
        onAccountChange &&
        removeAccountChangeListener &&
        watchAccountKey
      )
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
      const suppressThrough = suppressSubscriptionRefreshThroughSlotRef.current;
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
    captureAccountingTargets,
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

  const primaryHolding = snapshot.holdings[0];
  if (!primaryHolding) {
    return null;
  }

  const activePosition =
    position ?? createPositionFromRpcHolding(primaryHolding);
  const primaryDisplay = resolveEarnPositionDisplay({
    liquidityMint: primaryHolding.liquidityMint,
    market: primaryHolding.market,
  });
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
    currentSupplyApyBps: calculateWeightedEarnApyBps(snapshot.holdings),
    currentTotalAmountRaw: totalAmountRaw.toString(),
    display: {
      label: primaryHolding.label,
      marketName: primaryHolding.marketName,
      mintSymbol: primaryDisplay.mintSymbol,
    },
    holdings: snapshot.holdings,
    principalAmountRaw: activePosition.principalAmountRaw,
    status: "active",
  };
}

export function calculateWeightedEarnApyBps(
  holdings: readonly ActiveEarnPositionHolding[]
): string | null {
  let weighted = BigInt(0);
  let covered = BigInt(0);
  for (const holding of holdings) {
    const amount = BigInt(holding.amountRaw);
    if (amount <= BigInt(0)) {
      continue;
    }
    if (holding.kind === "idle") {
      covered += amount;
      continue;
    }
    if (holding.supplyApyBps === null) {
      return null;
    }
    covered += amount;
    weighted += amount * BigInt(holding.supplyApyBps);
  }
  return covered > BigInt(0) ? (weighted / covered).toString() : null;
}

function createPositionFromRpcHolding(
  holding: EarnRpcHolding
): ActiveEarnPosition {
  const reserve = holding.reserve ?? "";
  const display = resolveEarnPositionDisplay({
    liquidityMint: holding.liquidityMint,
    market: holding.market,
  });
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
      mintSymbol: display.mintSymbol,
    },
    holdings: [holding],
    initialHolding: {
      liquidityMint: holding.liquidityMint,
      market: holding.market,
      reserve,
      supplyApyBps: holding.supplyApyBps,
    },
    // RPC exposure is not a principal ledger. The earnings endpoint remains
    // unavailable until a confirmed deposit/withdrawal record supplies basis.
    principalAmountRaw: "0",
    status: "active",
  };
}
