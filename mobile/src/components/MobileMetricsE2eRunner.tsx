import { useEffect, useRef } from "react";

import { env } from "@/config/env";
import { useAppReady } from "@/lib/app-ready";
import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
import { postObservabilityJson } from "@/services/observability";

function sanitizeE2eError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/g, "<address>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function MobileMetricsE2eRunner() {
  const enabled = __DEV__ && process.env.EXPO_PUBLIC_E2E_METRICS === "true";
  const appReady = useAppReady();
  const { signer, state } = useWallet();
  const started = useRef(false);

  useEffect(() => {
    if (
      !enabled ||
      !appReady ||
      !signer ||
      !isWalletUnlocked(state) ||
      started.current
    ) {
      return;
    }
    started.current = true;
    void (async () => {
      let stage = "boot";
      await postObservabilityJson(
        "/e2e/status",
        { stage, state: "running", timestamp: new Date().toISOString() },
        env.observabilityBaseUrl
      );
      try {
        const { runLoadingMetricsE2e } = await import(
          "@/e2e/loading-metrics-runner"
        );
        await runLoadingMetricsE2e(signer, async (nextStage) => {
          stage = nextStage;
          await postObservabilityJson(
            "/e2e/status",
            { stage, state: "running", timestamp: new Date().toISOString() },
            env.observabilityBaseUrl
          );
        });
        // Metric capture waits for two animation frames and posts best-effort.
        // Give the last observation time to reach the local relay first.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        await postObservabilityJson(
          "/e2e/status",
          { stage, state: "completed", timestamp: new Date().toISOString() },
          env.observabilityBaseUrl
        );
      } catch (error) {
        await postObservabilityJson(
          "/e2e/status",
          {
            errorMessage: sanitizeE2eError(error),
            errorName: error instanceof Error ? error.name : "UnknownError",
            stage,
            state: "failed",
            timestamp: new Date().toISOString(),
          },
          env.observabilityBaseUrl
        );
      }
    })();
  }, [appReady, enabled, signer, state]);

  return null;
}
