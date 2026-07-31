import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  classifyBrowserLoadingDependencyUrl,
  FRONTEND_LOADING_METRIC_NAME,
  FRONTEND_LOADING_OPERATIONS,
  parseBrowserLoadingMetricEnvelope,
  resolveBrowserLoadingFailurePhase,
  type BrowserLoadingMetricEnvelope,
} from "../src/features/observability/metrics-contract";
import { buildOtlpLoadingMetricPayload } from "../src/features/observability/otlp";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const NOW = Date.parse("2026-07-31T12:00:00.000Z");
const FLOW_ID = "123e4567-e89b-42d3-a456-426614174000";
const PAGE_SESSION_ID = "123e4567-e89b-42d3-a456-426614174001";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function pass(message: string): void {
  console.info(`PASS: ${message}`);
}

function baseMetric(
  overrides: Partial<BrowserLoadingMetricEnvelope> = {}
): BrowserLoadingMetricEnvelope {
  return {
    durationMs: 123.456,
    flowId: FLOW_ID,
    metricName: FRONTEND_LOADING_METRIC_NAME,
    operation: "earn.deposit",
    outcome: "completed",
    pageSessionId: PAGE_SESSION_ID,
    pathname: "/app",
    phase: "interaction_to_preview",
    presentation: "in_app",
    timestamp: new Date(NOW).toISOString(),
    ...overrides,
  };
}

assert.deepEqual(FRONTEND_LOADING_OPERATIONS, [
  "page_load",
  "earn.deposit",
  "earn.withdrawal",
  "earn.close",
  "earn.autodeposit.setup",
  "earn.autodeposit.close",
]);
assert.deepEqual(
  parseBrowserLoadingMetricEnvelope(baseMetric(), NOW),
  baseMetric()
);
assert.deepEqual(
  parseBrowserLoadingMetricEnvelope(
    {
      ...baseMetric({
        dependency: "solana_rpc",
        phase: "dependency",
        presentation: undefined,
        requestCount: 2,
      }),
    },
    NOW
  ).dependency,
  "solana_rpc"
);
assert.equal(
  parseBrowserLoadingMetricEnvelope(
    {
      ...baseMetric({
        flowId: undefined,
        operation: "page_load",
        phase: "balances_ready",
        presentation: undefined,
      }),
    },
    NOW
  ).operation,
  "page_load"
);
assert.equal(
  parseBrowserLoadingMetricEnvelope(
    baseMetric({
      phase: "wallet_confirmation_to_ui",
      presentation: undefined,
    }),
    NOW
  ).phase,
  "wallet_confirmation_to_ui"
);
for (const invalid of [
  { ...baseMetric(), walletAddress: "forbidden" },
  { ...baseMetric(), metricName: "loyal.frontend.arbitrary" },
  { ...baseMetric(), durationMs: -1 },
  { ...baseMetric(), operation: "earn.deposit", flowId: undefined },
  { ...baseMetric(), operation: "page_load", phase: "balances_ready" },
  baseMetric({ phase: "interaction_to_preview", presentation: undefined }),
  baseMetric({ phase: "balances_ready", presentation: undefined }),
  baseMetric({ phase: "wallet_confirmation_to_ui" }),
  { ...baseMetric(), phase: "dependency", requestCount: 1 },
  {
    ...baseMetric(),
    dependency: "loyal_api",
    phase: "interaction_to_preview",
    requestCount: 1,
  },
]) {
  assert.throws(() => parseBrowserLoadingMetricEnvelope(invalid, NOW));
}
pass(
  "metric schema covers every requested flow and rejects arbitrary context, invalid combinations, and unbounded values"
);

assert.equal(
  resolveBrowserLoadingFailurePhase({
    previewMetricSent: false,
    walletSubmitted: false,
  }),
  "interaction_to_preview"
);
assert.equal(
  resolveBrowserLoadingFailurePhase({
    previewMetricSent: true,
    walletSubmitted: false,
  }),
  null
);
assert.equal(
  resolveBrowserLoadingFailurePhase({
    previewMetricSent: true,
    walletSubmitted: true,
  }),
  "wallet_confirmation_to_ui"
);
pass(
  "post-preview cancellation is not double-counted and submitted failures use the confirmation-to-UI phase"
);

async function verifyAfterPaintCapturePostsMetric(): Promise<void> {
  const postedBodies: string[] = [];
  const sessionValues = new Map<string, string>();
  Object.defineProperties(globalThis, {
    document: {
      configurable: true,
      value: { visibilityState: "visible" },
    },
    fetch: {
      configurable: true,
      value: async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body === "string") postedBodies.push(init.body);
        return new Response(null, { status: 202 });
      },
    },
    location: {
      configurable: true,
      value: { origin: "https://app.askloyal.com", pathname: "/app" },
    },
    requestAnimationFrame: {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(performance.now());
        return 1;
      },
    },
    sessionStorage: {
      configurable: true,
      value: {
        getItem: (key: string) => sessionValues.get(key) ?? null,
        setItem: (key: string, value: string) => sessionValues.set(key, value),
      },
    },
    window: { configurable: true, value: globalThis },
  });

  const {
    captureBrowserLoadingMetricAfterPaint,
    captureBrowserSubmittedFailureMetricAfterPaint,
  } = await import("../src/features/observability/client");
  captureBrowserLoadingMetricAfterPaint({
    flowId: FLOW_ID,
    operation: "earn.deposit",
    phase: "interaction_to_preview",
    presentation: "in_app",
    startedAtMs: performance.now() - 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(postedBodies.length, 1);
  const postedMetric = JSON.parse(postedBodies[0] ?? "null") as Record<
    string,
    unknown
  >;
  const parsedPostedMetric = parseBrowserLoadingMetricEnvelope(postedMetric);
  assert.equal(parsedPostedMetric.phase, "interaction_to_preview");
  assert.equal(parsedPostedMetric.presentation, "in_app");
  assert.ok(!("startedAtMs" in postedMetric));
  assert.ok(!("shouldCapture" in postedMetric));

  captureBrowserLoadingMetricAfterPaint({
    flowId: FLOW_ID,
    operation: "earn.autodeposit.close",
    phase: "interaction_to_preview",
    presentation: "in_app",
    shouldCapture: () => false,
    startedAtMs: performance.now() - 10,
  });
  captureBrowserSubmittedFailureMetricAfterPaint({
    flowId: FLOW_ID,
    operation: "earn.deposit",
    startedAtMs: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(postedBodies.length, 1);

  captureBrowserSubmittedFailureMetricAfterPaint({
    flowId: FLOW_ID,
    operation: "earn.deposit",
    startedAtMs: performance.now() - 10,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(postedBodies.length, 2);
  const postedFailure = parseBrowserLoadingMetricEnvelope(
    JSON.parse(postedBodies[1] ?? "null")
  );
  assert.equal(postedFailure.outcome, "failed");
  assert.equal(postedFailure.phase, "wallet_confirmation_to_ui");
}

await verifyAfterPaintCapturePostsMetric();
pass(
  "the public capture helpers gate stale previews and pre-submit failures without leaking local fields"
);

const pageOrigin = "https://app.askloyal.com";
const rpcEndpoint = "https://rpc.example.test/solana/mainnet";
assert.equal(
  classifyBrowserLoadingDependencyUrl({
    pageOrigin,
    resourceUrl: "https://app.askloyal.com/api/earn/prepare",
    rpcEndpoint,
  }),
  "loyal_api"
);
assert.equal(
  classifyBrowserLoadingDependencyUrl({
    pageOrigin,
    resourceUrl: "https://rpc.example.test/solana/mainnet",
    rpcEndpoint,
  }),
  "solana_rpc"
);
assert.equal(
  classifyBrowserLoadingDependencyUrl({
    pageOrigin,
    resourceUrl: "https://api.kamino.finance/instructions",
    rpcEndpoint,
  }),
  "third_party_api"
);
assert.equal(
  classifyBrowserLoadingDependencyUrl({
    pageOrigin,
    resourceUrl: "not a URL",
    rpcEndpoint,
  }),
  null
);
pass(
  "dependency attribution separates Loyal API, Solana RPC, and third party requests"
);

const otlp = buildOtlpLoadingMetricPayload({
  ...baseMetric(),
  deploymentEnvironment: "production",
  release: "abc123",
  serviceName: "loyal-frontend",
});
const serializedOtlp = JSON.stringify(otlp);
for (const required of [
  '"resourceMetrics"',
  `"name":"${FRONTEND_LOADING_METRIC_NAME}"`,
  '"unit":"ms"',
  '"asDouble":123.456',
  '"service.name"',
  '"loyal.operation"',
  '"loyal.phase"',
  '"loyal.page_session.id"',
]) {
  assert.ok(
    serializedOtlp.includes(required),
    `missing OTLP field ${required}`
  );
}
for (const forbidden of ["walletAddress", "signature", "amountRaw"]) {
  assert.ok(!serializedOtlp.includes(forbidden));
}
pass(
  "OTLP metrics payload carries duration and bounded dimensions without financial identifiers"
);

const routeSource = read(
  `${frontendRoot}/src/app/api/observability/metrics/route.ts`
);
const serverSource = read(
  `${frontendRoot}/src/features/observability/server.ts`
);
const clientSource = read(
  `${frontendRoot}/src/features/observability/client.ts`
);
const walletSource = read(
  `${repoRoot}/packages/smart-account-vaults/src/wallet.ts`
);
const workspaceSource = read(
  `${frontendRoot}/src/components/wallet-workspace/app-wallet-workspace.tsx`
);
const sidebarDataSource = read(
  `${frontendRoot}/src/hooks/use-smart-account-sidebar-data.ts`
);
const nginxSource = read(`${repoRoot}/observability/nginx.conf`);

assert.ok(routeSource.includes("isSameOriginRequest(request)"));
assert.ok(routeSource.includes("consumeBrowserMetricsRateLimit(request)"));
assert.ok(clientSource.includes('credentials: "same-origin"'));
assert.ok(serverSource.includes('"metrics"'));
assert.ok(serverSource.includes("authorization: config.ingestionKey"));
assert.ok(nginxSource.includes("location = /v1/metrics"));
assert.ok(nginxSource.includes("proxy_pass http://127.0.0.1:4318/v1/metrics"));
const transactionSentCallbackIndex = walletSource.indexOf(
  "onTransactionSent?.({ prepared, signature })"
);
const confirmationIndex = walletSource.indexOf("if (shouldConfirm)");
assert.ok(transactionSentCallbackIndex >= 0);
assert.ok(confirmationIndex >= 0);
assert.ok(transactionSentCallbackIndex < confirmationIndex);
const policyStageStart = sidebarDataSource.indexOf(
  "const executeEarnDepositPolicyStage"
);
const policyStageEnd = sidebarDataSource.indexOf(
  "const executeEarnDepositBatch",
  policyStageStart
);
assert.ok(policyStageStart >= 0);
assert.ok(policyStageEnd > policyStageStart);
assert.ok(
  sidebarDataSource
    .slice(policyStageStart, policyStageEnd)
    .includes("onTransactionSent: request.onWalletSubmitted")
);
// A full Resource Timing buffer stops recording, so preparation must be
// observed as a stream rather than scraped from the shared buffer.
assert.ok(clientSource.includes("observer.observe({ buffered: false"));
assert.ok(clientSource.includes("observer.takeRecords()"));
assert.ok(
  clientSource.indexOf("const collector = observeDependencyEntries()") <
    clientSource.indexOf("return await args.run()")
);

// An anonymous session paints no balance and must not enter the series.
const balancesReadyStart = workspaceSource.indexOf(
  "const areDisplayedBalancesReady"
);
const balancesReadyEnd = workspaceSource.indexOf(
  "captureBrowserLoadingMetricAfterPaint",
  balancesReadyStart
);
assert.ok(balancesReadyStart >= 0);
assert.ok(
  workspaceSource
    .slice(balancesReadyStart, balancesReadyEnd)
    .includes("canLoadPersonalAccount &&")
);

// Autodeposit setup prepares after confirmation, so its preview observation
// must bracket that preparation instead of the drafted review render.
const autodepositSetupStart = workspaceSource.indexOf(
  "const handleCompleteEarnAutodepositSetup"
);
const autodepositSetupEnd = workspaceSource.indexOf(
  "const handleCompleteEarnAutodepositClose",
  autodepositSetupStart
);
const autodepositSetupSource = workspaceSource.slice(
  autodepositSetupStart,
  autodepositSetupEnd
);
assert.ok(autodepositSetupStart >= 0);
assert.ok(autodepositSetupEnd > autodepositSetupStart);
assert.ok(autodepositSetupSource.includes("const prepareStartedAtMs"));
assert.ok(
  autodepositSetupSource.indexOf("measureBrowserLoadingDependencies") <
    autodepositSetupSource.indexOf('phase: "interaction_to_preview"')
);
assert.ok(
  autodepositSetupSource.indexOf('phase: "interaction_to_preview"') <
    autodepositSetupSource.indexOf("executeEarnAutodepositSetup")
);
assert.ok(!autodepositSetupSource.includes('presentation: "in_app"'));
assert.ok(!workspaceSource.includes("attempt.previewMetricSent"));

assert.ok(workspaceSource.includes("earnAutodepositCloseLifecycleRef.current"));
assert.ok(
  workspaceSource.includes(
    "const existingTracker = pendingEarnAutodepositClosePrepared"
  )
);
const autodepositSaveStart = workspaceSource.indexOf(
  "const handleSaveAutodeposit"
);
const autodepositSaveEnd = workspaceSource.indexOf(
  "const handleDismissEarnAutodepositPreview",
  autodepositSaveStart
);
const autodepositSaveSource = workspaceSource.slice(
  autodepositSaveStart,
  autodepositSaveEnd
);
const setupAttemptStartIndex = autodepositSaveSource.indexOf(
  "earnAutodepositSetupAttemptRef.current = setupAttempt"
);
const setupReviewStartIndex = autodepositSaveSource.indexOf(
  "setPendingEarnAutodepositDraft"
);
assert.ok(setupAttemptStartIndex >= 0);
assert.ok(setupReviewStartIndex >= 0);
assert.ok(setupAttemptStartIndex < setupReviewStartIndex);
assert.ok(
  workspaceSource.includes(
    "if (earnAutodepositCloseLifecycleRef.current !== tracker)"
  )
);
for (const [handler, operation] of [
  ["handleContinueEarnDepositReview", "earn.deposit"],
  ["handleContinueEarnWithdrawReview", "earn.withdrawal"],
  ["handleCompleteEarnCleanup", "earn.close"],
  ["handleCompleteEarnAutodepositSetup", "earn.autodeposit.setup"],
  ["handleCompleteEarnAutodepositClose", "earn.autodeposit.close"],
] as const) {
  const handlerStart = workspaceSource.indexOf(`const ${handler}`);
  const handlerEnd = workspaceSource.indexOf("\n  const ", handlerStart + 1);
  const handlerSource = workspaceSource.slice(handlerStart, handlerEnd);
  assert.ok(handlerStart >= 0);
  assert.ok(
    handlerSource.includes("captureBrowserSubmittedFailureMetricAfterPaint")
  );
  assert.ok(handlerSource.includes(`operation: "${operation}"`));
}
for (const operation of FRONTEND_LOADING_OPERATIONS) {
  assert.ok(workspaceSource.includes(`operation: "${operation}"`));
}
for (const phase of [
  "balances_ready",
  "interaction_to_preview",
  "wallet_confirmation_to_ui",
]) {
  assert.ok(workspaceSource.includes(`phase: "${phase}"`));
}
pass(
  "browser relay, server-only credential, /v1/metrics export, post-submit timing boundary, and requested UI flow wiring are present"
);

console.info("Frontend loading metrics verifier passed.");
