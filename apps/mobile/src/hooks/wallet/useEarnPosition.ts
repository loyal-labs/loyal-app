import { useCallback, useEffect, useRef, useState } from "react";

import { env } from "@/config/env";
import {
  getEarnRealtimeScope,
  subscribeEarnRealtime,
} from "@/features/earn-realtime/events";
import {
  fetchEarnHoldings,
  fetchEarnState,
  fetchEarnTransactions,
  type EarnHoldingItem,
  type EarnPosition,
} from "@/lib/solana/earn/earn-api";
import {
  applyConfirmedEarnMutation,
  normalizeEarnCluster,
  reconcileEarnProjection,
  resolveEarnMutationAccounting,
  type ConfirmedEarnMutation,
  type EarnPositionOverlay,
} from "@/lib/solana/earn/position-overlay";
import {
  readEarnOverlay,
  subscribeEarnOverlay,
  writeEarnOverlay,
} from "@/lib/solana/earn/position-store";

// Confirmed local amounts survive projection lag and app restarts. REST is
// authoritative only once its accounting slot covers the landed transaction.
export function useEarnPosition(walletAddress: string | null) {
  const [position, setPosition] = useState<EarnPosition | null>(null);
  const [holdings, setHoldings] = useState<EarnHoldingItem[]>([]);
  const [policyMissing, setPolicyMissing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchIdRef = useRef(0);
  const walletRef = useRef(walletAddress);
  const sessionKey = `${env.earnApiBaseUrl}:${normalizeEarnCluster(
    env.solanaEnv
  )}:${walletAddress}`;
  const sessionRef = useRef(sessionKey);
  const loadedWalletRef = useRef(sessionKey);
  walletRef.current = walletAddress;
  sessionRef.current = sessionKey;
  const overlayRef = useRef<EarnPositionOverlay | null>(null);
  const positionRef = useRef<EarnPosition | null>(null);

  const commit = useCallback(
    (overlay: EarnPositionOverlay | null, next: EarnPosition | null) => {
      overlayRef.current = overlay;
      positionRef.current = next;
      if (walletAddress) writeEarnOverlay(walletAddress, overlay);
      setPosition(next);
    },
    [walletAddress]
  );

  const confirmEarnMutation = useCallback(
    (mutation: ConfirmedEarnMutation) => {
      if (
        !walletAddress ||
        mutation.walletAddress !== walletAddress ||
        normalizeEarnCluster(mutation.cluster) !==
          normalizeEarnCluster(env.solanaEnv)
      )
        return;
      const currentWallet =
        walletRef.current === walletAddress &&
        sessionRef.current === sessionKey;
      if (currentWallet) ++fetchIdRef.current; // In-flight pre-confirm reads cannot acknowledge SSE.
      const overlay = applyConfirmedEarnMutation(
        readEarnOverlay(walletAddress),
        currentWallet ? positionRef.current : null,
        mutation
      );
      // A wallet switch cannot undo a landed transfer: retain it under its own
      // wallet key, but never update the newly selected wallet's UI.
      writeEarnOverlay(walletAddress, overlay, true);
      if (!currentWallet) return;
      setHoldings([]); // Do not display a pre-withdraw venue breakdown beside the new total.
      setHasLoaded(true);
      setIsLoading(false);
    },
    [walletAddress, sessionKey]
  );

  const refreshEarnPosition = useCallback(
    async (options?: { throwOnError?: boolean }) => {
      if (!walletAddress) return;
      const fetchId = ++fetchIdRef.current;
      const current = () =>
        fetchId === fetchIdRef.current &&
        walletRef.current === walletAddress &&
        sessionRef.current === sessionKey;
      const before = overlayRef.current;
      const readFence = [
        before?.confirmedSlot,
        before?.projectedSlot,
        before?.amountObservedSlot,
      ].reduce<string>(
        (latest, slot) =>
          slot && BigInt(slot) > BigInt(latest) ? slot : latest,
        "0"
      );
      setIsLoading(true);
      try {
        const [stateResult, holdingsResult, historyResult] =
          await Promise.allSettled([
            fetchEarnState(walletAddress),
            fetchEarnHoldings(
              walletAddress,
              readFence !== "0" &&
                (before?.pending || before?.position.currentAmountRaw !== "0")
                ? { minContextSlot: readFence }
                : undefined
            ),
            before?.pending
              ? fetchEarnTransactions(walletAddress)
              : Promise.resolve(null),
          ]);
        if (!current())
          throw new Error("Earn position refresh was superseded.");
        if (stateResult.status === "rejected") throw stateResult.reason;
        const state = stateResult.value;
        const scope = getEarnRealtimeScope(walletAddress);
        const latest = readEarnOverlay(walletAddress);
        if (
          (state.settingsPda &&
            normalizeEarnCluster(state.cluster ?? "") !==
              normalizeEarnCluster(env.solanaEnv)) ||
          (scope &&
            (state.settingsPda !== scope.settingsPda ||
              normalizeEarnCluster(scope.solanaEnv) !==
                normalizeEarnCluster(env.solanaEnv))) ||
          (!scope && latest && state.settingsPda !== latest.settingsPda)
        ) {
          throw new Error(
            "Earn position refresh belongs to a stale settings scope."
          );
        }
        if (
          state.settingsPda &&
          (!Array.isArray(state.projectedPositions) ||
            (scope &&
              state.projectedPositions.some(
                (row) => row.vaultPubkey !== scope.earnVaultAddress
              )))
        )
          throw new Error(
            "Earn accounting refresh is missing scoped row evidence."
          );
        const projectedSlot =
          state.projectedSlot ?? state.position?.lastConfirmedSlot ?? null;
        // The immutable ledger maps the actual signature to accounting row IDs
        // even after a rebalance/idle debit, and supplies an exact landing slot
        // when WS success only provided a conservative RPC context fence.
        const history =
          historyResult.status === "fulfilled"
            ? historyResult.value?.transactions ?? []
            : [];
        const previous = latest && {
          ...latest,
          mutations: (latest.mutations ?? []).map((mutation) =>
            resolveEarnMutationAccounting(
              mutation,
              state.projectedPositions ?? [],
              history
            )
          ),
        };
        let overlay = state.settingsPda
          ? reconcileEarnProjection({
              previous,
              settingsPda: state.settingsPda,
              position: state.position,
              projectedSlot,
              projectedPositions: state.projectedPositions,
            })
          : latest; // A missing projection is not proof of a confirmed full exit.
        let next = overlay?.position ?? state.position;
        if (holdingsResult.status === "fulfilled") {
          const live = holdingsResult.value;
          const sameScope =
            live.settingsPda === (overlay?.settingsPda ?? state.settingsPda) &&
            live.smartAccountAddress === state.smartAccountAddress;
          const minimumSlot = [
            overlay?.confirmedSlot,
            overlay?.projectedSlot,
            overlay?.amountObservedSlot,
          ].reduce<string>(
            (high, slot) => (slot && BigInt(slot) > BigInt(high) ? slot : high),
            "0"
          );
          const fresh =
            sameScope &&
            live.observedAt !== null &&
            (!minimumSlot ||
              (live.observedSlot !== null &&
                BigInt(live.observedSlot) >= BigInt(minimumSlot)));
          const closedProof =
            live.observedAt === null &&
            live.currentTotalAmountRaw === "0" &&
            live.holdings.length === 0 &&
            !overlay?.pending &&
            next?.currentAmountRaw === "0" &&
            state.projectedPositions &&
            state.projectedPositions.length > 0 &&
            state.projectedPositions.every(
              (row) => row.status === "closed" && row.currentAmountRaw === "0"
            );
          const emptyAccount =
            !state.settingsPda &&
            !latest &&
            !scope &&
            !state.position &&
            live.settingsPda === null &&
            live.currentTotalAmountRaw === "0" &&
            live.holdings.length === 0;
          if (!sameScope || (!fresh && !closedProof && !emptyAccount)) {
            throw new Error(
              "Earn holdings refresh is behind the accepted slot or scope."
            );
          }
          if (fresh) {
            if (next)
              next = { ...next, currentAmountRaw: live.currentTotalAmountRaw };
            if (overlay)
              overlay = { ...overlay, amountObservedSlot: live.observedSlot };
            setHoldings(live.holdings);
          }
          setPolicyMissing(!overlay?.pending && live.observedAt === null);
          if (
            !overlay?.pending &&
            live.observedAt === null &&
            (!next || next.currentAmountRaw === "0")
          ) {
            setHoldings([]);
          }
        }
        if (overlay && next) overlay = { ...overlay, position: next };
        commit(overlay, next);
        if (holdingsResult.status === "rejected") {
          // A closed projection covering the withdrawal is the complete zero
          // proof. Cleanup may already have removed the policy needed by the RPC
          // inventory endpoint; that is not a missing positive-balance refresh.
          const closedProof =
            !overlay?.pending &&
            next?.currentAmountRaw === "0" &&
            state.projectedPositions &&
            state.projectedPositions.length > 0 &&
            state.projectedPositions.every(
              (row) => row.status === "closed" && row.currentAmountRaw === "0"
            );
          if (!closedProof) throw holdingsResult.reason;
          setHoldings([]);
        }
      } catch (error) {
        if (options?.throwOnError) throw error;
        console.warn("Failed to refresh Earn position", error);
      } finally {
        if (current()) {
          setIsLoading(false);
          setHasLoaded(true);
        }
      }
    },
    [walletAddress, commit, sessionKey]
  );

  useEffect(() => {
    ++fetchIdRef.current;
    loadedWalletRef.current = sessionKey;
    const stored = walletAddress ? readEarnOverlay(walletAddress) : null;
    overlayRef.current = stored;
    positionRef.current = stored?.position ?? null;
    setPosition(stored?.position ?? null);
    setHoldings([]);
    setPolicyMissing(false);
    setHasLoaded(stored !== null);
    const unsubscribe = subscribeEarnOverlay((wallet, confirmed) => {
      if (wallet !== walletAddress || walletRef.current !== walletAddress)
        return;
      const overlay = readEarnOverlay(wallet);
      overlayRef.current = overlay;
      positionRef.current = overlay?.position ?? null;
      setPosition(overlay?.position ?? null);
      if (confirmed) {
        ++fetchIdRef.current;
        setHoldings([]);
        setHasLoaded(true);
        setIsLoading(false);
      }
    });
    if (walletAddress) void refreshEarnPosition();
    const requestIds = fetchIdRef;
    return () => {
      unsubscribe();
      ++requestIds.current;
    };
  }, [walletAddress, refreshEarnPosition, sessionKey]);

  // Missing accounting identities or a projection racing the last SSE frame
  // must converge even when no later event arrives. This retries evidence only;
  // elapsed time never releases a money overlay.
  useEffect(() => {
    if (!walletAddress) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const retry = async () => {
      if (readEarnOverlay(walletAddress)?.pending) await refreshEarnPosition();
      if (!stopped) timer = setTimeout(() => void retry(), 5_000);
    };
    timer = setTimeout(() => void retry(), 5_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [walletAddress, refreshEarnPosition]);

  useEffect(
    () =>
      subscribeEarnRealtime(async (refresh) => {
        if (refresh.position) await refreshEarnPosition({ throwOnError: true });
      }),
    [refreshEarnPosition]
  );

  const scopeMatches = loadedWalletRef.current === sessionKey;
  return {
    position: scopeMatches ? position : null,
    holdings: scopeMatches ? holdings : [],
    policyMissing: scopeMatches && policyMissing,
    isLoading,
    hasLoaded: scopeMatches && hasLoaded,
    refreshEarnPosition,
    confirmEarnMutation,
  };
}
