import { useCallback, useEffect, useRef, useState } from "react";

import { env } from "@/config/env";
import {
  fetchEarnHoldings,
  fetchEarnState,
  type EarnHoldingItem,
  type EarnPosition,
} from "@/lib/solana/earn/earn-api";

const MUTATION_TRUST_MS = 20_000;
// Keep only evidence, not balances, across Earn/wallet owners and screen reopens.
// Settings and the actual Earn vault are part of the key; a wallet-only cache
// would incorrectly apply an old account's cleanup to its replacement.
const closedSlots = new Map<string, bigint>();
const mutations = new Map<
  string,
  { epoch: number; pending: boolean; slot: bigint | null; scope: string | null }
>();

function slot(value: string | null | undefined): bigint | null {
  return typeof value === "string" && /^\d+$/.test(value)
    ? BigInt(value)
    : null;
}

export function useEarnPosition(walletAddress: string | null) {
  const [position, setPosition] = useState<EarnPosition | null>(null);
  const [holdings, setHoldings] = useState<EarnHoldingItem[]>([]);
  const [policyMissing, setPolicyMissing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [acceptedScope, setAcceptedScope] = useState<string | null>(null);
  const [acceptedPolicies, setAcceptedPolicies] = useState<string | null>(null);
  const [mutationVersion, setMutationVersion] = useState(0);
  const fetchIdRef = useRef(0);
  const currentRef = useRef<EarnPosition | null>(null);
  const scopeRef = useRef<string | null>(null);
  const mutatedAtRef = useRef(0);
  const pendingDepositRef = useRef(false);
  const configuredCluster =
    env.solanaEnv === "mainnet" ? "mainnet-beta" : env.solanaEnv;
  const identity = `${configuredCluster}:${walletAddress ?? "disconnected"}`;
  const identityRef = useRef(identity);
  const identityChanged = identityRef.current !== identity;
  if (identityChanged) {
    identityRef.current = identity;
    fetchIdRef.current += 1;
    currentRef.current = null;
    scopeRef.current = null;
    mutatedAtRef.current = 0;
    pendingDepositRef.current = false;
  }

  const markEarnMutation = useCallback(
    (options?: {
      pendingDeposit?: boolean;
      confirmedDeposit?: { amountRaw: string; observedSlot: string };
    }) => {
      const deposit = options?.confirmedDeposit;
      const previous = mutations.get(identity);
      if (
        identityRef.current !== identity ||
        (previous?.pending &&
          previous.scope !== null &&
          previous.scope !== scopeRef.current)
      ) {
        // Settle evidence for the submitting owner without touching the newly
        // selected wallet/account. Otherwise returning to that owner could stay
        // pending forever after its transaction completed off-screen.
        if (!options?.pendingDeposit && previous) {
          mutations.set(identity, {
            ...previous,
            epoch: previous.epoch + 1,
            pending: false,
            slot: deposit ? slot(deposit.observedSlot) : previous.slot,
          });
        }
        return;
      }
      ++fetchIdRef.current;
      setMutationVersion((version) => version + 1);
      mutatedAtRef.current = Date.now();
      pendingDepositRef.current = options?.pendingDeposit ?? false;
      mutations.set(identity, {
        epoch: (previous?.epoch ?? 0) + 1,
        pending: pendingDepositRef.current,
        slot: deposit
          ? slot(deposit.observedSlot)
          : previous?.scope === scopeRef.current
          ? previous.slot
          : null,
        scope: scopeRef.current,
      });
      if (deposit) {
        const next: EarnPosition = {
          currentAmountRaw: deposit.amountRaw,
          currentObservedSlot: deposit.observedSlot,
          currentSupplyApyBps: currentRef.current?.currentSupplyApyBps ?? null,
          principalAmountRaw: deposit.amountRaw,
          status: "active",
        };
        currentRef.current = next;
        setPosition(next);
        setHoldings([]);
        setHasLoaded(true);
      }
      setIsLoading(false);
    },
    [identity]
  );

  const refreshEarnPosition = useCallback(
    async (options?: { throwOnError?: boolean }) => {
      if (!walletAddress || identityRef.current !== identity) return;
      const fetchId = ++fetchIdRef.current;
      const mutationEpoch = mutations.get(identity)?.epoch ?? 0;
      setIsLoading(true);
      try {
        const [stateResult, holdingsResult] = await Promise.allSettled([
          fetchEarnState(walletAddress),
          fetchEarnHoldings(walletAddress),
        ]);
        if (
          fetchId !== fetchIdRef.current ||
          identityRef.current !== identity ||
          mutationEpoch !== (mutations.get(identity)?.epoch ?? 0)
        )
          return;
        if (stateResult.status === "rejected") throw stateResult.reason;
        const state = stateResult.value;
        if (
          (state.walletAddress && state.walletAddress !== walletAddress) ||
          (state.cluster && state.cluster !== configuredCluster) ||
          (state.vaultIndex !== undefined && state.vaultIndex !== 1)
        ) {
          throw new Error(
            "Earn state does not match the selected wallet scope."
          );
        }
        // Missing account mapping is not evidence of a replacement or zero funds.
        if (!state.settingsPda || !state.smartAccountAddress) return;
        const scope = `${identity}:${state.settingsPda}:1`;
        if (scopeRef.current !== null && scopeRef.current !== scope) {
          currentRef.current = null;
          setPosition(null);
          setHoldings([]);
          setPolicyMissing(false);
          pendingDepositRef.current = false;
          mutatedAtRef.current = 0;
        }
        scopeRef.current = scope;
        setAcceptedScope(scope);
        const live =
          holdingsResult.status === "fulfilled" ? holdingsResult.value : null;
        const liveMatches =
          live !== null &&
          live.settingsPda === state.settingsPda &&
          live.smartAccountAddress === state.smartAccountAddress &&
          (!live.cluster || live.cluster === configuredCluster) &&
          (!live.walletAddress || live.walletAddress === walletAddress) &&
          (live.vaultIndex === undefined || live.vaultIndex === 1) &&
          (!live.vaultPubkey ||
            !state.vaultPubkey ||
            live.vaultPubkey === state.vaultPubkey);
        const mutation = mutations.get(identity);
        const scopedMutation =
          mutation?.scope === null || mutation?.scope === scope
            ? mutation
            : null;
        const localSlot = scopedMutation?.slot ?? null;
        const positionSlot = slot(currentRef.current?.currentObservedSlot);
        const currentSlot =
          localSlot !== null &&
          (positionSlot === null || localSlot > positionSlot)
            ? localSlot
            : positionSlot;
        const nextSlot = slot(state.position?.currentObservedSlot);
        const proofSlot =
          state.position === null
            ? slot(state.closedPositionObservedSlot)
            : null;
        const liveSlot =
          liveMatches && live?.observedAt ? slot(live.observedSlot) : null;
        const closedSlot = closedSlots.get(scope) ?? null;
        // A wallet prompt/pending deposit is not an empty lifecycle. No response
        // started before the mutation may commit, even if it finishes afterwards.
        if (pendingDepositRef.current || scopedMutation?.pending) return;
        if (proofSlot !== null) {
          closedSlots.set(
            scope,
            closedSlot !== null && closedSlot > proofSlot
              ? closedSlot
              : proofSlot
          );
          if (
            (currentSlot !== null && currentSlot > proofSlot) ||
            (liveSlot !== null &&
              liveSlot > proofSlot &&
              live &&
              BigInt(live.currentTotalAmountRaw) > BigInt(0))
          )
            return;
          currentRef.current = null;
          setPosition(null);
          setHoldings([]);
          setPolicyMissing(true);
          return;
        }
        if (state.position === null) {
          // Old servers and missing policy metadata provide no closure evidence.
          // An initially empty wallet remains empty; a valid balance is retained.
          return;
        }
        if (
          (closedSlot !== null &&
            (nextSlot === null || nextSlot <= closedSlot)) ||
          (currentSlot !== null &&
            (nextSlot === null || nextSlot < currentSlot))
        )
          return;
        let next = state.position;
        const floor = nextSlot ?? currentSlot;
        const liveFresh =
          liveMatches &&
          liveSlot !== null &&
          (floor === null || liveSlot >= floor) &&
          (closedSlot === null || liveSlot > closedSlot);
        if (liveFresh && live) {
          setHoldings(live.holdings);
          if (
            Date.now() - mutatedAtRef.current >= MUTATION_TRUST_MS ||
            (localSlot !== null && liveSlot !== null && liveSlot >= localSlot)
          ) {
            next = {
              ...next,
              currentAmountRaw: live.currentTotalAmountRaw,
              currentObservedSlot: live.observedSlot ?? undefined,
            };
          }
        } else if (
          next.currentAmountRaw !== currentRef.current?.currentAmountRaw
        ) {
          // A reconciled total cannot keep details from a different balance
          // when the independent holdings request failed or is lagging.
          setHoldings([]);
        }
        if (liveMatches && live) setPolicyMissing(live.observedAt === null);
        currentRef.current = next;
        setAcceptedPolicies(
          state.policyAccounts?.slice().sort().join(",") ?? null
        );
        setPosition(next);
      } catch (error) {
        if (fetchId !== fetchIdRef.current || identityRef.current !== identity)
          return;
        console.error("Failed to fetch Earn position", error);
        if (options?.throwOnError) throw error;
      } finally {
        if (
          fetchId === fetchIdRef.current &&
          identityRef.current === identity
        ) {
          setIsLoading(false);
          setHasLoaded(true);
        }
      }
    },
    [walletAddress, identity, configuredCluster]
  );

  useEffect(() => {
    setPosition(null);
    setHoldings([]);
    setPolicyMissing(false);
    setHasLoaded(false);
    setAcceptedScope(null);
    setAcceptedPolicies(null);
    setIsLoading(false);
    if (walletAddress) void refreshEarnPosition();
    return () => {
      ++fetchIdRef.current;
    };
  }, [identity, walletAddress, refreshEarnPosition]);

  return {
    position: identityChanged ? null : position,
    holdings: identityChanged ? [] : holdings,
    policyMissing: identityChanged ? false : policyMissing,
    isLoading: identityChanged ? false : isLoading,
    hasLoaded: identityChanged ? false : hasLoaded,
    // Source selection must be invalidated when the accepted lifecycle closes.
    reconciliationKey: `${acceptedScope ?? identity}:${
      acceptedPolicies ?? "unknown"
    }:${mutationVersion}:${mutations.get(identity)?.epoch ?? 0}:${
      position === null ? "empty" : position.currentAmountRaw
    }`,
    refreshEarnPosition,
    markEarnMutation,
  };
}
