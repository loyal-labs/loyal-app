import "server-only";

import { serverEnv } from "@/lib/core/config/server";

import {
  parseStablecoinSymbols,
  type EarnStablecoinSymbol,
} from "./stablecoin-monitor.shared";

type AppEarnConfigResponse = {
  enabledStablecoins?: unknown;
};

export type StablecoinRolloutConfiguration = {
  appEnabled: ReadonlySet<EarnStablecoinSymbol> | null;
  appSource: "app-api" | "unavailable";
};

async function loadAppEnabledStablecoins() {
  try {
    const url = new URL("/api/earn/config", serverEnv.appApiBaseUrl);
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as AppEarnConfigResponse;
    if (
      !Array.isArray(payload.enabledStablecoins) ||
      !payload.enabledStablecoins.every((value) => typeof value === "string")
    ) {
      return null;
    }

    return parseStablecoinSymbols(payload.enabledStablecoins);
  } catch {
    return null;
  }
}

export async function getStablecoinRolloutConfiguration(): Promise<StablecoinRolloutConfiguration> {
  const appEnabled = await loadAppEnabledStablecoins();

  return {
    appEnabled,
    appSource: appEnabled ? "app-api" : "unavailable",
  };
}
