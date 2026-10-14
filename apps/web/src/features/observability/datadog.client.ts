"use client";

import type { datadogRum } from "@datadog/browser-rum";

import type { PublicEnv } from "@/lib/core/config/public";

import {
  lifecycleFailureCategory,
  type BrowserLifecycleEnvelope,
} from "./lifecycle-contract";

let rum: typeof datadogRum | undefined;
let initializing: Promise<void> | undefined;
let identity: string | null = null;
let identityGeneration = 0;
const pendingActions: ReturnType<typeof journeyAnalyticsProperties>[] = [];

// Deliberately exclude error text, wallet addresses, URLs and transaction data.
export function journeyAnalyticsProperties(
  event: BrowserLifecycleEnvelope,
  trafficKind: "external" | "internal" | "synthetic" | "unknown" = "unknown"
) {
  return {
    traffic_kind: trafficKind,
    journey_id: event.journeyId,
    trace_id: event.traceId,
    attempt_id: event.flowId,
    attempt_number: event.attemptNumber,
    event_id: event.eventId,
    flow: event.flowName,
    flow_version: 2,
    variant: event.flowVariant,
    step: event.stage,
    outcome: event.outcome,
    elapsed_ms: event.elapsedMs,
    duration_ms: event.durationMs,
    retry_count: event.retryCount,
    error_code: event.errorCode,
    error_category: lifecycleFailureCategory(event),
    wallet_provider: event.walletProvider,
    client_release: event.clientBuildId,
    chain_state: event.chainState,
    persistence_state: event.persistenceState,
  };
}

export function captureDatadogJourney(
  event: BrowserLifecycleEnvelope,
  trafficKind?: "external" | "internal" | "synthetic"
): void {
  try {
    const properties = journeyAnalyticsProperties(event, trafficKind);
    if (rum) rum.addAction("loyal.journey", properties);
    else {
      if (pendingActions.length >= 100) pendingActions.shift();
      pendingActions.push(properties);
    }
  } catch {
    // Product actions never depend on the RUM SDK.
  }
}

export function getDatadogSessionId(): string | undefined {
  try {
    return rum?.getInternalContext()?.session_id;
  } catch {
    return undefined;
  }
}

export function identifyDatadogJourneyUser(wallet: string | null): void {
  if (wallet === identity) return;
  const previous = identity;
  identity = wallet;
  const generation = ++identityGeneration;
  try {
    rum?.clearUser();
    // Anonymous -> authenticated stays in the same session; user switches do not.
    if (previous) {
      pendingActions.length = 0;
      rum?.stopSession();
    }
    if (!wallet || !rum) return;
    void crypto.subtle
      .digest(
        "SHA-256",
        new Uint8Array(new TextEncoder().encode(wallet)).buffer
      )
      .then((digest) => {
        if (generation !== identityGeneration) return;
        const id = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("");
        rum?.setUser({ id });
      })
      .catch(() => undefined);
  } catch {
    // Identity enrichment is best-effort.
  }
}

export function initJourneyDatadog(env: PublicEnv): Promise<void> {
  if (initializing) return initializing;
  if (!env.datadogApplicationId || !env.datadogClientToken)
    return Promise.resolve();
  initializing = import("@datadog/browser-rum")
    .then(({ datadogRum: sdk }) => {
      sdk.init({
        applicationId: env.datadogApplicationId!,
        clientToken: env.datadogClientToken!,
        site: "us5.datadoghq.com",
        service: "loyal-frontend",
        env: env.appEnvironment,
        version: env.gitCommitHash,
        sessionSampleRate: 100,
        sessionReplaySampleRate: 0,
        defaultPrivacyLevel: "mask",
        enablePrivacyForActionName: true,
        trackUserInteractions: false,
        trackResources: false,
        trackLongTasks: false,
        beforeSend(event) {
          // Existing ClickStack handles errors. Automatic SDK errors can contain
          // wallet/RPC payloads; RUM receives only our allowlisted custom actions.
          if (event.type !== "action" && event.type !== "view") return false;
          event.view.url = `${window.location.origin}/app`;
          event.view.name = "/app";
          if (event.view.referrer) event.view.referrer = "";
          return true;
        },
      });
      rum = sdk;
      const wallet = identity;
      identity = null;
      identifyDatadogJourneyUser(wallet);
      for (const properties of pendingActions.splice(0))
        sdk.addAction("loyal.journey", properties);
    })
    .catch(() => {
      initializing = undefined;
    });
  return initializing;
}
