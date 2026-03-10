import { useCallback, useState } from "react";

import {
  getCachedBalanceBg,
  getCachedDisplayCurrency,
  setCachedBalanceBg,
  setCachedDisplayCurrency,
} from "@/lib/solana/wallet-cache";

export function useDisplayPreferences(): {
  displayCurrency: "USD" | "SOL";
  setDisplayCurrency: React.Dispatch<React.SetStateAction<"USD" | "SOL">>;
  balanceBg: string | null;
  handleBgSelect: (bg: string | null) => void;
} {
  const [displayCurrency, setDisplayCurrency] = useState<"USD" | "SOL">(
    () => getCachedDisplayCurrency() ?? "USD",
  );
  const [balanceBg, setBalanceBg] = useState<string | null>(() => {
    const cached = getCachedBalanceBg();
    return cached !== undefined ? cached : null;
  });

  const handleBgSelect = useCallback((bg: string | null) => {
    setBalanceBg(bg);
    setCachedBalanceBg(bg);
  }, []);

  // Persist currency changes to MMKV synchronously
  const setDisplayCurrencyWrapped: React.Dispatch<
    React.SetStateAction<"USD" | "SOL">
  > = useCallback(
    (action) => {
      setDisplayCurrency((prev) => {
        const next = typeof action === "function" ? action(prev) : action;
        setCachedDisplayCurrency(next);
        return next;
      });
    },
    [],
  );

  return {
    displayCurrency,
    setDisplayCurrency: setDisplayCurrencyWrapped,
    balanceBg,
    handleBgSelect,
  };
}
