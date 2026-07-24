import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLIENT_BUILD_ID = "0123456789abcdef0123456789abcdef01234567";
const SERVER_BUILD_ID = "89abcdef0123456789abcdef0123456789abcdef";
const ORIGIN = "https://askloyal.com";
const CHUNK_URL = `${ORIGIN}/_next/static/chunks/app/global-error-3a07882f87777428.js`;
const EXTERNAL_CHUNK_URL =
  "https://cdn.example.test/_next/static/chunks/4219.js";
const SESSION_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;
const SERVER_ROUTE_PROBE_FLAG = "--server-route-probe";

type ClientModule = typeof import("../src/features/observability/client");
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type BrowserEventName = "error" | "unhandledrejection";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function pass(message: string): void {
  console.info(`PASS: ${message}`);
}

function chunkError(url = CHUNK_URL): Error {
  const error = new Error(`Loading chunk 4219 failed.\n(error: ${url})`);
  error.name = "ChunkLoadError";
  return error;
}

function installBrowser(options: {
  randomUUID: string;
  stallReport?: boolean;
  storage?: StorageLike;
}) {
  const calls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const listeners = new Map<BrowserEventName, (event: never) => void>();
  const storage = options.storage ?? new MemoryStorage();
  const verifierWindow = {
    addEventListener: (
      name: BrowserEventName,
      listener: (event: never) => void
    ) => listeners.set(name, listener),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    crypto: {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto
      ),
      randomUUID: () => options.randomUUID,
    },
    location: {
      origin: ORIGIN,
      pathname: "/",
      reload: () => calls.push("reload"),
    },
    navigator: {
      connection: { effectiveType: "4g", rtt: 80 },
      onLine: true,
    },
    performance: {
      getEntriesByName: (name: string) =>
        name === CHUNK_URL
          ? [
              {
                duration: 142.5,
                responseStatus: 504,
                transferSize: 10_540,
              },
            ]
          : [],
    },
    sessionStorage: storage,
    setTimeout: globalThis.setTimeout.bind(globalThis),
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: verifierWindow,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (
      _input: unknown,
      init?: { body?: unknown; signal?: AbortSignal }
    ) => {
      calls.push("report");
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (options.stallReport) {
        await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      }
      return new Response(null, { status: 202 });
    },
  });

  return {
    bodies,
    calls,
    dispatch(name: BrowserEventName, event: unknown) {
      listeners.get(name)?.(event as never);
    },
    storage,
  };
}

async function loadClient(tag: string): Promise<ClientModule> {
  const modulePath = `../src/features/observability/client?chunkVerifier=${tag}`;
  return (await import(modulePath)) as ClientModule;
}

async function verifyServerRouteProbe(): Promise<void> {
  process.env.OBSERVABILITY_INGESTION_API_KEY = "";
  process.env.OBSERVABILITY_OTLP_ENDPOINT = "";
  const { POST } = await import("../src/app/api/observability/errors/route");
  const previewOrigin = "https://preview.example.test";
  const envelope = {
    clientBuildId: CLIENT_BUILD_ID,
    diagnostics: {
      chunkUrl: `${previewOrigin}/_next/static/chunks/4219.js`,
      networkOnline: true,
    },
    message: "Loading chunk 4219 failed.",
    name: "ChunkLoadError",
    operation: "browser.unhandled_rejection",
    pageSessionId: SESSION_IDS[0],
    pathname: "/",
    timestamp: new Date().toISOString(),
  };
  const post = (origin: string, body: unknown) =>
    POST(
      new Request(`${origin}/api/observability/errors`, {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          origin,
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      })
    );

  assert.equal((await post(previewOrigin, envelope)).status, 202);
  assert.equal(
    (
      await post(ORIGIN, {
        ...envelope,
        diagnostics: {
          ...envelope.diagnostics,
          chunkUrl: EXTERNAL_CHUNK_URL,
        },
      })
    ).status,
    400
  );
  console.info("SERVER_ROUTE_PROBE_RESULT: PASS");
}

function runServerRouteProbe(): void {
  const probe = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      fileURLToPath(import.meta.url),
      SERVER_ROUTE_PROBE_FLAG,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        OBSERVABILITY_INGESTION_API_KEY: "",
        OBSERVABILITY_OTLP_ENDPOINT: "",
      },
    }
  );
  assert.equal(
    probe.status,
    0,
    `server route probe failed:\n${probe.stdout}${probe.stderr}`
  );
  assert.match(probe.stdout, /SERVER_ROUTE_PROBE_RESULT: PASS/);
}

async function verify(): Promise<void> {
  const nextConfigPath = "../next.config?chunkVerifier=full-build-id";
  const nextConfig = (await import(nextConfigPath)).default as {
    env?: Record<string, string>;
  };
  assert.match(
    nextConfig.env?.NEXT_PUBLIC_GIT_COMMIT_HASH ?? "",
    /^[0-9a-f]{40}$/
  );
  pass("Next.js injects the full immutable Git commit SHA");

  process.env.NEXT_PUBLIC_GIT_COMMIT_HASH = CLIENT_BUILD_ID;
  const contract = await import("../src/features/observability/error-contract");
  const { buildOtlpErrorPayload } = await import(
    "../src/features/observability/otlp"
  );

  const external = installBrowser({ randomUUID: SESSION_IDS[0] });
  await (await loadClient("external"))
    .createBrowserErrorProcessor()
    .process(chunkError(EXTERNAL_CHUNK_URL), "browser.unhandled_rejection");
  assert.deepEqual(external.calls, ["report"]);
  assert.equal(external.bodies[0].diagnostics, undefined);
  pass("cross-origin chunks cannot claim recovery");

  const requestShape = installBrowser({ randomUUID: SESSION_IDS[1] });
  const requestError = new Error("Loading chunk 4219 failed.") as Error & {
    request: string;
  };
  requestError.name = "ChunkLoadError";
  requestError.request = "/_next/static/chunks/4219.js";
  const requestClient = await loadClient("request-shape");
  requestClient.installBrowserErrorListeners();
  requestShape.dispatch("unhandledrejection", { reason: requestError });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requestShape.calls, ["report", "reload"]);
  assert.equal(
    (requestShape.bodies[0].diagnostics as Record<string, unknown>).chunkUrl,
    `${ORIGIN}/_next/static/chunks/4219.js`
  );
  pass("Webpack error.request reaches the browser listener and hard reload");

  const sessionStorage = new MemoryStorage();
  const first = installBrowser({
    randomUUID: SESSION_IDS[0],
    storage: sessionStorage,
  });
  await (await loadClient("first"))
    .createBrowserErrorProcessor()
    .process(chunkError(), "browser.unhandled_rejection");
  assert.deepEqual(first.calls, ["report", "reload"]);
  const firstEnvelope = first.bodies[0];
  assert.equal(firstEnvelope.clientBuildId, CLIENT_BUILD_ID);
  assert.equal(firstEnvelope.pageSessionId, SESSION_IDS[0]);
  assert.deepEqual(firstEnvelope.diagnostics, {
    chunkUrl: CHUNK_URL,
    connectionEffectiveType: "4g",
    connectionRttMs: 80,
    networkOnline: true,
    resourceDurationMs: 142.5,
    resourceResponseStatus: 504,
    resourceTransferSize: 10_540,
  });
  pass("the first same-origin failure reports diagnostics before one reload");

  const reloaded = installBrowser({
    randomUUID: SESSION_IDS[1],
    storage: sessionStorage,
  });
  await (await loadClient("reloaded"))
    .createBrowserErrorProcessor()
    .process(chunkError(), "browser.unhandled_rejection");
  assert.deepEqual(reloaded.calls, ["report"]);
  assert.equal(reloaded.bodies[0].pageSessionId, SESSION_IDS[0]);
  pass("the reload guard and random page-session ID survive a new document");

  const stalled = installBrowser({
    randomUUID: SESSION_IDS[2],
    stallReport: true,
  });
  const stalledAt = Date.now();
  await (await loadClient("stalled"))
    .createBrowserErrorProcessor()
    .process(chunkError(), "browser.unhandled_rejection");
  const stalledMs = Date.now() - stalledAt;
  assert.deepEqual(stalled.calls, ["report", "reload"]);
  assert.ok(stalledMs >= 200 && stalledMs < 1000, `${stalledMs} ms`);
  pass("a stalled telemetry POST cannot outlive the 250 ms reload grace");

  for (const [tag, storage] of [
    [
      "throwing-storage",
      {
        getItem: () => {
          throw new Error("unavailable");
        },
        setItem: () => {
          throw new Error("unavailable");
        },
      },
    ],
    [
      "nonpersistent-storage",
      { getItem: () => null, setItem: () => undefined },
    ],
  ] satisfies Array<[string, StorageLike]>) {
    const unavailable = installBrowser({
      randomUUID: SESSION_IDS[2],
      storage,
    });
    await (await loadClient(tag))
      .createBrowserErrorProcessor()
      .process(chunkError(), "browser.unhandled_rejection");
    assert.deepEqual(unavailable.calls, ["report"]);
  }
  pass("recovery fails closed when sessionStorage cannot retain the guard");

  const ordinary = installBrowser({ randomUUID: SESSION_IDS[2] });
  const ordinaryProcessor = (
    await loadClient("ordinary")
  ).createBrowserErrorProcessor();
  await ordinaryProcessor.process(
    new Error("ordinary"),
    "browser.window.error"
  );
  const extensionError = new Error("extension-only");
  extensionError.stack =
    "Error: extension-only\n" +
    "    at run (chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/inpage.js:1:1)";
  await ordinaryProcessor.process(extensionError, "browser.window.error");
  assert.deepEqual(ordinary.calls, ["report"]);
  pass("ordinary errors never reload and extension-only errors stay filtered");

  const parseOptions = {
    expectedChunkOrigin: ORIGIN,
    now: Date.parse(String(firstEnvelope.timestamp)),
  };
  const parsed = contract.parseBrowserErrorEnvelope(
    firstEnvelope,
    parseOptions
  );
  assert.deepEqual(parsed, firstEnvelope);
  const assertRejected = (overrides: Record<string, unknown>) =>
    assert.throws(
      () =>
        contract.parseBrowserErrorEnvelope(
          { ...firstEnvelope, ...overrides },
          parseOptions
        ),
      /Invalid observability error envelope/
    );
  assertRejected({ clientBuildId: "clientabc123" });
  assertRejected({ pageSessionId: "not-a-random-session-id" });
  assertRejected({
    diagnostics: {
      ...(firstEnvelope.diagnostics as Record<string, unknown>),
      resourceTransferSize: Number.MAX_SAFE_INTEGER,
    },
  });
  assertRejected({
    diagnostics: {
      ...(firstEnvelope.diagnostics as Record<string, unknown>),
      secretContext: "must-not-pass",
    },
  });
  assertRejected({
    diagnostics: {
      ...(firstEnvelope.diagnostics as Record<string, unknown>),
      chunkUrl: EXTERNAL_CHUNK_URL,
    },
  });
  pass("build, session, origin, and diagnostic fields are strictly bounded");

  runServerRouteProbe();
  pass("the relay derives request origin and rejects external chunk telemetry");

  const normalized = contract.createNormalizedBrowserErrorEvent(parsed, {
    deploymentEnvironment: "production",
    serverRelease: SERVER_BUILD_ID,
  });
  assert.equal(normalized.release, SERVER_BUILD_ID);
  const payload = JSON.stringify(buildOtlpErrorPayload(normalized));
  for (const expected of [
    `"service.version","value":{"stringValue":"${SERVER_BUILD_ID}"}`,
    `"loyal.client.build_id","value":{"stringValue":"${CLIENT_BUILD_ID}"}`,
    `"loyal.page_session.id","value":{"stringValue":"${SESSION_IDS[0]}"}`,
    `"loyal.chunk.url","value":{"stringValue":"${CHUNK_URL}"}`,
    '"network.online","value":{"boolValue":true}',
    '"network.connection.rtt_ms","value":{"intValue":"80"}',
    '"loyal.resource.response_status","value":{"intValue":"504"}',
  ]) {
    assert.ok(payload.includes(expected), `OTLP payload lacks ${expected}`);
  }
  assert.doesNotMatch(payload, /loyal\.ingest\.release/);
  pass(
    "server release stays authoritative while client diagnostics reach OTLP"
  );

  const {
    clientBuildId: _clientBuildId,
    diagnostics: _diagnostics,
    pageSessionId: _pageSessionId,
    ...legacyEnvelope
  } = firstEnvelope;
  const legacy = contract.parseBrowserErrorEnvelope(
    legacyEnvelope,
    parseOptions
  );
  assert.equal(
    contract.createNormalizedBrowserErrorEvent(legacy, {
      deploymentEnvironment: "production",
      serverRelease: SERVER_BUILD_ID,
    }).release,
    SERVER_BUILD_ID
  );
  pass("cached pre-fix browser envelopes remain accepted");

  const guide = await Bun.file(
    new URL("../../observability/README.md", import.meta.url)
  ).text();
  for (const value of [
    "bun run --cwd frontend verify:chunk-load-recovery",
    "loyal.client.build_id",
    "loyal.page_session.id",
    "loyal.chunk.url",
    "network.online",
    "loyal.resource.response_status",
  ]) {
    assert.ok(guide.includes(value), `operator guide lacks ${value}`);
  }
  pass("the operator guide documents diagnostics and verification");
  console.info("VERDICT: PASS");
}

try {
  if (process.argv.includes(SERVER_ROUTE_PROBE_FLAG)) {
    await verifyServerRouteProbe();
  } else {
    await verify();
  }
} catch (error) {
  console.error(error);
  console.error("VERDICT: FAIL");
  process.exitCode = 1;
}
