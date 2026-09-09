// Real mobile action modules + HTTP API + SDK + local SBF chain + routing projection.
// Native storage/analytics are adapters; Kamino instructions/SBF are protocol fixtures.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plugin } from "bun";
import * as SolanaWeb3 from "../../../node_modules/@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
} from "../../../node_modules/@solana/spl-token";
import postgres from "postgres";
import type {
  EarnPosition,
  EarnProjectedPosition,
} from "../src/lib/solana/earn/earn-api";
import type {
  ConfirmedEarnMutation,
  EarnPositionOverlay,
} from "../src/lib/solana/earn/position-overlay";

const { Connection, Keypair, PublicKey } = SolanaWeb3;
const args = Object.fromEntries(
  Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [
    process.argv[2 + i * 2]!.slice(2),
    process.argv[3 + i * 2]!,
  ])
);
for (const key of [
  "rpc-url",
  "postgres-url",
  "port",
  "genesis",
  "treasury",
  "state",
  "routing-root",
  "output",
])
  assert.ok(args[key], `Missing --${key}`);
for (const key of ["rpc-url", "postgres-url"])
  assert.equal(new URL(args[key]!).hostname, "127.0.0.1");
const database = new URL(args["postgres-url"]!);
assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
assert.equal(database.pathname, "/ask_2212_client_earn_local_e2e");
assert.equal(database.password, "");
assert.equal(database.search, "");
assert.equal(database.hash, "");
const appRoot = resolve(import.meta.dir, "../../..");
const connection = new Connection(args["rpc-url"]!, "confirmed");
const port = Number(args.port);
const apiUrl = `http://127.0.0.1:${port}`;
const realtimeUrl = `http://127.0.0.1:${port + 2}`;
const authSecret = "isolated-headless-e2e-realtime-not-production";
const children: ReturnType<typeof Bun.spawn>[] = [];
const apiRequests: { path: string; status: number; real: boolean }[] = [];
const events: Record<string, unknown>[] = [];
const amounts: string[] = [];
const cleanups: { signature: string; slot: number; policiesClosed: number }[] =
  [];
const records: { signature: string; slot: number; stage: string }[] = [];
const sql = postgres(args["postgres-url"]!, { max: 1 });
const controller = new AbortController();
let sseTask: Promise<void> | undefined;
let streamError: unknown;
let stage = "";
let sent: string[] = [];
let fullProjected = false;
const nativeFetch = globalThis.fetch.bind(globalThis);

async function run(command: string[], cwd = appRoot): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  assert.equal(
    await child.exited,
    0,
    `Command failed: ${command.slice(0, 5).join(" ")}`
  );
}
function start(
  command: string[],
  log: string,
  env = process.env,
  cwd = appRoot
) {
  const fd = openSync(log, "w", 0o600);
  const child = Bun.spawn(command, { cwd, env, stdout: fd, stderr: fd });
  closeSync(fd);
  children.push(child);
  return child;
}
async function waitReady(url: string): Promise<void> {
  for (let i = 0; i < 240; i++) {
    if (children.some((child) => child.exitCode !== null))
      throw new Error("An isolated service exited before readiness");
    if ((await nativeFetch(url).catch(() => null))?.ok) return;
    await Bun.sleep(500);
  }
  throw new Error(`Service not ready: ${url}`);
}
async function project(
  signature: string,
  transactionStage: string
): Promise<void> {
  let slot: number | undefined;
  for (let i = 0; i < 300; i++) {
    const status = (
      await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    assert.ok(!status?.err, "Transaction failed on local chain");
    if (status?.confirmationStatus === "finalized") {
      slot = status.slot;
      break;
    }
    await Bun.sleep(100);
  }
  assert.ok(slot, "Local transaction did not finalize");
  const record = { signature, slot, stage: transactionStage };
  records.push(record);
  const path = `${args.output}.${records.length}.transaction.json`;
  writeFileSync(path, JSON.stringify(record));
  await run(
    [
      "cargo",
      "run",
      "--quiet",
      "-p",
      "balance-sweep-ata-monitor",
      "--bin",
      "earn-client-local-e2e",
      "--",
      "--postgres-url",
      args["postgres-url"]!,
      "--rpc-url",
      args["rpc-url"]!,
      "--state",
      args.state!,
      "--transaction",
      path,
    ],
    args["routing-root"]
  );
}

try {
  await run(
    [
      "bun",
      "run",
      "scripts/verify-earn-client-local-chain.ts",
      "bootstrap",
      "--rpc-url",
      args["rpc-url"]!,
      "--treasury",
      args.treasury!,
      "--genesis",
      args.genesis!,
      "--state",
      args.state!,
      "--transaction",
      `${args.output}.bootstrap.ndjson`,
    ],
    resolve(appRoot, "apps/web")
  );
  const state = JSON.parse(readFileSync(args.state!, "utf8")) as Record<
    string,
    string
  >;
  start(
    [
      "bun",
      "run",
      "scripts/verify-earn-local-api.ts",
      "--state",
      args.state!,
      "--rpc-url",
      args["rpc-url"]!,
      "--transactions",
      `${args.output}.legacy.ndjson`,
      "--port",
      String(port),
      "--amount-raw",
      "0",
    ],
    `${args.output}.api-proxy.log`,
    {
      ...process.env,
      MOBILE_EARN_REAL_API: "1",
      MOBILE_EARN_REAL_API_DATABASE_URL: args["postgres-url"],
      MOBILE_EARN_REAL_API_LOG: `${args.output}.next-api.log`,
    },
    resolve(appRoot, "apps/mobile")
  );
  await waitReady(
    `${apiUrl}/api/smart-accounts/mobile/earn/state?walletAddress=${state.walletAddress}`
  );
  start(
    ["cargo", "run", "--quiet", "-p", "loyal-yield-realtime"],
    `${args.output}.realtime.log`,
    {
      ...process.env,
      NEON_DATABASE_URL: args["postgres-url"],
      REALTIME_AUTH_SECRET: authSecret,
      REALTIME_ALLOWED_ORIGINS: "http://127.0.0.1:3000",
      REALTIME_HEARTBEAT_SECONDS: "1",
      PORT: String(port + 2),
    },
    args["routing-root"]
  );
  await waitReady(`${realtimeUrl}/readyz`);
  const now = Math.floor(Date.now() / 1000);
  const claims = Buffer.from(
    JSON.stringify({
      aud: "loyal-yield-realtime",
      clientKind: "mobile",
      earnVaultAddress: state.vaultPubkey,
      exp: now + 240,
      iat: now,
      iss: "loyal-apps",
      scopes: ["earn"],
      settingsPda: state.settingsPda,
      solanaEnv: "mainnet-beta",
      v: 1,
      walletAddress: state.walletAddress,
    })
  ).toString("base64url");
  const token = `${claims}.${createHmac("sha256", authSecret)
    .update(claims)
    .digest("base64url")}`;
  const stream = await nativeFetch(`${realtimeUrl}/events`, {
    headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  assert.ok(stream.body);
  sseTask = (async () => {
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (data) events.push(JSON.parse(data));
      }
    }
  })().catch((error: unknown) => {
    if (!controller.signal.aborted) streamError = error;
  });

  const storage = new Map<string, string>();
  const nativeAdapters: Record<string, Record<string, unknown>> = {
    "@/config/env": {
      env: { earnApiBaseUrl: apiUrl, vercelProtectionBypass: "" },
    },
    "@/lib/solana/rpc/connection": {
      getConnection: () => connection,
      getSolanaEnv: () => "mainnet",
    },
    "@/lib/analytics/analytics": { track: () => undefined },
    // Use one real web3 instance in this headless harness. Bun otherwise
    // loads mobile + workspace copies and instanceof PublicKey fails.
    // This does not verify Metro's installed-device module resolution.
    "@solana/web3.js": SolanaWeb3,
    "expo-secure-store": {
      getItemAsync: async (key: string) => storage.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        storage.set(key, value);
      },
      deleteItemAsync: async (key: string) => {
        storage.delete(key);
      },
    },
    "@/services/observability": {
      mapLifecycleErrorCode: () => "unexpected_error",
      startLifecycleFlow: () => ({
        flowId: crypto.randomUUID(),
        start: () => undefined,
        observe: () => undefined,
        complete: () => undefined,
        failFrom: () => undefined,
        setVariant: () => undefined,
      }),
    },
  };
  plugin({
    name: "local-native-adapters",
    setup(builder) {
      // Bun's runtime loader resolves tsconfig aliases before loading modules.
      // Adapt exact resolved platform files; leave action/API/SDK code intact.
      for (const [key, exports] of Object.entries(nativeAdapters)) {
        const path = key.startsWith("@/")
          ? `${resolve(import.meta.dir, "../src", key.slice(2))}.ts`
          : fileURLToPath(import.meta.resolve(key));
        const filter = new RegExp(
          `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
        );
        builder.onLoad({ filter }, () => ({ exports, loader: "object" }));
      }
    },
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
    let url = new URL(raw);
    if (
      url.hostname === "api.kamino.finance" &&
      /\/klend\/(deposit|withdraw)-instructions$/.test(url.pathname)
    )
      url = new URL(url.pathname, apiUrl);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(url.hostname),
      `Blocked nonlocal HTTP: ${url.hostname}`
    );
    if (url.pathname.startsWith("/api/smart-accounts/mobile/earn/")) {
      assert.ok(
        !/\/(prepare|confirm|reconcile)(?:\/|$)/.test(url.pathname),
        `Forbidden legacy action API: ${url.pathname}`
      );
      if (
        stage === "full_withdrawal" &&
        url.pathname.endsWith("/withdraw/cleanup/context") &&
        !fullProjected
      ) {
        assert.equal(sent.length, 1, "Expected withdrawal before cleanup");
        await project(sent[0]!, "full_withdrawal");
        fullProjected = true;
      }
      const response = await nativeFetch(url, init);
      apiRequests.push({
        path: url.pathname,
        status: response.status,
        real: response.headers.get("x-loyal-e2e-api") === "real-loyal-app",
      });
      return response;
    }
    return nativeFetch(url, init);
  }) as typeof fetch;
  const nativeSend = connection.sendRawTransaction.bind(connection);
  connection.sendRawTransaction = async (...input) => {
    const signature = await nativeSend(...input);
    if (!sent.includes(signature)) sent.push(signature);
    return signature;
  };
  const { LocalKeypairSigner } = await import("../src/lib/wallet/signer");
  const { executeEarnDeposit } = await import("../src/lib/solana/earn/deposit");
  const { fetchEarnHoldings, fetchEarnTransactions } = await import(
    "../src/lib/solana/earn/earn-api"
  );
  const { executeEarnWithdraw } = await import(
    "../src/lib/solana/earn/withdraw"
  );
  const signer = new LocalKeypairSigner(
    Keypair.fromSeed(new Uint8Array(32).fill(8))
  );
  const {
    applyConfirmedEarnMutation,
    reconcileEarnProjection,
    resolveEarnMutationAccounting,
  } = await import("../src/lib/solana/earn/position-overlay");
  let overlay: EarnPositionOverlay | null = null;
  let priorProjection: {
    position: EarnPosition | null;
    projectedSlot: string | null;
    projectedPositions: EarnProjectedPosition[];
  } = { position: null, projectedSlot: null, projectedPositions: [] };

  for (const [operation, expected] of [
    ["initial_deposit", "4000000"],
    ["top_up", "6000000"],
    ["partial_withdrawal", "4000000"],
    ["full_withdrawal", "0"],
  ] as const) {
    stage = operation;
    sent = [];
    let cleanupSignature: string | undefined;
    const confirmed: ConfirmedEarnMutation[] = [];
    const onConfirmed = (mutation: ConfirmedEarnMutation) => {
      confirmed.push(mutation);
    };
    if (operation === "initial_deposit" || operation === "top_up") {
      await executeEarnDeposit({
        signer,
        amountUsd: operation === "initial_deposit" ? 4 : 2,
        mint: state.usdcMint!,
        onConfirmed,
      });
      assert.equal(sent.length, operation === "initial_deposit" ? 3 : 1);
    } else {
      const result = await executeEarnWithdraw({
        signer,
        amountUsd: operation === "partial_withdrawal" ? 2 : 4,
        mode: operation === "partial_withdrawal" ? "partial" : "full",
        onConfirmed,
      });
      cleanupSignature = result.cleanupSignature;
      if (operation === "full_withdrawal")
        assert.ok(cleanupSignature, "Full mobile withdrawal skipped cleanup");
    }
    assert.equal(
      confirmed.length,
      1,
      "Expected one confirmed money-moving callback, not policy/cleanup callbacks"
    );
    const mutation = confirmed[0]!;
    assert.equal(
      mutation.signature,
      sent[operation === "initial_deposit" ? 2 : 0]
    );
    assert.equal(mutation.settingsPda, state.settingsPda);
    assert.ok(BigInt(mutation.confirmedSlot) > 0n);
    overlay = applyConfirmedEarnMutation(
      overlay,
      priorProjection.position,
      mutation
    );
    assert.equal(overlay.position.currentAmountRaw, expected);
    assert.equal(overlay.position.principalAmountRaw, expected);
    assert.equal(
      applyConfirmedEarnMutation(overlay, priorProjection.position, mutation),
      overlay,
      "Duplicate confirmation applied twice"
    );
    if (!fullProjected) {
      // A supported read must not heal accounting from the already changed
      // chain: only the routing projection below is allowed to publish it.
      const unprojected = await fetch(
        `${apiUrl}/api/smart-accounts/mobile/earn/state?walletAddress=${state.walletAddress}`
      );
      assert.equal(unprojected.status, 200);
      const unprojectedBody = (await unprojected.json()) as {
        position: EarnPosition | null;
      };
      const priorAmount = priorProjection.position?.currentAmountRaw ?? "0";
      assert.equal(
        unprojectedBody.position?.currentAmountRaw ?? "0",
        priorAmount,
        "GET state healed unprojected chain accounting"
      );
      const untouched =
        await sql`SELECT COALESCE(sum(current_amount_raw), 0) AS amount FROM loyal_yield.user_yield_positions WHERE settings = ${state.settingsPda!}`;
      assert.equal(
        String(untouched[0]?.amount),
        priorAmount,
        "GET state mutated accounting before routing projection"
      );
    }
    if (operation === "initial_deposit") {
      for (const [i, signature] of sent.entries())
        await project(
          signature,
          ["route_policy", "setup_policy", "initial_deposit"][i]!
        );
    } else if (!fullProjected) await project(sent[0]!, operation);
    const rows =
      await sql`SELECT current_amount_raw FROM loyal_yield.user_yield_positions WHERE settings = ${state.settingsPda!} ORDER BY id DESC LIMIT 1`;
    assert.equal(String(rows[0]?.current_amount_raw), expected);
    const response = await fetch(
      `${apiUrl}/api/smart-accounts/mobile/earn/state?walletAddress=${state.walletAddress}`
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as typeof priorProjection;
    assert.equal(body.position?.currentAmountRaw ?? "0", expected);
    const history = await fetchEarnTransactions(state.walletAddress!);
    const entry = history.transactions.find(
      (event) => event.signature === mutation.signature
    );
    assert.ok(
      entry?.positionId &&
        body.projectedPositions.some((row) => row.id === entry.positionId),
      "Real HTTP history must expose the immutable accounting position ID"
    );
    const recovered = resolveEarnMutationAccounting(
      { ...mutation, accountingSlot: null, accountingTargets: [] },
      body.projectedPositions,
      history.transactions
    );
    assert.equal(
      recovered.accountingSlot,
      entry.transactionSlot,
      "Immutable HTTP history did not resolve confirmed accounting evidence"
    );
    assert.equal(
      entry.transactionSlot,
      mutation.accountingSlot ?? mutation.confirmedSlot,
      "HTTP transactionSlot must equal actual confirmed landing, not later projection observation"
    );
    overlay = { ...overlay, mutations: [recovered] };
    overlay = reconcileEarnProjection({
      previous: overlay,
      settingsPda: state.settingsPda!,
      ...body,
    });
    assert.ok(overlay);
    assert.equal(
      overlay.pending,
      false,
      "Confirmed accounting projection did not release overlay"
    );
    assert.equal(overlay.position.principalAmountRaw, expected);
    let stale = overlay;
    try {
      stale = reconcileEarnProjection({
        previous: overlay,
        settingsPda: state.settingsPda!,
        ...priorProjection,
      })!;
    } catch (error) {
      assert.match(
        error instanceof Error ? error.message : "",
        /Earn accounting projection regressed/
      );
    }
    assert.equal(
      stale,
      overlay,
      "Stale API response replaced confirmed balance/tombstone"
    );
    priorProjection = body;
    if (operation !== "full_withdrawal") {
      const holdings = await fetchEarnHoldings(state.walletAddress!, {
        minContextSlot: mutation.confirmedSlot,
      });
      assert.equal(holdings.settingsPda, state.settingsPda);
      assert.equal(holdings.currentTotalAmountRaw, expected);
      assert.ok(
        holdings.observedSlot &&
          BigInt(holdings.observedSlot) >= BigInt(mutation.confirmedSlot)
      );
    }
    const walletAta = getAssociatedTokenAddressSync(
      new PublicKey(state.usdcMint!),
      signer.publicKey
    );
    assert.equal(
      (await getAccount(connection, walletAta, "confirmed")).amount.toString(),
      String(10000000n - BigInt(expected))
    );
    if (cleanupSignature) {
      const policies =
        await sql`SELECT policy_account FROM loyal_yield.route_policies WHERE settings = ${state.settingsPda!}`;
      assert.ok(
        policies.length >= 2,
        "Cleanup must verify the route/setup policy pair"
      );
      const accounts = await connection.getMultipleAccountsInfo(
        policies.map((row) => new PublicKey(row.policy_account)),
        "confirmed"
      );
      assert.ok(
        accounts.every((account) => !account),
        "Policy accounts remain after mobile cleanup"
      );
      const status = (await connection.getSignatureStatuses([cleanupSignature]))
        .value[0];
      assert.ok(
        status && !status.err && status.confirmationStatus !== "processed"
      );
      cleanups.push({
        signature: cleanupSignature,
        slot: status.slot,
        policiesClosed: policies.length,
      });
    }
    amounts.push(expected);
    console.info(
      `PASS production mobile ${operation}: chain + projection + real HTTP state = ${expected}${
        cleanupSignature ? "; cleanup policies closed" : ""
      }`
    );
  }
  for (
    let i = 0;
    i < 50 &&
    events.filter((event) => String(event.reason).startsWith("holding_event_"))
      .length < 4;
    i++
  )
    await Bun.sleep(100);
  assert.ok(!streamError, "SSE failed");
  const reasons = events
    .map((event) => event.reason)
    .filter((reason) => String(reason).startsWith("holding_event_"));
  assert.deepEqual(reasons, [
    "holding_event_deposit_initialized",
    "holding_event_deposit_top_up",
    "holding_event_withdrawal_partial",
    "holding_event_withdrawal_full",
  ]);
  assert.ok(
    apiRequests.every((request) => request.real),
    "A mobile API request was served by a mock"
  );
  assert.ok(
    apiRequests.every(
      (request) => request.status >= 200 && request.status < 300
    ),
    "A real mobile API request failed (including session bootstrap)"
  );
  writeFileSync(
    args.output!,
    JSON.stringify(
      {
        status: "passed",
        cleanups,
        amounts,
        records,
        apiRequests,
        events,
        limits: [
          "headless action modules, not React Native UI/provider",
          "native storage/analytics adapters; MMKV fallback; single real web3 instance (Metro resolution not exercised)",
          "mock Kamino instructions and SBF",
          "emulated LaserStream admission, real routing reconciliation and SSE",
          "app auth/smart-account provisioned as local fixture",
        ],
      },
      null,
      2
    )
  );
} catch (error) {
  writeFileSync(
    args.output!,
    JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        amounts,
        records,
        apiRequests,
        events,
      },
      null,
      2
    )
  );
  throw error;
} finally {
  controller.abort();
  await sseTask;
  globalThis.fetch = nativeFetch;
  for (const child of children.reverse()) {
    child.kill();
    await child.exited;
  }
  await sql.end();
}
