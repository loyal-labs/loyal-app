import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveObservabilityActorId } from "../src/features/observability/actor";
import {
  createLifecycleTracker,
  EXECUTE_NOW_STATES,
  LIFECYCLE_ERROR_CODES,
  LIFECYCLE_FLOW_NAMES,
  LIFECYCLE_OUTCOMES,
  LIFECYCLE_SAMPLING_RATIO,
  LIFECYCLE_SOURCES,
  LIFECYCLE_STAGES,
  LIFECYCLE_VARIANTS,
  mapExecuteNowState,
  parseBrowserLifecycleEnvelope,
  PROVISIONING_OUTCOMES,
  type BrowserLifecycleEnvelope,
  type LifecycleDiagnostics,
} from "../src/features/observability/lifecycle-contract";
import { buildOtlpLifecyclePayload } from "../src/features/observability/otlp";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const FLOW_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = Date.parse("2026-07-16T12:00:00.000Z");

function read(relativePath: string): string {
  return readFileSync(`${frontendRoot}/${relativePath}`, "utf8");
}

function pass(message: string): void {
  console.info(`PASS: ${message}`);
}

function baseEvent(
  overrides: Partial<BrowserLifecycleEnvelope> = {}
): BrowserLifecycleEnvelope {
  return {
    durationMs: 10,
    elapsedMs: 20,
    flowId: FLOW_ID,
    flowName: "earn.deposit",
    flowVariant: "initial",
    outcome: "observed",
    pathname: "/app",
    runtime: "browser",
    source: "browser",
    stage: "prepare",
    timestamp: new Date(NOW).toISOString(),
    ...overrides,
  } as BrowserLifecycleEnvelope;
}

assert.deepEqual(LIFECYCLE_FLOW_NAMES, [
  "auth.sign_in",
  "auth.smart_account_provisioning",
  "earn.deposit",
  "earn.withdrawal",
  "earn.autodeposit.configuration",
  "earn.autodeposit.execute_now",
]);
assert.deepEqual(LIFECYCLE_OUTCOMES, [
  "started",
  "observed",
  "completed",
  "failed",
  "cancelled",
]);
assert.deepEqual(LIFECYCLE_SOURCES, ["browser", "next_api", "sse", "fallback"]);
assert.equal(LIFECYCLE_SAMPLING_RATIO, 1);
assert.equal(new Set(LIFECYCLE_ERROR_CODES).size, LIFECYCLE_ERROR_CODES.length);
assert.equal(new Set(PROVISIONING_OUTCOMES).size, PROVISIONING_OUTCOMES.length);
assert.equal(new Set(EXECUTE_NOW_STATES).size, EXECUTE_NOW_STATES.length);
for (const flowName of LIFECYCLE_FLOW_NAMES) {
  assert.ok(LIFECYCLE_VARIANTS[flowName].length > 0);
  assert.ok(LIFECYCLE_STAGES[flowName].length > 0);
}
pass(
  "binding flow, outcome, source, sampling, stage, variant, and error allowlists are exhaustive"
);

assert.deepEqual(parseBrowserLifecycleEnvelope(baseEvent(), NOW), baseEvent());
for (const invalid of [
  { ...baseEvent(), flowId: "not-a-uuid" },
  { ...baseEvent(), flowId: "123e4567-e89b-12d3-a456-426614174000" },
  { ...baseEvent(), flowName: "earn.transfer" },
  { ...baseEvent(), flowVariant: "topup" },
  { ...baseEvent(), stage: "unknown" },
  { ...baseEvent(), actorId: "actor:v1:forbidden" },
  { ...baseEvent(), arbitraryContext: { wallet: "forbidden" } },
  { ...baseEvent(), pathname: "/app?token=forbidden" },
  { ...baseEvent(), durationMs: 900_001 },
  { ...baseEvent(), elapsedMs: 86_400_001 },
  { ...baseEvent(), timestamp: "2026-07-16T10:59:59.999Z" },
  { ...baseEvent(), authProofKind: "siws" },
  { ...baseEvent(), executeNowState: "requested" },
]) {
  assert.throws(() => parseBrowserLifecycleEnvelope(invalid, NOW));
}
assert.doesNotThrow(() =>
  parseBrowserLifecycleEnvelope(
    baseEvent({ durationMs: 900_000, elapsedMs: 86_400_000 }),
    NOW
  )
);
pass(
  "trust-boundary parser rejects malformed UUIDs, unknown keys/combinations, query data, stale events, and numeric overflow"
);

const trackerEvents: BrowserLifecycleEnvelope[] = [];
let trackerNow = NOW;
const tracker = createLifecycleTracker({
  emit: (event) => trackerEvents.push(event),
  flowId: FLOW_ID,
  flowName: "earn.deposit",
  flowVariant: "top_up",
  now: () => trackerNow,
  pathname: "/app",
});
tracker.start("intent");
trackerNow += 20;
tracker.observe("prepare");
trackerNow += 20;
tracker.complete("ui_commit");
tracker.fail("ui_commit", { errorCode: "unexpected_error" });
tracker.observe("prepare");
assert.deepEqual(
  trackerEvents.map((event) => event.outcome),
  ["started", "observed", "completed"]
);
tracker.recovery({ errorCode: "record_failed" });
tracker.recovery({ errorCode: "record_failed" });
assert.equal(trackerEvents.length, 4);
assert.deepEqual(
  {
    chainState: trackerEvents[3]?.chainState,
    errorCode: trackerEvents[3]?.errorCode,
    outcome: trackerEvents[3]?.outcome,
    persistenceState: trackerEvents[3]?.persistenceState,
    recoveryRequired: trackerEvents[3]?.recoveryRequired,
    stage: trackerEvents[3]?.stage,
  },
  {
    chainState: "confirmed",
    errorCode: "record_failed",
    outcome: "observed",
    persistenceState: "failed",
    recoveryRequired: true,
    stage: "backend_confirm",
  }
);

for (const terminal of ["failed", "cancelled"] as const) {
  const events: BrowserLifecycleEnvelope[] = [];
  const attempt = createLifecycleTracker({
    emit: (event) => events.push(event),
    flowId:
      terminal === "failed"
        ? "123e4567-e89b-42d3-a456-426614174001"
        : "123e4567-e89b-42d3-a456-426614174002",
    flowName: "earn.withdrawal",
    flowVariant: "partial",
    now: () => NOW,
    pathname: "/app",
  });
  attempt.start("intent");
  if (terminal === "failed")
    attempt.fail("prepare", { errorCode: "invalid_request" });
  else
    attempt.cancel("wallet_submit_confirm", { errorCode: "wallet_rejected" });
  attempt.complete("ui_commit");
  assert.equal(
    events.filter((event) =>
      ["completed", "failed", "cancelled"].includes(event.outcome)
    ).length,
    1
  );
  assert.equal(events.at(-1)?.outcome, terminal);
}

const abandoned: BrowserLifecycleEnvelope[] = [];
const abandonedTracker = createLifecycleTracker({
  emit: (event) => abandoned.push(event),
  flowId: "123e4567-e89b-42d3-a456-426614174003",
  flowName: "auth.sign_in",
  flowVariant: "interactive",
  now: () => NOW,
  pathname: "/app",
});
abandonedTracker.start("intent");
abandonedTracker.observe("wallet_select");
assert.equal(abandoned.at(-1)?.stage, "wallet_select");
assert.ok(
  !abandoned.some((event) =>
    ["completed", "failed", "cancelled"].includes(event.outcome)
  )
);
assert.doesNotThrow(() => {
  createLifecycleTracker({
    emit: () => {
      throw new Error("synthetic exporter failure");
    },
    flowId: "123e4567-e89b-42d3-a456-426614174004",
    flowName: "auth.sign_in",
    flowVariant: "interactive",
    now: () => NOW,
    pathname: "/app",
  }).start("intent");
});
pass(
  "tracker enforces one terminal, bounded recovery, abandonment last-stage semantics, and exporter failure isolation"
);

assert.deepEqual(
  Object.fromEntries(
    EXECUTE_NOW_STATES.map((state) => [
      state,
      mapExecuteNowState(state).outcome,
    ])
  ),
  {
    requested: "observed",
    selected: "observed",
    pull_confirmed: "observed",
    completed: "completed",
    failed: "failed",
    released: "failed",
    canceled: "cancelled",
  }
);
pass("Execute Now state-to-outcome mapping is exact");

const actorSecret = "synthetic-observability-actor-secret-000000";
const wallet = "SyntheticWalletIdentifierForVerifier";
const actor = deriveObservabilityActorId({
  deploymentEnvironment: "production",
  secret: actorSecret,
  walletAddress: wallet,
});
assert.match(actor ?? "", /^actor:v1:[0-9a-f]{64}$/);
assert.equal(
  actor,
  deriveObservabilityActorId({
    deploymentEnvironment: "production",
    secret: actorSecret,
    walletAddress: wallet,
  })
);
assert.notEqual(
  actor,
  deriveObservabilityActorId({
    deploymentEnvironment: "preview",
    secret: actorSecret,
    walletAddress: wallet,
  })
);
assert.equal(
  deriveObservabilityActorId({
    deploymentEnvironment: "production",
    secret: "short",
    walletAddress: wallet,
  }),
  null
);
assert.ok(!JSON.stringify(actor).includes(wallet));
assert.ok(!JSON.stringify(actor).includes(actorSecret));
pass(
  "actor enrichment is deterministic, environment-separated, anonymous-safe, and irreversible in payload form"
);

const diagnosticEvents: Array<BrowserLifecycleEnvelope & LifecycleDiagnostics> =
  [
    baseEvent({
      chainState: "confirmed",
      durationMs: 1,
      elapsedMs: 2,
      executionMode: "batch",
      flowName: "earn.deposit",
      flowVariant: "initial",
      httpStatus: 202,
      instructionCount: 4,
      lookupTableUsed: true,
      outcome: "failed",
      persistenceState: "failed",
      policyMode: "create",
      reviewBypassed: false,
      setupRequired: true,
      stage: "backend_confirm",
      stageCount: 3,
      stageIndex: 2,
      transactionVersion: "v0",
      errorCode: "record_failed",
    }),
    baseEvent({
      autodepositCloseRequired: true,
      cleanupRequired: true,
      flowName: "earn.withdrawal",
      flowVariant: "full",
      stage: "cleanup",
    }),
    baseEvent({
      authProofKind: "siws",
      flowName: "auth.sign_in",
      flowVariant: "interactive",
      stage: "wallet_approval",
    }),
    baseEvent({
      flowName: "auth.smart_account_provisioning",
      flowVariant: "wallet_onboarding",
      provisioningOutcome: "sponsored_new_record",
      stage: "sponsorship_finalize",
    }),
    baseEvent({
      executeNowState: "selected",
      flowName: "earn.autodeposit.execute_now",
      flowVariant: "execute_now",
      scheduledSlotId: "42",
      source: "sse",
      stage: "state_observed",
    }),
  ];

const storedAttributes = new Map<string, unknown>();
for (const [index, event] of diagnosticEvents.entries()) {
  const normalized = parseBrowserLifecycleEnvelope(event, NOW);
  const payload = buildOtlpLifecyclePayload({
    ...normalized,
    ...(index === 0 ? { actorId: actor! } : {}),
    deploymentEnvironment: "production",
    release: "abcdef1",
    serviceName: "loyal-frontend",
  }) as {
    resourceLogs: Array<{
      scopeLogs: Array<{
        logRecords: Array<{
          attributes: Array<{ key: string; value: unknown }>;
          severityText: string;
        }>;
      }>;
    }>;
  };
  const record = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
  for (const attribute of record.attributes)
    storedAttributes.set(attribute.key, attribute.value);
  assert.equal(record.severityText, index === 0 ? "ERROR" : "INFO");
}
for (const key of [
  "loyal.event.kind",
  "loyal.flow.id",
  "loyal.flow.name",
  "loyal.flow.variant",
  "loyal.flow.stage",
  "loyal.flow.outcome",
  "loyal.flow.source",
  "loyal.duration_ms",
  "loyal.elapsed_ms",
  "loyal.actor.id",
  "loyal.error.code",
  "loyal.execute_now.state",
  "loyal.chain.state",
  "loyal.persistence.state",
  "http.response.status_code",
  "loyal.stage.index",
  "loyal.stage.count",
  "loyal.instruction.count",
  "loyal.transaction.version",
  "loyal.transaction.lookup_table_used",
  "loyal.policy.mode",
  "loyal.setup.required",
  "loyal.review.bypassed",
  "loyal.autodeposit_close.required",
  "loyal.cleanup.required",
  "loyal.auth.proof_kind",
  "loyal.execution.mode",
  "loyal.provisioning.outcome",
  "loyal.scheduled_slot.id",
])
  assert.ok(storedAttributes.has(key), `missing OTLP attribute ${key}`);
assert.deepEqual(storedAttributes.get("loyal.duration_ms"), { intValue: "10" });
assert.deepEqual(storedAttributes.get("loyal.transaction.lookup_table_used"), {
  boolValue: true,
});
assert.deepEqual(storedAttributes.get("loyal.transaction.version"), {
  stringValue: "v0",
});

const recoveryPayload = buildOtlpLifecyclePayload({
  ...trackerEvents[3]!,
  deploymentEnvironment: "production",
  release: "abcdef1",
  serviceName: "loyal-frontend",
}) as {
  resourceLogs: Array<{
    scopeLogs: Array<{ logRecords: Array<{ severityText: string }> }>;
  }>;
};
assert.equal(
  recoveryPayload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.severityText,
  "ERROR"
);
pass(
  "flow-valid synthetic records collectively preserve every exact OTLP name/type and severity rule"
);

const listeners = new Map<string, (event: unknown) => void>();
let fetchAttempts = 0;
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      listeners.set(name, listener),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: { pathname: "/app" },
    setTimeout: globalThis.setTimeout.bind(globalThis),
  },
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () => {
    fetchAttempts += 1;
    throw new Error("synthetic telemetry outage");
  },
});
const { captureBrowserLifecycle } = await import(
  "../src/features/observability/client"
);
assert.doesNotThrow(() => captureBrowserLifecycle(baseEvent()));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(fetchAttempts, 1);
pass(
  "browser lifecycle transport is fire-and-forget and non-throwing during outage"
);

const sources = {
  authHook: read("src/components/auth/use-wallet-proof-auth.ts"),
  authProof: read("src/lib/auth/wallet-proof-flow.ts"),
  authClient: read("src/lib/auth/client.ts"),
  autoReauth: read("src/components/auth/wallet-auto-reauth.tsx"),
  completionRoute: read("src/app/api/auth/wallet/complete/route.ts"),
  onboarding: read("src/features/identity/server/wallet-onboarding.ts"),
  workspace: read("src/components/wallet-workspace/app-wallet-workspace.tsx"),
  sidebarData: read("src/hooks/use-smart-account-sidebar-data.ts"),
  fallback: read("src/features/earn-realtime/fallback.ts"),
  eventRoute: read("src/app/api/observability/events/route.ts"),
  lifecycleClient: read("src/features/observability/client.ts"),
  lifecycleServer: read("src/features/observability/lifecycle.server.ts"),
  limiter: read("src/features/observability/rate-limit.server.ts"),
};
assert.match(sources.authHook, /createBrowserLifecycleTracker/);
assert.match(sources.authProof, /x-loyal-flow-id|flowId: lifecycle\?\.flowId/);
assert.match(sources.autoReauth, /auto_reauth/);
assert.match(sources.completionRoute, /auth\.smart_account_provisioning/);
for (const stage of [
  "proof_verify",
  "user_resolve",
  "smart_account_lookup",
  "smart_account_reconcile",
  "smart_account_reserve",
  "sponsorship_submit",
  "sponsorship_finalize",
  "signer_verify",
  "completion_persist",
  "session_issue",
])
  assert.ok(
    sources.onboarding.includes(`"${stage}"`),
    `missing provisioning stage ${stage}`
  );
for (const flow of [
  "earn.deposit",
  "earn.withdrawal",
  "earn.autodeposit.configuration",
  "earn.autodeposit.execute_now",
])
  assert.ok(sources.workspace.includes(flow), `missing workspace flow ${flow}`);
for (const variant of [
  "initial",
  "resumed",
  "top_up",
  "partial",
  "full",
  "setup",
  "floor_update",
  "pause",
  "resume",
  "close",
  "execute_now",
])
  assert.ok(
    sources.workspace.includes(`"${variant}"`),
    `missing variant ${variant}`
  );
assert.match(
  sources.workspace,
  /recordExecuteNowProgress\(progress, "sse", event\.occurredAt\)/
);
assert.match(
  sources.workspace,
  /recordExecuteNowProgress\(progress, "fallback", progress\.occurredAt\)/
);
assert.doesNotMatch(
  sources.workspace,
  /occurredAt: new Date\(\)\.toISOString\(\)/
);
assert.match(sources.sidebarData, /observabilityFlowId/);
assert.match(sources.eventRoute, /MAX_LIFECYCLE_REQUEST_BYTES/);
assert.match(sources.eventRoute, /resolveAuthenticatedPrincipalFromRequest/);
assert.match(sources.eventRoute, /OBSERVABILITY_ACTOR_HMAC_SECRET/);
assert.match(sources.lifecycleClient, /keepalive: true/);
assert.match(
  sources.lifecycleClient,
  /void postBrowserLifecycle\(envelope\)\.catch/
);
assert.match(sources.lifecycleServer, /after\(async \(\) =>/);
assert.match(sources.limiter, /MAX_LIFECYCLE_REPORTS_PER_WINDOW\s*=\s*120/);
assert.match(sources.limiter, /MAX_TRACKED_SOURCES\s*=\s*1024/);
assert.doesNotMatch(
  Object.values(sources).join("\n"),
  /Math\.random\(\).*sampl|sampleRate|samplingRate/i
);
pass(
  "production auth, provisioning, Earn, configuration, Execute Now, SSE/fallback, relay, and non-blocking server callsites are wired"
);

const statusLines = execFileSync("git", ["status", "--porcelain"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\n")
  .filter((line) => line.length > 0);
for (const line of statusLines) {
  const path = line.slice(3);
  assert.ok(path.startsWith("frontend/"), `prohibited changed path: ${path}`);
  assert.ok(
    !/(?:package\.json|bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(
      path
    )
  );
}
pass(
  "working implementation changes stay frontend-only with no manifest or lockfile mutation"
);

console.info('OBSERVABILITY_FLOW_VERIFIER_RESULT {"status":"pass"}');
