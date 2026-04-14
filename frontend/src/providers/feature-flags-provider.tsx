"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import {
  FeatureFlagsContextProvider,
  useFeatureFlagsContext,
} from "@/contexts/feature-flags-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { getFlagsManifestUrl, type FrontendFlagsManifest } from "@/flags";
import { evaluateFrontendFlag } from "@/lib/flags/evaluate-frontend-flag";

function useOptionalPublicEnv() {
  try {
    return usePublicEnv();
  } catch {
    return null;
  }
}

function useOptionalAuthSession() {
  try {
    return useAuthSession();
  } catch {
    return null;
  }
}

export function FeatureFlagsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const publicEnv = useOptionalPublicEnv();
  const authSession = useOptionalAuthSession();
  const [manifest, setManifest] = useState<FrontendFlagsManifest | null>(null);

  useEffect(() => {
    const manifestUrl = getFlagsManifestUrl();
    if (!manifestUrl) {
      return;
    }
    const refreshUrl = manifestUrl;

    let cancelled = false;

    async function refresh() {
      try {
        const response = await fetch(refreshUrl, { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as FrontendFlagsManifest;
        if (!cancelled) {
          setManifest(payload);
        }
      } catch {
        // Ignore refresh failures. The provider should keep serving the
        // last known manifest or the false default.
      }
    }

    void refresh();
    const intervalId = window.setInterval(refresh, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const value = useMemo(() => {
    const isTeam = Boolean(authSession?.user?.email?.endsWith("@loyal.dev"));
    const flagMap = new Map(
      (manifest?.flags ?? []).map((flag) => [flag.key, flag])
    );
    const appEnvironment =
      publicEnv?.appEnvironment === "local"
        ? "development"
        : publicEnv?.appEnvironment === "dev"
          ? "preview"
          : "production";

    return {
      version: manifest?.version ?? null,
      isEnabled: (key: string) =>
        evaluateFrontendFlag(flagMap.get(key), {
          appEnvironment,
          isTeam,
        }),
    };
  }, [authSession?.user?.email, manifest, publicEnv?.appEnvironment]);

  return <FeatureFlagsContextProvider value={value}>{children}</FeatureFlagsContextProvider>;
}

export function useFeatureFlags() {
  return useFeatureFlagsContext();
}
