import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createBrowserErrorEnvelope,
  createErrorDeduplicator,
  parseBrowserErrorEnvelope,
} from "../src/features/observability/error-contract";
import { buildOtlpErrorPayload } from "../src/features/observability/otlp";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(`${frontendRoot}/${relativePath}`, "utf8");
}

function pass(message: string): void {
  console.info(`PASS: ${message}`);
}

const forbidden = {
  apiKey: "forbidden-api-key-marker",
  bearer: "forbidden-bearer-marker",
  cookie: "forbidden-cookie-marker",
  query: "forbidden-query-marker",
  wallet: "7YWHMfk9JZe0LMkEnRrKt6trp2xH4D9vLqPN5QwX8aBc",
};

const now = new Date("2026-07-15T20:00:00.000Z");
const rawError = new Error(
  `Request failed at https://api.example.test/path?token=${forbidden.query}` +
    ` Authorization: Bearer ${forbidden.bearer}` +
    ` api_key=${forbidden.apiKey}` +
    ` cookie=${forbidden.cookie}` +
    ` wallet=${forbidden.wallet}` +
    " x".repeat(600)
);
rawError.name = "SensitiveError";
rawError.stack = `${rawError.name}: ${rawError.message}\nresponse headers: ${forbidden.cookie}`;

const envelope = createBrowserErrorEnvelope(rawError, "earn.deposit.execute", {
  now,
  pathname: `/earn?token=${forbidden.query}#secret`,
});

assert.equal(envelope.pathname, "/earn");
assert.ok(envelope.name.length <= 80);
assert.ok(envelope.message.length <= 512);
assert.ok((envelope.stack?.length ?? 0) <= 4096);

const serializedEnvelope = JSON.stringify(envelope);
for (const marker of Object.values(forbidden)) {
  assert.ok(
    !serializedEnvelope.includes(marker),
    `sanitized envelope retained forbidden marker ${marker}`
  );
}
pass("normalization strips query/hash, redacts sensitive identifiers, and truncates fields");

const parsed = parseBrowserErrorEnvelope(envelope, now.getTime());
assert.deepEqual(parsed, envelope);
assert.throws(
  () =>
    parseBrowserErrorEnvelope(
      { ...envelope, arbitraryContext: { secret: forbidden.apiKey } },
      now.getTime()
    ),
  /Invalid observability error envelope/
);
assert.throws(
  () =>
    parseBrowserErrorEnvelope(
      { ...envelope, operation: "arbitrary.operation" },
      now.getTime()
    ),
  /Invalid observability error envelope/
);
assert.throws(
  () =>
    parseBrowserErrorEnvelope(
      { ...envelope, timestamp: "2026-07-15T18:00:00.000Z" },
      now.getTime()
    ),
  /Invalid observability error envelope/
);
pass("strict schema rejects unknown fields, operations, and stale timestamps");

let dedupeNow = 1_000;
const deduplicator = createErrorDeduplicator({
  now: () => dedupeNow,
  windowMs: 5_000,
});
assert.equal(deduplicator.isDuplicate(envelope), false);
assert.equal(deduplicator.isDuplicate(envelope), true);
dedupeNow += 5_001;
assert.equal(deduplicator.isDuplicate(envelope), false);
pass("browser duplicate suppression is bounded by time");

const payload = buildOtlpErrorPayload({
  deploymentEnvironment: "production",
  exception: {
    message: parsed.message,
    name: parsed.name,
    ...(parsed.stack ? { stack: parsed.stack } : {}),
  },
  operation: parsed.operation,
  pathname: parsed.pathname,
  release: "abcdef1",
  runtime: "browser",
  serviceName: "loyal-frontend",
  timestamp: parsed.timestamp,
});
const serializedPayload = JSON.stringify(payload);
for (const required of [
  "service.name",
  "service.version",
  "deployment.environment.name",
  "loyal.runtime",
  "loyal.operation",
  "url.path",
  "exception.type",
  "exception.message",
  "severityNumber",
  "timeUnixNano",
]) {
  assert.ok(serializedPayload.includes(required), `OTLP payload lacks ${required}`);
}
for (const marker of Object.values(forbidden)) {
  assert.ok(
    !serializedPayload.includes(marker),
    `OTLP payload retained forbidden marker ${marker}`
  );
}
pass("OTLP payload contains fixed resource/error fields and no forbidden markers");

const listeners = new Map<string, (event: unknown) => void>();
let fetchAttempts = 0;
const verifierWindow = {
  addEventListener: (name: string, listener: (event: unknown) => void) => {
    listeners.set(name, listener);
  },
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  location: { pathname: "/verifier" },
  setTimeout: globalThis.setTimeout.bind(globalThis),
};
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: verifierWindow,
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () => {
    fetchAttempts += 1;
    throw new Error("synthetic telemetry outage");
  },
});

const { captureBrowserError, installBrowserErrorListeners } = await import(
  "../src/features/observability/client"
);
assert.doesNotThrow(() =>
  captureBrowserError(
    new Error("synthetic direct client failure"),
    "earn.deposit.execute"
  )
);
installBrowserErrorListeners();
installBrowserErrorListeners();
assert.equal(listeners.size, 2);
listeners.get("error")?.({ error: new Error("synthetic window failure") });
listeners.get("unhandledrejection")?.({
  reason: new Error("synthetic rejection failure"),
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(fetchAttempts, 3);
pass("client capture and both global listeners stay non-throwing when transport fails");

const clientSource = read("src/features/observability/client.ts");
const serverSource = read("src/features/observability/server.ts");
const routeSource = read("src/app/api/observability/errors/route.ts");
const rateLimitSource = read(
  "src/features/observability/rate-limit.server.ts"
);
const serverInstrumentation = read("src/instrumentation.ts");
const clientInstrumentation = read("src/instrumentation-client.ts");
const appBoundary = read("src/app/error.tsx");
const globalBoundary = read("src/app/global-error.tsx");
const earnSource = read("src/hooks/use-smart-account-sidebar-data.ts");

assert.match(clientSource, /catch \{[\s\S]*best-effort/);
assert.match(clientSource, /void postBrowserError\(envelope\)\.catch/);
assert.match(clientSource, /__loyalObservabilityListenersInstalled__/);
assert.match(clientSource, /"error"/);
assert.match(clientSource, /"unhandledrejection"/);
assert.match(clientSource, /keepalive: true/);
assert.match(clientInstrumentation, /installBrowserErrorListeners\(\)/);
pass("browser capture is one-time, rejection-safe, and wired before hydration");

const timeoutMatch = serverSource.match(/EXPORT_TIMEOUT_MS\s*=\s*(\d+)/);
assert.ok(timeoutMatch, "server exporter timeout constant is missing");
assert.ok(Number(timeoutMatch[1]) <= 1500);
assert.match(serverSource, /catch \{\s*return false;/);
assert.doesNotMatch(serverSource, /NEXT_PUBLIC_[A-Z_]*(?:KEY|TOKEN)/);
assert.match(serverSource, /authorization: config\.ingestionKey/);
pass("server export is <=1500 ms, fail-open, and keeps credentials server-only");

assert.match(routeSource, /isSameOriginRequest/);
assert.match(routeSource, /application\/json/);
assert.match(routeSource, /body\.byteLength/);
assert.match(routeSource, /consumeBrowserErrorRateLimit/);
assert.match(routeSource, /return jsonResponse\(\{ accepted: true \}, 202\)/);
assert.match(rateLimitSource, /MAX_REPORTS_PER_WINDOW\s*=\s*20/);
assert.match(rateLimitSource, /MAX_TRACKED_SOURCES\s*=\s*1024/);
assert.match(rateLimitSource, /createHash\("sha256"\)/);
pass("same-origin relay enforces JSON, actual bytes, bounded hashed-source rate limiting, and 202 fail-open semantics");

assert.match(serverInstrumentation, /reportServerError/);
assert.match(serverInstrumentation, /context\.routePath \?\? request\.path/);
assert.doesNotMatch(
  serverInstrumentation,
  /request\.(?:headers|body|cookies)/
);
assert.match(appBoundary, /"react\.error_boundary"/);
assert.match(appBoundary, /onClick=\{reset\}/);
assert.match(globalBoundary, /"react\.global_error_boundary"/);
assert.match(globalBoundary, /<html/);
assert.match(globalBoundary, /<body/);
assert.match(globalBoundary, /onClick=\{reset\}/);
assert.match(earnSource, /"earn\.deposit\.confirmation"/);
assert.match(earnSource, /"earn\.deposit\.execute"/);
pass("server hook, both React boundaries, and both Earn error seams are wired");

const changedObservabilitySources = [
  clientSource,
  serverSource,
  routeSource,
  rateLimitSource,
  serverInstrumentation,
  clientInstrumentation,
  appBoundary,
  globalBoundary,
].join("\n");
// walletAddress is deliberately absent from this list: wallet addresses are
// now exported in plaintext as `loyal.wallet.address`. Everything below stays
// prohibited — signatures, transaction payloads, and raw request echoes.
for (const prohibited of [
  "JSON.stringify(request",
  "headers: request.headers",
  "body: request.body",
  "signedTransaction",
  "transactionSignature",
]) {
  assert.ok(
    !changedObservabilitySources.includes(prohibited),
    `observability wiring references prohibited context: ${prohibited}`
  );
}
pass("observability wiring does not serialize prohibited app context");

console.info("OBSERVABILITY_FRONTEND_VERIFIER_RESULT {\"status\":\"pass\"}");
