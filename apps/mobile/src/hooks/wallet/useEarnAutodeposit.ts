import { shouldRetainConfirmedAutodepositSetup } from "@loyal-labs/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeEarnRealtime } from "@/features/earn-realtime/events";
import type { ConfirmedEarnAutodepositSetup } from "@/lib/solana/earn/autodeposit";
import {
  fetchEarnAutodepositState,
  type EarnAutodepositState,
} from "@/lib/solana/earn/earn-api";

type OptimisticSetup = {
  identity: ConfirmedEarnAutodepositSetup;
  state: EarnAutodepositState;
  walletAddress: string;
};

// Reads the wallet's current Autodeposit state (threshold + on/off + the
// policy/delegation the floor/toggle/close calls need) from the read-only
// backend endpoint. Like useEarnPosition: wallet-address-keyed, never signs.
export function useEarnAutodeposit(walletAddress: string | null) {
  const [autodeposit, setAutodeposit] = useState<EarnAutodepositState | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchIdRef = useRef(0);
  const optimisticSetupRef = useRef<OptimisticSetup | null>(null);

  const confirmAutodepositSetup = useCallback(
    (confirmed: ConfirmedEarnAutodepositSetup) => {
      if (!walletAddress) {
        return;
      }
      const optimistic: OptimisticSetup = {
        identity: confirmed,
        state: {
          active: true,
          lifecycleStatus: "active",
          policyAccount: confirmed.policyAccount,
          recurringDelegation: confirmed.recurringDelegation,
          scheduledSweeps: [],
          status: "active",
          vaultIndex: confirmed.vaultIndex,
          walletBalanceFloorRaw: confirmed.walletBalanceFloorRaw,
        },
        walletAddress,
      };
      optimisticSetupRef.current = optimistic;
      setAutodeposit(optimistic.state);
    },
    [walletAddress],
  );

  const refreshAutodeposit = useCallback(
    async (options?: {
      throwOnError?: boolean;
    }): Promise<EarnAutodepositState | null> => {
      if (!walletAddress) {
        return null;
      }
      const fetchId = ++fetchIdRef.current;
      setIsLoading(true);
      try {
        const state = await fetchEarnAutodepositState(walletAddress);
        const optimistic = optimisticSetupRef.current;
        let nextAutodeposit = state.autodeposit;
        if (optimistic?.walletAddress === walletAddress) {
          const retain = shouldRetainConfirmedAutodepositSetup({
            canonical: state.autodeposit
              ? {
                  phase:
                    state.autodeposit.lifecycleStatus === "pending_policy" ||
                    state.autodeposit.lifecycleStatus ===
                      "pending_delegation" ||
                    state.autodeposit.status === "pending"
                      ? "pending"
                      : "settled",
                  policyAccount: state.autodeposit.policyAccount,
                  recurringDelegation:
                    state.autodeposit.recurringDelegation ?? null,
                }
              : null,
            confirmed: optimistic.identity,
          });
          if (retain) {
            nextAutodeposit = optimistic.state;
          } else {
            optimisticSetupRef.current = null;
          }
        }
        if (fetchId === fetchIdRef.current) {
          setAutodeposit(nextAutodeposit);
        } else if (options?.throwOnError) {
          throw new Error("Autodeposit refresh was superseded.");
        }
        return nextAutodeposit;
      } catch (error) {
        console.error("Failed to fetch Autodeposit state", error);
        if (options?.throwOnError) {
          throw error;
        }
        return null;
      } finally {
        if (fetchId === fetchIdRef.current) {
          setIsLoading(false);
          setHasLoaded(true);
        }
      }
    },
    [walletAddress],
  );

  useEffect(() => {
    if (walletAddress) {
      refreshAutodeposit();
    } else {
      optimisticSetupRef.current = null;
      setAutodeposit(null);
      setHasLoaded(false);
    }
  }, [walletAddress, refreshAutodeposit]);

  useEffect(
    () =>
      subscribeEarnRealtime(async (refresh) => {
        if (refresh.earnState) await refreshAutodeposit({ throwOnError: true });
      }),
    [refreshAutodeposit],
  );

  return {
    autodeposit,
    confirmAutodepositSetup,
    isLoading,
    hasLoaded,
    refreshAutodeposit,
  };
}
