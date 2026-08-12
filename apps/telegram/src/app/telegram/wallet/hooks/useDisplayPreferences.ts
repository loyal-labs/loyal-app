import { useCallback, useEffect, useState } from "react";

import { BALANCE_BG_KEY, DISPLAY_CURRENCY_KEY } from "@/lib/constants";
import {
  getCloudValue,
  setCloudValue,
} from "@/lib/telegram/mini-app/cloud-storage";

import {
  cachedBalanceBg,
  cachedDisplayCurrency,
  setCachedBalanceBg,
  setCachedDisplayCurrency,
} from "../wallet-cache";

export function useDisplayPreferences(): {
  displayCurrency: "USD" | "SOL";
  setDisplayCurrency: React.Dispatch<React.SetStateAction<"USD" | "SOL">>;
  balanceBg: string | null;
  bgLoaded: boolean;
  handleBgSelect: (bg: string | null) => void;
} {
  const [displayCurrency, setDisplayCurrency] = useState<"USD" | "SOL">(
    () => cachedDisplayCurrency ?? "USD"
  );
  const [balanceBg, setBalanceBg] = useState<string | null>(() =>
    cachedBalanceBg !== undefined ? cachedBalanceBg : null
  );
  const [bgLoaded, setBgLoaded] = useState(() => cachedBalanceBg !== undefined);

  const handleBgSelect = useCallback((bg: string | null) => {
    setBalanceBg(bg);
    setCachedBalanceBg(bg);
    void setCloudValue(BALANCE_BG_KEY, bg ?? "none");
  }, []);

  // Load display currency preference from cloud storage
  useEffect(() => {
    if (cachedDisplayCurrency !== null) return; // Already loaded from cache

    void (async () => {
      try {
        const stored = await getCloudValue(DISPLAY_CURRENCY_KEY);
        if (stored === "USD" || stored === "SOL") {
          setCachedDisplayCurrency(stored);
          setDisplayCurrency(stored);
        }
      } catch (error) {
        console.error("Failed to load display currency preference", error);
      }
    })();
  }, []);

  // Load balance background preference from cloud storage
  useEffect(() => {
    if (cachedBalanceBg !== undefined) return; // Already loaded from cache

    void (async () => {
      try {
        const stored = await getCloudValue(BALANCE_BG_KEY);
        if (typeof stored === "string" && stored.length > 0) {
          const bg = stored === "none" ? null : stored;
          setCachedBalanceBg(bg);
          setBalanceBg(bg);
        } else {
          setCachedBalanceBg("balance-bg-01");
          setBalanceBg("balance-bg-01");
        }
      } catch (error) {
        console.error("Failed to load balance background preference", error);
        setCachedBalanceBg("balance-bg-01");
        setBalanceBg("balance-bg-01");
      } finally {
        setBgLoaded(true);
      }
    })();
  }, []);

  return {
    displayCurrency,
    setDisplayCurrency,
    balanceBg,
    bgLoaded,
    handleBgSelect,
  };
}
