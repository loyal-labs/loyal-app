import assert from "node:assert/strict";
import {
  accessSync,
  constants,
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  buildOtlpLifecyclePayload,
  isAlertableLifecycleEvent,
} from "../../web/src/features/observability/otlp";
import type { NormalizedLifecycleEvent } from "../../web/src/features/observability/lifecycle-contract";

const APP_PACKAGE = "com.loyal.app.dev";
const APP_SCHEME = "loyal-dev";
const DEFAULT_AVD = "SkyVerse_API_35";
const DEFAULT_METRO_PORT = 8082;
const DEFAULT_PROXY_PORT = 4320;
const FIXTURE_PUBLIC_KEY = "11111111111111111111111111111111";
const FIXTURE_ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const NATIVE_MESSAGE = "authorization request failed";
const EXPECTED_MESSAGE =
  "Wallet authorization is no longer valid. Reset your wallet in Settings and reconnect your wallet.";
const UI_XML_PATH = "/sdcard/loyal-mwa-authorization-ui.xml";

type UiNode = {
  bounds: [number, number, number, number];
  contentDescription: string;
  text: string;
};
type LifecycleEvent = {
  flowName?: string;
  stage?: string;
  outcome?: string;
  errorCode?: string;
  errorDetail?: string;
  httpStatus?: number;
  flowId?: string;
  flowVariant?: string;
  durationMs?: number;
  elapsedMs?: number;
  pathname?: string;
  release?: string;
  runtime?: string;
  source?: string;
  timestamp?: string;
  walletAddress?: string;
  [key: string]: unknown;
};

const avdName = process.env.MOBILE_MWA_AUTHORIZATION_AVD ?? DEFAULT_AVD;
const metroPort = Number(
  process.env.MOBILE_MWA_AUTHORIZATION_METRO_PORT ?? DEFAULT_METRO_PORT
);
const proxyPort = Number(
  process.env.MOBILE_MWA_AUTHORIZATION_PROXY_PORT ?? DEFAULT_PROXY_PORT
);
const timeoutMs = Number(
  process.env.MOBILE_MWA_AUTHORIZATION_TIMEOUT_MS ?? "600000"
);
const tempRoot = mkdtempSync(join(tmpdir(), "loyal-mwa-authorization-"));
const processLogPath = join(tempRoot, "processes.log");
const processLog = createWriteStream(processLogPath, { flags: "a" });
const children: ChildProcess[] = [];
const lifecycleEvents: LifecycleEvent[] = [];
let emulatorSerial: string | null = null;
let emulatorStarted = false;
let generatedAndroid = false;
const sourceSnapshots: Array<{ path: string; source: string }> = [];
const moduleBuildPaths = [
  resolve(import.meta.dir, "../modules/expo-seed-vault/android/build"),
  resolve(import.meta.dir, "../modules/expo-synced-keychain/android/build"),
];
const generatedModuleBuildPaths = moduleBuildPaths.filter(
  (path) => !existsSync(path)
);

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean } = {}
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? resolve(import.meta.dir, ".."),
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.quiet ? "pipe" : ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0)
    throw new Error(
      `${command} exited with status ${String(result.status)}${
        options.quiet && result.stderr ? `: ${result.stderr.trim()}` : ""
      }`
    );
  return options.quiet ? result.stdout.trim() : "";
}

function start(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): ChildProcess {
  const child = spawn(command, args, {
    cwd: resolve(import.meta.dir, ".."),
    env: env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(processLog);
  child.stderr?.pipe(processLog);
  children.push(child);
  return child;
}

async function waitFor<T>(
  description: string,
  read: () => T | false | Promise<T | false>,
  limitMs = 120_000
): Promise<T> {
  const deadline = Date.now() + limitMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await read();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(500);
  }
  throw new Error(
    `Timed out waiting for ${description}${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }.`
  );
}

function findExecutable(
  candidates: Array<string | null>,
  label: string
): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error(`${label} executable was not found.`);
}

const androidRoot =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  "/opt/homebrew/share/android-commandlinetools";
const adb = findExecutable(
  [
    join(androidRoot, "platform-tools/adb"),
    "/opt/homebrew/bin/adb",
    "/opt/homebrew/share/android-commandlinetools/platform-tools/adb",
  ],
  "ADB"
);
const emulator = findExecutable(
  [
    join(androidRoot, "emulator/emulator"),
    "/opt/homebrew/share/android-commandlinetools/emulator/emulator",
  ],
  "Android emulator"
);

function adbRun(args: string[], quiet = true): string {
  assert.ok(emulatorSerial, "Emulator serial is unavailable.");
  return run(adb, ["-s", emulatorSerial, ...args], { quiet });
}

function connectedEmulator(): string | null {
  const output = run(adb, ["devices"], { quiet: true });
  for (const line of output.split("\n").slice(1)) {
    const [serial, state] = line.trim().split(/\s+/, 2);
    if (serial?.startsWith("emulator-") && state === "device") return serial;
  }
  return null;
}

async function ensureEmulator(): Promise<string> {
  const connected = connectedEmulator();
  if (connected) {
    emulatorSerial = connected;
    return connected;
  }
  start(emulator, [
    "-avd",
    avdName,
    "-no-window",
    "-no-audio",
    "-no-boot-anim",
    "-gpu",
    "swiftshader_indirect",
  ]);
  emulatorStarted = true;
  emulatorSerial = await waitFor(
    "the emulator to connect",
    () => connectedEmulator() ?? false,
    180_000
  );
  await waitFor(
    "Android boot completion",
    () => adbRun(["shell", "getprop", "sys.boot_completed"]) === "1",
    180_000
  );
  return emulatorSerial;
}

function verifierEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANDROID_HOME: androidRoot,
    ANDROID_SDK_ROOT: androidRoot,
    APP_VARIANT: "development",
    EXPO_PUBLIC_API_BASE_URL: `http://127.0.0.1:${proxyPort}`,
    EXPO_PUBLIC_EARN_API_BASE_URL: `http://127.0.0.1:${proxyPort}`,
    EXPO_PUBLIC_MWA_E2E_FIXTURE: "authorization-failed",
    EXPO_PUBLIC_SOLANA_ENV: "mainnet",
    JAVA_HOME:
      process.env.JAVA_HOME ??
      "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  };
}

function patchSource(path: string, marker: string, replacement: string): void {
  const source = readFileSync(path, "utf8");
  assert.equal(
    source.split(marker).length - 1,
    1,
    `Source marker missing in ${path}`
  );
  sourceSnapshots.push({ path, source });
  writeFileSync(path, source.replace(marker, replacement));
}

function replaceSource(path: string, replacement: string): void {
  const source = readFileSync(path, "utf8");
  sourceSnapshots.push({ path, source });
  writeFileSync(path, replacement);
}

function installTemporaryFixture(): void {
  patchSource(
    resolve(import.meta.dir, "../src/lib/wallet/mwa-signer.ts"),
    `async function getMwa() {\n  return import("@solana-mobile/mobile-wallet-adapter-protocol-web3js");\n}`,
    `async function getMwa() {\n  if (process.env.EXPO_PUBLIC_MWA_E2E_FIXTURE === "authorization-failed") {\n    const fixture = {\n      authorize: async () => ({ accounts: [{ address: "${FIXTURE_ADDRESS}" }], auth_token: "fixture-auth-token" }),\n      signMessages: async () => { throw { code: -1, message: "${NATIVE_MESSAGE}" }; },\n      signTransactions: async () => { throw { code: -1, message: "${NATIVE_MESSAGE}" }; },\n    };\n    return { transact: async (callback: (wallet: typeof fixture) => unknown) => callback(fixture) } as any;\n  }\n  return import("@solana-mobile/mobile-wallet-adapter-protocol-web3js");\n}`
  );
  replaceSource(
    resolve(import.meta.dir, "../app/_layout.tsx"),
    'import "@/global.css";\nimport { Stack } from "expo-router";\nexport default function RootLayout() { return <Stack screenOptions={{ headerShown: false }} />; }\n'
  );
  patchSource(
    resolve(
      import.meta.dir,
      "../node_modules/react-native-reanimated/android/CMakeLists.txt"
    ),
    '"${REACT_NATIVE_WORKLETS_DIR}/android/build/intermediates/cmake/${BUILD_TYPE}/obj/${ANDROID_ABI}/libworklets.so"',
    '"${REACT_NATIVE_WORKLETS_DIR}/android/build/intermediates/prefab_package/${BUILD_TYPE}/prefab/modules/worklets/libs/android.${ANDROID_ABI}/libworklets.so"'
  );
  replaceSource(
    resolve(import.meta.dir, "../app/(tabs)/index.tsx"),
    'export { default } from "../mwa-authorization-e2e";\n'
  );
  replaceSource(
    resolve(import.meta.dir, "../app/(tabs)/_layout.tsx"),
    'import { Slot } from "expo-router";\nexport default function TabsLayout() { return <Slot />; }\n'
  );

  const routePath = resolve(
    import.meta.dir,
    "../app/mwa-authorization-e2e.tsx"
  );
  assert.equal(
    existsSync(routePath),
    false,
    "Temporary E2E route already exists."
  );
  const routeSource = [
    'import { useEffect, useRef, useState } from "react";',
    'import { Text, View } from "react-native";',
    'import { loadMwaAccount, storeMwaAccount } from "@/lib/wallet/mwa-account-storage";',
    'import { MwaSigner } from "@/lib/wallet/mwa-signer";',
    'import { startLifecycleFlow } from "@/services/observability";',
    `const EXPECTED_MESSAGE = ${JSON.stringify(EXPECTED_MESSAGE)};`,
    `const FIXTURE_PUBLIC_KEY = ${JSON.stringify(FIXTURE_PUBLIC_KEY)};`,
    "export default function MwaAuthorizationE2eScreen() {",
    "  const exercised = useRef(false);",
    '  const [result, setResult] = useState("MWA E2E starting");',
    '  const [accountState, setAccountState] = useState("MWA account pending");',
    '  const [errorClass, setErrorClass] = useState("error class pending");',
    '  const [userMessage, setUserMessage] = useState("reconnect message pending");',
    "  useEffect(() => {",
    "    if (exercised.current) return;",
    "    exercised.current = true;",
    "    void (async () => {",
    '      await storeMwaAccount({ authToken: "fixture-auth-token", publicKey: FIXTURE_PUBLIC_KEY, label: "MWA E2E fixture" });',
    '      const signer = new MwaSigner("fixture-auth-token", FIXTURE_PUBLIC_KEY, "MWA E2E fixture");',
    '      const flow = startLifecycleFlow({ flowName: "earn.withdrawal", flowVariant: "full", walletAddress: FIXTURE_PUBLIC_KEY });',
    '      flow.start("intent");',
    '      flow.start("prepare");',
    '      await signer.signMessage(new Uint8Array([1, 2, 3])).then(() => setResult("MWA E2E FAIL: fixture unexpectedly signed"), async (error: unknown) => {',
    '      flow.failFrom("prepare", error);',
    "      const cleared = (await loadMwaAccount()) === null;",
    '      setAccountState(cleared ? "MWA account cleared" : "MWA account NOT cleared");',
    "      const typed = error as { failure?: string; message?: string };",
    '      const valid = typed.failure === "authorization_expired" && typed.message === EXPECTED_MESSAGE;',
    '      setUserMessage(typed.message === EXPECTED_MESSAGE ? EXPECTED_MESSAGE : "unexpected reconnect message");',
    '      setErrorClass(valid ? "wallet_authorization_expired" : "unexpected error class");',
    '      setResult(valid && cleared ? "MWA E2E PASS" : "MWA E2E FAIL");',
    "    });",
    "    })();",
    "  }, []);",
    "  return (<View style={{ flex: 1, paddingTop: 80, paddingHorizontal: 24 }}>",
    "    <Text accessible accessibilityLabel={result}>{result}</Text>",
    "    <Text accessible accessibilityLabel={accountState}>{accountState}</Text>",
    "    <Text accessible accessibilityLabel={errorClass}>{errorClass}</Text>",
    "    <Text accessible accessibilityLabel={userMessage}>{userMessage}</Text>",
    "  </View>);",
    "}",
    "",
  ].join("\n");
  writeFileSync(routePath, routeSource);
  sourceSnapshots.push({ path: routePath, source: "" });
}

function restoreSources(): void {
  for (const snapshot of sourceSnapshots.reverse()) {
    if (snapshot.source === "") rmSync(snapshot.path, { force: true });
    else writeFileSync(snapshot.path, snapshot.source);
  }
  sourceSnapshots.length = 0;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function dumpUi(): UiNode[] {
  adbRun(["shell", "uiautomator", "dump", UI_XML_PATH]);
  const xml = adbRun(["exec-out", "cat", UI_XML_PATH]);
  const nodes: UiNode[] = [];
  for (const match of xml.matchAll(/<node\s+([^>]+)\/?/g)) {
    const attrs = new Map<string, string>();
    for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g))
      attrs.set(attr[1], decodeXml(attr[2]));
    const bounds = attrs
      .get("bounds")
      ?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (bounds)
      nodes.push({
        bounds: [
          Number(bounds[1]),
          Number(bounds[2]),
          Number(bounds[3]),
          Number(bounds[4]),
        ],
        contentDescription: attrs.get("content-desc") ?? "",
        text: attrs.get("text") ?? "",
      });
  }
  return nodes;
}

function findNode(nodes: UiNode[], label: string): UiNode | null {
  return (
    nodes.find((node) => node.contentDescription === label) ??
    nodes.find((node) => node.text === label) ??
    null
  );
}

async function waitForNode(label: string, limitMs = 120_000): Promise<UiNode> {
  return waitFor(
    `UI node ${JSON.stringify(label)}`,
    () => findNode(dumpUi(), label) ?? false,
    limitMs
  );
}

async function dismissDevClientIntro(): Promise<void> {
  const intro = await waitFor(
    "the development-client intro or app",
    () => {
      const nodes = dumpUi();
      const continueButton = findNode(nodes, "Continue");
      if (continueButton)
        return { kind: "continue" as const, node: continueButton };
      const closeButton = findNode(nodes, "Close");
      if (closeButton) return { kind: "close" as const, node: closeButton };
      if (
        findNode(nodes, "MWA E2E starting") ||
        findNode(nodes, "MWA E2E PASS")
      ) {
        return { kind: "ready" as const };
      }
      return false;
    },
    180_000
  );
  if (intro.kind === "ready") return;
  const [left, top, right, bottom] = intro.node.bounds;
  adbRun([
    "shell",
    "input",
    "tap",
    String(Math.round((left + right) / 2)),
    String(Math.round((top + bottom) / 2)),
  ]);
  if (intro.kind === "continue") {
    const close = await waitForNode("Close", 180_000).catch(() => null);
    if (close) {
      const [closeLeft, closeTop, closeRight, closeBottom] = close.bounds;
      adbRun([
        "shell",
        "input",
        "tap",
        String(Math.round((closeLeft + closeRight) / 2)),
        String(Math.round((closeTop + closeBottom) / 2)),
      ]);
    }
  }
}

function startProxy(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: proxyPort,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (
        request.method === "POST" &&
        url.pathname === "/api/observability/mobile/events"
      ) {
        const body = (await request
          .json()
          .catch(() => null)) as LifecycleEvent | null;
        if (body?.flowName === "earn.withdrawal") lifecycleEvents.push(body);
        return Response.json({ accepted: true }, { status: 202 });
      }
      return Response.json({ accepted: true }, { status: 202 });
    },
  });
}

function normalized(event: LifecycleEvent): NormalizedLifecycleEvent {
  return {
    deploymentEnvironment: "dev",
    durationMs: event.durationMs ?? 1,
    elapsedMs: event.elapsedMs ?? 1,
    flowId: event.flowId ?? "40697037-d01c-43b7-8379-acd8ff9073be",
    flowName: "earn.withdrawal",
    flowVariant: "full",
    outcome: "failed",
    pathname: event.pathname ?? "/",
    release: event.release ?? "0.1.2_e2e",
    runtime: "mobile",
    serviceName: "loyal-mobile",
    source: "mobile_app",
    stage: event.stage ?? "prepare",
    timestamp: event.timestamp ?? new Date().toISOString(),
    errorCode: event.errorCode,
    errorDetail: event.errorDetail,
    httpStatus: event.httpStatus,
    walletAddress: event.walletAddress,
  } as NormalizedLifecycleEvent;
}

function severityText(payload: unknown): string | undefined {
  const value = payload as {
    resourceLogs?: Array<{
      scopeLogs?: Array<{ logRecords?: Array<{ severityText?: string }> }>;
    }>;
  };
  return value.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0]?.severityText;
}

async function main(): Promise<void> {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0);
  const proxy = startProxy();
  const env = verifierEnv();
  try {
    installTemporaryFixture();
    await ensureEmulator();
    const androidPath = resolve(import.meta.dir, "../android");
    if (!existsSync(androidPath)) {
      generatedAndroid = true;
      run("npx", ["expo", "prebuild", "--platform", "android", "--clean"], {
        env,
      });
    }
    const emulatorAbi = adbRun(["shell", "getprop", "ro.product.cpu.abi"]);
    assert.match(emulatorAbi, /^[a-z0-9_-]+$/i, "Unexpected emulator ABI.");
    // Reanimated 4.1.6 expects AGP's legacy Worklets republish directory,
    // which is empty for macOS /private/tmp worktrees. The temporary CMake
    // patch above points at the stable prefab artifact Gradle does produce.
    // Build only the phone's ABI so this isolated check stays deterministic.
    run(
      "./gradlew",
      [
        "app:assembleDebug",
        "--no-parallel",
        `-PreactNativeArchitectures=${emulatorAbi}`,
      ],
      { cwd: androidPath, env }
    );
    adbRun([
      "install",
      "-r",
      join(androidPath, "app/build/outputs/apk/debug/app-debug.apk"),
    ]);
    adbRun(["shell", "pm", "clear", APP_PACKAGE]);
    adbRun(["reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
    adbRun(["reverse", `tcp:${proxyPort}`, `tcp:${proxyPort}`]);
    const metro = start(
      "npx",
      [
        "expo",
        "start",
        "--dev-client",
        "--localhost",
        "--clear",
        "--port",
        String(metroPort),
      ],
      env
    );
    await waitFor(
      "Metro",
      async () =>
        metro.exitCode === null &&
        (await fetch(`http://127.0.0.1:${metroPort}/status`)
          .then((response) => response.ok)
          .catch(() => false)),
      180_000
    );
    const devClientUrl = `${APP_SCHEME}://expo-development-client/?url=${encodeURIComponent(
      `http://127.0.0.1:${metroPort}`
    )}`;
    adbRun([
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      devClientUrl,
      APP_PACKAGE,
    ]);
    await dismissDevClientIntro();
    adbRun([
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `${APP_SCHEME}:///mwa-authorization-e2e`,
      APP_PACKAGE,
    ]);
    await waitForNode("MWA E2E PASS", timeoutMs);
    await waitForNode("MWA account cleared", timeoutMs);
    await waitForNode("wallet_authorization_expired", timeoutMs);
    await waitForNode(EXPECTED_MESSAGE, timeoutMs);
    const event = await waitFor(
      "failed withdrawal lifecycle event",
      () =>
        lifecycleEvents.find(
          (candidate) =>
            candidate.flowName === "earn.withdrawal" &&
            candidate.stage === "prepare" &&
            candidate.outcome === "failed"
        ) ?? false,
      timeoutMs
    );
    assert.equal(event.errorCode, "wallet_authorization_expired");
    assert.notEqual(event.errorCode, "request_failed");
    assert.equal(event.httpStatus, undefined);
    assert.doesNotMatch(JSON.stringify(event), /authorization request failed/);
    assert.equal(
      Object.values(event).some((value) => value === -1 || value === "-1"),
      false
    );
    const eventForClassifier = normalized(event);
    assert.equal(isAlertableLifecycleEvent(eventForClassifier), false);
    assert.equal(
      severityText(buildOtlpLifecyclePayload(eventForClassifier)),
      "INFO"
    );
    console.info(
      JSON.stringify(
        {
          accountCleared: true,
          errorCode: event.errorCode,
          flow: `${event.flowName}.${event.stage}.${event.outcome}`,
          otlpSeverity: "INFO",
          rawNativeContentLeaked: false,
          ui: "MWA E2E PASS",
        },
        null,
        2
      )
    );
  } finally {
    proxy.stop(true);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Process logs: ${processLogPath}`);
  process.exitCode = 1;
} finally {
  for (const child of children.reverse())
    if (child.exitCode === null) child.kill("SIGTERM");
  if (emulatorSerial) {
    spawnSync(
      adb,
      ["-s", emulatorSerial, "shell", "pm", "clear", APP_PACKAGE],
      { stdio: "ignore" }
    );
    spawnSync(
      adb,
      ["-s", emulatorSerial, "reverse", "--remove", `tcp:${metroPort}`],
      { stdio: "ignore" }
    );
    spawnSync(
      adb,
      ["-s", emulatorSerial, "reverse", "--remove", `tcp:${proxyPort}`],
      { stdio: "ignore" }
    );
    spawnSync(adb, ["-s", emulatorSerial, "shell", "rm", "-f", UI_XML_PATH], {
      stdio: "ignore",
    });
  }
  if (emulatorStarted && emulatorSerial)
    spawnSync(adb, ["-s", emulatorSerial, "emu", "kill"], { stdio: "ignore" });
  restoreSources();
  if (generatedAndroid)
    rmSync(resolve(import.meta.dir, "../android"), {
      recursive: true,
      force: true,
    });
  for (const path of generatedModuleBuildPaths)
    rmSync(path, { recursive: true, force: true });
  processLog.end();
  if (process.exitCode !== 1)
    rmSync(tempRoot, { recursive: true, force: true });
}
