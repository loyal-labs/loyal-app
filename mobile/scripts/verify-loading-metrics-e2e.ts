import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  accessSync,
  constants,
  createWriteStream,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  MOBILE_LOADING_METRIC_NAME,
  MOBILE_LOADING_OPERATIONS,
  parseMobileLoadingMetricEnvelope,
  type MobileLoadingMetricEnvelope,
} from "../src/services/loading-metrics-contract";

const CLICKSTACK_PORT = Number(
  process.env.MOBILE_METRICS_CLICKSTACK_PORT ?? "18123"
);
const RELAY_PORT = Number(process.env.MOBILE_METRICS_RELAY_PORT ?? "4319");
const METRO_PORT = Number(process.env.MOBILE_METRICS_METRO_PORT ?? "8081");
const CLICKSTACK_IMAGE =
  process.env.MOBILE_METRICS_CLICKSTACK_IMAGE ??
  "loyal-clickstack:mobile-metrics-e2e";
const CLICKSTACK_CONTAINER = `loyal-mobile-metrics-e2e-${process.pid}`;
const CLICKSTACK_CONTEXT = resolve(
  process.env.MOBILE_METRICS_CLICKSTACK_CONTEXT ??
    resolve(import.meta.dir, "../../observability")
);
const CLICKSTACK_INGESTION_KEY = "local-mobile-metrics-e2e-ingestion";
const APP_PACKAGE = "com.loyal.app.dev";
const DEV_CLIENT_SCHEME = "exp+loyal-app";
const AVD_NAME = process.env.MOBILE_METRICS_AVD ?? "SkyVerse_API_35";
const configuredWalletKeyPath = process.env.MOBILE_E2E_WALLET_KEYPAIR;
const walletKeyPath = configuredWalletKeyPath
  ? resolve(configuredWalletKeyPath)
  : null;
const timeoutMs = Number(process.env.MOBILE_METRICS_TIMEOUT_MS ?? "1200000");
const relayOnly = process.argv.includes("--relay-only");
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E2E_STAGE_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;

const requiredCompletedOperations = [
  "app_load",
  "earn.deposit",
  "earn.withdrawal",
  "earn.autodeposit.setup",
  "earn.autodeposit.floor_update",
  "earn.autodeposit.pause",
  "earn.autodeposit.resume",
  "earn.autodeposit.close",
] as const;
const requiredTerminalOperations = [
  ...requiredCompletedOperations,
  "earn.autodeposit.execute_now",
] as const;

type E2eState = "idle" | "running" | "completed" | "failed";

const tempRoot = mkdtempSync(join(tmpdir(), "loyal-mobile-metrics-e2e-"));
const logPath = join(tempRoot, "verifier.log");
const log = createWriteStream(logPath, { flags: "a" });
const children: ChildProcess[] = [];
let emulatorStarted = false;
let emulatorSerial: string | null = null;
let clickstackStarted = false;
let e2eState: E2eState = "idle";
let e2eErrorName: string | null = null;
let e2eErrorMessage: string | null = null;
let e2eStage = "boot";
const resources: { relay: ReturnType<typeof Bun.serve> | null } = {
  relay: null,
};

function pass(message: string): void {
  console.info(`PASS: ${message}`);
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean } = {}
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? resolve(import.meta.dir, ".."),
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.quiet ? "pipe" : ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    if (options.quiet && result.stderr) log.write(result.stderr);
    throw new Error(`${command} exited with status ${String(result.status)}.`);
  }
  return options.quiet ? result.stdout.trim() : "";
}

function start(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd ?? resolve(import.meta.dir, ".."),
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  children.push(child);
  return child;
}

async function waitFor<T>(
  description: string,
  predicate: () => T | false | Promise<T | false>,
  limitMs = 60_000
): Promise<T> {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function queryClickStack(query: string): string {
  return run(
    "podman",
    ["exec", CLICKSTACK_CONTAINER, "clickhouse-client", "--query", query],
    { quiet: true }
  );
}

function queryUnexpectedAttributeCount(): string {
  return queryClickStack(`
    SELECT count()
    FROM default.otel_metrics_gauge
    WHERE MetricName = '${MOBILE_LOADING_METRIC_NAME}'
      AND (
        arrayExists(
          key -> NOT has([
            'loyal.operation',
            'loyal.phase',
            'loyal.outcome',
            'url.path',
            'loyal.app_session.id',
            'loyal.platform',
            'loyal.flow.id'
          ], key),
          mapKeys(Attributes)
        )
        OR arrayExists(
          key -> NOT has([
            'service.name',
            'service.version',
            'deployment.environment.name'
          ], key),
          mapKeys(ResourceAttributes)
        )
      )
    FORMAT TabSeparatedRaw
  `);
}

function stringAttribute(key: string, value: string) {
  return { key, value: { stringValue: value } };
}

function buildOtlpMetricPayload(metric: MobileLoadingMetricEnvelope): unknown {
  const attributes = [
    stringAttribute("loyal.operation", metric.operation),
    stringAttribute("loyal.phase", metric.phase),
    stringAttribute("loyal.outcome", metric.outcome),
    stringAttribute("url.path", metric.pathname),
    stringAttribute("loyal.app_session.id", metric.appSessionId),
    stringAttribute("loyal.platform", metric.platform),
  ];
  if (metric.flowId) {
    attributes.push(stringAttribute("loyal.flow.id", metric.flowId));
  }
  const timeUnixNano = (
    BigInt(Date.parse(metric.timestamp)) * BigInt(1_000_000)
  ).toString();
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            stringAttribute("service.name", "loyal-mobile"),
            stringAttribute("service.version", metric.release),
            stringAttribute("deployment.environment.name", metric.environment),
          ],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                description: "Loyal mobile loading duration in milliseconds.",
                gauge: {
                  dataPoints: [
                    {
                      asDouble: metric.durationMs,
                      attributes,
                      timeUnixNano,
                    },
                  ],
                },
                name: metric.metricName,
                unit: "ms",
              },
            ],
            scope: { name: "loyal.mobile.loading", version: "1" },
          },
        ],
      },
    ],
  };
}

async function exportMetricToClickStack(
  metric: MobileLoadingMetricEnvelope
): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${CLICKSTACK_PORT}/v1/metrics`,
    {
      body: JSON.stringify(buildOtlpMetricPayload(metric)),
      headers: {
        authorization: CLICKSTACK_INGESTION_KEY,
        "content-type": "application/json",
      },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw new Error(`ClickStack rejected OTLP metrics (${response.status}).`);
  }
}

function findEmulatorBinary(): string {
  const candidates = [
    process.env.ANDROID_HOME
      ? join(process.env.ANDROID_HOME, "emulator/emulator")
      : null,
    "/opt/homebrew/share/android-commandlinetools/emulator/emulator",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known SDK location.
    }
  }
  throw new Error("Android emulator binary not found.");
}

function connectedEmulator(): string | null {
  const output = run("adb", ["devices"], { quiet: true });
  for (const line of output.split("\n").slice(1)) {
    const [serial, state] = line.trim().split(/\s+/, 2);
    if (serial?.startsWith("emulator-") && state === "device") return serial;
  }
  return null;
}

async function ensureEmulator(): Promise<string> {
  const existing = connectedEmulator();
  if (existing) return existing;
  const emulator = findEmulatorBinary();
  start(emulator, [
    "-avd",
    AVD_NAME,
    "-no-window",
    "-no-audio",
    "-no-boot-anim",
    "-gpu",
    "swiftshader_indirect",
  ]);
  emulatorStarted = true;
  await waitFor("ADB emulator", () => connectedEmulator() !== null, 180_000);
  const serial = connectedEmulator();
  assert.ok(serial);
  await waitFor(
    "Android boot completion",
    () =>
      run("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"], {
        quiet: true,
      }) === "1",
    180_000
  );
  return serial;
}

function verifierEnv(): NodeJS.ProcessEnv {
  const androidSdkRoot =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    "/opt/homebrew/share/android-commandlinetools";
  const javaHome =
    process.env.JAVA_HOME ??
    "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home";
  return {
    ...process.env,
    ANDROID_HOME: androidSdkRoot,
    ANDROID_SDK_ROOT: androidSdkRoot,
    JAVA_HOME: javaHome,
    APP_VARIANT: "development",
    EXPO_PUBLIC_E2E_DEPOSIT_USD:
      process.env.EXPO_PUBLIC_E2E_DEPOSIT_USD ?? "0.01",
    EXPO_PUBLIC_E2E_METRICS: "true",
    EXPO_PUBLIC_OBSERVABILITY_BASE_URL: `http://127.0.0.1:${RELAY_PORT}`,
    EXPO_PUBLIC_SOLANA_ENV: process.env.EXPO_PUBLIC_SOLANA_ENV ?? "mainnet",
  };
}

async function main(): Promise<void> {
  if (!relayOnly) {
    if (!walletKeyPath) {
      throw new Error(
        "Set MOBILE_E2E_WALLET_KEYPAIR to an explicitly approved test keypair."
      );
    }
    accessSync(walletKeyPath, constants.R_OK);
  }
  assert.deepEqual(MOBILE_LOADING_OPERATIONS, [
    "app_load",
    "earn.deposit",
    "earn.withdrawal",
    "earn.refund",
    "earn.autodeposit.setup",
    "earn.autodeposit.floor_update",
    "earn.autodeposit.pause",
    "earn.autodeposit.resume",
    "earn.autodeposit.close",
    "earn.autodeposit.execute_now",
  ]);
  const contractSample = {
    appSessionId: "123e4567-e89b-42d3-a456-426614174001",
    durationMs: 100,
    environment: "dev",
    flowId: "123e4567-e89b-42d3-a456-426614174000",
    metricName: MOBILE_LOADING_METRIC_NAME,
    operation: "earn.deposit",
    outcome: "completed",
    pathname: "/",
    phase: "interaction_to_ui",
    platform: "android",
    release: "dev",
    timestamp: new Date().toISOString(),
  } as const;
  assert.equal(
    parseMobileLoadingMetricEnvelope(contractSample).operation,
    "earn.deposit"
  );
  assert.throws(() =>
    parseMobileLoadingMetricEnvelope({
      ...contractSample,
      walletAddress: "forbidden",
    })
  );
  pass("strict mobile metric contract rejects financial and arbitrary context");

  const imageExists = spawnSync(
    "podman",
    ["image", "exists", CLICKSTACK_IMAGE],
    { stdio: "ignore" }
  );
  if (imageExists.status !== 0) {
    try {
      accessSync(join(CLICKSTACK_CONTEXT, "Dockerfile"), constants.R_OK);
    } catch {
      throw new Error(
        "ClickStack image is absent and its build context was not found. " +
          "Set MOBILE_METRICS_CLICKSTACK_CONTEXT to this repository's observability directory."
      );
    }
    run("podman", ["build", "--tag", CLICKSTACK_IMAGE, CLICKSTACK_CONTEXT]);
  }
  run("podman", [
    "run",
    "--detach",
    "--rm",
    "--name",
    CLICKSTACK_CONTAINER,
    "--publish",
    `127.0.0.1:${String(CLICKSTACK_PORT)}:8080`,
    "--env",
    "PORT=8080",
    "--env",
    "EXPRESS_SESSION_SECRET=local-mobile-metrics-e2e-session",
    "--env",
    `INGESTION_API_KEY=${CLICKSTACK_INGESTION_KEY}`,
    "--env",
    "CLICKSTACK_INTERNAL_SMOKE_ENABLED=true",
    "--env",
    "USAGE_STATS_ENABLED=false",
    CLICKSTACK_IMAGE,
  ]);
  clickstackStarted = true;
  await waitFor(
    "local ClickStack",
    async () => {
      try {
        const response = await fetch(
          `http://127.0.0.1:${CLICKSTACK_PORT}/api/health`
        );
        return response.ok;
      } catch {
        return false;
      }
    },
    180_000
  );
  const registration = await fetch(
    `http://127.0.0.1:${CLICKSTACK_PORT}/api/register/password`,
    {
      body: JSON.stringify({
        confirmPassword: "Local-mobile-metrics-e2e-2026!",
        email: `mobile-metrics-${process.pid}@example.invalid`,
        password: "Local-mobile-metrics-e2e-2026!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }
  );
  if (!registration.ok) {
    throw new Error(
      `ClickStack team bootstrap failed (${registration.status}).`
    );
  }
  await waitFor(
    "ClickStack authenticated collector",
    () => {
      const output = run(
        "podman",
        ["logs", "--tail", "300", CLICKSTACK_CONTAINER],
        { quiet: true }
      );
      return output.includes('"status":"pass","stage":"initial"');
    },
    240_000
  );

  resources.relay = Bun.serve({
    hostname: "127.0.0.1",
    port: RELAY_PORT,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method !== "POST") return new Response(null, { status: 405 });
      if (url.pathname === "/api/observability/mobile/metrics") {
        try {
          const metric = parseMobileLoadingMetricEnvelope(await request.json());
          await exportMetricToClickStack(metric);
          return Response.json({ accepted: true }, { status: 202 });
        } catch {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }
      }
      if (url.pathname === "/e2e/status") {
        const status = (await request.json()) as {
          errorMessage?: unknown;
          errorName?: unknown;
          stage?: unknown;
          state?: unknown;
        };
        if (
          status.state === "running" ||
          status.state === "completed" ||
          status.state === "failed"
        ) {
          e2eState = status.state;
          e2eErrorName =
            typeof status.errorName === "string" ? status.errorName : null;
          e2eErrorMessage =
            typeof status.errorMessage === "string" &&
            status.errorMessage.length <= 240 &&
            !/[\u0000-\u001f\u007f]/.test(status.errorMessage)
              ? status.errorMessage
              : null;
          if (
            typeof status.stage === "string" &&
            E2E_STAGE_PATTERN.test(status.stage) &&
            status.stage !== e2eStage
          ) {
            e2eStage = status.stage;
            console.info(`E2E stage: ${e2eStage}`);
          }
          return Response.json({ accepted: true }, { status: 202 });
        }
        return Response.json({ error: "invalid_request" }, { status: 400 });
      }
      return new Response(null, { status: 404 });
    },
  });
  pass("disposable ClickStack and strict local native relay started");

  if (relayOnly) {
    const response = await fetch(
      `http://127.0.0.1:${RELAY_PORT}/api/observability/mobile/metrics`,
      {
        body: JSON.stringify({
          ...contractSample,
          flowId: undefined,
          operation: "app_load",
          phase: "app_ready",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );
    assert.equal(response.status, 202);
    const count = await waitFor(
      "relay-only metric in ClickStack",
      () => {
        const output = queryClickStack(
          `SELECT count() FROM default.otel_metrics_gauge WHERE MetricName = '${MOBILE_LOADING_METRIC_NAME}' AND Attributes['loyal.operation'] = 'app_load' FORMAT TSVRaw`
        );
        return Number(output) > 0 ? output : false;
      },
      120_000
    );
    pass(
      `native relay returned 202 and ClickStack persisted ${count} metric row(s)`
    );
    const stored = JSON.parse(
      queryClickStack(`
        SELECT
          Attributes['loyal.phase'] AS phase,
          Attributes['loyal.flow.id'] AS flowId,
          Attributes['loyal.platform'] AS platform,
          ResourceAttributes['service.name'] AS serviceName
        FROM default.otel_metrics_gauge
        WHERE MetricName = '${MOBILE_LOADING_METRIC_NAME}'
          AND Attributes['loyal.operation'] = 'app_load'
        LIMIT 1
        FORMAT JSONEachRow
      `)
    ) as Record<string, unknown>;
    assert.deepEqual(stored, {
      flowId: "",
      phase: "app_ready",
      platform: "android",
      serviceName: "loyal-mobile",
    });
    assert.equal(queryUnexpectedAttributeCount().trim(), "0");
    pass("stored relay-only row matches the strict attribute allowlist");
    return;
  }

  assert.ok(walletKeyPath);
  const serial = await ensureEmulator();
  emulatorSerial = serial;
  pass(`Android emulator ${AVD_NAME} is ready`);

  const androidRoot = resolve(import.meta.dir, "../android");
  const debugApk = join(
    androidRoot,
    "app/build/outputs/apk/debug/app-debug.apk"
  );
  run("./gradlew", ["app:assembleDebug"], {
    cwd: androidRoot,
    env: verifierEnv(),
  });
  run("adb", ["-s", serial, "install", "-r", debugApk], { quiet: true });
  run("adb", ["-s", serial, "shell", "pm", "clear", APP_PACKAGE], {
    quiet: true,
  });
  run("adb", ["-s", serial, "shell", "am", "force-stop", APP_PACKAGE], {
    quiet: true,
  });
  run(
    "adb",
    [
      "-s",
      serial,
      "push",
      walletKeyPath,
      "/data/local/tmp/loyal-metrics-e2e-wallet.json",
    ],
    { quiet: true }
  );
  try {
    run(
      "adb",
      ["-s", serial, "shell", "run-as", APP_PACKAGE, "mkdir", "-p", "files"],
      { quiet: true }
    );
    run(
      "adb",
      [
        "-s",
        serial,
        "shell",
        "run-as",
        APP_PACKAGE,
        "cp",
        "/data/local/tmp/loyal-metrics-e2e-wallet.json",
        "files/loyal-metrics-e2e-wallet.json",
      ],
      { quiet: true }
    );
  } finally {
    spawnSync(
      "adb",
      [
        "-s",
        serial,
        "shell",
        "rm",
        "-f",
        "/data/local/tmp/loyal-metrics-e2e-wallet.json",
      ],
      { stdio: "ignore" }
    );
  }
  run(
    "adb",
    [
      "-s",
      serial,
      "reverse",
      `tcp:${String(METRO_PORT)}`,
      `tcp:${String(METRO_PORT)}`,
    ],
    {
      quiet: true,
    }
  );
  run(
    "adb",
    [
      "-s",
      serial,
      "reverse",
      `tcp:${String(RELAY_PORT)}`,
      `tcp:${String(RELAY_PORT)}`,
    ],
    { quiet: true }
  );

  const metro = start(
    "npx",
    [
      "expo",
      "start",
      "--dev-client",
      "--localhost",
      "--clear",
      "--port",
      String(METRO_PORT),
    ],
    { env: verifierEnv() }
  );
  await waitFor(
    "Metro",
    async () => {
      if (metro.exitCode !== null)
        throw new Error("Metro exited during startup.");
      try {
        const response = await fetch(`http://127.0.0.1:${METRO_PORT}/status`);
        return response.ok;
      } catch {
        return false;
      }
    },
    180_000
  );
  const devClientUrl = `${DEV_CLIENT_SCHEME}://expo-development-client/?url=${encodeURIComponent(
    `http://127.0.0.1:${METRO_PORT}`
  )}`;
  run(
    "adb",
    [
      "-s",
      serial,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      devClientUrl,
      APP_PACKAGE,
    ],
    { quiet: true }
  );

  await waitFor(
    "the in-app Earn action sequence",
    () => {
      if (e2eState === "failed") {
        throw new Error(
          `The in-app verifier failed (${
            e2eErrorName ?? "UnknownError"
          }) at ${e2eStage}${e2eErrorMessage ? `: ${e2eErrorMessage}` : "."}`
        );
      }
      return e2eState === "completed";
    },
    timeoutMs
  );

  const rows = (
    await waitFor(
      "required mobile metrics in ClickStack",
      () => {
        const output = queryClickStack(`
      SELECT
        Attributes['loyal.operation'] AS operation,
        Attributes['loyal.outcome'] AS outcome,
        Attributes['loyal.phase'] AS phase,
        Attributes['loyal.app_session.id'] AS appSessionId,
        Attributes['loyal.flow.id'] AS flowId,
        Attributes['loyal.platform'] AS platform,
        ResourceAttributes['service.name'] AS serviceName,
        count() AS observations,
        round(min(Value), 3) AS minDurationMs,
        round(max(Value), 3) AS maxDurationMs
      FROM default.otel_metrics_gauge
      WHERE MetricName = '${MOBILE_LOADING_METRIC_NAME}'
      GROUP BY operation, outcome, phase, appSessionId, flowId, platform, serviceName
      ORDER BY operation, outcome, flowId
      FORMAT JSONEachRow
    `);
        const terminal = new Set(
          output
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>)
            .filter(
              (row) => row.outcome === "completed" || row.outcome === "failed"
            )
            .map((row) => String(row.operation))
        );
        return requiredTerminalOperations.every((operation) =>
          terminal.has(operation)
        )
          ? output
          : false;
      },
      120_000
    )
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const completed = new Set(
    rows
      .filter((row) => row.outcome === "completed")
      .map((row) => String(row.operation))
  );
  for (const operation of requiredCompletedOperations) {
    assert.ok(
      completed.has(operation),
      `missing completed metric: ${operation}`
    );
  }
  const executeNowRows = rows.filter(
    (row) => row.operation === "earn.autodeposit.execute_now"
  );
  assert.ok(
    executeNowRows.some(
      (row) => row.outcome === "completed" || row.outcome === "failed"
    ),
    "missing terminal metric: earn.autodeposit.execute_now"
  );
  const terminalRows = rows.filter(
    (row) => row.outcome === "completed" || row.outcome === "failed"
  );
  const appSessionIds = new Set(
    terminalRows.map((row) => String(row.appSessionId))
  );
  assert.equal(appSessionIds.size, 1);
  assert.match([...appSessionIds][0] ?? "", UUID_V4_PATTERN);
  for (const row of terminalRows) {
    const operation = String(row.operation);
    assert.equal(row.platform, "android");
    assert.equal(row.serviceName, "loyal-mobile");
    assert.equal(typeof row.minDurationMs, "number");
    assert.ok(Number(row.minDurationMs) >= 0);
    if (operation === "app_load") {
      assert.equal(row.phase, "app_ready");
      assert.equal(row.flowId, "");
    } else {
      assert.equal(row.phase, "interaction_to_ui");
      assert.match(String(row.flowId), UUID_V4_PATTERN);
    }
  }
  const forbidden = queryUnexpectedAttributeCount();
  assert.equal(forbidden.trim(), "0");
  pass(
    "emulator completed deposit, Autodeposit policy lifecycle, withdrawal, close, and cleanup actions"
  );
  pass(
    `execute-now reached a persisted terminal metric (${executeNowRows
      .map((row) => String(row.outcome))
      .join(", ")})`
  );
  pass(
    "every required duration metric is queryable from the local ClickStack database"
  );
  pass(
    "stored metric and resource dimensions match the strict privacy allowlist"
  );
  console.table(rows);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Verifier logs: ${logPath}`);
  process.exitCode = 1;
} finally {
  resources.relay?.stop(true);
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  if (emulatorSerial) {
    spawnSync(
      "adb",
      [
        "-s",
        emulatorSerial,
        "shell",
        "run-as",
        APP_PACKAGE,
        "rm",
        "-f",
        "files/loyal-metrics-e2e-wallet.json",
      ],
      { stdio: "ignore" }
    );
    spawnSync(
      "adb",
      [
        "-s",
        emulatorSerial,
        "shell",
        "rm",
        "-f",
        "/data/local/tmp/loyal-metrics-e2e-wallet.json",
      ],
      { stdio: "ignore" }
    );
  }
  if (emulatorStarted) {
    spawnSync("adb", ["emu", "kill"], { stdio: "ignore" });
  }
  if (clickstackStarted) {
    spawnSync("podman", ["rm", "--force", CLICKSTACK_CONTAINER], {
      stdio: "ignore",
    });
  }
  log.end();
  if (process.exitCode !== 1)
    rmSync(tempRoot, { recursive: true, force: true });
}
