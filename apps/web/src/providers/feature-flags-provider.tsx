"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import {
  FeatureFlagsContextProvider,
  useFeatureFlagsContext,
} from "@/contexts/feature-flags-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import { getFlagsManifestUrl, type FrontendFlagsManifest } from "@/flags";
import {
  readClientCacheEntry,
  writeClientCache,
} from "@/lib/client-cache/client-cache";
import { evaluateFrontendFlag } from "@/lib/flags/evaluate-frontend-flag";

const FLAGS_CACHE_KEY = "loyal.frontendFlags.v1";
const FLAGS_CACHE_VERSION = 1;
const FLAGS_FRESH_MS = 5 * 60 * 1000;
const FLAGS_PERSIST_TTL_MS = 24 * 60 * 60 * 1000;
const FLAGS_REQUEST_TIMEOUT_MS = 5000;

const FLAG_AUDIENCES = new Set(["all", "public", "team"]);
const FLAG_ENVIRONMENTS = new Set(["development", "preview", "production"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFrontendFlagsManifest(
  value: unknown
): value is FrontendFlagsManifest {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.version !== "string" ||
    typeof value.generatedAt !== "string" ||
    !Array.isArray(value.flags)
  ) {
    return false;
  }

  return value.flags.every((flag) => {
    if (!isRecord(flag) || !Array.isArray(flag.targetEnvironments)) {
      return false;
    }

    return (
      typeof flag.key === "string" &&
      flag.key.length > 0 &&
      typeof flag.enabled === "boolean" &&
      typeof flag.audience === "string" &&
      FLAG_AUDIENCES.has(flag.audience) &&
      flag.targetEnvironments.every(
        (environment) =>
          typeof environment === "string" && FLAG_ENVIRONMENTS.has(environment)
      )
    );
  });
}

function readCachedManifest(manifestUrl: string) {
  return readClientCacheEntry<FrontendFlagsManifest>({
    key: FLAGS_CACHE_KEY,
    version: FLAGS_CACHE_VERSION,
    solanaEnv: manifestUrl,
    validate: isFrontendFlagsManifest,
  });
}

function writeCachedManifest(
  manifestUrl: string,
  manifest: FrontendFlagsManifest
) {
  writeClientCache({
    key: FLAGS_CACHE_KEY,
    version: FLAGS_CACHE_VERSION,
    solanaEnv: manifestUrl,
    data: manifest,
    ttlMs: FLAGS_PERSIST_TTL_MS,
  });
}

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
    let inFlight: Promise<void> | null = null;
    let lastAttemptAt = 0;
    const controller = new AbortController();

    const cached = readCachedManifest(refreshUrl);
    if (cached) {
      setManifest(cached.data);
      lastAttemptAt = cached.savedAt;
    }

    async function refresh() {
      const now = Date.now();
      if (
        controller.signal.aborted ||
        inFlight ||
        now - lastAttemptAt < FLAGS_FRESH_MS
      ) {
        return inFlight ?? Promise.resolve();
      }
      lastAttemptAt = now;

      const request = (async () => {
        const requestController = new AbortController();
        const abortRequest = () => requestController.abort();
        controller.signal.addEventListener("abort", abortRequest, {
          once: true,
        });
        const timeoutId = setTimeout(abortRequest, FLAGS_REQUEST_TIMEOUT_MS);

        try {
          const response = await fetch(refreshUrl, {
            cache: "default",
            signal: requestController.signal,
          });
          if (!response.ok) {
            return;
          }

          const payload: unknown = await response.json();
          if (!isFrontendFlagsManifest(payload)) {
            return;
          }

          writeCachedManifest(refreshUrl, payload);
          if (!cancelled) {
            setManifest(payload);
          }
        } catch {
          // Keep serving the last known manifest or the false default.
        } finally {
          clearTimeout(timeoutId);
          controller.signal.removeEventListener("abort", abortRequest);
        }
      })().finally(() => {
        if (inFlight === request) {
          inFlight = null;
        }
      });

      inFlight = request;
      return request;
    }

    if (!cached || Date.now() - cached.savedAt >= FLAGS_FRESH_MS) {
      void refresh();
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
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

  return (
    <FeatureFlagsContextProvider value={value}>
      {children}
    </FeatureFlagsContextProvider>
  );
}

export function useFeatureFlags() {
  return useFeatureFlagsContext();
}
