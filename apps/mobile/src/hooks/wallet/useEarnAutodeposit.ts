import {
  shouldRetainConfirmedOnchainMutation,
  type ConfirmedOnchainMutation,
} from "@loyal-labs/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeEarnRealtime } from "@/features/earn-realtime/events";
import type {
  ConfirmedEarnAutodepositClose,
  ConfirmedEarnAutodepositSetup,
} from "@/lib/solana/earn/autodeposit";
import {
  fetchEarnAutodepositState,
  type EarnAutodepositState,
} from "@/lib/solana/earn/earn-api";

type OptimisticMutation = {
  confirmed: ConfirmedOnchainMutation;
  state: EarnAutodepositState | null;
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
  const optimisticMutationRef = useRef<OptimisticMutation | null>(null);

  const confirmAutodepositSetup = useCallback(
    (confirmed: ConfirmedEarnAutodepositSetup) => {
      if (!walletAddress) {
        return;
      }
      const optimistic: OptimisticMutation = {
        confirmed: {
          identities: [confirmed.policyAccount],
          operation: "install",
        },
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
      optimisticMutationRef.current = optimistic;
      setAutodeposit(optimistic.state);
    },
    [walletAddress],
  );

  const confirmAutodepositClose = useCallback(
    (confirmed: ConfirmedEarnAutodepositClose) => {
      if (!walletAddress) {
        return;
      }
      optimisticMutationRef.current = {
        confirmed: {
          identities: confirmed.policyAccounts,
          operation: "remove",
        },
        state: null,
        walletAddress,
      };
      setAutodeposit(null);
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
        const optimistic = optimisticMutationRef.current;
        let nextAutodeposit = state.autodeposit;
        if (optimistic?.walletAddress === walletAddress) {
          const retain = shouldRetainConfirmedOnchainMutation({
            canonical: state.autodeposit
              ? {
                  identities: [state.autodeposit.policyAccount],
                  phase:
                    state.autodeposit.lifecycleStatus === "pending_policy" ||
                    state.autodeposit.lifecycleStatus ===
                      "pending_delegation" ||
                    state.autodeposit.status === "pending"
                      ? "pending"
                      : "settled",
                }
              : null,
            confirmed: optimistic.confirmed,
          });
          if (retain) {
            nextAutodeposit = optimistic.state;
          } else {
            optimisticMutationRef.current = null;
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
      optimisticMutationRef.current = null;
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
    confirmAutodepositClose,
    confirmAutodepositSetup,
    isLoading,
    hasLoaded,
    refreshAutodeposit,
  };
}
