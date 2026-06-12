"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readClientCache,
  removeClientCache,
  writeClientCache,
} from "@/lib/client-cache/client-cache";

const EARN_POSITION_CACHE_VERSION = 1;

export type ActiveEarnPosition = {
  currentSupplyApyBps: string | null;
  display: {
    label: string;
    marketName: string;
    mintSymbol: string;
  };
  initialHolding: {
    liquidityMint: string;
    market: string | null;
    reserve: string;
    supplyApyBps: string | null;
  };
  currentHolding: {
    amountRaw: string;
    liquidityMint: string;
    market: string | null;
    observedAt: string;
    observedSlot: string;
    provenance: {
      lastHoldingEventId: string | null;
      lastRebalanceDecisionId: string | null;
    };
    reserve: string;
  };
  principalAmountRaw: string;
  status: string;
};

export type EarnPositionCachePayload = {
  position: ActiveEarnPosition | null;
};

type LastEarnPositionCachePayload = {
  position: ActiveEarnPosition;
  settingsPda: string;
};

type ActiveEarnPositionResponse = {
  position: ActiveEarnPosition | null;
};

export function isActiveEarnPosition(
  position: ActiveEarnPosition | null | undefined
): position is ActiveEarnPosition {
  if (position?.status !== "active") {
    return false;
  }

  try {
    return BigInt(position.principalAmountRaw) > BigInt(0);
  } catch {
    return false;
  }
}

export function getEarnPositionCacheKey(args: {
  solanaEnv: string;
  walletAddress: string;
  settingsPda: string;
}): string {
  return [
    "loyal",
    "earn-position",
    EARN_POSITION_CACHE_VERSION,
    args.solanaEnv,
    args.walletAddress,
    args.settingsPda,
  ].join(":");
}

function getLastEarnPositionCacheKey(args: {
  solanaEnv: string;
  walletAddress: string;
}): string {
  return [
    "loyal",
    "earn-position-last",
    EARN_POSITION_CACHE_VERSION,
    args.solanaEnv,
    args.walletAddress,
  ].join(":");
}

function readLastEarnPositionCache(args: {
  solanaEnv: string;
  walletAddress: string;
}): LastEarnPositionCachePayload | null {
  const key = getLastEarnPositionCacheKey(args);
  const payload = readClientCache<LastEarnPositionCachePayload>({
    key,
    version: EARN_POSITION_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    validate: (data): data is LastEarnPositionCachePayload =>
      typeof data === "object" &&
      data !== null &&
      "position" in data &&
      "settingsPda" in data,
  });
  return payload;
}

function writeLastEarnPositionCache(args: {
  solanaEnv: string;
  walletAddress: string;
  settingsPda: string;
  position: ActiveEarnPosition | null;
}) {
  const key = getLastEarnPositionCacheKey(args);
  if (!args.position) {
    removeClientCache({ key });
    return;
  }

  writeClientCache<LastEarnPositionCachePayload>({
    key,
    version: EARN_POSITION_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    data: {
      position: args.position,
      settingsPda: args.settingsPda,
    },
  });
}

export function readEarnPositionCache(args: {
  solanaEnv: string;
  walletAddress: string;
  settingsPda: string;
}): ActiveEarnPosition | null {
  const key = getEarnPositionCacheKey(args);
  const payload = readClientCache<EarnPositionCachePayload>({
    key,
    version: EARN_POSITION_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    settingsPda: args.settingsPda,
    validate: (data): data is EarnPositionCachePayload =>
      typeof data === "object" && data !== null && "position" in data,
  });
  return payload?.position ?? null;
}

export function writeEarnPositionCache(args: {
  solanaEnv: string;
  walletAddress: string;
  settingsPda: string;
  position: ActiveEarnPosition | null;
}) {
  const key = getEarnPositionCacheKey(args);
  if (!args.position) {
    removeClientCache({ key });
    writeLastEarnPositionCache(args);
    return;
  }

  writeClientCache<EarnPositionCachePayload>({
    key,
    version: EARN_POSITION_CACHE_VERSION,
    solanaEnv: args.solanaEnv,
    walletAddress: args.walletAddress,
    settingsPda: args.settingsPda,
    data: { position: args.position },
  });
  writeLastEarnPositionCache(args);
}

export async function fetchActiveEarnPosition(): Promise<ActiveEarnPosition | null> {
  const response = await fetch(
    "/api/smart-accounts/yield-optimization/position",
    {
      credentials: "include",
    }
  );

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      payload?.error?.message ?? "Failed to load active earn position."
    );
  }

  const payload = (await response.json()) as ActiveEarnPositionResponse;
  return payload.position;
}

export function useActiveEarnPosition({
  enabled,
  settingsPda,
  solanaEnv,
  walletAddress,
}: {
  enabled: boolean;
  settingsPda: string | null | undefined;
  solanaEnv: string;
  walletAddress: string | null | undefined;
}) {
  const [position, setPositionState] = useState<ActiveEarnPosition | null>(
    null
  );

  const canUseCache = Boolean(enabled && walletAddress && settingsPda);

  const setPosition = useCallback(
    (
      next:
        | ActiveEarnPosition
        | null
        | ((current: ActiveEarnPosition | null) => ActiveEarnPosition | null)
    ) => {
      setPositionState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        if (walletAddress && settingsPda) {
          writeEarnPositionCache({
            solanaEnv,
            walletAddress,
            settingsPda,
            position: resolved,
          });
        }
        return resolved;
      });
    },
    [settingsPda, solanaEnv, walletAddress]
  );

  const refresh = useCallback(async () => {
    const next = await fetchActiveEarnPosition();
    setPosition(next);
    return next;
  }, [setPosition]);

  useEffect(() => {
    if (!canUseCache || !walletAddress || !settingsPda) {
      if (enabled && walletAddress && !settingsPda) {
        const fallback = readLastEarnPositionCache({
          solanaEnv,
          walletAddress,
        });
        if (fallback?.position) {
          setPositionState(fallback.position);
          return;
        }
      }

      if (enabled && walletAddress) {
        return;
      }

      setPositionState(null);
      return;
    }

    const cached = readEarnPositionCache({
      solanaEnv,
      walletAddress,
      settingsPda,
    });
    if (cached) {
      setPositionState(cached);
    }

    let cancelled = false;
    fetchActiveEarnPosition()
      .then((fresh) => {
        if (cancelled) {
          return;
        }
        setPositionState((current) => {
          if (
            fresh !== null &&
            !isActiveEarnPosition(fresh) &&
            isActiveEarnPosition(current)
          ) {
            return current;
          }

          writeEarnPositionCache({
            solanaEnv,
            walletAddress,
            settingsPda,
            position: fresh,
          });
          return fresh;
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.warn("[earn-position] failed to load active position", error);
      });

    return () => {
      cancelled = true;
    };
  }, [canUseCache, enabled, settingsPda, solanaEnv, walletAddress]);

  return {
    position,
    refresh,
    setPosition,
  };
}
