import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  classifyBrowserLoadingDependencyUrl,
  FRONTEND_LOADING_METRIC_NAME,
  FRONTEND_LOADING_OPERATIONS,
  parseBrowserLoadingMetricEnvelope,
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
for (const invalid of [
  { ...baseMetric(), walletAddress: "forbidden" },
  { ...baseMetric(), metricName: "loyal.frontend.arbitrary" },
  { ...baseMetric(), durationMs: -1 },
  { ...baseMetric(), operation: "earn.deposit", flowId: undefined },
  { ...baseMetric(), operation: "page_load", phase: "balances_ready" },
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
