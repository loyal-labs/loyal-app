import { useEffect, useMemo, useState } from "react";

import { getCachedKaminoLendingApyBps } from "@/lib/solana/deposits/kamino-apy";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";

export type ApyByMint = Record<string, number>;

/**
 * Fetch Kamino lending APY for each shielded holding's mint. Mints without a
 * configured Kamino reserve return null from the SDK and are omitted from the
 * result so callers can use `apyByMint[mint] > 0` as the render guard.
 */
export function useTokenApy(holdings: TokenHolding[]): ApyByMint {
  const shieldedMintKey = useMemo(() => {
    const mints = new Set<string>();
    for (const holding of holdings) {
      if (holding.isSecured && holding.balance > 0) mints.add(holding.mint);
    }
    return Array.from(mints).sort().join("|");
  }, [holdings]);

  const [apyByMint, setApyByMint] = useState<ApyByMint>({});

  useEffect(() => {
    if (shieldedMintKey.length === 0) {
      setApyByMint({});
      return;
    }

    const mints = shieldedMintKey.split("|");
    let cancelled = false;

    Promise.all(
      mints.map(async (mint) => {
        const apyBps = await getCachedKaminoLendingApyBps(mint);
        return [mint, apyBps] as const;
      })
    ).then((results) => {
      if (cancelled) return;
      const next: ApyByMint = {};
      for (const [mint, apyBps] of results) {
        if (typeof apyBps === "number" && apyBps > 0) next[mint] = apyBps;
      }
      setApyByMint(next);
    });

    return () => {
      cancelled = true;
    };
  }, [shieldedMintKey]);

  return apyByMint;
}
