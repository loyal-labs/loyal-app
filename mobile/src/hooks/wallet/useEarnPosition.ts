import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchEarnHoldings,
  fetchEarnState,
  type EarnHoldingItem,
  type EarnPosition,
} from "@/lib/solana/earn/earn-api";

// After a local deposit/withdraw, the backend read-model (`/state`
// `currentAmountRaw`) is written synchronously by the confirm call, so it's the
// correct intended balance immediately. The live `/holdings` read, by contrast,
// LAGS the chain mid-sweep — it dips below the deposit right after a deposit
// (funds still moving idle→Kamino) and reads high right after a withdraw. So for
// a short window after a mutation we trust the read-model; outside it we trust
// the live holdings total, which tracks market drift the read-model misses (the
// reason the live override exists at all). This mirrors the web showing the
// correct value the moment a deposit lands instead of a transient dip.
const MUTATION_TRUST_MS = 20_000;

// Picks the balance the headline shows. `preferReadModel` (set briefly after a
// local mutation) keeps the confirm-written read-model; otherwise the live total
// overrides it. APY/principal/status always come from the read-model. When the
// live read is unavailable (null) we keep the read-model rather than zeroing a
// real balance.
function reconcileBalance(
  position: EarnPosition | null,
  liveTotalRaw: string | null,
  preferReadModel: boolean,
): EarnPosition | null {
  if (position === null || liveTotalRaw === null || preferReadModel) {
    return position;
  }
  return { ...position, currentAmountRaw: liveTotalRaw };
}

// Reads the wallet's current Earn position (balance + APY) from the backend
// read-model. Like useTokenHoldings, it takes a read-only wallet address and
// never signs — the lookup is unauthenticated by design so opening the Earn tab
// doesn't prompt for a Seed Vault approval.
export function useEarnPosition(walletAddress: string | null) {
  const [position, setPosition] = useState<EarnPosition | null>(null);
  // Live per-venue holdings (Kamino obligation(s) + idle USDC) — the same data
  // the web shows for its per-position breakdown. Exposed alongside `position`
  // so the positions sheet can render the live split instead of the stale DB
  // withdraw-sources read.
  const [holdings, setHoldings] = useState<EarnHoldingItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Flips true once a fetch settles for the current wallet. Lets the UI tell
  // "not loaded yet" (skeleton) apart from "loaded, genuinely empty" ($0) — the
  // position read can legitimately resolve to null for a wallet with no Earn.
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchIdRef = useRef(0);
  // Timestamp of the last local deposit/withdraw. Within MUTATION_TRUST_MS of it
  // we trust the read-model over the lagging live read (see reconcileBalance).
  const mutatedAtRef = useRef(0);

  // Called by the Earn screen right before/after a deposit or withdraw so the
  // next reads prefer the freshly-written read-model instead of the mid-sweep
  // live total.
  const markEarnMutation = useCallback(() => {
    mutatedAtRef.current = Date.now();
  }, []);

  const refreshEarnPosition = useCallback(async () => {
    if (!walletAddress) {
      return;
    }
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    try {
      // Fetch both concurrently: `state` for APY/principal/status (+ the
      // post-mutation balance), `holdings` for the live balance once settled. A
      // holdings failure must not drop the position, so each settles independently.
      const [stateResult, holdingsResult] = await Promise.allSettled([
        fetchEarnState(walletAddress),
        fetchEarnHoldings(walletAddress),
      ]);
      if (fetchId !== fetchIdRef.current) {
        return;
      }
      if (stateResult.status === "rejected") {
        console.error("Failed to fetch Earn position", stateResult.reason);
        return;
      }
      let liveTotalRaw: string | null = null;
      if (holdingsResult.status === "fulfilled") {
        // observedAt is null only when the server skipped the chain read (no
        // active Earn policy row yet) and returned a placeholder "0" — treat
        // that as "live read unavailable" so it can't zero a real read-model
        // balance. A genuine snapshot always carries observedAt, even at $0.
        if (holdingsResult.value.observedAt !== null) {
          liveTotalRaw = holdingsResult.value.currentTotalAmountRaw;
        }
        setHoldings(holdingsResult.value.holdings);
      } else {
        console.error("Failed to fetch Earn holdings", holdingsResult.reason);
      }
      const preferReadModel =
        Date.now() - mutatedAtRef.current < MUTATION_TRUST_MS;
      setPosition(
        reconcileBalance(
          stateResult.value.position,
          liveTotalRaw,
          preferReadModel,
        ),
      );
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, [walletAddress]);

  useEffect(() => {
    if (walletAddress) {
      refreshEarnPosition();
    } else {
      setPosition(null);
      setHoldings([]);
      setHasLoaded(false);
    }
  }, [walletAddress, refreshEarnPosition]);

  return {
    position,
    holdings,
    isLoading,
    hasLoaded,
    refreshEarnPosition,
    markEarnMutation,
  };
}
