import assert from "node:assert/strict";
import {
  accessSync,
  copyFileSync,
  constants,
  createWriteStream,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from "node:child_process";

import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { buildOtlpLifecyclePayload } from "../../web/src/features/observability/otlp";

const APP_PACKAGE = "com.loyal.app.dev";
const APP_SCHEME = "loyal-dev";
const DEFAULT_AVD = "SkyVerse_API_35";
const DEFAULT_METRO_PORT = 8081;
const DEFAULT_PROXY_PORT = 4319;
const MAINNET_ACK = "I_ACKNOWLEDGE_MAINNET";
const UPSTREAM = process.env.MOBILE_WITHDRAW_UPSTREAM ?? "https://askloyal.com";
const solanaEnv = process.env.MOBILE_WITHDRAW_SOLANA_ENV ?? "mainnet";
const isIsolatedLocalnet = solanaEnv === "localnet";
const LIFECYCLE_PATH = "/api/observability/mobile/events";
const ERROR_PATH = "/api/observability/mobile/errors";
const METRICS_PATH = "/api/observability/mobile/metrics";
const INSUFFICIENT_SOL_ACK = "I_ACKNOWLEDGE_MAINNET_READ_ONLY";
const INCIDENT_BALANCE_LAMPORTS = "11887572";
const INCIDENT_DEFICIT_LAMPORTS = "27645228";
const INCIDENT_REQUIRED_LAMPORTS = "39532800";
const INCIDENT_MESSAGE =
  "Add at least 0.027645228 SOL to your wallet before depositing. This Earn setup needs 0.0395328 SOL for account rent and network fees.";
const MAINNET_USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

type Mode = "withdraw" | "seed-position" | "insufficient-sol";

type LifecycleEvent = {
  chainState?: string;
  durationMs: number;
  elapsedMs: number;
  errorCode?: string;
  errorDetail?: string;
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
  upstream?: string | null;
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
  : process.argv.includes("--insufficient-sol")
  ? "insufficient-sol"
  : "withdraw";
const keyPath = process.env.MOBILE_E2E_WALLET_KEYPAIR
  ? resolve(process.env.MOBILE_E2E_WALLET_KEYPAIR)
  : null;
const avdName = process.env.MOBILE_WITHDRAW_AVD ?? DEFAULT_AVD;
const metroPort = Number(
  process.env.MOBILE_WITHDRAW_METRO_PORT ?? DEFAULT_METRO_PORT
);
const proxyPort = Number(
  process.env.MOBILE_WITHDRAW_PROXY_PORT ?? DEFAULT_PROXY_PORT
);
const androidAbi = process.env.MOBILE_WITHDRAW_ANDROID_ABI ?? "arm64-v8a";
const maxPositionUsd = Number(
  process.env.MOBILE_WITHDRAW_MAX_POSITION_USD ?? "2"
);
const seedAmountUsd = Number(
  process.env.MOBILE_WITHDRAW_SEED_AMOUNT_USD ?? "1.17"
);
const timeoutMs = Number(process.env.MOBILE_WITHDRAW_TIMEOUT_MS ?? "600000");
const outputPath = process.env.MOBILE_WITHDRAW_PROFILE_OUTPUT
  ? resolve(process.env.MOBILE_WITHDRAW_PROFILE_OUTPUT)
  : null;
const requireRealLoyalApi = process.env.MOBILE_REQUIRE_REAL_API === "1";

const tempRoot = mkdtempSync(join(tmpdir(), "loyal-withdraw-profile-"));
const processLogPath = join(tempRoot, "processes.log");
const processLog = createWriteStream(processLogPath, { flags: "a" });
const children: ChildProcess[] = [];
const lifecycleEvents: LifecycleEvent[] = [];
const globalErrorEvents: unknown[] = [];
const apiTimings: ApiTiming[] = [];
let emulatorStarted = false;
let emulatorSerial: string | null = null;
let seedDepositActionBounds: UiNode["bounds"] | null = null;
let patchedKaminoClientSource: { path: string; source: string } | undefined;
const seededDepositSources: { path: string; source: string }[] = [];

function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    quiet?: boolean;
  } = {}
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
      }`
    );
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
  child.stdout?.pipe(processLog);
  child.stderr?.pipe(processLog);
  children.push(child);
  return child;
}

async function waitFor<T>(
  description: string,
  read: () => T | false | Promise<T | false>,
  limitMs = 60_000,
  pollMs = 500
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
    await Bun.sleep(pollMs);
  }
  throw new Error(
    `Timed out waiting for ${description}${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }.`
  );
}

function findExecutable(candidates: (string | null)[], label: string): string {
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
  "ADB"
);

const emulator = findExecutable(
  [
    process.env.ANDROID_HOME
      ? join(process.env.ANDROID_HOME, "emulator/emulator")
      : null,
    "/opt/homebrew/share/android-commandlinetools/emulator/emulator",
  ],
  "Android emulator"
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
    180_000
  );
  emulatorSerial = serial;
  await waitFor(
    "Android boot completion",
    () => adbRun(["shell", "getprop", "sys.boot_completed"]) === "1",
    180_000
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

function routeKaminoInstructionApiThroughVerifier(): void {
  if (!isIsolatedLocalnet) return;
  const path = resolve(
    import.meta.dir,
    "../../../packages/smart-account-vaults/src/client.ts"
  );
  const source = readFileSync(path, "utf8");
  const replacements = [
    [
      "https://api.kamino.finance/ktx/klend/deposit-instructions",
      `http://127.0.0.1:${proxyPort}/ktx/klend/deposit-instructions`,
    ],
    [
      "https://api.kamino.finance/ktx/klend/withdraw-instructions",
      `http://127.0.0.1:${proxyPort}/ktx/klend/withdraw-instructions`,
    ],
  ] as const;
  let patched = source;
  for (const [from, to] of replacements) {
    assert.equal(
      patched.split(from).length - 1,
      1,
      `The verifier could not locate Kamino instruction URL ${from}.`
    );
    patched = patched.replace(from, to);
  }
  writeFileSync(path, patched);
  patchedKaminoClientSource = { path, source };
}

function restoreKaminoClientSource(): void {
  if (!patchedKaminoClientSource) return;
  writeFileSync(
    patchedKaminoClientSource.path,
    patchedKaminoClientSource.source
  );
  patchedKaminoClientSource = undefined;
}

function injectIncidentNativeSolRequirement(): void {
  const path = resolve(import.meta.dir, "../src/lib/solana/earn/deposit.ts");
  const source = readFileSync(path, "utf8");
  const marker = "  const amountRaw = usdToStableRaw(args.amountUsd);";
  assert.equal(
    source.split(marker).length - 1,
    1,
    "The insufficient-SOL verifier could not locate the deposit action."
  );
  writeFileSync(
    path,
    source.replace(
      marker,
      [
        marker,
        "  assertNativeSolRequirement({",
        `    balanceLamports: ${JSON.stringify(INCIDENT_BALANCE_LAMPORTS)},`,
        '    balanceSource: "queried",',
        "    canProceed: false,",
        `    deficitLamports: ${JSON.stringify(INCIDENT_DEFICIT_LAMPORTS)},`,
        "    items: [{",
        '      kind: "kamino_setup_top_up",',
        '      label: "Kamino setup account rent",',
        `      lamports: ${JSON.stringify(INCIDENT_REQUIRED_LAMPORTS)},`,
        '      stage: "deposit",',
        "    }],",
        "    payer: args.signer.publicKey.toBase58(),",
        `    requiredLamports: ${JSON.stringify(INCIDENT_REQUIRED_LAMPORTS)},`,
        "  });",
      ].join("\n")
    )
  );
  seededDepositSources.push({ path, source });
}

function openDepositSheetInVerifierBundle(): void {
  if (mode === "withdraw") return;
  if (mode === "seed-position") {
    const path = resolve(import.meta.dir, "../app/(tabs)/index.tsx");
    const source = readFileSync(path, "utf8");
    const marker = "const [depositOpen, setDepositOpen] = useState(false);";
    assert.equal(
      source.split(marker).length - 1,
      1,
      "The seed verifier could not locate the Deposit sheet state."
    );
    writeFileSync(
      path,
      source.replace(
        marker,
        [
          "const [depositOpenState, setDepositOpen] = useState(false);",
          "const depositOpen = true || depositOpenState;",
        ].join("\n")
      )
    );
    seededDepositSources.push({ path, source });
  } else {
    const path = resolve(import.meta.dir, "../app/(tabs)/index.tsx");
    const source = readFileSync(path, "utf8");
    const logBoxMarker =
      'import { Alert, StyleSheet, useWindowDimensions } from "react-native";';
    assert.equal(
      source.split(logBoxMarker).length - 1,
      1,
      "The insufficient-SOL verifier could not locate the React Native import."
    );
    const logBoxSource = source.replace(
      logBoxMarker,
      [
        'import { Alert, LogBox, StyleSheet, useWindowDimensions } from "react-native";',
        "LogBox.ignoreAllLogs(true);",
      ].join("\n")
    );
    const openMarker = "const [depositOpen, setDepositOpen] = useState(false);";
    assert.equal(
      logBoxSource.split(openMarker).length - 1,
      1,
      "The insufficient-SOL verifier could not locate the Deposit state."
    );
    writeFileSync(
      path,
      logBoxSource.replace(
        openMarker,
        [
          "const [depositOpen, setDepositOpen] = useState(false);",
          "const insufficientSolVerifierStarted = useRef(false);",
          "useEffect(() => {",
          "  if (!signer || insufficientSolVerifierStarted.current) return;",
          "  const timer = setTimeout(() => {",
          "    if (insufficientSolVerifierStarted.current) return;",
          "    insufficientSolVerifierStarted.current = true;",
          "    void executeEarnDeposit({",
          "      signer,",
          `      amountUsd: ${seedAmountUsd.toFixed(2)},`,
          "      mint: SOLANA_USDC_MINT_MAINNET,",
          "    }).catch((error) => {",
          "      Alert.alert(",
          '        "Deposit unavailable",',
          '        error instanceof Error ? error.message : "Deposit failed. Please try again.",',
          "      );",
          "    });",
          "  }, 5000);",
          "  return () => clearTimeout(timer);",
          "}, [signer]);",
        ].join("\n")
      )
    );
    seededDepositSources.push({ path, source });
    injectIncidentNativeSolRequirement();
    return;
  }

  const sheetPath = resolve(
    import.meta.dir,
    "../src/components/earn/DepositSheet.tsx"
  );
  const sheetSource = readFileSync(sheetPath, "utf8");
  const amountMarker = 'const [amount, setAmount] = useState("");';
  assert.equal(
    sheetSource.split(amountMarker).length - 1,
    1,
    "The seed verifier could not locate the Deposit amount state."
  );
  const seededAmount = seedAmountUsd.toFixed(2);
  const initializedSheetSource = sheetSource.replace(
    amountMarker,
    `const [amount, setAmount] = useState(${JSON.stringify(seededAmount)});`
  );
  const resetMarker = [
    "    if (open) {",
    '      setAmount("");',
    "      setSubmitError(null);",
  ].join("\n");
  assert.equal(
    initializedSheetSource.split(resetMarker).length - 1,
    1,
    "The seed verifier could not locate the Deposit open reset."
  );
  const initializedAndResetSheetSource = initializedSheetSource.replace(
    resetMarker,
    [
      "    if (open) {",
      `      setAmount(${JSON.stringify(seededAmount)});`,
      "      setSubmitError(null);",
    ].join("\n")
  );
  const availableMarker = "  const available = selectedSource.usd;";
  assert.equal(
    initializedAndResetSheetSource.split(availableMarker).length - 1,
    1,
    "The seed verifier could not locate the selected balance state."
  );
  let boundedSheetSource = initializedAndResetSheetSource.replace(
    availableMarker,
    `  const available = ${seededAmount};`
  );
  if (mode === "insufficient-sol") {
    const topUpMarker =
      "const needsSolTopUp = (firstDepositSolShortfall ?? 0) > 0;";
    assert.equal(
      boundedSheetSource.split(topUpMarker).length - 1,
      1,
      "The insufficient-SOL verifier could not locate the generic SOL preflight."
    );
    // Exercise the SDK's exact dynamic rent requirement instead of the UI's
    // coarse first-deposit estimate. This mutation exists only in the Metro
    // verifier bundle and is restored in finally.
    boundedSheetSource = boundedSheetSource.replace(
      topUpMarker,
      "const needsSolTopUp = false;"
    );
  }
  const handlerMarker =
    "  }, [amount, available, onDeposit, selectedSource.mint]);";
  assert.equal(
    boundedSheetSource.split(handlerMarker).length - 1,
    1,
    "The seed verifier could not locate the real Deposit handler."
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
      ].join("\n")
    )
  );
  seededDepositSources.push({ path: sheetPath, source: sheetSource });
}

function openWithdrawSheetInVerifierBundle(): void {
  if (mode !== "withdraw") return;
  const path = resolve(import.meta.dir, "../app/(tabs)/index.tsx");
  const source = readFileSync(path, "utf8");
  const marker = "const [withdrawOpen, setWithdrawOpen] = useState(false);";
  assert.equal(
    source.split(marker).length - 1,
    1,
    "The withdrawal verifier could not locate the Withdraw sheet state."
  );
  writeFileSync(
    path,
    source.replace(
      marker,
      [
        "const [withdrawOpenState, setWithdrawOpen] = useState(false);",
        "const withdrawOpen = true || withdrawOpenState;",
      ].join("\n")
    )
  );
  seededDepositSources.push({ path, source });

  const sheetPath = resolve(
    import.meta.dir,
    "../src/components/earn/WithdrawSheet.tsx"
  );
  const sheetSource = readFileSync(sheetPath, "utf8");
  const handlerMarker = "  const renderBackdrop = useCallback(";
  assert.equal(
    sheetSource.split(handlerMarker).length - 1,
    1,
    "The withdrawal verifier could not locate the real Withdraw handler."
  );
  writeFileSync(
    sheetPath,
    sheetSource.replace(
      handlerMarker,
      [
        "  const verifierSubmitted = useRef(false);",
        "  useEffect(() => {",
        "    if (!open || available <= 0 || maxSelected) return;",
        "    setAmount(floorTo2(available).toFixed(2));",
        "    setMaxSelected(true);",
        "  }, [available, maxSelected, open]);",
        "  useEffect(() => {",
        "    if (",
        "      !open ||",
        "      disabled ||",
        "      !maxSelected ||",
        "      (hasPicker && !selectedSource) ||",
        "      verifierSubmitted.current",
        "    ) return;",
        "    verifierSubmitted.current = true;",
        "    const timer = setTimeout(() => void handleWithdraw(), 10);",
        "    return () => clearTimeout(timer);",
        "  }, [disabled, handleWithdraw, hasPicker, maxSelected, open, selectedSource]);",
        "",
        handlerMarker,
      ].join("\n")
    )
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
  env: NodeJS.ProcessEnv
): void {
  const manifestPath = join(androidRoot, "app/src/main/AndroidManifest.xml");
  const originalManifest = readFileSync(manifestPath, "utf8");
  const verifierManifest = originalManifest.includes(
    "android:usesCleartextTraffic="
  )
    ? originalManifest.replace(
        /android:usesCleartextTraffic="[^"]*"/,
        'android:usesCleartextTraffic="true"'
      )
    : originalManifest.replace(
        "<application ",
        '<application android:usesCleartextTraffic="true" '
      );
  writeFileSync(manifestPath, verifierManifest);
  try {
    assert.match(androidAbi, /^(?:arm64-v8a|x86_64)$/);
    const gradleArgs = [
      "--no-parallel",
      `-PreactNativeArchitectures=${androidAbi}`,
    ];
    run(
      "./gradlew",
      [
        `:react-native-worklets:buildCMakeDebug[${androidAbi}][worklets]`,
        ...gradleArgs,
      ],
      { cwd: androidRoot, env }
    );
    // Reanimated 4.1.1 still imports Worklets from AGP's old `cmake` output
    // path, while AGP 8.11 publishes the library under a hashed `cxx` path.
    // Materialize the compatibility copy after Worklets has built so a fresh
    // verifier checkout can assemble reliably.
    const workletsIntermediates = resolve(
      androidRoot,
      "../node_modules/react-native-worklets/android/build/intermediates"
    );
    const workletsCandidates = readdirSync(
      join(workletsIntermediates, "cxx/Debug")
    )
      .map((directory) =>
        join(
          workletsIntermediates,
          "cxx/Debug",
          directory,
          `obj/${androidAbi}/libworklets.so`
        )
      )
      .filter(existsSync);
    assert.equal(
      workletsCandidates.length,
      1,
      `The verifier expected one ${androidAbi} Worklets library.`
    );
    const legacyWorkletsPath = join(
      workletsIntermediates,
      `cmake/debug/obj/${androidAbi}/libworklets.so`
    );
    mkdirSync(dirname(legacyWorkletsPath), { recursive: true });
    copyFileSync(workletsCandidates[0]!, legacyWorkletsPath);
    run(
      "./gradlew",
      [
        "app:assembleDebug",
        "--exclude-task",
        `:react-native-worklets:buildCMakeDebug[${androidAbi}][worklets]`,
        ...gradleArgs,
      ],
      {
        cwd: androidRoot,
        env,
      }
    );
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
    adbRun(["exec-out", "cat", "/sdcard/loyal-withdraw-ui.xml"])
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
    limitMs
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
    }
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
    180_000
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
      180_000
    );
    if (next.kind === "close") {
      // Expo's developer-menu Close control is not reliably activated by an
      // accessibility-coordinate tap on headless emulators. Android Back is
      // the native dismissal path and avoids waiting on the obscured app UI.
      adbRun(["shell", "input", "keyevent", "KEYCODE_BACK"]);
    }
    try {
      await waitForNode("Import Existing Wallet", 180_000);
    } catch (error) {
      const visibleLabels = dumpUi()
        .flatMap((node) => [node.text, node.contentDescription])
        .filter(Boolean)
        .slice(0, 80);
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        }; visible UI labels: ${JSON.stringify(visibleLabels)}`
      );
    }
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
      }, observed candidate lengths ${JSON.stringify(observedLengths)}).`
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
        importButton.bounds
      )}).`
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
      const importModalOpen = findNode(nodes, "Import Wallet") !== null;
      if (
        findNode(nodes, "Importing wallet...") ||
        (!importModalOpen &&
          (findNode(nodes, "Skip for now") ||
            findNode(nodes, "Earn") ||
            findNode(nodes, "Deposit")))
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
        importButtonBounds
      )}).`
    );
  }

  const biometricChoice = await waitFor(
    "wallet import completion",
    () => {
      const nodes = dumpUi();
      if (findNode(nodes, "Import Wallet")) return false;
      const skip = findNode(nodes, "Skip for now");
      if (skip) return { kind: "skip" as const, node: skip };
      const earnScreen = findNode(nodes, "Earn") ?? findNode(nodes, "Deposit");
      if (earnScreen) return { kind: "ready" as const };
      if (
        mode === "insufficient-sol" &&
        lifecycleEvents.some(
          (event) =>
            event.flowName === "earn.deposit" && event.outcome === "started"
        )
      ) {
        return { kind: "ready" as const };
      }
      return false;
    },
    180_000
  );
  if (biometricChoice.kind === "skip") {
    tap(biometricChoice.node);
    await waitFor(
      "the Earn screen",
      () => {
        const nodes = dumpUi();
        return findNode(nodes, "Earn") ?? findNode(nodes, "Deposit") ?? false;
      },
      180_000
    );
  }
}

async function currentPositionRaw(walletAddress: string): Promise<bigint> {
  const response = await fetch(
    `${UPSTREAM}/api/smart-accounts/mobile/earn/state?walletAddress=${encodeURIComponent(
      walletAddress
    )}`
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
    "confirmed"
  );
  const account = getAssociatedTokenAddressSync(
    MAINNET_USDC_MINT,
    walletAddress,
    false,
    TOKEN_PROGRAM_ID
  );
  try {
    return BigInt(
      (await connection.getTokenAccountBalance(account)).value.amount
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
    EXPO_PUBLIC_API_BASE_URL: isIsolatedLocalnet
      ? `http://127.0.0.1:${proxyPort}`
      : process.env.EXPO_PUBLIC_API_BASE_URL ??
        "https://solana-telegram-transactions.vercel.app",
    EXPO_PUBLIC_EARN_API_BASE_URL: `http://127.0.0.1:${proxyPort}`,
    EXPO_PUBLIC_SOLANA_ENV: solanaEnv,
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
  if (request.method === "POST" && url.pathname === ERROR_PATH) {
    globalErrorEvents.push(await request.json().catch(() => null));
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
    upstream: upstreamResponse.headers.get("x-loyal-e2e-api"),
  });
  if (isIsolatedLocalnet) {
    console.info(
      `[withdraw-e2e] local API ${request.method} ${url.pathname} -> ${upstreamResponse.status}`
    );
  }
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

function lifecycleSeverity(event: LifecycleEvent): string | undefined {
  const payload = buildOtlpLifecyclePayload({
    deploymentEnvironment: "prod",
    pathname: "/",
    release: "android-e2e",
    runtime: "mobile",
    serviceName: "loyal-mobile",
    source: "mobile_app",
    ...event,
  });
  return payload.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]?.severityText;
}

function lifecycleStageDurations(flowName: string): Record<string, number> {
  const matching = lifecycleEvents.filter(
    (event) => event.flowName === flowName
  );
  return Object.fromEntries(
    matching.map((event) => [
      `${event.stage}.${event.outcome}`,
      Number(event.durationMs),
    ])
  );
}

async function driveWithdraw(): Promise<void> {
  await waitFor(
    "the imported wallet's initial Earn state read",
    () =>
      apiTimings.some(
        (timing) =>
          timing.method === "GET" &&
          timing.pathname === "/api/smart-accounts/mobile/earn/state" &&
          timing.status === 200
      ) || false,
    180_000
  );
  console.info("[withdraw-e2e] imported wallet Earn state loaded");
  if (isIsolatedLocalnet) {
    await waitFor(
      "the verifier-triggered withdrawal handler",
      () =>
        lifecycleEvents.some(
          (event) =>
            event.flowName === "earn.withdrawal" && event.outcome === "started"
        ) ||
        apiTimings.some((timing) => timing.pathname.includes("/withdraw")) ||
        false,
      120_000,
      10
    );
    console.info(
      "[withdraw-e2e] verifier triggered the real mobile withdrawal handler"
    );
    await verifyCompletedWithdrawLifecycle();
    return;
  }
  const initialNodes = dumpUi();
  const earnTab = findNode(initialNodes, "Earn");
  if (earnTab) {
    console.info("[withdraw-e2e] opening Earn tab");
    tap(earnTab);
  } else {
    assert.ok(
      findNode(initialNodes, "Deposit"),
      "The imported wallet opened neither the Earn tab nor the Earn screen."
    );
    console.info("[withdraw-e2e] Earn screen is already open");
  }
  console.info("[withdraw-e2e] opening withdrawal sheet");
  let maxButton =
    findNode(dumpUi(), "Use maximum balance") ??
    findNode(dumpUi(), "MAX") ??
    null;
  let withdrawActionBounds: UiNode["bounds"] | null = null;
  for (let attempt = 0; attempt < 4 && !maxButton; attempt += 1) {
    const withdrawAction = await waitFor(
      "the Earn withdrawal action",
      () =>
        dumpUi().find((node) => node.contentDescription === "Withdraw") ??
        false,
      180_000
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
      8_000
    ).catch(() => null);
  }
  if (!maxButton) {
    throw new Error(
      `The Earn withdrawal action did not open its sheet (last bounds: ${JSON.stringify(
        withdrawActionBounds
      )}).`
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
          (node.contentDescription === "Withdraw" || node.text === "Withdraw")
      );
      return (
        candidates.sort((left, right) => right.bounds[3] - left.bounds[3])[0] ??
        false
      );
    },
    120_000
  );
  const started = async (): Promise<boolean> =>
    lifecycleEvents.some(
      (event) =>
        event.flowName === "earn.withdrawal" && event.outcome === "started"
    ) || apiTimings.some((timing) => timing.pathname.includes("/withdraw"));
  tap(submitButton);
  let handlerStarted = await waitFor(
    "the withdrawal handler to start",
    async () => (await started()) || false,
    5_000
  ).catch(() => false);
  if (!handlerStarted) {
    const [left, top, right, bottom] = submitButton.bounds;
    const x = String(Math.round((left + right) / 2));
    const y = String(Math.round((top + bottom) / 2));
    adbRun(["shell", "input", "touchscreen", "swipe", x, y, x, y, "200"]);
    handlerStarted = await waitFor(
      "the withdrawal handler to start after the fallback activation",
      async () => (await started()) || false,
      10_000
    ).catch(() => false);
  }
  if (!handlerStarted) {
    throw new Error(
      `The enabled withdrawal CTA did not invoke its handler (bounds: ${JSON.stringify(
        submitButton.bounds
      )}).`
    );
  }
  console.info("[withdraw-e2e] withdrawal handler started through the app UI");
  await verifyCompletedWithdrawLifecycle();
}

async function verifyCompletedWithdrawLifecycle(): Promise<void> {
  const completed = await waitFor(
    "completed withdrawal lifecycle",
    () =>
      lifecycleEvents.find(
        (event) =>
          event.flowName === "earn.withdrawal" &&
          event.outcome === "completed" &&
          event.stage === "ui_commit"
      ) ?? false,
    timeoutMs,
    isIsolatedLocalnet ? 10 : 500
  );
  await waitFor(
    "successful cleanup_prepare lifecycle",
    () =>
      lifecycleEvents.find(
        (event) =>
          event.flowId === completed.flowId &&
          event.outcome === "observed" &&
          event.stage === "cleanup_prepare"
      ) ?? false,
    10_000,
    10
  );
  await waitFor(
    "confirmed cleanup wallet submission lifecycle",
    () =>
      lifecycleEvents.find(
        (event) =>
          event.flowId === completed.flowId &&
          event.outcome === "observed" &&
          event.stage === "cleanup_wallet_submit_confirm" &&
          event.chainState === "confirmed"
      ) ?? false,
    10_000,
    10
  );
}

function verifyRealLoyalApiCoverage(): void {
  if (!requireRealLoyalApi) return;

  const requiredRequests = [
    ["POST", "/api/smart-accounts/mobile/earn/withdraw/prepare-context"],
    ["POST", "/api/smart-accounts/mobile/earn/withdraw/confirm"],
    [
      "POST",
      "/api/smart-accounts/mobile/earn/withdraw/cleanup/prepare-context",
    ],
  ] as const;
  for (const [method, pathname] of requiredRequests) {
    const request = apiTimings.find(
      (timing) =>
        timing.method === method &&
        timing.pathname === pathname &&
        timing.status >= 200 &&
        timing.status < 300 &&
        timing.upstream === "real-loyal-app"
    );
    assert.ok(
      request,
      `${method} ${pathname} did not succeed through the real loyal-app API.`
    );
  }
}

async function verifyInsufficientSolOutcome(): Promise<void> {
  const terminal = await waitFor(
    "cancelled insufficient-SOL lifecycle",
    () =>
      lifecycleEvents.find(
        (event) =>
          event.flowName === "earn.deposit" &&
          event.outcome === "cancelled" &&
          event.stage === "prepare" &&
          event.errorCode === "insufficient_native_sol"
      ) ?? false,
    timeoutMs
  );
  await waitForNode(INCIDENT_MESSAGE, 30_000);
  await Bun.sleep(1_000);
  assert.equal(
    lifecycleSeverity(terminal),
    "INFO",
    "The production lifecycle mapper classified the shortfall as alertable."
  );
  assert.equal(
    lifecycleEvents.some(
      (event) => event.flowName === "earn.deposit" && event.outcome === "failed"
    ),
    false,
    "The expected shortfall emitted a failed lifecycle event."
  );
  assert.equal(
    globalErrorEvents.length,
    0,
    "The expected shortfall reached the global error ingest."
  );
  assert.equal(
    apiTimings.some(
      (timing) =>
        timing.pathname.includes("/deposit/confirm") ||
        timing.pathname.includes("/deposit/sponsor")
    ),
    false,
    "The expected shortfall reached a deposit submission endpoint."
  );
}

async function driveSeedDeposit(): Promise<void> {
  if (mode !== "insufficient-sol") {
    await waitFor(
      "the initial Earn state reads",
      () =>
        apiTimings.some(
          (timing) =>
            timing.method === "GET" &&
            timing.pathname === "/api/smart-accounts/mobile/earn/state" &&
            timing.status === 200
        ) || false,
      180_000
    );
    console.info("[withdraw-e2e] initial Earn state loaded for seed");
  }
  await Bun.sleep(2_000);
  const automaticallyStarted = await waitFor(
    "the verifier seed Deposit handler",
    () =>
      lifecycleEvents.some(
        (event) =>
          event.flowName === "earn.deposit" && event.outcome === "started"
      ) || false,
    30_000
  ).catch(() => false);
  if (automaticallyStarted) {
    console.info("[withdraw-e2e] seed Deposit handler started");
    if (mode === "insufficient-sol") {
      await verifyInsufficientSolOutcome();
      return;
    }
    await waitFor(
      "completed deposit lifecycle",
      () =>
        lifecycleEvents.find(
          (event) =>
            event.flowName === "earn.deposit" &&
            event.outcome === "completed" &&
            event.stage === "ui_commit"
        ) ?? false,
      timeoutMs
    );
    return;
  }
  let amountInput = await waitForNode("Deposit amount", 15_000).catch(
    () => null
  );
  let amountFocusedByCoordinate = false;
  let amountSelectedWithMax = false;
  let depositAction: UiNode | null = null;
  if (!amountInput) {
    const openSheet = await waitForNode("Use maximum balance", 5_000).catch(
      () => null
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
            node.contentDescription === "Deposit"
        ) ?? false,
      180_000
    );
    if (attempt === 0) {
      console.info(
        `[withdraw-e2e] opening deposit sheet at ${JSON.stringify(
          depositAction.bounds
        )}`
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
        depositAction?.bounds ?? null
      )}).`
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
      3_000
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
            JSON.stringify(depositAction?.bounds ?? seedDepositActionBounds)
      );
      return (
        candidates.sort((left, right) => right.bounds[3] - left.bounds[3])[0] ??
        false
      );
    },
    120_000
  );
  tap(submitButton);
  console.info(
    `[withdraw-e2e] activated seed Deposit CTA at ${JSON.stringify(
      submitButton.bounds
    )}`
  );
  const depositStarted = (): boolean =>
    lifecycleEvents.some(
      (event) =>
        event.flowName === "earn.deposit" && event.outcome === "started"
    ) || apiTimings.some((timing) => timing.pathname.includes("/deposit"));
  let handlerStarted = await waitFor(
    "the deposit handler to start",
    () => depositStarted() || false,
    5_000
  ).catch(() => false);
  if (!handlerStarted) {
    const [left, top, right, bottom] = submitButton.bounds;
    const x = String(Math.round((left + right) / 2));
    const y = String(Math.round((top + bottom) / 2));
    adbRun(["shell", "input", "touchscreen", "swipe", x, y, x, y, "200"]);
    handlerStarted = await waitFor(
      "the deposit handler to start after fallback activation",
      () => depositStarted() || false,
      10_000
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
      10_000
    ).catch(() => false);
  }
  if (!handlerStarted) {
    throw new Error("The seed Deposit CTA did not invoke its real handler.");
  }
  console.info("[withdraw-e2e] seed Deposit handler started");
  if (mode === "insufficient-sol") {
    await verifyInsufficientSolOutcome();
    return;
  }
  await waitFor(
    "completed deposit lifecycle",
    () =>
      lifecycleEvents.find(
        (event) =>
          event.flowName === "earn.deposit" &&
          event.outcome === "completed" &&
          event.stage === "ui_commit"
      ) ?? false,
    timeoutMs
  );
}

async function main(): Promise<void> {
  if (
    mode === "insufficient-sol" &&
    process.env.CONFIRM_NATIVE_SOL_E2E !== INSUFFICIENT_SOL_ACK
  ) {
    throw new Error(
      `Set CONFIRM_NATIVE_SOL_E2E=${INSUFFICIENT_SOL_ACK} after approving the read-only mainnet verifier.`
    );
  }
  if (
    mode !== "insufficient-sol" &&
    !isIsolatedLocalnet &&
    process.env.CONFIRM_MAINNET_WITHDRAW !== MAINNET_ACK
  ) {
    throw new Error(
      `Set CONFIRM_MAINNET_WITHDRAW=${MAINNET_ACK} after explicitly approving the mainnet verifier transaction.`
    );
  }
  if (mode !== "insufficient-sol" && !keyPath) {
    throw new Error(
      "Set MOBILE_E2E_WALLET_KEYPAIR to the approved keypair file."
    );
  }
  if (keyPath) accessSync(keyPath, constants.R_OK);
  assert.ok(Number.isFinite(maxPositionUsd) && maxPositionUsd > 0);
  assert.ok(Number.isFinite(seedAmountUsd) && seedAmountUsd > 0);

  const keypair =
    mode === "insufficient-sol"
      ? Keypair.generate()
      : Keypair.fromSecretKey(
          Uint8Array.from(
            JSON.parse(readFileSync(keyPath!, "utf8")) as number[]
          )
        );
  const secretBytes = Uint8Array.from(keypair.secretKey);
  const walletAddress = keypair.publicKey.toBase58();
  const secretInputValue = Array.from(secretBytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  secretBytes.fill(0);
  const beforeRaw = await currentPositionRaw(walletAddress);
  const beforeUsd = Number(beforeRaw) / 1_000_000;
  if (mode === "withdraw") {
    if (beforeRaw <= BigInt(0)) {
      throw new Error(
        "The approved wallet has no active Earn position to withdraw."
      );
    }
    if (beforeUsd > maxPositionUsd) {
      throw new Error(
        `Refusing to withdraw $${beforeUsd.toFixed(
          6
        )}; the verifier cap is $${maxPositionUsd.toFixed(2)}.`
      );
    }
  } else if (mode === "seed-position" && beforeRaw > BigInt(0)) {
    throw new Error("Seed-position mode requires no active Earn position.");
  } else if (mode === "seed-position") {
    const walletUsdcRaw = await currentWalletUsdcRaw(keypair.publicKey);
    const maximumRaw = BigInt(Math.trunc(maxPositionUsd * 1_000_000));
    if (walletUsdcRaw > maximumRaw) {
      throw new Error(
        `Refusing to MAX-deposit ${walletUsdcRaw.toString()} raw USDC; the verifier cap is ${maximumRaw.toString()}.`
      );
    }
    if (walletUsdcRaw < BigInt(Math.trunc(seedAmountUsd * 1_000_000))) {
      throw new Error(
        "The approved wallet does not have enough USDC to seed the position."
      );
    }
  }

  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    idleTimeout: 60,
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
    const apk = join(androidRoot, "app/build/outputs/apk/debug/app-debug.apk");
    if (process.env.MOBILE_WITHDRAW_REUSE_APK !== "1" || !existsSync(apk)) {
      assembleVerifierApk(androidRoot, env);
    }
    adbRun(["install", "-r", apk]);
    adbRun(["shell", "pm", "clear", APP_PACKAGE]);
    adbRun(["reverse", `tcp:${metroPort}`, `tcp:${metroPort}`]);
    adbRun(["reverse", `tcp:${proxyPort}`, `tcp:${proxyPort}`]);
    if (isIsolatedLocalnet) {
      adbRun(["reverse", "tcp:8899", "tcp:8899"]);
      adbRun(["reverse", "tcp:8900", "tcp:8900"]);
    }
    routeKaminoInstructionApiThroughVerifier();
    if (mode === "insufficient-sol") {
      openDepositSheetInVerifierBundle();
    }

    const metroArgs = ["expo", "start", "--dev-client", "--localhost"];
    if (process.env.MOBILE_WITHDRAW_REUSE_APK !== "1") {
      metroArgs.push("--clear");
    }
    metroArgs.push("--port", String(metroPort));
    const metro = start("npx", metroArgs, { env });
    await waitFor(
      "Metro",
      async () => {
        if (metro.exitCode !== null) throw new Error("Metro exited early.");
        const response = await fetch(
          `http://127.0.0.1:${metroPort}/status`
        ).catch(() => null);
        return response?.ok ?? false;
      },
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
    await importWallet(secretInputValue);
    keypair.secretKey.fill(0);
    console.info("[withdraw-e2e] wallet imported through the app UI");
    if (mode === "withdraw" && isIsolatedLocalnet) {
      lifecycleEvents.length = 0;
      openWithdrawSheetInVerifierBundle();
      await Bun.sleep(2_000);
      console.info(
        "[withdraw-e2e] loaded deterministic Withdraw sheet verifier bundle"
      );
    }
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
                node.contentDescription === "Deposit"
            ) ?? false,
          180_000
        )
      ).bounds;
      console.info(
        `[withdraw-e2e] captured original Deposit action at ${JSON.stringify(
          seedDepositActionBounds
        )}`
      );
      lifecycleEvents.length = 0;
      globalErrorEvents.length = 0;
      apiTimings.length = 0;
    }
    if (mode === "seed-position") {
      openDepositSheetInVerifierBundle();
      await Bun.sleep(2_000);
      console.info(
        "[withdraw-e2e] loaded verifier seed bundle by Fast Refresh"
      );
    }

    if (mode === "withdraw") {
      await driveWithdraw();
      verifyRealLoyalApiCoverage();
    } else {
      await driveSeedDeposit();
    }

    // The real-API run deliberately holds back the routing projection until
    // Android has confirmed and cleaned up. A completed lifecycle therefore
    // proves the client's optimistic zero while the cross-repo harness later
    // proves the durable projected zero.
    const afterRawString =
      mode === "withdraw" && requireRealLoyalApi
        ? "0"
        : await waitFor(
            mode === "withdraw"
              ? "the position to reach zero"
              : mode === "seed-position"
              ? "the position to appear"
              : "the position to remain unchanged",
            async () => {
              const raw = await currentPositionRaw(walletAddress);
              return mode === "withdraw"
                ? raw === BigInt(0)
                  ? raw.toString()
                  : false
                : mode === "seed-position"
                ? raw > BigInt(0)
                  ? raw.toString()
                  : false
                : raw === beforeRaw
                ? raw.toString()
                : false;
            },
            180_000
          );
    const report = {
      apiTimings,
      beforePositionRaw: beforeRaw.toString(),
      lifecycleEvents,
      globalErrorEventCount: globalErrorEvents.length,
      mode,
      positionRawAfter: afterRawString,
      projectionDeferredUntilAndroidCleanup:
        mode === "withdraw" && requireRealLoyalApi,
      realLoyalApiVerified: mode === "withdraw" && requireRealLoyalApi,
      stageDurationsMs: lifecycleStageDurations(
        mode === "withdraw" ? "earn.withdrawal" : "earn.deposit"
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
      }
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
      }
    );
  }
  if (emulatorStarted) {
    spawnSync(adb, ["-s", emulatorSerial!, "emu", "kill"], { stdio: "ignore" });
  }
  restoreKaminoClientSource();
  restoreDepositSource();
  processLog.end();
  if (process.exitCode !== 1)
    rmSync(tempRoot, { recursive: true, force: true });
}
