import { useCallback, useEffect, useState } from "react";

import {
  computeKaminoUsdcEarnings,
  type KaminoUsdcEarnings,
} from "@/lib/solana/deposits/kamino-earnings";
import { useWallet } from "@/lib/wallet/wallet-provider";

/**
 * Fetch the wallet's Kamino USDC earnings aggregate. Null until loaded,
 * or when the wallet has no tracked shielded USDC position.
 *
 * Caller should invoke `refresh()` after any shield/unshield so the pill
 * reflects the new cost basis immediately.
 */
export function useKaminoEarnings(): {
  earnings: KaminoUsdcEarnings | null;
  refresh: () => Promise<void>;
} {
  const { signer, publicKey } = useWallet();
  const [earnings, setEarnings] = useState<KaminoUsdcEarnings | null>(null);

  const refresh = useCallback(async () => {
    if (!signer || !publicKey) {
      setEarnings(null);
      return;
    }
    try {
      const next = await computeKaminoUsdcEarnings({
        publicKey,
        signer,
      });
      setEarnings(next);
    } catch (error) {
      console.warn("[useKaminoEarnings] compute failed", error);
      setEarnings(null);
    }
  }, [signer, publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { earnings, refresh };
}
