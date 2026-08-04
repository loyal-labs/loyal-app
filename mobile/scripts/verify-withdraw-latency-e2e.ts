import assert from "node:assert/strict";
import {
  accessSync,
  copyFileSync,
  constants,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";

import { Keypair } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

const APP_PACKAGE = "com.loyal.app.dev";
const APP_SCHEME = "loyal-dev";
const DEFAULT_AVD = "SkyVerse_API_35";
const DEFAULT_METRO_PORT = 8081;
const DEFAULT_PROXY_PORT = 4319;
const MAINNET_ACK = "I_ACKNOWLEDGE_MAINNET";
const UPSTREAM = "https://askloyal.com";
const LIFECYCLE_PATH = "/api/observability/mobile/events";
const METRICS_PATH = "/api/observability/mobile/metrics";
const MAINNET_USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

type Mode = "withdraw" | "seed-position";

type LifecycleEvent = {
  chainState?: string;
  durationMs: number;
  elapsedMs: number;
  flowId: string;
  flowName: string;
  flowVariant: string;
  outcome: string;
  persistenceState?: string;
  recoveryRequired?: boolean;
  stage: string;
  timestamp: string;
  walletAddress?: string;
};

type ApiTiming = {
  durationMs: number;
  method: string;
  pathname: string;
  status: number;
  startedAt: string;
};

type UiNode = {
  bounds: [number, number, number, number];
  clickable: boolean;
  contentDescription: string;
  enabled: boolean;
  focused: boolean;
  text: string;
};

const mode: Mode = process.argv.includes("--seed-position")
  ? "seed-position"
  : "withdraw";
const keyPath = process.env.MOBILE_E2E_WALLET_KEYPAIR
  ? resolve(process.env.MOBILE_E2E_WALLET_KEYPAIR)
  : null;
const avdName = process.env.MOBILE_WITHDRAW_AVD ?? DEFAULT_AVD;
const metroPort = Number(
  process.env.MOBILE_WITHDRAW_METRO_PORT ?? DEFAULT_METRO_PORT,
);
const proxyPort = Number(
  process.env.MOBILE_WITHDRAW_PROXY_PORT ?? DEFAULT_PROXY_PORT,
);
const maxPositionUsd = Number(
  process.env.MOBILE_WITHDRAW_MAX_POSITION_USD ?? "2",
);
const seedAmountUsd = Number(
  process.env.MOBILE_WITHDRAW_SEED_AMOUNT_USD ?? "1.17",
);
const timeoutMs = Number(process.env.MOBILE_WITHDRAW_TIMEOUT_MS ?? "600000");
const outputPath = process.env.MOBILE_WITHDRAW_PROFILE_OUTPUT
  ? resolve(process.env.MOBILE_WITHDRAW_PROFILE_OUTPUT)
  : null;

const tempRoot = mkdtempSync(join(tmpdir(), "loyal-withdraw-profile-"));
const processLogPath = join(tempRoot, "processes.log");
const processLog = createWriteStream(processLogPath, { flags: "a" });
const children: ChildProcess[] = [];
const lifecycleEvents: LifecycleEvent[] = [];
const apiTimings: ApiTiming[] = [];
let emulatorStarted = false;
let emulatorSerial: string | null = null;
let seedDepositActionBounds: UiNode["bounds"] | null = null;
let materializedPrivateTransactionsEntry:
  | { entryPath: string; linkTarget: string }
  | undefined;
const seededDepositSources: { path: string; source: string }[] = [];

function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    quiet?: boolean;
  } = {},
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? resolve(import.meta.dir, ".."),
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    stdio: options.quiet ? "pipe" : ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${String(result.status)}${
        options.quiet && result.stderr ? `: ${result.stderr.trim()}` : ""
      }`,
    );
  }
  return options.quiet ? result.stdout.trim() : "";
}

function start(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd ?? resolve(import.meta.dir, ".."),
    env: options.env ?? process.env,
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
  limitMs = 60_000,
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
    }.`,
  );
}

function findExecutable(
  candidates: Array<string | null>,
  label: string,
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

const adb = findExecutable(
  [
    process.env.ANDROID_HOME
      ? join(process.env.ANDROID_HOME, "platform-tools/adb")
      : null,
    "/opt/homebrew/bin/adb",
    "/opt/homebrew/share/android-commandlinetools/platform-tools/adb",
  ],
  "ADB",
);

const emulator = findExecutable(
  [
    process.env.ANDROID_HOME
      ? join(process.env.ANDROID_HOME, "emulator/emulator")
      : null,
    "/opt/homebrew/share/android-commandlinetools/emulator/emulator",
  ],
  "Android emulator",
);

function adbRun(args: string[], quiet = true): string {
  assert.ok(emulatorSerial, "Emulator serial is unavailable.");
  return run(adb, ["-s", emulatorSerial, ...args], { quiet });
}

function isSoftKeyboardVisible(): boolean {
  const state = adbRun(["shell", "dumpsys", "input_method"]);
  return /(?:mInputShown|mIsInputViewShown|mShowRequested)=true/.test(state);
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
  if (connected) return connected;
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
  const serial = await waitFor(
    "the emulator to connect",
    () => connectedEmulator() ?? false,
    180_000,
  );
  emulatorSerial = serial;
  await waitFor(
    "Android boot completion",
    () => adbRun(["shell", "getprop", "sys.boot_completed"]) === "1",
    180_000,
  );
  return serial;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function materializeWorktreePrivateTransactionsEntry(): void {
  const entryPath = resolve(
    import.meta.dir,
    "../node_modules/@loyal-labs/private-transactions/dist/index.js",
  );
  if (!existsSync(entryPath) || !lstatSync(entryPath).isSymbolicLink()) return;

  const linkTarget = readlinkSync(entryPath);
  const worktreeEntry = resolve(
    import.meta.dir,
    "../../sdk/private-transactions/dist/index.js",
  );
  unlinkSync(entryPath);
  copyFileSync(worktreeEntry, entryPath);
  materializedPrivateTransactionsEntry = { entryPath, linkTarget };
}

function restorePrivateTransactionsEntry(): void {
  if (!materializedPrivateTransactionsEntry) return;
  const { entryPath, linkTarget } = materializedPrivateTransactionsEntry;
  unlinkSync(entryPath);
  symlinkSync(linkTarget, entryPath);
  materializedPrivateTransactionsEntry = undefined;
}

function openDepositSheetInSeedBundle(): void {
  if (mode !== "seed-position") return;
  const path = resolve(import.meta.dir, "../app/(tabs)/index.tsx");
  const source = readFileSync(path, "utf8");
  const marker = "const [depositOpen, setDepositOpen] = useState(false);";
  assert.equal(
    source.split(marker).length - 1,
    1,
    "The seed verifier could not locate the Deposit sheet state.",
  );
  writeFileSync(
    path,
    source.replace(
      marker,
      [
        "const [depositOpenState, setDepositOpen] = useState(false);",
        "const depositOpen = true || depositOpenState;",
      ].join("\n"),
    ),
  );
  seededDepositSources.push({ path, source });

  const sheetPath = resolve(
    import.meta.dir,
    "../src/components/earn/DepositSheet.tsx",
  );
  const sheetSource = readFileSync(sheetPath, "utf8");
  const amountMarker = 'const [amount, setAmount] = useState("");';
  assert.equal(
    sheetSource.split(amountMarker).length - 1,
    1,
    "The seed verifier could not locate the Deposit amount state.",
  );
  const seededAmount = seedAmountUsd.toFixed(2);
  const initializedSheetSource = sheetSource.replace(
    amountMarker,
    `const [amount, setAmount] = useState(${JSON.stringify(seededAmount)});`,
  );
  const resetMarker = 'setAmount("");';
  assert.equal(
    initializedSheetSource.split(resetMarker).length - 1,
    1,
    "The seed verifier could not locate the Deposit open reset.",
  );
  const initializedAndResetSheetSource = initializedSheetSource.replace(
    resetMarker,
    `setAmount(${JSON.stringify(seededAmount)});`,
  );
  const availableMarker = [
    "const available = Number.isFinite(availableUsdc ?? NaN)",
    "    ? (availableUsdc as number)",
    "    : 0;",
  ].join("\n");
  assert.equal(
    initializedAndResetSheetSource.split(availableMarker).length - 1,
    1,
    "The seed verifier could not locate the available USDC state.",
  );
  const boundedSheetSource = initializedAndResetSheetSource.replace(
    availableMarker,
    `const available = ${seededAmount};`,
  );
  const handlerMarker = "  }, [amount, available, onDeposit]);";
  assert.equal(
    boundedSheetSource.split(handlerMarker).length - 1,
    1,
    "The seed verifier could not locate the real Deposit handler.",
  );
  writeFileSync(
    sheetPath,
    boundedSheetSource.replace(
      handlerMarker,
      [
        handlerMarker,
        "  const verifierSubmitted = useRef(false);",
        "  useEffect(() => {",
        "    if (!open || verifierSubmitted.current) return;",
        "    verifierSubmitted.current = true;",
        "    const timer = setTimeout(() => void handleDeposit(), 500);",
        "    return () => clearTimeout(timer);",
        "  }, [handleDeposit, open]);",
      ].join("\n"),
    ),
  );
  seededDepositSources.push({ path: sheetPath, source: sheetSource });
}

function restoreDepositSource(): void {
  for (const entry of seededDepositSources.reverse()) {
    writeFileSync(entry.path, entry.source);
  }
  seededDepositSources.length = 0;
}

function assembleVerifierApk(
  androidRoot: string,
  env: NodeJS.ProcessEnv,
): void {
  const manifestPath = join(androidRoot, "app/src/main/AndroidManifest.xml");
  const originalManifest = readFileSync(manifestPath, "utf8");
  const verifierManifest = originalManifest.includes(
    "android:usesCleartextTraffic=",
  )
    ? originalManifest.replace(
        /android:usesCleartextTraffic="[^"]*"/,
        'android:usesCleartextTraffic="true"',
      )
    : originalManifest.replace(
        "<application ",
        '<application android:usesCleartextTraffic="true" ',
      );
  writeFileSync(manifestPath, verifierManifest);
  try {
    run("./gradlew", ["app:assembleDebug"], { cwd: androidRoot, env });
  } finally {
    writeFileSync(manifestPath, originalManifest);
  }
}

function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const match of xml.matchAll(/<node\s+([^>]+)\/?/g)) {
    const attrs = new Map<string, string>();
    for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
      attrs.set(attr[1], decodeXml(attr[2]));
    }
    const bounds = attrs
      .get("bounds")
      ?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (!bounds) continue;
    nodes.push({
      bounds: [
        Number(bounds[1]),
        Number(bounds[2]),
        Number(bounds[3]),
        Number(bounds[4]),
      ],
      clickable: attrs.get("clickable") === "true",
      contentDescription: attrs.get("content-desc") ?? "",
      enabled: attrs.get("enabled") !== "false",
      focused: attrs.get("focused") === "true",
      text: attrs.get("text") ?? "",
    });
  }
  return nodes;
}

function dumpUi(): UiNode[] {
  adbRun(["shell", "uiautomator", "dump", "/sdcard/loyal-withdraw-ui.xml"]);
  return parseUiNodes(
    adbRun(["exec-out", "cat", "/sdcard/loyal-withdraw-ui.xml"]),
  );
}

function findNode(nodes: UiNode[], label: string): UiNode | null {
  return (
    nodes.find((node) => node.contentDescription === label) ??
    nodes.find((node) => node.text === label) ??
    null
  );
}

function findKnownImportError(nodes: UiNode[]): string | null {
  const prefixes = [
    "Please paste your secret key",
    "JSON array must contain",
    "Invalid byte at position",
    "Invalid JSON array",
    "Base58 key must decode to",
    "Unrecognized key format",
    "PIN must be 4 digits",
    "Failed to import wallet",
  ];
  return (
    nodes
      .map((node) => node.text)
      .find((value) => prefixes.some((prefix) => value.startsWith(prefix))) ??
    null
  );
}

async function waitForNode(label: string, limitMs = 120_000): Promise<UiNode> {
  return waitFor(
    `UI node ${JSON.stringify(label)}`,
    () => findNode(dumpUi(), label) ?? false,
    limitMs,
  );
}

function tap(node: UiNode): void {
  const [left, top, right, bottom] = node.bounds;
  adbRun([
    "shell",
    "input",
    "tap",
    String(Math.round((left + right) / 2)),
    String(Math.round((top + bottom) / 2)),
  ]);
}

async function tapLabel(label: string, limitMs = 120_000): Promise<void> {
  tap(await waitForNode(label, limitMs));
}

function typeWithoutCommandArgument(value: string): void {
  assert.match(value, /^[0-9A-HJ-NP-Za-km-z.]+$/);
  const command = `input text ${value}\nexit\n`;
  const result: SpawnSyncReturns<string> = spawnSync(
    adb,
    ["-s", emulatorSerial!, "shell"],
    {
      encoding: "utf8",
      input: command,
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    throw new Error("ADB could not type into the focused input.");
  }
}

async function enterPin(pin: string): Promise<void> {
  for (const digit of pin) {
    await tapLabel(digit);
    await Bun.sleep(80);
  }
}

async function dismissDevClientIntro(): Promise<void> {
  const initial = await waitFor(
    "the app or development-client intro",
    () => {
      const nodes = dumpUi();
      const importWallet = findNode(nodes, "Import Existing Wallet");
      if (importWallet) return { kind: "ready" as const };
      const continueButton = findNode(nodes, "Continue");
      if (continueButton) {
        return { kind: "continue" as const, node: continueButton };
      }
      return false;
    },
    180_000,
  );
  if (initial.kind === "continue") {
    tap(initial.node);
    const next = await waitFor(
      "the app or development-client close button",
      () => {
        const nodes = dumpUi();
        if (findNode(nodes, "Import Existing Wallet")) {
          return { kind: "ready" as const };
        }
        const closeButton = findNode(nodes, "Close");
        return closeButton
          ? { kind: "close" as const, node: closeButton }
          : false;
      },
      180_000,
    );
    if (next.kind === "close") tap(next.node);
    await waitForNode("Import Existing Wallet", 180_000);
  }
}

async function importWallet(secretInputValue: string): Promise<void> {
  await tapLabel("Import Existing Wallet");
  await waitForNode("Create PIN");
  await enterPin("1234");
  await waitForNode("Confirm PIN");
  await enterPin("1234");
  const secretInput = await waitForNode("Paste secret key...");
  tap(secretInput);
  await Bun.sleep(500);
  typeWithoutCommandArgument(secretInputValue);
  const typedNodes = dumpUi();
  if (!typedNodes.some((node) => node.text === secretInputValue)) {
    const observedLengths = typedNodes
      .map((node) => node.text)
      .filter((value) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(value))
      .map((value) => value.length)
      .filter((length) => length >= 32);
    throw new Error(
      `Secret-key input did not match (expected length ${
        secretInputValue.length
      }, observed candidate lengths ${JSON.stringify(observedLengths)}).`,
    );
  }
  let importButton = await waitForNode("Import Wallet");
  if (isSoftKeyboardVisible() || importButton.bounds[1] < 1_600) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      adbRun(["shell", "input", "tap", "50", "2350"]);
      await Bun.sleep(750);
      importButton = await waitForNode("Import Wallet");
      if (importButton.bounds[1] >= 1_600) break;
    }
  }
  if (importButton.bounds[1] < 1_600) {
    adbRun(["shell", "input", "keyevent", "KEYCODE_BACK"]);
    await Bun.sleep(750);
    importButton = await waitForNode("Import Wallet");
  }
  if (importButton.bounds[1] < 1_600) {
    throw new Error(
      `The emulator keyboard still covers Import Wallet (bounds: ${JSON.stringify(
        importButton.bounds,
      )}).`,
    );
  }
  await Bun.sleep(500);
  let importStarted = false;
  let importButtonBounds: UiNode["bounds"] | null = importButton.bounds;
  for (let attempt = 0; attempt < 6 && !importStarted; attempt += 1) {
    if (attempt < 2) {
      const importButton = await waitForNode("Import Wallet");
      importButtonBounds = importButton.bounds;
      tap(importButton);
    } else if (attempt === 2) {
      adbRun(["shell", "input", "keyevent", "KEYCODE_TAB"]);
      adbRun(["shell", "input", "keyevent", "KEYCODE_ENTER"]);
    } else if (attempt === 3) {
      adbRun(["shell", "input", "keyevent", "KEYCODE_TAB"]);
      adbRun(["shell", "input", "keyevent", "KEYCODE_SPACE"]);
    } else if (attempt === 4) {
      const importButton = await waitForNode("Import Wallet");
      importButtonBounds = importButton.bounds;
      const [left, top, right, bottom] = importButton.bounds;
      const x = String(Math.round((left + right) / 2));
      const y = String(Math.round((top + bottom) / 2));
      adbRun(["shell", "input", "touchscreen", "swipe", x, y, x, y, "100"]);
    } else {
      for (let move = 0; move < 4; move += 1) {
        adbRun(["shell", "input", "keyevent", "KEYCODE_DPAD_DOWN"]);
      }
      adbRun(["shell", "input", "keyevent", "KEYCODE_DPAD_CENTER"]);
    }
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const nodes = dumpUi();
      const error = findKnownImportError(nodes);
      if (error) throw new Error(`Wallet import validation failed: ${error}`);
      if (
        findNode(nodes, "Importing wallet...") ||
        findNode(nodes, "Skip for now") ||
        findNode(nodes, "Earn")
      ) {
        importStarted = true;
        break;
      }
      await Bun.sleep(500);
    }
  }
  if (!importStarted) {
    throw new Error(
      `Import Wallet presses did not start wallet import (last bounds: ${JSON.stringify(
        importButtonBounds,
      )}).`,
    );
  }

  const biometricChoice = await waitFor(
    "wallet import completion",
    () => {
      const nodes = dumpUi();
      const skip = findNode(nodes, "Skip for now");
      if (skip) return { kind: "skip" as const, node: skip };
      const earn = findNode(nodes, "Earn");
      if (earn) return { kind: "ready" as const, node: earn };
      return false;
    },
    180_000,
  );
  if (biometricChoice.kind === "skip") {
    tap(biometricChoice.node);
    await waitForNode("Earn", 180_000);
  }
}

async function currentPositionRaw(walletAddress: string): Promise<bigint> {
  const response = await fetch(
    `${UPSTREAM}/api/smart-accounts/mobile/earn/state?walletAddress=${encodeURIComponent(
      walletAddress,
    )}`,
  );
  if (!response.ok) {
    throw new Error(`Earn state preflight failed (${response.status}).`);
  }
  const body = (await response.json()) as {
    position?: { currentAmountRaw?: unknown } | null;
  };
  const raw = body.position?.currentAmountRaw;
  return typeof raw === "string" && /^\d+$/.test(raw) ? BigInt(raw) : BigInt(0);
}

async function currentWalletUsdcRaw(walletAddress: PublicKey): Promise<bigint> {
  const connection = new Connection(
    process.env.MOBILE_WITHDRAW_PREFLIGHT_RPC ??
      "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const account = getAssociatedTokenAddressSync(
    MAINNET_USDC_MINT,
    walletAddress,
    false,
    TOKEN_PROGRAM_ID,
  );
  try {
    return BigInt(
      (await connection.getTokenAccountBalance(account)).value.amount,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("could not find account")
    ) {
      return BigInt(0);
    }
    throw error;
  }
}

function verifierEnv(): NodeJS.ProcessEnv {
  const androidRoot =
    process.env.ANDROID_HOME ??
    process.env.ANDROID_SDK_ROOT ??
    "/opt/homebrew/share/android-commandlinetools";
  return {
    ...process.env,
    ANDROID_HOME: androidRoot,
    ANDROID_SDK_ROOT: androidRoot,
    APP_VARIANT: "development",
    EXPO_PUBLIC_API_BASE_URL:
      process.env.EXPO_PUBLIC_API_BASE_URL ??
      "https://solana-telegram-transactions.vercel.app",
    EXPO_PUBLIC_EARN_API_BASE_URL: `http://127.0.0.1:${proxyPort}`,
    EXPO_PUBLIC_SOLANA_ENV: "mainnet",
    JAVA_HOME:
      process.env.JAVA_HOME ??
      "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  };
}

function isLifecycleEvent(value: unknown): value is LifecycleEvent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.flowName === "earn.withdrawal" ||
      record.flowName === "earn.deposit") &&
    typeof record.stage === "string" &&
    typeof record.outcome === "string"
  );
}

async function proxyRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === LIFECYCLE_PATH) {
    const body = await request.json().catch(() => null);
    if (isLifecycleEvent(body)) lifecycleEvents.push(body);
    return Response.json({ accepted: true }, { status: 202 });
  }
  if (request.method === "POST" && url.pathname === METRICS_PATH) {
    return Response.json({ accepted: true }, { status: 202 });
  }

  const startedAtMs = Date.now();
  const upstreamUrl = new URL(`${url.pathname}${url.search}`, UPSTREAM);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  const upstreamResponse = await fetch(upstreamUrl, {
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer(),
    headers,
    method: request.method,
    redirect: "manual",
  });
  apiTimings.push({
    durationMs: Date.now() - startedAtMs,
    method: request.method,
    pathname: url.pathname,
    startedAt: new Date(startedAtMs).toISOString(),
    status: upstreamResponse.status,
  });
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");
  return new Response(upstreamResponse.body, {
    headers: responseHeaders,
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
  });
}

function lifecycleStageDurations(flowName: string): Record<string, number> {
  const matching = lifecycleEvents.filter(
    (event) => event.flowName === flowName,
  );
  return Object.fromEntries(
    matching.map((event) => [
      `${event.stage}.${event.outcome}`,
      Number(event.durationMs),
    ]),
  );
}

async function driveWithdraw(): Promise<void> {
  console.info("[withdraw-e2e] opening Earn tab");
  await tapLabel("Earn");
  console.info("[withdraw-e2e] opening withdrawal sheet");
  let maxButton: UiNode | null = null;
  let withdrawActionBounds: UiNode["bounds"] | null = null;
  for (let attempt = 0; attempt < 4 && !maxButton; attempt += 1) {
    const withdrawAction = await waitFor(
      "the Earn withdrawal action",
      () =>
        dumpUi().find((node) => node.contentDescription === "Withdraw") ??
        false,
      180_000,
    );
    withdrawActionBounds = withdrawAction.bounds;
    if (attempt === 0) {
      tap(withdrawAction);
    } else if (attempt < 3) {
      const [left, top, right, bottom] = withdrawAction.bounds;
      const x = String(Math.round((left + right) / 2));
      const y = String(Math.round((top + bottom) / 2));
      adbRun([
        "shell",
        "input",
        "touchscreen",
        "swipe",
        x,
        y,
        x,
        y,
        attempt === 1 ? "100" : "250",
      ]);
    } else {
      adbRun(["shell", "input", "keyevent", "KEYCODE_TAB"]);
      adbRun(["shell", "input", "keyevent", "KEYCODE_ENTER"]);
    }
    maxButton = await waitFor(
      "the withdrawal maximum button",
      () => {
        const nodes = dumpUi();
        return (
          findNode(nodes, "Use maximum balance") ??
          findNode(nodes, "MAX") ??
          false
        );
      },
      8_000,
    ).catch(() => null);
  }
  if (!maxButton) {
    throw new Error(
      `The Earn withdrawal action did not open its sheet (last bounds: ${JSON.stringify(
        withdrawActionBounds,
      )}).`,
    );
  }
  tap(maxButton);
  console.info("[withdraw-e2e] selected full balance");
  lifecycleEvents.length = 0;
  apiTimings.length = 0;
  const submitButton = await waitFor(
    "the withdrawal submit button",
    () => {
      const candidates = dumpUi().filter(
        (node) =>
          node.enabled &&
          node.clickable &&
          JSON.stringify(node.bounds) !==
            JSON.stringify(withdrawActionBounds) &&
          (node.contentDescription === "Withdraw" || node.text === "Withdraw"),
      );
      return (
        candidates.sort((left, right) => right.bounds[3] - left.bounds[3])[0] ??
        false
      );
    },
    120_000,
  );
  const started = async (): Promise<boolean> =>
    lifecycleEvents.some(
      (event) =>
        event.flowName === "earn.withdrawal" && event.outcome === "started",
    ) || apiTimings.some((timing) => timing.pathname.includes("/withdraw"));
  tap(submitButton);
  let handlerStarted = await waitFor(
    "the withdrawal handler to start",
    async () => (await started()) || false,
    5_000,
  ).catch(() => false);
  if (!handlerStarted) {
    const [left, top, right, bottom] = submitButton.bounds;
    const x = String(Math.round((left + right) / 2));
    const y = String(Math.round((top + bottom) / 2));
    adbRun(["shell", "input", "touchscreen", "swipe", x, y, x, y, "200"]);
    handlerStarted = await waitFor(
      "the withdrawal handler to start after the fallback activation",
      async () => (await started()) || false,
      10_000,
    ).catch(() => false);
  }
  if (!handlerStarted) {
    throw new Error(
      `The enabled withdrawal CTA did not invoke its handler (bounds: ${JSON.stringify(
        submitButton.bounds,
      )}).`,
    );
  }
  console.info("[withdraw-e2e] withdrawal handler started through the app UI");
  const completed = await waitFor(
    "completed withdrawal lifecycle",
    () =>
      lifecycleEvents.find(
        (event) =>
          event.flowName === "earn.withdrawal" &&
          event.outcome === "completed" &&
          event.stage === "ui_commit",
      ) ?? false,
    timeoutMs,
  );
  const cleanupPrepare = lifecycleEvents.find(
    (event) =>
      event.flowId === completed.flowId &&
      event.outcome === "observed" &&
      event.stage === "cleanup_prepare",
  );
  assert.ok(
    cleanupPrepare,
    "The withdrawal completed without a successful cleanup_prepare event.",
  );
  const cleanupWallet = lifecycleEvents.find(
    (event) =>
      event.flowId === completed.flowId &&
      event.outcome === "observed" &&
      event.stage === "cleanup_wallet_submit_confirm" &&
      event.chainState === "confirmed",
  );
  assert.ok(
    cleanupWallet,
    "The withdrawal completed without confirmed cleanup wallet submission.",
  );
  const cleanupBackend = lifecycleEvents.find(
    (event) =>
      event.flowId === completed.flowId &&
      event.outcome === "observed" &&
      event.stage === "cleanup_backend_confirm" &&
      event.chainState === "confirmed" &&
      event.persistenceState === "recorded" &&
      event.recoveryRequired !== true,
  );
  assert.ok(
    cleanupBackend,
    "The withdrawal completed without recorded cleanup persistence.",
  );
}

async function driveSeedDeposit(): Promise<void> {
  await waitFor(
    "the initial Earn state reads",
    () =>
      apiTimings.some(
        (timing) =>
          timing.method === "GET" &&
          timing.pathname === "/api/smart-accounts/mobile/earn/state" &&
          timing.status === 200,
      ) || false,
    180_000,
  );
  console.info("[withdraw-e2e] initial Earn state loaded for seed");
  await Bun.sleep(2_000);
  const automaticallyStarted = await waitFor(
    "the verifier seed Deposit handler",
    () =>
      lifecycleEvents.some(
        (event) =>
          event.flowName === "earn.deposit" && event.outcome === "started",
      ) || false,
    30_000,
  ).catch(() => false);
  if (automaticallyStarted) {
    console.info("[withdraw-e2e] seed Deposit handler started");
    await waitFor(
      "completed deposit lifecycle",
      () =>
        lifecycleEvents.find(
          (event) =>
            event.flowName === "earn.deposit" &&
            event.outcome === "completed" &&
            event.stage === "ui_commit",
        ) ?? false,
      timeoutMs,
    );
    return;
  }
  let amountInput = await waitForNode("Deposit amount", 15_000).catch(
    () => null,
  );
  let amountFocusedByCoordinate = false;
  let amountSelectedWithMax = false;
  let depositAction: UiNode | null = null;
  if (!amountInput) {
    const openSheet = await waitForNode("Use maximum balance", 5_000).catch(
      () => null,
    );
    if (openSheet) {
      amountSelectedWithMax = true;
      console.info("[withdraw-e2e] verifier seed Deposit sheet is open");
    } else {
      await tapLabel("Earn");
    }
  }
  for (
    let attempt = 0;
    attempt < 4 &&
    !amountInput &&
    !amountFocusedByCoordinate &&
    !amountSelectedWithMax;
    attempt += 1
  ) {
    depositAction = await waitFor(
      "the Earn deposit action",
      () =>
        dumpUi().find(
          (node) =>
            node.enabled &&
            node.clickable &&
            node.contentDescription === "Deposit",
        ) ?? false,
      180_000,
    );
    if (attempt === 0) {
      console.info(
        `[withdraw-e2e] opening deposit sheet at ${JSON.stringify(
          depositAction.bounds,
        )}`,
      );
    }
    if (attempt === 0) {
      tap(depositAction);
    } else if (attempt < 3) {
      const [left, top, right, bottom] = depositAction.bounds;
      const x = String(Math.round((left + right) / 2));
      const y = String(Math.round((top + bottom) / 2));
      if (attempt === 1) {
        adbRun(["shell", "input", "motionevent", "DOWN", x, y]);
        await Bun.sleep(150);
        adbRun(["shell", "input", "motionevent", "UP", x, y]);
      } else {
        adbRun(["shell", "input", "touchscreen", "swipe", x, y, x, y, "250"]);
      }
    } else {
      for (let focusAttempt = 0; focusAttempt < 20; focusAttempt += 1) {
        adbRun(["shell", "input", "keyevent", "KEYCODE_TAB"]);
        const focused = dumpUi().find((node) => node.focused);
        if (
          focused &&
          (focused.contentDescription === "Deposit" ||
            focused.text === "Deposit" ||
            JSON.stringify(focused.bounds) ===
              JSON.stringify(depositAction.bounds))
        ) {
          adbRun(["shell", "input", "keyevent", "KEYCODE_ENTER"]);
          break;
        }
      }
    }
    amountInput = await waitForNode("Deposit amount", 8_000).catch(() => null);
  }
  if (!amountInput && !amountFocusedByCoordinate && !amountSelectedWithMax) {
    throw new Error(
      `The Earn deposit action did not open its sheet (bounds: ${JSON.stringify(
        depositAction?.bounds ?? null,
      )}).`,
    );
  }
  if (!amountSelectedWithMax) {
    if (amountInput) tap(amountInput);
    typeWithoutCommandArgument(seedAmountUsd.toFixed(2));
  }
  if (isSoftKeyboardVisible()) {
    adbRun(["shell", "input", "keyevent", "KEYCODE_BACK"]);
    await waitFor(
      "the keyboard to close",
      () => !isSoftKeyboardVisible(),
      3_000,
    ).catch(() => undefined);
  }
  lifecycleEvents.length = 0;
  apiTimings.length = 0;
  const submitButton = await waitFor(
    "the deposit submit button",
    () => {
      const candidates = dumpUi().filter(
        (node) =>
          node.enabled &&
          node.clickable &&
          node.contentDescription === "Deposit" &&
          JSON.stringify(node.bounds) !==
            JSON.stringify(depositAction?.bounds ?? seedDepositActionBounds),
      );
      return (
        candidates.sort((left, right) => right.bounds[3] - left.bounds[3])[0] ??
        false
      );
    },
    120_000,
  );
  tap(submitButton);
  console.info(
    `[withdraw-e2e] activated seed Deposit CTA at ${JSON.stringify(
      submitButton.bounds,
    )}`,
  );
  const depositStarted = (): boolean =>
    lifecycleEvents.some(
      (event) =>
        event.flowName === "earn.deposit" && event.outcome === "started",
    ) || apiTimings.some((timing) => timing.pathname.includes("/deposit"));
  let handlerStarted = await waitFor(
    "the deposit handler to start",
    () => depositStarted() || false,
    5_000,
  ).catch(() => false);
  if (!handlerStarted) {
    const [left, top, right, bottom] = submitButton.bounds;
    const x = String(Math.round((left + right) / 2));
    const y = String(Math.round((top + bottom) / 2));
    adbRun(["shell", "input", "touchscreen", "swipe", x, y, x, y, "200"]);
    handlerStarted = await waitFor(
      "the deposit handler to start after fallback activation",
      () => depositStarted() || false,
      10_000,
    ).catch(() => false);
  }
  if (!handlerStarted) {
    for (let focusAttempt = 0; focusAttempt < 30; focusAttempt += 1) {
      adbRun(["shell", "input", "keyevent", "KEYCODE_TAB"]);
      const focused = dumpUi().find((node) => node.focused);
      if (
        focused &&
        JSON.stringify(focused.bounds) === JSON.stringify(submitButton.bounds)
      ) {
        adbRun(["shell", "input", "keyevent", "KEYCODE_ENTER"]);
        break;
      }
    }
    handlerStarted = await waitFor(
      "the deposit handler to start after keyboard activation",
      () => depositStarted() || false,
      10_000,
    ).catch(() => false);
  }
  if (!handlerStarted) {
    throw new Error("The seed Deposit CTA did not invoke its real handler.");
  }
  console.info("[withdraw-e2e] seed Deposit handler started");
  await waitFor(
    "completed deposit lifecycle",
    () =>
      lifecycleEvents.find(
        (event) =>
          event.flowName === "earn.deposit" &&
          event.outcome === "completed" &&
          event.stage === "ui_commit",
      ) ?? false,
    timeoutMs,
  );
}

async function main(): Promise<void> {
  if (process.env.CONFIRM_MAINNET_WITHDRAW !== MAINNET_ACK) {
    throw new Error(
      `Set CONFIRM_MAINNET_WITHDRAW=${MAINNET_ACK} after explicitly approving the mainnet verifier transaction.`,
    );
  }
  if (!keyPath) {
    throw new Error(
      "Set MOBILE_E2E_WALLET_KEYPAIR to the approved keypair file.",
    );
  }
  accessSync(keyPath, constants.R_OK);
  assert.ok(Number.isFinite(maxPositionUsd) && maxPositionUsd > 0);
  assert.ok(Number.isFinite(seedAmountUsd) && seedAmountUsd > 0);

  const secretBytes = Uint8Array.from(
    JSON.parse(readFileSync(keyPath, "utf8")) as number[],
  );
  const keypair = Keypair.fromSecretKey(secretBytes);
  const walletAddress = keypair.publicKey.toBase58();
  const secretInputValue = Array.from(secretBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  secretBytes.fill(0);
  const beforeRaw = await currentPositionRaw(walletAddress);
  const beforeUsd = Number(beforeRaw) / 1_000_000;
  if (mode === "withdraw") {
    if (beforeRaw <= BigInt(0)) {
      throw new Error(
        "The approved wallet has no active Earn position to withdraw.",
      );
    }
    if (beforeUsd > maxPositionUsd) {
      throw new Error(
        `Refusing to withdraw $${beforeUsd.toFixed(
          6,
        )}; the verifier cap is $${maxPositionUsd.toFixed(2)}.`,
      );
    }
  } else if (beforeRaw > BigInt(0)) {
    throw new Error("Seed-position mode requires no active Earn position.");
  } else {
    const walletUsdcRaw = await currentWalletUsdcRaw(keypair.publicKey);
    const maximumRaw = BigInt(Math.trunc(maxPositionUsd * 1_000_000));
    if (walletUsdcRaw > maximumRaw) {
      throw new Error(
        `Refusing to MAX-deposit ${walletUsdcRaw.toString()} raw USDC; the verifier cap is ${maximumRaw.toString()}.`,
      );
    }
    if (walletUsdcRaw < BigInt(Math.trunc(seedAmountUsd * 1_000_000))) {
      throw new Error(
        "The approved wallet does not have enough USDC to seed the position.",
      );
    }
  }

  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: proxyPort,
    fetch: proxyRequest,
  });
  try {
    emulatorSerial = await ensureEmulator();
    const env = verifierEnv();
    const androidRoot = resolve(import.meta.dir, "../android");
    if (existsSync(androidRoot)) {
      // Reuse the generated native project when it already matches this branch.
    } else {
      run("npx", ["expo", "prebuild", "--platform", "android", "--clean"], {
        env,
      });
    }
    assembleVerifierApk(androidRoot, env);
    const apk = join(androidRoot, "app/build/outputs/apk/debug/app-debug.apk");
    adbRun(["install", "-r", apk]);
    adbRun(["shell", "pm", "clear", APP_PACKAGE]);
    adbRun(["reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
    adbRun(["reverse", `tcp:${proxyPort}`, `tcp:${proxyPort}`]);
    materializeWorktreePrivateTransactionsEntry();

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
      { env },
    );
    await waitFor(
      "Metro",
      async () => {
        if (metro.exitCode !== null) throw new Error("Metro exited early.");
        const response = await fetch(
          `http://127.0.0.1:${metroPort}/status`,
        ).catch(() => null);
        return response?.ok ?? false;
      },
      180_000,
    );
    const devClientUrl = `${APP_SCHEME}://expo-development-client/?url=${encodeURIComponent(
      `http://127.0.0.1:${metroPort}`,
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
    await importWallet(secretInputValue);
    keypair.secretKey.fill(0);
    console.info("[withdraw-e2e] wallet imported through the app UI");
    if (mode === "seed-position") {
      await tapLabel("Earn");
      seedDepositActionBounds = (
        await waitFor(
          "the original Earn deposit action",
          () =>
            dumpUi().find(
              (node) =>
                node.enabled &&
                node.clickable &&
                node.contentDescription === "Deposit",
            ) ?? false,
          180_000,
        )
      ).bounds;
      console.info(
        `[withdraw-e2e] captured original Deposit action at ${JSON.stringify(
          seedDepositActionBounds,
        )}`,
      );
      lifecycleEvents.length = 0;
      apiTimings.length = 0;
    }
    openDepositSheetInSeedBundle();
    if (mode === "seed-position") {
      await Bun.sleep(2_000);
      console.info(
        "[withdraw-e2e] loaded verifier seed bundle by Fast Refresh",
      );
    }

    if (mode === "withdraw") {
      await driveWithdraw();
    } else {
      await driveSeedDeposit();
    }

    const afterRawString = await waitFor(
      mode === "withdraw"
        ? "the position to reach zero"
        : "the position to appear",
      async () => {
        const raw = await currentPositionRaw(walletAddress);
        return mode === "withdraw"
          ? raw === BigInt(0)
            ? raw.toString()
            : false
          : raw > BigInt(0)
            ? raw.toString()
            : false;
      },
      180_000,
    );
    const report = {
      apiTimings,
      beforePositionRaw: beforeRaw.toString(),
      lifecycleEvents,
      mode,
      positionRawAfter: afterRawString,
      stageDurationsMs: lifecycleStageDurations(
        mode === "withdraw" ? "earn.withdrawal" : "earn.deposit",
      ),
      walletAddress,
    };
    if (outputPath) {
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
        mode: 0o600,
      });
    }
    console.info(JSON.stringify(report, null, 2));
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
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  if (emulatorSerial) {
    spawnSync(
      adb,
      ["-s", emulatorSerial, "shell", "pm", "clear", APP_PACKAGE],
      {
        stdio: "ignore",
      },
    );
    spawnSync(
      adb,
      [
        "-s",
        emulatorSerial,
        "shell",
        "rm",
        "-f",
        "/sdcard/loyal-withdraw-ui.xml",
      ],
      {
        stdio: "ignore",
      },
    );
  }
  if (emulatorStarted) {
    spawnSync(adb, ["-s", emulatorSerial!, "emu", "kill"], { stdio: "ignore" });
  }
  restorePrivateTransactionsEntry();
  restoreDepositSource();
  processLog.end();
  if (process.exitCode !== 1)
    rmSync(tempRoot, { recursive: true, force: true });
}
