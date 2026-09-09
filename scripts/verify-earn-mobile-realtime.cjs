// Inert integration verifier: executes the actual provider, event bus, stream,
// position hook, overlay and MMKV store. Only React/native/RPC/API boundaries stubbed.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules/typescript"));
const base = "apps/mobile/src/";
const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
  await new Promise(setImmediate);
};
function runtime() {
  const cells = [];
  let index = 0;
  const effects = [];
  const cleanups = [];
  const depsEqual = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(value) {
      const i = index++;
      return (cells[i] ??= { current: value });
    },
    useState(value) {
      const i = index++;
      if (!(i in cells)) cells[i] = value;
      return [
        cells[i],
        (value) => {
          cells[i] = typeof value === "function" ? value(cells[i]) : value;
        },
      ];
    },
    useCallback(fn, deps) {
      const i = index++;
      if (!cells[i] || !depsEqual(cells[i].deps, deps)) cells[i] = { fn, deps };
      return cells[i].fn;
    },
    useEffect(fn, deps) {
      const i = index++;
      if (!cells[i] || !depsEqual(cells[i].deps, deps)) {
        effects.push(() => {
          cleanups[i]?.();
          cleanups[i] = fn();
        });
        cells[i] = { deps };
      }
    },
  };
  return {
    react,
    render(fn) {
      index = 0;
      const result = fn();
      while (effects.length) effects.shift()();
      return result;
    },
    stop() {
      for (const cleanup of cleanups) cleanup?.();
    },
  };
}
async function scenario(walletState, sessionAvailable = true) {
  const env = { earnApiBaseUrl: "http://inert-api", solanaEnv: "devnet" };
  const timers = new Map();
  let timerId = 0;
  const clock = {
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const memory = new Map();
  const mmkv = {
    getString: (key) => memory.get(key),
    setString: (key, value) => memory.set(key, value),
    delete: (key) => memory.delete(key),
  };
  const all = [];
  let appListener;
  const AppState = {
    currentState: "active",
    addEventListener(_event, fn) {
      appListener = fn;
      return {
        remove() {
          appListener = null;
        },
      };
    },
  };
  class Xhr {
    readyState = 0;
    status = 0;
    responseText = "";
    headers = {};
    aborted = false;
    constructor() {
      all.push(this);
    }
    open(_method, url) {
      this.url = url;
    }
    setRequestHeader(key, value) {
      this.headers[key] = value;
    }
    send() {}
    abort() {
      this.aborted = true;
    }
    admit() {
      this.readyState = 2;
      this.status = 200;
      this.onreadystatechange?.();
    }
    frame(id) {
      this.responseText += `event: loyal_yield\nid: ${id}\ndata: ${JSON.stringify(
        { eventType: "earn.position.changed", eventId: String(id) }
      )}\n\n`;
      this.onprogress?.();
    }
  }
  const load = (rel, imports) => {
    const exports = {};
    const code = ts.transpileModule(
      fs.readFileSync(path.join(root, base, rel), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }
    ).outputText;
    vm.runInNewContext(
      code,
      {
        exports,
        require: (name) => {
          if (name in imports) return imports[name];
          throw new Error(`unexpected ${rel}: ${name}`);
        },
        console: { ...console, warn() {} },
        ...clock,
        XMLHttpRequest: Xhr,
        URL,
        Buffer,
        Date,
      },
      { filename: rel }
    );
    return exports;
  };
  const overlay = load("lib/solana/earn/position-overlay.ts", {});
  const store = load("lib/solana/earn/position-store.ts", {
    "@/config/env": { env },
    "@/lib/storage": { mmkv },
    "./position-overlay": overlay,
  });
  const events = load("features/earn-realtime/events.ts", {});
  const stream = load("features/earn-realtime/stream.ts", {
    buffer: { Buffer },
    "@/config/env": { env },
    "@/lib/solana/earn/position-overlay": overlay,
  });
  const row = {
    id: "1",
    liquidityMint: "usdc",
    initialReserveAddress: "initial",
    currentLiquidityMint: "usdc",
    currentReserveAddress: "reserve",
    currentAmountRaw: "10",
    principalAmountRaw: "10",
    currentObservedSlot: "100",
    lastConfirmedSlot: "100",
    status: "active",
    vaultPubkey: "vault",
  };
  let state = {
    cluster: "devnet",
    settingsPda: "settings",
    smartAccountAddress: "vault",
    projectedSlot: "100",
    projectedPositions: [row],
    position: {
      currentAmountRaw: "10",
      principalAmountRaw: "10",
      currentSupplyApyBps: null,
      status: "active",
    },
  };
  let live = {
    settingsPda: "settings",
    smartAccountAddress: "vault",
    currentTotalAmountRaw: "10",
    observedAt: "now",
    observedSlot: "100",
    holdings: [],
  };
  let held = null,
    earnings = 0,
    stateReads = 0,
    holdingsReads = 0,
    exactSlot = null;
  class EarnApiError extends Error {}
  const token = {
    accessToken:
      Buffer.from(
        JSON.stringify({
          v: 1,
          iss: "loyal-apps",
          aud: "loyal-yield-realtime",
          walletAddress: "wallet",
          settingsPda: "settings",
          earnVaultAddress: "vault",
          solanaEnv: "devnet",
        })
      ).toString("base64url") + ".inert",
    eventsUrl: "http://inert-stream",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };
  const api = {
    EarnApiError,
    fetchEarnState: async () => {
      stateReads++;
      return state;
    },
    fetchEarnHoldings: async () => {
      holdingsReads++;
      return held ?? live;
    },
    fetchEarnRealtimeToken: async () => token,
    fetchEarnTransactions: async () => ({
      transactions: exactSlot
        ? [
            {
              signature: "deposit",
              kind: "deposit",
              positionId: "1",
              transactionSlot: exactSlot,
              confirmedSlot: "999999",
            },
          ]
        : [],
    }),
  };
  const hooks = runtime();
  const module = load("hooks/wallet/useEarnPosition.ts", {
    react: hooks.react,
    "@/config/env": { env },
    "@/features/earn-realtime/events": events,
    "@/lib/solana/earn/earn-api": api,
    "@/lib/solana/earn/position-overlay": overlay,
    "@/lib/solana/earn/position-store": store,
  });
  let wallet = "wallet";
  const render = () => hooks.render(() => module.useEarnPosition(wallet));
  let hook = render();
  await flush();
  hook = render();
  const providerRuntime = runtime();
  let renew = null,
    silent = 0,
    deliberate = 0;
  const signer = {
    kind: walletState === "unlocked" ? "local" : "mwa",
    publicKey: { toBase58: () => "wallet" },
  };
  const provider = load("features/earn-realtime/EarnRealtimeProvider.tsx", {
    react: providerRuntime.react,
    "react-native": { AppState },
    "@/hooks/wallet/useEarnEarnings": {
      refreshEarnEarningsCache: async () => {
        earnings++;
      },
    },
    "@/lib/solana/earn/earn-api": api,
    "@/lib/solana/earn/earn-auth": {
      ensureEarnRealtimeSession: async (_wallet, _signer, explicit) => {
        if (explicit) deliberate++;
        else silent++;
        sessionAvailable = true;
        return "session";
      },
    },
    "@/lib/solana/earn/earn-session": {
      getEarnSessionToken: async () => (sessionAvailable ? "session" : null),
      clearEarnSession: async () => {},
    },
    "@/lib/wallet/wallet-provider": {
      useWallet: () => ({ publicKey: "wallet", state: walletState, signer }),
      isWalletUnlocked: (state) =>
        state === "unlocked" || state === "vault-unlocked",
    },
    "@/lib/storage": { mmkv },
    "./events": events,
    "./session-renewal": {
      setEarnSessionRenewal: (fn) => {
        renew = fn;
      },
    },
    "./stream": stream,
  });
  providerRuntime.render(() => provider.EarnRealtimeProvider());
  await flush();
  const tick = async (ms) => {
    const entry = [...timers].find(([, t]) => t.ms === ms);
    assert.ok(entry, `timer ${ms}`);
    timers.delete(entry[0]);
    entry[1].fn();
    await flush();
  };
  if (!sessionAvailable) {
    assert.equal(all.length, 0);
    assert.equal(silent, 0);
    assert.equal(deliberate, 0);
    assert.equal(typeof renew, "function");
    await renew();
    await tick(0);
    assert.equal(deliberate, 1);
  }
  assert.equal(all.length, 1, `${walletState} connects`);
  let xhr = all.at(-1);
  xhr.admit();
  await flush();
  assert.ok(
    stateReads >= 2 && holdingsReads >= 2 && earnings >= 1,
    "admission resync reaches actual resource subscribers"
  );
  const cursor = stream.earnCursorKey(token, "wallet");
  let release;
  held = new Promise((resolve) => {
    release = resolve;
  });
  xhr.frame(1);
  await flush();
  assert.equal(memory.get(cursor), undefined, "refresh pending cannot ack");
  release(live);
  held = null;
  await flush();
  assert.equal(memory.get(cursor), "1", "all subscribers complete before ack");
  const reconnect = async () => {
    live = { ...live, observedAt: "now", observedSlot: "100" };
    await tick(1000);
    xhr = all.at(-1);
    assert.equal(xhr.headers["Last-Event-ID"], memory.get(cursor));
    xhr.admit();
    await flush();
  };
  // A fulfilled but unfenced holdings response must reject actual provider acknowledgement.
  live = { ...live, observedAt: null, observedSlot: null };
  xhr.frame(2);
  await flush();
  assert.equal(memory.get(cursor), "1");
  assert.equal(xhr.aborted, true);
  await reconnect();
  xhr.frame(2);
  await flush();
  assert.equal(memory.get(cursor), "2");
  const accepted = store.readEarnOverlay("wallet");
  for (const invalid of [
    { ...state, cluster: "mainnet-beta" },
    { ...state, settingsPda: "other" },
    { ...state, projectedPositions: [{ ...row, vaultPubkey: "other" }] },
    {
      ...state,
      projectedPositions: [
        { ...row, lastConfirmedSlot: "99", currentObservedSlot: "99" },
      ],
    },
  ]) {
    const valid = state;
    state = invalid;
    await assert.rejects(hook.refreshEarnPosition({ throwOnError: true }));
    assert.equal(
      store.readEarnOverlay("wallet"),
      accepted,
      "scope/stale rejection precedes commit"
    );
    state = valid;
  }
  live = { ...live, observedSlot: "99" };
  xhr.frame(3);
  await flush();
  assert.equal(memory.get(cursor), "2");
  await reconnect();
  // Confirm while a frame's refresh is outstanding: supersession cannot ack.
  held = new Promise((resolve) => {
    release = resolve;
  });
  xhr.frame(3);
  await flush();
  hook.confirmEarnMutation({
    walletAddress: "wallet",
    settingsPda: "settings",
    cluster: "devnet",
    signature: "deposit",
    confirmedSlot: "110",
    accountingSlot: null,
    deltaAmountRaw: "5",
    accountingTargets: [
      { kind: "deposit", liquidityMint: "usdc", reserve: "initial" },
    ],
  });
  release({ ...live, observedSlot: "100" });
  held = null;
  await flush();
  assert.equal(memory.get(cursor), "2");
  assert.equal(
    store.readEarnOverlay("wallet").position.principalAmountRaw,
    "15"
  );
  // Actual hook resolves conservative WS fence via signature identity; unrelated
  // ancient closed row never participates in this deposit's accounting handoff.
  exactSlot = "105";
  state = {
    ...state,
    projectedSlot: "1",
    projectedPositions: [
      {
        ...row,
        lastConfirmedSlot: "105",
        currentObservedSlot: "105",
        principalAmountRaw: "15",
        currentAmountRaw: "15",
      },
      {
        ...row,
        id: "old",
        liquidityMint: "cash",
        initialReserveAddress: "retired",
        status: "closed",
        currentAmountRaw: "0",
        principalAmountRaw: "0",
        lastConfirmedSlot: "1",
        currentObservedSlot: "1",
      },
    ],
    position: {
      ...state.position,
      principalAmountRaw: "15",
      currentAmountRaw: "15",
    },
  };
  live = { ...live, observedSlot: "110", currentTotalAmountRaw: "15" };
  await tick(5000);
  hook = render();
  assert.equal(store.readEarnOverlay("wallet").pending, false);
  assert.equal(hook.position.principalAmountRaw, "15");
  assert.equal(hook.position.currentAmountRaw, "15");
  assert.equal(
    silent,
    walletState === "unlocked" && deliberate === 0 && scenario.bootstrap ? 1 : 0
  );
  hooks.stop();
  providerRuntime.stop();
  assert.equal(timers.size, 0);
  assert.equal(appListener, null);
  console.log(
    `PASS ${walletState}: actual admission/subscriptions, deferred ack, unfenced/stale/scope rejection, supersession, per-row/status convergence, renewal boundary`
  );
}
(async () => {
  await scenario("unlocked");
  await scenario("vault-unlocked");
  await scenario("vault-unlocked", false);
  scenario.bootstrap = true;
  await scenario("unlocked", false);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
