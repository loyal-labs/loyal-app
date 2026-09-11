// Deterministic hook/cache contract runner: scheduling, HTTP and RPC are mocked.
// This exercises commit ordering, not real React/browser or live RPC integration.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";

import type { EarnRpcHoldingsSnapshot } from "@/lib/yield-optimization/earn-rpc-holdings.client";

import type { ActiveEarnPosition } from "./use-active-earn-position";

type EffectCell = { deps: unknown[]; cleanup?: void | (() => void) };
let cells: unknown[] = [];
let cursor = 0;
let pendingEffects: (() => void)[] = [];
const changed = (a: unknown[] | undefined, b: unknown[]) =>
  !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));

mock.module("react", () => ({
  useRef<T>(value: T) {
    const i = cursor++;
    return (cells[i] ??= { current: value }) as { current: T };
  },
  useState<T>(value: T) {
    const i = cursor++;
    if (!(i in cells)) cells[i] = value;
    return [
      cells[i],
      (next: T | ((current: T) => T)) => {
        cells[i] =
          typeof next === "function"
            ? (next as (current: T) => T)(cells[i] as T)
            : next;
      },
    ];
  },
  useCallback<T>(fn: T, deps: unknown[]) {
    const i = cursor++;
    const previous = cells[i] as { fn: T; deps: unknown[] } | undefined;
    if (!previous || changed(previous.deps, deps)) cells[i] = { fn, deps };
    return (cells[i] as { fn: T }).fn;
  },
  useEffect(fn: () => void | (() => void), deps: unknown[]) {
    const i = cursor++;
    const previous = cells[i] as EffectCell | undefined;
    if (!previous || changed(previous.deps, deps)) {
      const cell: EffectCell = { deps };
      cells[i] = cell;
      pendingEffects.push(() => {
        previous?.cleanup?.();
        cell.cleanup = fn();
      });
    }
  },
}));

let rpcRead: (input: {
  minContextSlot?: number;
}) => Promise<EarnRpcHoldingsSnapshot>;
mock.module("@/lib/yield-optimization/earn-rpc-holdings.client", () => ({
  fetchEarnRpcHoldingsSnapshot: (input: { minContextSlot?: number }) =>
    rpcRead(input),
  sumEarnRpcHoldingsAmountRaw: (
    holdings: EarnRpcHoldingsSnapshot["holdings"]
  ) =>
    holdings.reduce(
      (total, holding) => total + BigInt(holding.amountRaw),
      BigInt(0)
    ),
}));

const { useActiveEarnPosition, writeEarnPositionCache, readEarnPositionCache } =
  await import("./use-active-earn-position");
const scope = {
  solanaEnv: "mainnet",
  walletAddress: "11111111111111111111111111111112",
  settingsPda: "11111111111111111111111111111113",
};
const policy = {
  account: scope.walletAddress,
  seed: "1",
  vaultIndex: 1,
  vaultPubkey: scope.walletAddress,
};
let props: Parameters<typeof useActiveEarnPosition>[0];
let output: ReturnType<typeof useActiveEarnPosition>;
let storage: Map<string, string>;
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function render() {
  cursor = 0;
  // The mocked dispatcher above supplies the hook lifecycle for this runner.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  output = useActiveEarnPosition(props);
  const effects = pendingEffects;
  pendingEffects = [];
  for (const effect of effects) effect();
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  render();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function snapshot(slot: string): EarnRpcHoldingsSnapshot {
  return {
    completeness: "complete",
    currentTotalAmountRaw: "100000000",
    currentTotalNominalUsdMicros: "100000000",
    observedAt: new Date(0).toISOString(),
    observedSlot: slot,
    holdings: [
      {
        amountRaw: "100000000",
        kind: "idle",
        liquidityMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        market: null,
        reserve: null,
        label: "Idle Balance",
        marketName: "USDC",
        sourceId: "idle:usdc",
        supplyApyBps: null,
        observedAt: new Date(0).toISOString(),
        observedSlot: slot,
        provenance: { source: "rpc_getMultipleAccounts" },
      },
    ],
    provenance: {
      watchedAccounts: [],
      accountCount: 1,
      chunkCount: 1,
      commitment: "confirmed",
      source: "rpc_getMultipleAccounts",
    },
  };
}
function position(slot: string): ActiveEarnPosition {
  return {
    status: "active",
    currentTotalAmountRaw: "100000000",
    principalAmountRaw: "100000000",
    currentSupplyApyBps: null,
    display: { label: "Idle Balance", marketName: "USDC", mintSymbol: "USDC" },
    initialHolding: {
      liquidityMint: snapshot(slot).holdings[0].liquidityMint,
      market: null,
      reserve: "",
      supplyApyBps: null,
    },
    currentHolding: {
      amountRaw: "100000000",
      liquidityMint: snapshot(slot).holdings[0].liquidityMint,
      market: null,
      reserve: "",
      observedAt: new Date(0).toISOString(),
      observedSlot: slot,
      provenance: { lastHoldingEventId: null, lastRebalanceDecisionId: null },
    },
    holdings: snapshot(slot).holdings,
  };
}
function respondWith(body: unknown) {
  globalThis.fetch = mock(async () =>
    Response.json(body)
  ) as unknown as typeof fetch;
}
function expectClosed() {
  expect(output.position).toBeNull();
  expect(readEarnPositionCache(scope)).toBeNull();
  // Neither positive cache may survive; scoped closure evidence must survive.
  expect([...storage.keys()].filter((key) => !key.endsWith(":closed"))).toEqual([]);
}

beforeEach(() => {
  cells = [];
  cursor = 0;
  pendingEffects = [];
  props = {
    ...scope,
    enabled: true,
    programId: scope.walletAddress,
    earnPolicy: policy,
    connection: {} as never,
  };
  storage = new Map();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    },
  });
  rpcRead = async () => snapshot("500");
  respondWith({ position: null, closedPositionObservedSlot: "600" });
  writeEarnPositionCache({ ...scope, position: position("500") });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("accepted closure survives subsequent lagging RPC refreshes and allows a later deposit", async () => {
  render();
  await flush();
  expectClosed();
  for (const slot of ["500", "600"]) {
    rpcRead = async ({ minContextSlot }) => {
      expect(minContextSlot).toBe(601);
      return snapshot(slot); // Simulate a response violating the RPC fence too.
    };
    expect(await output.refresh()).toBeNull();
    await flush();
    expectClosed();
  }
  rpcRead = async ({ minContextSlot }) => {
    expect(minContextSlot).toBe(601);
    return snapshot("700");
  };
  await output.refresh();
  await flush();
  expect(output.position?.currentHolding.observedSlot).toBe("700");
  expect(readEarnPositionCache(scope)?.currentHolding.observedSlot).toBe("700");
  for (const slot of ["500", "650"]) {
    rpcRead = async ({ minContextSlot }) => {
      expect(minContextSlot).toBe(700);
      return { ...snapshot(slot), holdings: [] };
    };
    await output.refresh();
    await flush();
    expect(output.position?.currentHolding.observedSlot).toBe("700");
    expect(readEarnPositionCache(scope)?.currentHolding.observedSlot).toBe(
      "700"
    );
  }
});

test("no-policy stale tab clears on refresh and cannot resurrect from stale HTTP", async () => {
  props.earnPolicy = null;
  respondWith({ position: position("500") });
  render();
  await flush();
  expect(output.position?.currentHolding.observedSlot).toBe("500");
  respondWith({ position: null, closedPositionObservedSlot: "600" });
  await output.refresh();
  await flush();
  expectClosed();
  for (const slot of ["500", "600"]) {
    respondWith({ position: position(slot) });
    await output.refresh();
    await flush();
    expectClosed();
  }
  respondWith({ position: position("700") });
  await output.refresh();
  await flush();
  expect(output.position?.currentHolding.observedSlot).toBe("700");
});

test("closure response preserves a later RPC deposit and fences subsequent reads", async () => {
  rpcRead = async () => snapshot("700");
  render();
  await flush();
  expect(output.position?.currentHolding.observedSlot).toBe("700");
  rpcRead = async () => snapshot("500");
  await output.refresh();
  await flush();
  expect(readEarnPositionCache(scope)?.currentHolding.observedSlot).toBe("700");
});

test("outstanding closure cannot erase a locally confirmed later deposit", async () => {
  const http = deferred<Response>();
  globalThis.fetch = mock(() => http.promise) as unknown as typeof fetch;
  render();
  await flush();
  output.setPosition(position("700"));
  render();
  http.resolve(
    Response.json({ position: null, closedPositionObservedSlot: "600" })
  );
  await flush();
  expect(output.position?.currentHolding.observedSlot).toBe("700");
  expect(readEarnPositionCache(scope)?.currentHolding.observedSlot).toBe("700");
});

test("accepted closure invalidates a previously outstanding refresh", async () => {
  const http = deferred<Response>();
  globalThis.fetch = mock(() => http.promise) as unknown as typeof fetch;
  render();
  await flush();
  const rpc = deferred<EarnRpcHoldingsSnapshot>();
  rpcRead = () => rpc.promise;
  const refresh = output.refresh();
  http.resolve(
    Response.json({ position: null, closedPositionObservedSlot: "600" })
  );
  await flush();
  rpc.resolve(snapshot("500"));
  await refresh;
  await flush();
  expectClosed();
});

for (const change of [
  { walletAddress: "11111111111111111111111111111114" },
  { solanaEnv: "devnet" },
  { settingsPda: "11111111111111111111111111111115" },
]) {
  test(`closure fence is isolated on ${JSON.stringify(
    change
  )} switch`, async () => {
    render();
    await flush();
    expectClosed();
    const pending = deferred<EarnRpcHoldingsSnapshot>();
    rpcRead = () => pending.promise;
    const oldRefresh = output.refresh();
    props = { ...props, ...change };
    rpcRead = async ({ minContextSlot }) => {
      expect(minContextSlot).toBeUndefined();
      return snapshot("550");
    };
    respondWith({ position: null });
    render();
    await flush();
    pending.resolve(snapshot("800"));
    await oldRefresh;
    await flush();
    expect(output.position?.currentHolding.observedSlot).toBe("550");
    expect(
      readEarnPositionCache({ ...scope, ...change })?.currentHolding
        .observedSlot
    ).toBe("550");
    expect(readEarnPositionCache(scope)).toBeNull();
  });
}

test("closure survives owner remount while its HTTP response is delayed", async () => {
  render();
  await flush();
  expectClosed();
  cells = [];
  cursor = 0;
  pendingEffects = [];
  const http = deferred<Response>();
  globalThis.fetch = mock(() => http.promise) as unknown as typeof fetch;
  rpcRead = async () => snapshot("500");
  render();
  await flush();
  expectClosed();
});

test("confirmed deposit survives lagging empty refresh without a prior closure", async () => {
  respondWith({ position: null });
  render();
  await flush();
  output.setPosition(position("700"));
  render();
  rpcRead = async ({ minContextSlot }) => {
    expect(minContextSlot).toBe(700);
    return { ...snapshot("500"), holdings: [] };
  };
  await output.refresh();
  await flush();
  expect(output.position?.currentHolding.observedSlot).toBe("700");
});
