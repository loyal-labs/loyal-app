import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLIENT_BUILD_ID = "clientabc123";
const SERVER_ROUTE_PROBE_FLAG = "--server-route-probe";
const FIRST_PARTY_ORIGIN = "https://askloyal.com";
const CHUNK_URL =
  "https://askloyal.com/_next/static/chunks/app/global-error-3a07882f87777428.js";
const EXTERNAL_CHUNK_URL =
  "https://cdn.example.test/_next/static/chunks/4219.js";
const PREVIEW_ORIGIN = "https://preview.example.test";
const PREVIEW_CHUNK_URL = `${PREVIEW_ORIGIN}/_next/static/chunks/4219.js`;
const FIRST_PAGE_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_PAGE_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_PAGE_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const PAGE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ClientModule = typeof import("../src/features/observability/client");

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

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

function installBrowserDocument(options: {
  calls: string[];
  postedBodies: unknown[];
  randomUUID: string;
  storage: StorageLike;
}): void {
  const document = { visibilityState: "visible" };
  const navigator = {
    connection: {
      downlink: 4.25,
      effectiveType: "4g",
      rtt: 80,
      saveData: false,
    },
    onLine: true,
  };
  const performance = {
    getEntriesByName: (name: string) =>
      name === CHUNK_URL
        ? [
            {
              decodedBodySize: 20_480,
              duration: 142.5,
              encodedBodySize: 10_240,
              name,
              responseStatus: 504,
              transferSize: 10_540,
            },
          ]
        : [],
  };
  const verifierWindow = {
    addEventListener: () => undefined,
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    crypto: {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto
      ),
      randomUUID: () => options.randomUUID,
    },
    document,
    location: {
      origin: FIRST_PARTY_ORIGIN,
      pathname: "/",
      reload: () => {
        options.calls.push("reload");
      },
    },
    navigator,
    performance,
    sessionStorage: options.storage,
    setTimeout: globalThis.setTimeout.bind(globalThis),
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: verifierWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigator,
  });
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: performance,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: unknown, init?: { body?: unknown }) => {
      options.calls.push("report");
      options.postedBodies.push(JSON.parse(String(init?.body)) as unknown);
      return new Response(null, { status: 202 });
    },
  });
}

async function verifyServerRouteProbe(): Promise<void> {
  process.env.OBSERVABILITY_INGESTION_API_KEY = "";
  process.env.OBSERVABILITY_OTLP_ENDPOINT = "";
  const { POST } = await import("../src/app/api/observability/errors/route");
  const baseEnvelope = {
    clientBuildId: CLIENT_BUILD_ID,
    diagnostics: {
      chunkUrl: PREVIEW_CHUNK_URL,
      networkOnline: true,
    },
    message: "Loading chunk 4219 failed.",
    name: "ChunkLoadError",
    operation: "browser.unhandled_rejection",
    pageSessionId: FIRST_PAGE_SESSION_ID,
    pathname: "/",
    timestamp: new Date().toISOString(),
  };
  const postEnvelope = (origin: string, envelope: unknown) =>
    POST(
      new Request(`${origin}/api/observability/errors`, {
        body: JSON.stringify(envelope),
        headers: {
          "content-type": "application/json",
          origin,
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      })
    );

  const firstPartyResponse = await postEnvelope(PREVIEW_ORIGIN, baseEnvelope);
  assert.equal(firstPartyResponse.status, 202);
  const externalResponse = await postEnvelope(FIRST_PARTY_ORIGIN, {
    ...baseEnvelope,
    diagnostics: {
      ...baseEnvelope.diagnostics,
      chunkUrl: EXTERNAL_CHUNK_URL,
    },
  });
  assert.equal(externalResponse.status, 400);
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
  process.env.NEXT_PUBLIC_GIT_COMMIT_HASH = CLIENT_BUILD_ID;

  const calls: string[] = [];
  const postedBodies: unknown[] = [];
  const sessionStorage = new MemoryStorage();
  installBrowserDocument({
    calls,
    postedBodies,
    randomUUID: FIRST_PAGE_SESSION_ID,
    storage: sessionStorage,
  });

  const client = (await import(
    // @ts-ignore -- Bun keys static resource queries as separate modules.
    "../src/features/observability/client?verifierDocument=first"
  )) as ClientModule;
  const errorContract = await import(
    "../src/features/observability/error-contract"
  );
  const { buildOtlpErrorPayload } = await import(
    "../src/features/observability/otlp"
  );

  assert.equal(
    typeof client.createBrowserErrorProcessor,
    "function",
    "browser error processor is missing"
  );
  assert.equal(
    typeof errorContract.createNormalizedBrowserErrorEvent,
    "function",
    "browser-to-OTLP normalization is missing"
  );

  const chunkError = new Error(
    `Loading chunk 4219 failed.\n(error: ${CHUNK_URL})`
  );
  chunkError.name = "ChunkLoadError";

  const externalChunkError = new Error(
    `Loading chunk 4219 failed.\n(error: ${EXTERNAL_CHUNK_URL})`
  );
  externalChunkError.name = "ChunkLoadError";
  await client
    .createBrowserErrorProcessor()
    .process(externalChunkError, "browser.unhandled_rejection");
  assert.deepEqual(calls, ["report"]);
  assert.equal(
    (postedBodies[0] as Record<string, unknown>).diagnostics,
    undefined
  );
  calls.length = 0;
  postedBodies.length = 0;
  pass("cross-origin errors cannot claim first-party chunk recovery");

  const firstDocumentProcessor = client.createBrowserErrorProcessor();
  await firstDocumentProcessor.process(
    chunkError,
    "browser.unhandled_rejection"
  );

  assert.deepEqual(calls, ["report", "reload"]);
  assert.equal(postedBodies.length, 1);
  const firstEnvelope = postedBodies[0] as Record<string, unknown>;
  assert.equal(firstEnvelope.clientBuildId, CLIENT_BUILD_ID);
  assert.match(String(firstEnvelope.pageSessionId), PAGE_SESSION_ID_PATTERN);
  assert.equal(firstEnvelope.pageSessionId, FIRST_PAGE_SESSION_ID);
  assert.deepEqual(firstEnvelope.diagnostics, {
    chunkUrl: CHUNK_URL,
    connectionDownlinkMbps: 4.25,
    connectionEffectiveType: "4g",
    connectionRttMs: 80,
    connectionSaveData: false,
    documentVisibilityState: "visible",
    networkOnline: true,
    resourceDecodedBodySize: 20_480,
    resourceDurationMs: 142.5,
    resourceEncodedBodySize: 10_240,
    resourceResponseStatus: 504,
    resourceTransferSize: 10_540,
  });
  pass("first-party ChunkLoadError is reported before one hard reload");
  pass(
    "client build, random page session, network, and resource diagnostics are captured"
  );

  // A hard reload replaces both the document globals and the client module.
  // Only sessionStorage survives. The second random UUID is deliberately
  // different so this equality fails if the stored ID cannot be recovered.
  installBrowserDocument({
    calls,
    postedBodies,
    randomUUID: SECOND_PAGE_SESSION_ID,
    storage: sessionStorage,
  });
  const reloadedClient = (await import(
    // @ts-ignore -- This must be a fresh module after the simulated reload.
    "../src/features/observability/client?verifierDocument=reloaded"
  )) as ClientModule;
  assert.notEqual(
    reloadedClient.createBrowserErrorProcessor,
    client.createBrowserErrorProcessor,
    "cache-busted import did not create a fresh client module"
  );
  const reloadedDocumentProcessor =
    reloadedClient.createBrowserErrorProcessor();
  await reloadedDocumentProcessor.process(
    chunkError,
    "browser.unhandled_rejection"
  );
  assert.deepEqual(calls, ["report", "reload", "report"]);
  assert.equal(postedBodies.length, 2);
  assert.equal(
    (postedBodies[1] as Record<string, unknown>).pageSessionId,
    firstEnvelope.pageSessionId
  );
  assert.notEqual(
    (postedBodies[1] as Record<string, unknown>).pageSessionId,
    SECOND_PAGE_SESSION_ID
  );
  pass(
    "fresh module and document recover the stored page session without another reload"
  );

  const throwingStorage: StorageLike = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };
  installBrowserDocument({
    calls,
    postedBodies,
    randomUUID: THIRD_PAGE_SESSION_ID,
    storage: throwingStorage,
  });
  const storageFailureClient = (await import(
    // @ts-ignore -- Isolate module state for the storage-failure document.
    "../src/features/observability/client?verifierDocument=storage-failure"
  )) as ClientModule;
  const storageFailureProcessor =
    storageFailureClient.createBrowserErrorProcessor();
  await storageFailureProcessor.process(
    chunkError,
    "browser.unhandled_rejection"
  );
  assert.equal(calls.filter((call) => call === "reload").length, 1);
  assert.equal(postedBodies.length, 3);

  const nonPersistentStorage: StorageLike = {
    getItem: () => null,
    setItem: () => undefined,
  };
  installBrowserDocument({
    calls,
    postedBodies,
    randomUUID: THIRD_PAGE_SESSION_ID,
    storage: nonPersistentStorage,
  });
  const nonPersistentClient = (await import(
    // @ts-ignore -- Isolate module state for the non-persistent document.
    "../src/features/observability/client?verifierDocument=no-retention"
  )) as ClientModule;
  await nonPersistentClient
    .createBrowserErrorProcessor()
    .process(chunkError, "browser.unhandled_rejection");
  assert.equal(calls.filter((call) => call === "reload").length, 1);
  assert.equal(postedBodies.length, 4);
  pass(
    "reload recovery fails closed when its persistent guard throws or cannot retain writes"
  );

  installBrowserDocument({
    calls,
    postedBodies,
    randomUUID: SECOND_PAGE_SESSION_ID,
    storage: sessionStorage,
  });
  const ordinaryClient = (await import(
    // @ts-ignore -- Isolate module state for the ordinary-error document.
    "../src/features/observability/client?verifierDocument=ordinary"
  )) as ClientModule;
  const ordinaryError = new Error("ordinary application failure");
  const ordinaryProcessor = ordinaryClient.createBrowserErrorProcessor();
  await ordinaryProcessor.process(ordinaryError, "browser.window.error");
  assert.equal(calls.filter((call) => call === "reload").length, 1);
  assert.equal(postedBodies.length, 5);

  const extensionError = new Error("extension-only failure");
  extensionError.stack =
    "Error: extension-only failure\n" +
    "    at run (chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/inpage.js:1:1)";
  await ordinaryProcessor.process(extensionError, "browser.window.error");
  assert.equal(postedBodies.length, 5);
  assert.equal(calls.filter((call) => call === "reload").length, 1);
  pass(
    "ordinary errors never reload and extension-only ambient errors stay filtered"
  );

  const parseOptions = {
    expectedChunkOrigin: FIRST_PARTY_ORIGIN,
    now: new Date(String(firstEnvelope.timestamp)).getTime(),
  };
  const parsed = errorContract.parseBrowserErrorEnvelope(
    firstEnvelope,
    parseOptions
  );
  assert.deepEqual(parsed, firstEnvelope);

  assert.throws(
    () =>
      errorContract.parseBrowserErrorEnvelope(
        {
          ...firstEnvelope,
          pageSessionId: "not-a-random-session-id",
        },
        parseOptions
      ),
    /Invalid observability error envelope/
  );
  assert.throws(
    () =>
      errorContract.parseBrowserErrorEnvelope(
        {
          ...firstEnvelope,
          diagnostics: {
            ...(firstEnvelope.diagnostics as Record<string, unknown>),
            resourceTransferSize: Number.MAX_SAFE_INTEGER,
          },
        },
        parseOptions
      ),
    /Invalid observability error envelope/
  );
  assert.throws(
    () =>
      errorContract.parseBrowserErrorEnvelope(
        {
          ...firstEnvelope,
          diagnostics: {
            ...(firstEnvelope.diagnostics as Record<string, unknown>),
            secretContext: "must-not-pass",
          },
        },
        parseOptions
      ),
    /Invalid observability error envelope/
  );
  pass(
    "untrusted session and diagnostic fields are strictly validated and bounded"
  );

  const normalizationContext = {
    deploymentEnvironment: "production",
    ingestRelease: "serverdef456",
  };
  assert.throws(
    () =>
      errorContract.createNormalizedBrowserErrorEvent(
        errorContract.parseBrowserErrorEnvelope(
          {
            ...firstEnvelope,
            diagnostics: {
              ...(firstEnvelope.diagnostics as Record<string, unknown>),
              chunkUrl: EXTERNAL_CHUNK_URL,
            },
          },
          parseOptions
        ),
        normalizationContext
      ),
    /Invalid observability error envelope/
  );
  pass("server parser rejects external chunk diagnostics before normalization");

  runServerRouteProbe();
  pass(
    "same-origin relay derives each request origin and rejects external chunk telemetry"
  );

  const normalized = errorContract.createNormalizedBrowserErrorEvent(
    parsed,
    normalizationContext
  );
  assert.equal(normalized.release, CLIENT_BUILD_ID);
  const serializedPayload = JSON.stringify(buildOtlpErrorPayload(normalized));
  for (const expected of [
    `"service.version","value":{"stringValue":"${CLIENT_BUILD_ID}"}`,
    `"loyal.client.build_id","value":{"stringValue":"${CLIENT_BUILD_ID}"}`,
    `"loyal.page_session.id","value":{"stringValue":"${firstEnvelope.pageSessionId}"}`,
    `"loyal.chunk.url","value":{"stringValue":"${CHUNK_URL}"}`,
    '"network.online","value":{"boolValue":true}',
    '"network.connection.effective_type","value":{"stringValue":"4g"}',
    '"network.connection.rtt_ms","value":{"intValue":"80"}',
    '"loyal.resource.response_status","value":{"intValue":"504"}',
    '"loyal.ingest.release","value":{"stringValue":"serverdef456"}',
  ]) {
    assert.ok(
      serializedPayload.includes(expected),
      `OTLP payload lacks ${expected}`
    );
  }
  pass(
    "validated client diagnostics survive server normalization and OTLP mapping"
  );

  const {
    clientBuildId: _clientBuildId,
    diagnostics: _diagnostics,
    pageSessionId: _pageSessionId,
    ...legacyEnvelope
  } = firstEnvelope;
  const parsedLegacy = errorContract.parseBrowserErrorEnvelope(
    legacyEnvelope,
    parseOptions
  );
  const normalizedLegacy = errorContract.createNormalizedBrowserErrorEvent(
    parsedLegacy,
    {
      deploymentEnvironment: "production",
      ingestRelease: "serverdef456",
    }
  );
  assert.equal(normalizedLegacy.release, "serverdef456");
  pass("cached pre-fix browser envelopes remain accepted during rollout");

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
