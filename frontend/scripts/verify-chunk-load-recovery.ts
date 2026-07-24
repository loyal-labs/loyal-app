import assert from "node:assert/strict";

const CLIENT_BUILD_ID = "clientabc123";
const CHUNK_URL =
  "https://askloyal.com/_next/static/chunks/app/global-error-3a07882f87777428.js";
const PAGE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

async function verify(): Promise<void> {
  process.env.NEXT_PUBLIC_GIT_COMMIT_HASH = CLIENT_BUILD_ID;

  const calls: string[] = [];
  const postedBodies: unknown[] = [];
  const sessionStorage = new MemoryStorage();
  const listeners = new Map<string, (event: unknown) => void>();
  let activeStorage: StorageLike = sessionStorage;

  const verifierWindow = {
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      listeners.set(name, listener);
    },
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    crypto: globalThis.crypto,
    document: { visibilityState: "visible" },
    location: {
      origin: "https://askloyal.com",
      pathname: "/",
      reload: () => {
        calls.push("reload");
      },
    },
    navigator: {
      connection: {
        downlink: 4.25,
        effectiveType: "4g",
        rtt: 80,
        saveData: false,
      },
      onLine: true,
    },
    performance: {
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
    },
    get sessionStorage() {
      return activeStorage;
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: verifierWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: verifierWindow.document,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: verifierWindow.navigator,
  });
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: verifierWindow.performance,
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: unknown, init?: { body?: unknown }) => {
      calls.push("report");
      postedBodies.push(JSON.parse(String(init?.body)) as unknown);
      return new Response(null, { status: 202 });
    },
  });

  const client = await import("../src/features/observability/client");
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
    "Loading chunk 4219 failed.\n" +
      "(error: https://cdn.example.test/_next/static/chunks/4219.js)"
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

  // A hard reload creates a fresh in-memory processor, but sessionStorage
  // survives. This models the same browser tab after the recovery reload.
  const reloadedDocumentProcessor = client.createBrowserErrorProcessor();
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
  pass(
    "repeat failure in the same page session remains observable without another reload"
  );

  activeStorage = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };
  const storageFailureProcessor = client.createBrowserErrorProcessor();
  await storageFailureProcessor.process(
    chunkError,
    "browser.unhandled_rejection"
  );
  assert.equal(calls.filter((call) => call === "reload").length, 1);
  assert.equal(postedBodies.length, 3);

  activeStorage = {
    getItem: () => null,
    setItem: () => undefined,
  };
  await client
    .createBrowserErrorProcessor()
    .process(chunkError, "browser.unhandled_rejection");
  assert.equal(calls.filter((call) => call === "reload").length, 1);
  assert.equal(postedBodies.length, 4);
  pass(
    "reload recovery fails closed when its persistent guard throws or cannot retain writes"
  );

  activeStorage = sessionStorage;
  const ordinaryError = new Error("ordinary application failure");
  const ordinaryProcessor = client.createBrowserErrorProcessor();
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

  const parsed = errorContract.parseBrowserErrorEnvelope(firstEnvelope);
  assert.deepEqual(parsed, firstEnvelope);

  assert.throws(
    () =>
      errorContract.parseBrowserErrorEnvelope({
        ...firstEnvelope,
        pageSessionId: "not-a-random-session-id",
      }),
    /Invalid observability error envelope/
  );
  assert.throws(
    () =>
      errorContract.parseBrowserErrorEnvelope({
        ...firstEnvelope,
        diagnostics: {
          ...(firstEnvelope.diagnostics as Record<string, unknown>),
          resourceTransferSize: Number.MAX_SAFE_INTEGER,
        },
      }),
    /Invalid observability error envelope/
  );
  assert.throws(
    () =>
      errorContract.parseBrowserErrorEnvelope({
        ...firstEnvelope,
        diagnostics: {
          ...(firstEnvelope.diagnostics as Record<string, unknown>),
          secretContext: "must-not-pass",
        },
      }),
    /Invalid observability error envelope/
  );
  pass(
    "untrusted session and diagnostic fields are strictly validated and bounded"
  );

  const normalized = errorContract.createNormalizedBrowserErrorEvent(parsed, {
    deploymentEnvironment: "production",
    ingestRelease: "serverdef456",
  });
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
  const parsedLegacy = errorContract.parseBrowserErrorEnvelope(legacyEnvelope);
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
  await verify();
} catch (error) {
  console.error(error);
  console.error("VERDICT: FAIL");
  process.exitCode = 1;
}
