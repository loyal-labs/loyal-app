import { useEarnPosition } from "../useEarnPosition";
import { useEarnWithdrawSources } from "../useEarnWithdrawSources";
import type {
  EarnHoldingsResponse,
  EarnPosition,
  EarnStateResponse,
  EarnWithdrawSourceInfo,
} from "@/lib/solana/earn/earn-api";

// Run both owning hooks, substituting only React scheduling and HTTP. This
// protects the money-movement invariant: a closed generation cannot supply a
// replacement deposit's headline, cost basis, details or withdrawal source.
let cells: unknown[] = [];
let cursor = 0;
let effects: (() => void)[] = [];
const changed = (a: unknown[] | undefined, b: unknown[]) =>
  !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
jest.mock("react", () => ({
  useRef<T>(value: T) {
    const i = cursor++;
    return (cells[i] ??= { current: value }) as { current: T };
  },
  useState<T>(value: T) {
    const i = cursor++;
    if (!(i in cells)) cells[i] = value;
    return [
      cells[i],
      (next: T | ((previous: T) => T)) => {
        cells[i] =
          typeof next === "function"
            ? (next as (previous: T) => T)(cells[i] as T)
            : next;
      },
    ];
  },
  useCallback<T>(fn: T, deps: unknown[]) {
    const i = cursor++;
    const old = cells[i] as { fn: T; deps: unknown[] } | undefined;
    if (!old || changed(old.deps, deps)) cells[i] = { fn, deps };
    return (cells[i] as { fn: T }).fn;
  },
  useEffect(fn: () => void | (() => void), deps: unknown[]) {
    const i = cursor++;
    type Effect = { deps: unknown[]; cleanup?: void | (() => void) };
    const old = cells[i] as Effect | undefined;
    if (!old || changed(old.deps, deps)) {
      const cell: Effect = { deps };
      cells[i] = cell;
      effects.push(() => {
        old?.cleanup?.();
        cell.cleanup = fn();
      });
    }
  },
}));
jest.mock("@/config/env", () => ({ env: { solanaEnv: "mainnet" } }));
let stateRead: () => Promise<EarnStateResponse>;
let holdingsRead: () => Promise<EarnHoldingsResponse>;
let sourceRows: EarnWithdrawSourceInfo[] = [];
jest.mock("@/lib/solana/earn/earn-api", () => ({
  fetchEarnState: () => stateRead(),
  fetchEarnHoldings: () => holdingsRead(),
  fetchEarnWithdrawSources: async () => ({ sources: sourceRows }),
}));

let walletId = 0;
let output: ReturnType<typeof useEarnPosition> &
  ReturnType<typeof useEarnWithdrawSources>;
const render = Harness;
function Harness() {
  cursor = 0;
  const owner = useEarnPosition(`lifecycle-wallet-${walletId}`);
  const sources = useEarnWithdrawSources(
    `lifecycle-wallet-${walletId}`,
    owner.reconciliationKey,
    owner.position !== null
  );
  output = { ...owner, ...sources };
  const pending = effects;
  effects = [];
  pending.forEach((fn) => fn());
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  render();
}
const position = (): EarnPosition => ({
  currentAmountRaw: "100000000",
  principalAmountRaw: "100000000",
  currentObservedSlot: "500",
  currentSupplyApyBps: null,
  status: "active",
});
const state = (
  value: EarnPosition | null = position(),
  closed: string | null = null
): EarnStateResponse => ({
  position: value,
  closedPositionObservedSlot: closed,
  cluster: "mainnet-beta",
  settingsPda: "settings-A",
  smartAccountAddress: "vault-A",
});
const holdings = (
  amount = "100000000",
  slot: string | null = "500",
  settings = "settings-A"
): EarnHoldingsResponse => ({
  currentTotalAmountRaw: amount,
  observedSlot: slot,
  observedAt: slot === null ? null : "2026-09-11T00:00:00Z",
  settingsPda: settings,
  smartAccountAddress: "vault-A",
  holdings:
    amount === "0"
      ? []
      : [
          {
            kind: "idle",
            amountRaw: amount,
            label: "USDC",
            liquidityMint: "USDC",
            market: null,
            marketName: null,
            reserve: null,
          },
        ],
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  walletId++;
  cells = [];
  cursor = 0;
  effects = [];
  stateRead = async () => state();
  holdingsRead = async () => holdings();
  sourceRows = [
    {
      type: "idle",
      id: "old-source",
      amountRaw: "100000000",
      label: "USDC",
      liquidityMint: "USDC",
      market: null,
      reserve: null,
      tokenAccount: "old-token-account",
    },
  ];
});
afterEach(() => jest.useRealTimers());

async function refresh() {
  await output.refreshEarnPosition();
  await flush();
}

test("delayed closure cannot keep old headline/details/sources over newer funds", async () => {
  render();
  await flush();
  await output.refreshSources();
  await flush();
  expect(output.sources[0].id).toBe("old-source");
  stateRead = async () => state(null, "600");
  holdingsRead = async () => holdings("25000000", "700");
  await refresh();
  await refresh();
  expect(output.position?.currentAmountRaw).toBe("25000000");
  expect(output.position?.principalAmountRaw).toBeNull();
  expect(output.holdings.map((row) => row.amountRaw)).toEqual(["25000000"]);
  expect(output.sources).toEqual([]);
});

test("accepted closure allows a later funded snapshot despite older accounting", async () => {
  stateRead = async () => state(null, "600");
  holdingsRead = async () => holdings("0", null);
  render();
  await flush();
  expect(output.position).toBeNull();
  stateRead = async () => state();
  holdingsRead = async () => holdings("25000000", "700");
  await refresh();
  expect(output.position?.currentAmountRaw).toBe("25000000");
  expect(output.position?.principalAmountRaw).toBeNull();
  // A subsequent stale response still cannot resurrect the closed 100.
  holdingsRead = async () => holdings("100000000", "500");
  await refresh();
  expect(output.position?.currentAmountRaw).toBe("25000000");
});

for (const [label, snapshot] of [
  ["foreign scope", () => holdings("25000000", "700", "settings-other")],
  ["same-slot funds", () => holdings("25000000", "600")],
  ["unobserved funds", () => holdings("25000000", null)],
] as const) {
  test(`${label} cannot defeat a proven closure`, async () => {
    render();
    await flush();
    stateRead = async () => state(null, "600");
    holdingsRead = async () => snapshot();
    await refresh();
    expect(output.position).toBeNull();
    expect(output.holdings).toEqual([]);
  });
}

test("RPC failure is not closure evidence and retains funded state", async () => {
  render();
  await flush();
  stateRead = async () => state(null);
  holdingsRead = async () => {
    throw new Error("offline");
  };
  await refresh();
  expect(output.position?.currentAmountRaw).toBe("100000000");
});
