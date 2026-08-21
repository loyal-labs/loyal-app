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

const APP_PACKAGE = "com.loyal.app.dev";
const APP_SCHEME = "loyal-dev";
const DEFAULT_AVD = "SkyVerse_API_35";
const DEFAULT_METRO_PORT = 8082;
const DEFAULT_PROXY_PORT = 4320;
const PUBLIC_KEY = "11111111111111111111111111111111";
const ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const AUTH_TOKEN = "fixture-auth-token";
const RECONNECT_MESSAGE =
  "Wallet authorization is no longer valid. Reset your wallet in Settings and reconnect your wallet.";
const UI_XML = "/sdcard/loyal-mwa-authorization-ui.xml";
type LifecycleEvent = {
  flowName?: string;
  stage?: string;
  outcome?: string;
  errorCode?: string;
  httpStatus?: number;
  [key: string]: unknown;
};
type UiNode = {
  bounds: [number, number, number, number];
  contentDescription: string;
  text: string;
};

const avd = process.env.MOBILE_MWA_AUTHORIZATION_AVD ?? DEFAULT_AVD;
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
const logPath = join(tempRoot, "processes.log");
const log = createWriteStream(logPath, { flags: "a" });
const children: ChildProcess[] = [];
const snapshots: Array<{ path: string; source: string }> = [];
const lifecycleEvents: LifecycleEvent[] = [];
const unexpectedRequests: string[] = [];
const moduleBuildPaths = [
  resolve(import.meta.dir, "../modules/expo-seed-vault/android/build"),
];
const generatedModuleBuildPaths = moduleBuildPaths.filter(
  (path) => !existsSync(path)
);
let serial: string | null = null;
let ownsEmulator = false;
let ownsAndroid = false;

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
  read: () => T | false | Promise<T | false>,
  limitMs = 120_000
): Promise<T> {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch {
      /* retry */
    }
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function executable(candidates: string[], label: string): string {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  throw new Error(`${label} executable was not found.`);
}

const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  "/opt/homebrew/share/android-commandlinetools";
const adb = executable(
  [
    join(sdk, "platform-tools/adb"),
    "/opt/homebrew/bin/adb",
    "/opt/homebrew/share/android-commandlinetools/platform-tools/adb",
  ],
  "ADB"
);
const emulator = executable(
  [
    join(sdk, "emulator/emulator"),
    "/opt/homebrew/share/android-commandlinetools/emulator/emulator",
  ],
  "Android emulator"
);
function adbRun(args: string[]): string {
  assert.ok(serial);
  return run(adb, ["-s", serial, ...args], { quiet: true });
}
function connected(): string | null {
  for (const line of run(adb, ["devices"], { quiet: true })
    .split("\n")
    .slice(1)) {
    const [name, state] = line.trim().split(/\s+/, 2);
    if (name?.startsWith("emulator-") && state === "device") return name;
  }
  return null;
}
async function ensureEmulator(): Promise<void> {
  serial = connected();
  if (serial) return;
  start(emulator, [
    "-avd",
    avd,
    "-no-window",
    "-no-audio",
    "-no-boot-anim",
    "-gpu",
    "swiftshader_indirect",
  ]);
  ownsEmulator = true;
  serial = await waitFor("the emulator", () => connected() ?? false, 180_000);
  await waitFor(
    "Android boot completion",
    () => adbRun(["shell", "getprop", "sys.boot_completed"]) === "1",
    180_000
  );
}

function envForVerifier(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    APP_VARIANT: "development",
    EXPO_PUBLIC_API_BASE_URL: `http://127.0.0.1:${proxyPort}`,
    EXPO_PUBLIC_EARN_API_BASE_URL: `http://127.0.0.1:${proxyPort}`,
    EXPO_PUBLIC_MWA_AUTHORIZATION_E2E: "1",
    EXPO_PUBLIC_SOLANA_ENV: "devnet",
    JAVA_HOME:
      process.env.JAVA_HOME ??
      "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  };
}

function replaceSource(path: string, source: string): void {
  snapshots.push({ path, source: readFileSync(path, "utf8") });
  writeFileSync(path, source);
}
function patchSource(path: string, marker: string, replacement: string): void {
  const source = readFileSync(path, "utf8");
  assert.equal(
    source.split(marker).length - 1,
    1,
    `Expected one marker in ${path}`
  );
  snapshots.push({ path, source });
  writeFileSync(path, source.replace(marker, replacement));
}
function addSource(path: string, source: string): void {
  assert.equal(existsSync(path), false, `Temporary route exists: ${path}`);
  snapshots.push({ path, source: "" });
  writeFileSync(path, source);
}

function installFixture(): void {
  patchSource(
    resolve(import.meta.dir, "../src/lib/wallet/mwa-signer.ts"),
    `async function getMwa() {\n  return import("@solana-mobile/mobile-wallet-adapter-protocol-web3js");\n}`,
    `async function getMwa() {
  if (process.env.EXPO_PUBLIC_MWA_AUTHORIZATION_E2E === "1") {
    const fixture = {
      authorize: async () => ({ accounts: [{ address: "${ADDRESS}" }], auth_token: "${AUTH_TOKEN}" }),
      signMessages: async () => { throw { code: -1, message: "authorization request failed" }; },
      signTransactions: async () => { throw { code: -1, message: "authorization request failed" }; },
    };
    return { transact: async (callback: (wallet: typeof fixture) => unknown) => callback(fixture) } as never;
  }
  return import("@solana-mobile/mobile-wallet-adapter-protocol-web3js");
}`
  );
  patchSource(
    resolve(import.meta.dir, "../src/lib/solana/earn/withdraw.ts"),
    `  await assertSolForFees(\n    getConnection(),\n    args.signer.publicKey,\n    WITHDRAW_MIN_FEE_LAMPORTS,\n  ).catch((error) => {\n    flow.failFrom("prepare", error);\n    throw error;\n  });`,
    `  if (process.env.EXPO_PUBLIC_MWA_AUTHORIZATION_E2E !== "1") {
    await assertSolForFees(getConnection(), args.signer.publicKey, WITHDRAW_MIN_FEE_LAMPORTS).catch((error) => {
      flow.failFrom("prepare", error);
      throw error;
    });
  }`
  );
  replaceSource(
    resolve(import.meta.dir, "../app/_layout.tsx"),
    `import "@/global.css";\nimport { Stack } from "expo-router";\nexport default function RootLayout() { return <Stack initialRouteName="mwa-authorization-e2e" screenOptions={{ headerShown: false }} />; }\n`
  );
  replaceSource(
    resolve(import.meta.dir, "../app/(tabs)/_layout.tsx"),
    `import { Redirect } from "expo-router";\nexport default function TabsLayout() { return <Redirect href="/mwa-authorization-e2e" />; }\n`
  );
  const cmakePath = resolve(
    import.meta.dir,
    "../node_modules/react-native-reanimated/android/CMakeLists.txt"
  );
  const cmakeMarker =
    '"${REACT_NATIVE_WORKLETS_DIR}/android/build/intermediates/cmake/${BUILD_TYPE}/obj/${ANDROID_ABI}/libworklets.so"';
  if (existsSync(cmakePath)) {
    const cmake = readFileSync(cmakePath, "utf8");
    if (cmake.includes(cmakeMarker)) {
      patchSource(
        cmakePath,
        cmakeMarker,
        '"${REACT_NATIVE_WORKLETS_DIR}/android/build/intermediates/prefab_package/${BUILD_TYPE}/prefab/modules/worklets/libs/android.${ANDROID_ABI}/libworklets.so"'
      );
    }
  }
  addSource(
    resolve(import.meta.dir, "../app/mwa-authorization-e2e.tsx"),
    `import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { executeEarnWithdraw } from "@/lib/solana/earn/withdraw";
import { loadMwaAccount, storeMwaAccount } from "@/lib/wallet/mwa-account-storage";
import { MwaSigner } from "@/lib/wallet/mwa-signer";
const PUBLIC_KEY = "${PUBLIC_KEY}";
const AUTH_TOKEN = "${AUTH_TOKEN}";
const EXPECTED = ${JSON.stringify(RECONNECT_MESSAGE)};
const account = { authToken: AUTH_TOKEN, publicKey: PUBLIC_KEY, label: "MWA E2E fixture" };
export default function MwaAuthorizationE2e() {
  const ran = useRef(false);
  const [result, setResult] = useState("MWA E2E starting");
  const [storage, setStorage] = useState("account pending");
  const [code, setCode] = useState("error code pending");
  const [copy, setCopy] = useState("reconnect copy pending");
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      await storeMwaAccount(account);
      let authError: unknown;
      try { await executeEarnWithdraw({ signer: new MwaSigner(AUTH_TOKEN, PUBLIC_KEY), amountUsd: 1, mode: "full" }); }
      catch (error) { authError = error; }
      const auth = authError as { failure?: string; message?: string };
      const authCleared = (await loadMwaAccount()) === null;
      await storeMwaAccount(account);
      let txError: unknown;
      try { await new MwaSigner(AUTH_TOKEN, PUBLIC_KEY).signAllTransactions([]); }
      catch (error) { txError = error; }
      const tx = txError as { failure?: string };
      const txCleared = (await loadMwaAccount()) === null;
      const passed = auth.failure === "authorization_expired" && auth.message === EXPECTED && tx.failure === "authorization_expired" && authCleared && txCleared;
      setStorage(passed ? "MWA account cleared" : "MWA account NOT cleared");
      setCode(passed ? "wallet_authorization_expired" : "unexpected error code");
      setCopy(auth.message === EXPECTED ? EXPECTED : "unexpected reconnect message");
      setResult(passed ? "MWA E2E PASS" : "MWA E2E FAIL");
    })().catch((error: unknown) => setResult(\`MWA E2E FAIL: \${error instanceof Error ? error.message : String(error)}\`));
  }, []);
  return <View style={{ flex: 1, paddingTop: 80, paddingHorizontal: 24 }}><Text accessible accessibilityLabel={result}>{result}</Text><Text accessible accessibilityLabel={storage}>{storage}</Text><Text accessible accessibilityLabel={code}>{code}</Text><Text accessible accessibilityLabel={copy}>{copy}</Text></View>;
}
`
  );
}

function restoreSources(): void {
  for (const snapshot of snapshots.reverse()) {
    if (snapshot.source === "") rmSync(snapshot.path, { force: true });
    else writeFileSync(snapshot.path, snapshot.source);
  }
  snapshots.length = 0;
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
  adbRun(["shell", "uiautomator", "dump", UI_XML]);
  const xml = adbRun(["exec-out", "cat", UI_XML]);
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
function node(label: string): UiNode | null {
  const nodes = dumpUi();
  return (
    nodes.find((item) => item.contentDescription === label) ??
    nodes.find((item) => item.text === label) ??
    null
  );
}
async function waitForNode(
  label: string,
  limitMs = timeoutMs
): Promise<UiNode> {
  return waitFor(`UI node ${label}`, () => node(label) ?? false, limitMs);
}
async function openDevClient(): Promise<void> {
  const intro = await waitFor(
    "development client",
    () =>
      node("Continue") ?? node("Close") ?? node("MWA E2E starting") ?? false,
    180_000
  );
  if (
    intro.text === "MWA E2E starting" ||
    intro.contentDescription === "MWA E2E starting"
  )
    return;
  const [left, top, right, bottom] = intro.bounds;
  adbRun([
    "shell",
    "input",
    "tap",
    String(Math.round((left + right) / 2)),
    String(Math.round((top + bottom) / 2)),
  ]);
  if (intro.text === "Continue" || intro.contentDescription === "Continue") {
    const close = await waitForNode("Close", 30_000).catch(() => null);
    if (close) {
      const [l, t, r, b] = close.bounds;
      adbRun([
        "shell",
        "input",
        "tap",
        String(Math.round((l + r) / 2)),
        String(Math.round((t + b) / 2)),
      ]);
    }
  }
}

function proxy(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: proxyPort,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (
        request.method === "POST" &&
        url.pathname === "/api/observability/mobile/events"
      ) {
        const event = (await request
          .json()
          .catch(() => null)) as LifecycleEvent | null;
        if (event?.flowName === "earn.withdrawal") lifecycleEvents.push(event);
        return Response.json({ accepted: true }, { status: 202 });
      }
      unexpectedRequests.push(`${request.method} ${url.pathname}`);
      return Response.json({ accepted: false }, { status: 500 });
    },
  });
}

async function main(): Promise<void> {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0);
  const localProxy = proxy();
  const env = envForVerifier();
  try {
    installFixture();
    await ensureEmulator();
    const android = resolve(import.meta.dir, "../android");
    if (!existsSync(android)) {
      ownsAndroid = true;
      run("npx", ["expo", "prebuild", "--platform", "android", "--clean"], {
        env,
      });
    }
    const abi = adbRun(["shell", "getprop", "ro.product.cpu.abi"]);
    assert.match(abi, /^[a-z0-9_-]+$/i);
    run(
      "./gradlew",
      [
        "app:assembleDebug",
        "--no-parallel",
        `-PreactNativeArchitectures=${abi}`,
      ],
      { cwd: android, env }
    );
    adbRun([
      "install",
      "-r",
      join(android, "app/build/outputs/apk/debug/app-debug.apk"),
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
      { env }
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
    const devUrl = `${APP_SCHEME}://expo-development-client/?url=${encodeURIComponent(
      `http://127.0.0.1:${metroPort}`
    )}`;
    adbRun([
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      devUrl,
      APP_PACKAGE,
    ]);
    await openDevClient();
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
    await waitForNode("MWA E2E PASS");
    await waitForNode("MWA account cleared");
    await waitForNode("wallet_authorization_expired");
    await waitForNode(RECONNECT_MESSAGE);
    const event = await waitFor(
      "failed withdrawal lifecycle event",
      () =>
        lifecycleEvents.find(
          (item) =>
            item.flowName === "earn.withdrawal" &&
            item.stage === "prepare" &&
            item.outcome === "failed"
        ) ?? false
    );
    assert.equal(event.errorCode, "wallet_authorization_expired");
    assert.equal(event.httpStatus, undefined);
    assert.doesNotMatch(JSON.stringify(event), /authorization request failed/);
    assert.equal(
      Object.values(event).some((value) => value === -1 || value === "-1"),
      false
    );
    assert.deepEqual(unexpectedRequests, []);
    console.info(
      JSON.stringify(
        {
          accountCleared: true,
          backendOrRpcRequests: 0,
          errorCode: event.errorCode,
          nativeContentLeaked: false,
          ui: "MWA E2E PASS",
        },
        null,
        2
      )
    );
  } finally {
    localProxy.stop(true);
  }
}

function cleanup(): void {
  for (const child of children.reverse())
    if (child.exitCode === null) child.kill("SIGTERM");
  if (serial) {
    spawnSync(adb, ["-s", serial, "shell", "pm", "clear", APP_PACKAGE], {
      stdio: "ignore",
    });
    spawnSync(adb, ["-s", serial, "reverse", "--remove", `tcp:${metroPort}`], {
      stdio: "ignore",
    });
    spawnSync(adb, ["-s", serial, "reverse", "--remove", `tcp:${proxyPort}`], {
      stdio: "ignore",
    });
    spawnSync(adb, ["-s", serial, "shell", "rm", "-f", UI_XML], {
      stdio: "ignore",
    });
  }
  if (ownsEmulator && serial)
    spawnSync(adb, ["-s", serial, "emu", "kill"], { stdio: "ignore" });
  restoreSources();
  if (ownsAndroid)
    rmSync(resolve(import.meta.dir, "../android"), {
      recursive: true,
      force: true,
    });
  for (const path of generatedModuleBuildPaths)
    rmSync(path, { recursive: true, force: true });
  log.end();
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Process logs: ${logPath}`);
  process.exitCode = 1;
} finally {
  cleanup();
  if (process.exitCode !== 1)
    rmSync(tempRoot, { recursive: true, force: true });
}
