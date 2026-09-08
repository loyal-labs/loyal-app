// Inert ownership/money-state verifier. Executes real repositories, API handlers
// and hooks; database/network/native boundaries are replaced, never production I/O.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules/typescript"));
function load(rel, imports, extra = {}) {
  const source = ts.transpileModule(
    fs.readFileSync(path.join(root, rel), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const exports = {};
  vm.runInNewContext(
    source,
    {
      exports,
      require: (name) => {
        if (name in imports) return imports[name];
        throw new Error("Unexpected dependency: " + name);
      },
      console,
      setTimeout,
      clearTimeout,
      URL,
      Request,
      Response,
      process: { env: {} },
      ...extra,
    },
    { filename: rel }
  );
  return exports;
}
const actions = {
  resolveLoyalClusterForSolanaEnv: () => "devnet",
  LoyalCluster: { Devnet: "devnet", MainnetBeta: "mainnet-beta" },
};
const schema = new Proxy(
  {},
  { get: (_, name) => new Proxy({}, { get: (_, col) => `${name}.${col}` }) }
);
const drizzle = {
  and: (...args) => args.filter(Boolean),
  eq: (column, value) => ({ column, value }),
  desc: (x) => x,
  asc: (x) => x,
  sql: () => null,
};
let writes = 0,
  queries = 0;
const now = new Date();
const row = {
  id: 1n,
  settings: "settings",
  walletAddress: "wallet",
  vaultIndex: 1,
  vaultPubkey: "vault",
  status: "active",
  currentAmountRaw: 100n,
  principalAmountRaw: 90n,
  currentObservedSlot: 110n,
  lastConfirmedSlot: 100n,
  initialLiquidityMint: "mint",
  currentLiquidityMint: "mint",
  currentMarket: "market",
  currentReserve: "reserve",
  currentObservedAt: now,
};
let rows = [row];
function filtered(input) {
  queries++;
  return rows.filter((r) =>
    input.where.every((p) => r[p.column.split(".")[1]] === p.value)
  );
}
const table = {
  async findFirst(input) {
    assert.equal(this, table);
    return filtered(input)[0];
  },
  async findMany(input) {
    assert.equal(this, table);
    return filtered(input);
  },
};
const db = new Proxy(
  { query: { userYieldPositions: table } },
  {
    get(target, key) {
      if (key in target) return target[key];
      return () => {
        writes++;
        throw new Error("Database mutation forbidden: " + String(key));
      };
    },
  }
);
const repository = load(
  "apps/web/src/lib/yield-optimization/yield-deposit-repository.server.ts",
  {
    "server-only": {},
    "@loyal-labs/actions": actions,
    "@solana/web3.js": {},
    "drizzle-orm": drizzle,
    "./yield-neon-client.server": new Proxy(
      { getYieldOptimizationClient: () => ({ db }) },
      { get: (t, k) => (k in t ? t[k] : schema[k]) }
    ),
  }
);
const input = {
  cluster: "devnet",
  settings: "settings",
  walletAddress: "wallet",
  vaultIndex: 1,
};
(async () => {
  assert.equal(
    (await repository.findActiveYieldPositionForVault(input)).id,
    1n
  );
  assert.equal(
    await repository.findActiveYieldPositionForVault({
      ...input,
      walletAddress: "intruder",
    }),
    null
  );
  assert.equal(
    await repository.findActiveYieldPositionForVault({
      ...input,
      settings: "other",
    }),
    null
  );
  assert.equal(
    await repository.findActiveYieldPositionForVault({
      ...input,
      vaultIndex: 0,
    }),
    null
  );
  rows = [
    { ...row, status: "closed", currentAmountRaw: 0n, lastConfirmedSlot: 200n },
  ];
  assert.equal(await repository.findActiveYieldPositionForVault(input), null);
  assert.equal(
    (await repository.findYieldPositionsForVault(input))[0].lastConfirmedSlot,
    200n
  );
  assert.equal(writes, 0);

  const serializers = load(
    "apps/web/src/lib/yield-optimization/earn-state-serializers.server.ts",
    { "./earn-autodeposit-loaded-state.shared": {} }
  );
  const imports = {
    "@/lib/yield-optimization/earn-state-serializers.server": serializers,
    "next/server": {
      NextResponse: { json: (body, options) => Response.json(body, options) },
    },
    "@loyal-labs/actions": {
      ...actions,
      getKaminoUsdcEarnTargetForCluster: () => ({
        reserve: { toBase58: () => "other" },
        market: { toBase58: () => "other" },
        liquidityMint: { toBase58: () => "other" },
      }),
    },
    "@/features/chat/server/app-user": {
      findCurrentUser: async () => ({ id: "user" }),
    },
    "@/features/identity/server/wallet-auth-errors": {
      WalletAuthError: class extends Error {},
    },
    "@/features/identity/server/wallet-auth-signature": {
      decodeWalletAddress: () => {},
    },
    "@/features/smart-accounts/server/service": {
      findReadyCurrentUserSmartAccount: async () => ({
        settingsPda: "settings",
        smartAccountAddress: "vault",
      }),
    },
    "@/lib/core/config/solana-env-override": {
      resolveLoyalWebSolanaEnvFromEnv: () => "devnet",
    },
    "@/lib/kamino/timescale-reserve-client.server": {
      getCurrentReserveUpdatesByReserve: async () => [],
    },
    "@/lib/yield-optimization/yield-deposit-repository.server": repository,
  };
  const mobile = load(
    "apps/web/src/app/api/smart-accounts/mobile/earn/state/route.ts",
    imports
  );
  const before = queries;
  const empty = await mobile.GET(new Request("https://app/state"));
  assert.equal(empty.status, 400);
  assert.equal(queries, before);
  let response = await (
    await mobile.GET(new Request("https://app/state?walletAddress=wallet"))
  ).json();
  assert.equal(response.position, null);
  assert.equal(response.projectedSlot, "200");
  assert.equal(response.projectedPositions[0].status, "closed");
  rows = [
    row,
    {
      ...row,
      id: 2n,
      initialLiquidityMint: "other-mint",
      currentAmountRaw: 50n,
      principalAmountRaw: 45n,
      lastConfirmedSlot: 90n,
    },
  ];
  response = await (
    await mobile.GET(new Request("https://app/state?walletAddress=wallet"))
  ).json();
  assert.equal(response.position.currentAmountRaw, "150");
  assert.equal(response.position.principalAmountRaw, "135");
  assert.equal(response.projectedSlot, "90");
  assert.equal(response.position.lastConfirmedSlot, "90");
  assert.equal(writes, 0);
  console.log(
    "PASS: read-only ownership predicates, closed accounting evidence, multi-mint conservative slot/amount aggregation"
  );

  let hookCells = [],
    cellIndex = 0,
    effects = [];
  const react = {
    useRef(value) {
      const i = cellIndex++;
      return (hookCells[i] ??= { current: value });
    },
    useState(value) {
      const i = cellIndex++;
      if (!(i in hookCells)) hookCells[i] = value;
      return [
        hookCells[i],
        (next) => {
          hookCells[i] = typeof next === "function" ? next(hookCells[i]) : next;
        },
      ];
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(fn) {
      effects.push(fn);
    },
  };
  const holding = (slot) => ({
    amountRaw: "100",
    kind: "kamino",
    label: "Kamino",
    liquidityMint: "mint",
    market: "market",
    marketName: "Kamino",
    observedAt: now.toISOString(),
    observedSlot: String(slot),
    provenance: { source: "rpc_getMultipleAccounts" },
    reserve: "reserve",
    sourceId: "reserve:reserve",
    supplyApyBps: "300",
    tokenProgramId: "token",
  });
  const position = (principal, slot) => ({
    currentSupplyApyBps: "300",
    lastConfirmedSlot: String(slot),
    currentTotalAmountRaw: "100",
    principalAmountRaw: String(principal),
    status: "active",
    currentHolding: {
      ...holding(slot),
      provenance: { lastHoldingEventId: null, lastRebalanceDecisionId: null },
    },
    initialHolding: {
      liquidityMint: "mint",
      market: "market",
      reserve: "reserve",
      supplyApyBps: "300",
    },
    display: { label: "Kamino", marketName: "Kamino", mintSymbol: "USDC" },
  });
  let rest = position(90, 100),
    restReads = 0,
    rpcReads = [],
    rpcSlot = 110,
    rpcZero = false,
    holdRpc = null;
  const snapshot = () => ({
    holdings: rpcZero ? [] : [holding(rpcSlot)],
    observedSlot: String(rpcSlot),
    observedAt: now.toISOString(),
    provenance: { watchedAccounts: [] },
  });
  const accounting = load(
    "apps/web/src/lib/yield-optimization/earn-position-accounting.client.ts",
    {}
  );
  let projectedRows,
    history = { transactions: [] },
    recoveryEnabled = false;
  const localData = new Map();
  const storage = {
    getItem: (key) => localData.get(key) ?? null,
    setItem: (key, value) => localData.set(key, value),
  };
  const newRecovery = () =>
    load(
      "apps/web/src/lib/yield-optimization/earn-position-recovery.client.ts",
      {
        "@/lib/client-cache/client-cache": {
          getClientCacheStorage: () => storage,
        },
        "./earn-position-accounting.client": accounting,
      }
    );
  let recovery = newRecovery();
  const intervals = [];
  const hooks = load(
    "apps/web/src/hooks/use-active-earn-position.ts",
    {
      "@/lib/yield-optimization/earn-position-accounting.client": accounting,
      "@/lib/yield-optimization/earn-position-recovery.client": {
        readEarnPositionRecovery: (scope) =>
          recoveryEnabled ? recovery.readEarnPositionRecovery(scope) : null,
        writeEarnPositionRecovery: (scope, data) => {
          if (recoveryEnabled) recovery.writeEarnPositionRecovery(scope, data);
        },
      },
      react,
      "@loyal-labs/actions": actions,
      "@loyal-labs/solana-rpc": { resolveSolanaEnv: (x) => x },
      "@solana/web3.js": {
        PublicKey: class {
          constructor(x) {
            this.x = x;
          }
          toBase58() {
            return this.x;
          }
        },
      },
      "@/lib/client-cache/client-cache": {
        readClientCache: () => null,
        writeClientCache: () => {},
        removeClientCache: () => {},
      },
      "@/lib/yield-optimization/earn-position-display": {
        resolveEarnPositionDisplay: () => ({ mintSymbol: "USDC" }),
      },
      "@/lib/yield-optimization/earn-rpc-holdings.client": {
        sumEarnRpcHoldingsAmountRaw: (holdings) =>
          holdings.reduce((n, h) => n + BigInt(h.amountRaw), 0n),
        fetchEarnRpcHoldingsSnapshot: async (args) => {
          rpcReads.push(args);
          if (holdRpc) return holdRpc;
          return snapshot();
        },
      },
    },
    {
      setInterval: (callback) => {
        intervals.push(callback);
        return intervals.length;
      },
      clearInterval: () => {},
      fetch: async (_url, init) => {
        assert.notEqual(init?.method, "POST");
        if (_url.endsWith("/earn-transactions")) return Response.json(history);
        restReads++;
        return Response.json({
          position: rest,
          projectedPositions: projectedRows,
        });
      },
    }
  );
  const props = {
    enabled: true,
    walletAddress: "wallet",
    settingsPda: "settings",
    solanaEnv: "devnet",
    programId: "program",
    earnPolicy: {},
    connection: {},
  };
  function render() {
    cellIndex = 0;
    effects = [];
    return hooks.useActiveEarnPosition(props);
  }
  let hook = render();
  await hook.refresh();
  hook = render();
  assert.equal(hook.position.principalAmountRaw, "90");
  rest = position(95, 120);
  rpcSlot = 130;
  await hook.refresh();
  hook = render();
  assert.equal(hook.position.principalAmountRaw, "95");
  assert.equal(restReads, 2);
  hook.setPosition(position(150, 200));
  hook.suppressSubscriptionRefreshThroughSlot("200");
  rest = position(95, 120);
  rpcSlot = 210;
  await hook.refresh();
  hook = render();
  assert.equal(hook.position.principalAmountRaw, "150");
  assert.equal(rpcReads.at(-1).minContextSlot, 200);
  rest = position(150, 200);
  await hook.refresh();
  hook = render();
  assert.equal(hook.position.principalAmountRaw, "150");

  let release;
  holdRpc = new Promise((resolve) => {
    release = resolve;
  });
  const oldRead = hook.refresh();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  hook.setPosition(null);
  hook.suppressSubscriptionRefreshThroughSlot("300");
  release({ ...snapshot(), observedSlot: "250" });
  holdRpc = null;
  await assert.rejects(oldRead, /superseded/);
  hook = render();
  assert.equal(hook.position, null);
  rpcSlot = 310;
  rpcZero = true;
  await hook.refresh();
  hook = render();
  assert.equal(hook.position, null);
  assert.equal(rpcReads.at(-1).minContextSlot, 300);
  console.log(
    "PASS: web REST refetch/principal adoption, stale ledger optimism, confirmed RPC fence, in-flight full-exit tombstone"
  );

  hookCells = [];
  rpcZero = false;
  rpcSlot = 500;
  rest = position(250, 400);
  hook = render();
  for (const effect of effects) effect();
  await new Promise((resolve) => setTimeout(resolve, 0));
  hook = render();
  assert.equal(hook.position.principalAmountRaw, "250");
  assert.equal(rpcReads.at(-1).minContextSlot, undefined);
  console.log(
    "PASS: initial web load adopts successful projected principal (not cached zero basis)"
  );

  // Execute real row coverage and hook commits, not source-string assertions.
  const evidence = (id, slot, extra = {}) => ({
    id,
    initialLiquidityMint: "initial-" + id,
    initialReserve: "initial-reserve-" + id,
    currentLiquidityMint: "current-" + id,
    currentReserve: "reserve-" + id,
    vaultPubkey: "vault",
    status: "active",
    lastConfirmedSlot: String(slot),
    ...extra,
  });
  const a = evidence("a", 100),
    b = evidence("b", 5),
    c = evidence("c", 7, { status: "closed" });
  const deposit = {
    signature: "deposit-a",
    confirmedSlot: "200",
    targets: [
      {
        kind: "deposit",
        liquidityMint: a.initialLiquidityMint,
        reserve: a.initialReserve,
        vaultPubkey: "vault",
      },
    ],
  };
  const add = (amount) => (current) => ({
    ...current,
    currentTotalAmountRaw: String(
      BigInt(current.currentTotalAmountRaw) + BigInt(amount)
    ),
    principalAmountRaw: String(
      BigInt(current.principalAmountRaw) + BigInt(amount)
    ),
  });
  hookCells = [];
  rpcZero = false;
  rpcSlot = 150;
  projectedRows = [a, b, c];
  rest = position(90, 5);
  hook = render();
  await hook.refresh();
  hook = render();
  // RPC wins the confirmation race, but cannot acknowledge principal.
  rpcSlot = 210;
  await hook.refresh();
  hook = render();
  hook.setPosition(add(20), deposit);
  hook = render();
  assert.equal(hook.position.currentTotalAmountRaw, "100");
  assert.equal(hook.position.principalAmountRaw, "110");
  hook.setPosition(add(20), deposit);
  hook = render();
  assert.equal(
    hook.position.principalAmountRaw,
    "110",
    "signature replay cannot double-add"
  );
  await assert.rejects(hook.refresh(), /still pending/);
  hook = render();
  assert.equal(hook.position.principalAmountRaw, "110");
  assert.equal(
    accounting.isEarnMutationCovered(
      [evidence("x", 999, { initialLiquidityMint: a.initialLiquidityMint })],
      deposit
    ),
    false,
    "wrong initial reserve cannot cover"
  );
  assert.equal(
    accounting.isEarnMutationCovered(
      [evidence("a", 999, { vaultPubkey: "other" })],
      deposit
    ),
    false,
    "wrong vault cannot cover"
  );
  assert.equal(
    accounting.isEarnMutationCovered([a, evidence("b", 999), c], deposit),
    false,
    "new sibling slot cannot cover"
  );
  projectedRows = [evidence("a", 200), b, c];
  rest = position(111, 5);
  await hook.refresh();
  hook = render();
  assert.equal(
    hook.position.principalAmountRaw,
    "111",
    "old active and closed siblings cannot pin principal"
  );
  projectedRows = [a, b, c];
  rest = position(90, 5);
  await assert.rejects(hook.refresh(), /regressed/);
  hook = render();
  assert.equal(hook.position.principalAmountRaw, "111");
  projectedRows = [evidence("a", 200), b, c];
  const targetA = hook.captureAccountingTargets([
    {
      kind: "withdrawal",
      liquidityMint: a.currentLiquidityMint,
      reserve: a.currentReserve,
      vaultPubkey: "vault",
    },
  ]);
  assert.equal(targetA[0].positionIds[0], "a");
  assert.equal(
    accounting.isEarnMutationCovered(
      [
        evidence("a", 300, {
          currentLiquidityMint: "rebalanced",
          currentReserve: "rebalanced-reserve",
        }),
        b,
        c,
      ],
      { targets: targetA, confirmedSlot: "300" }
    ),
    true,
    "bound row survives a current-mint rebalance"
  );
  assert.equal(
    accounting.isEarnMutationCovered(
      [
        evidence("wrong", 900, {
          currentLiquidityMint: a.currentLiquidityMint,
          currentReserve: a.currentReserve,
        }),
      ],
      { targets: targetA, confirmedSlot: "300" }
    ),
    false,
    "same source cannot substitute a different bound row"
  );
  assert.equal(
    accounting.isEarnMutationCovered([evidence("a", 300)], {
      targets: [{ ...targetA[0], positionIds: ["a", "missing"] }],
      confirmedSlot: "300",
    }),
    false
  );
  const targetB = hook.captureAccountingTargets([
    {
      kind: "withdrawal",
      liquidityMint: b.currentLiquidityMint,
      reserve: b.currentReserve,
      vaultPubkey: "vault",
    },
  ]);
  hook.setPosition(add(-20), {
    targets: targetA,
    confirmedSlot: "300",
    signature: "withdraw-a",
  });
  hook = render();
  assert.equal(
    hook.position.principalAmountRaw,
    "91",
    "first landed stage remains even if next stage is cancelled"
  );
  hook.setPosition(add(-10), {
    targets: targetB,
    confirmedSlot: "400",
    signature: "withdraw-b",
  });
  projectedRows = [
    evidence("a", 300, {
      currentLiquidityMint: "rebalanced",
      currentReserve: "rebalanced-reserve",
    }),
    b,
    c,
  ];
  rest = position(91, 5);
  rpcSlot = 450;
  await assert.rejects(hook.refresh(), /still pending/);
  hook = render();
  assert.equal(
    hook.position.principalAmountRaw,
    "81",
    "partial stage coverage cannot release the aggregate overlay"
  );
  projectedRows = [projectedRows[0], evidence("b", 400), c];
  rest = position(80, 300);
  await hook.refresh();
  hook = render();
  assert.equal(
    hook.position.principalAmountRaw,
    "80",
    "different step slots converge without demanding MAX on every row"
  );
  hook.setPosition(add(-40), {
    targets: targetA,
    confirmedSlot: "500",
    signature: "exit-a",
  });
  hook.setPosition(null, {
    targets: targetB,
    confirmedSlot: "600",
    signature: "exit-b",
  });
  rpcZero = true;
  rpcSlot = 650;
  rest = null;
  projectedRows = [];
  await assert.rejects(hook.refresh(), /regressed/);
  hook = render();
  assert.equal(hook.position, null, "absence is not full-exit evidence");
  projectedRows = [
    evidence("a", 500, { status: "closed" }),
    evidence("b", 600, { status: "closed" }),
    c,
  ];
  await hook.refresh();
  hook = render();
  assert.equal(hook.position, null);
  assert.equal(rpcReads.at(-1).minContextSlot, 600);
  projectedRows = [a, b, c];
  rest = position(90, 5);
  await assert.rejects(hook.refresh(), /regressed/);
  hook = render();
  assert.equal(
    hook.position,
    null,
    "accepted closed rows cannot be resurrected"
  );

  // A refresh that started before a new confirmation must still reject.
  projectedRows = [
    evidence("a", 500, { status: "closed" }),
    evidence("b", 600, { status: "closed" }),
    c,
  ];
  rest = null;
  holdRpc = new Promise((resolve) => {
    release = resolve;
  });
  const raced = hook.refresh();
  await new Promise((resolve) => setTimeout(resolve, 0));
  hook.setPosition(position(12, 700), {
    ...deposit,
    confirmedSlot: "700",
    signature: "reopen",
  });
  release({ ...snapshot(), observedSlot: "650" });
  holdRpc = null;
  await assert.rejects(raced, /superseded/);
  hook = render();
  assert.equal(hook.position.principalAmountRaw, "12");
  console.log(
    "PASS: exact row/vault/initial identity, rebalanced withdrawal IDs, unrelated old siblings, staged principal convergence, RPC-before-confirmation deduplication, full-exit evidence, stale and racing refresh rejection"
  );

  const support = load(
    "apps/web/src/components/wallet-workspace/facelift/earn-actions-support.ts",
    {
      "@solana/spl-token": { TOKEN_PROGRAM_ID: { toBase58: () => "token" } },
      "@solana/web3.js": {},
      react: {},
      "@/components/wallet-sidebar/earn-detail-view": {},
      "@/features/earn-realtime": {},
      "@/features/observability/lifecycle-contract": {},
      "@/features/smart-accounts/refresh-plan": {},
      "@/lib/yield-optimization/earn-position-display": {
        resolveEarnPositionDisplay: () => ({
          label: "Kamino",
          marketName: "Kamino",
          mintSymbol: "USDC",
        }),
      },
    }
  );
  const source = (mint, reserve) => ({
    liquidityMint: mint,
    reserve,
    market: "market",
    type: "reserve",
    amountRaw: "100",
    sourceId: reserve,
  });
  const draft = {
    mode: "full",
    source: source("current-a", "reserve-a"),
    fullExitSources: [
      source("current-a", "reserve-a"),
      source("current-b", "reserve-b"),
    ],
  };
  const prepared = {
    withdrawSteps: ["a", "b"].map((id, i) => ({
      persistence: {
        vaultPubkey: "vault",
        liquidityMint: "current-" + id,
        withdrawnAmountRaw: "50",
      },
      reserveWithdrawals: [
        {
          accountingReserve: "reserve-" + id,
          liquidityMint: "current-" + id,
          market: "market",
          withdrawnAmountRaw: "50",
        },
      ],
    })),
  };
  let stagePosition = {
    ...position(100, 100),
    holdings: ["a", "b"].map((id) => ({
      ...holding(100),
      liquidityMint: "current-" + id,
      reserve: "reserve-" + id,
      amountRaw: "50",
    })),
  };
  stagePosition = support
    .getEarnWithdrawStepUpdate(prepared, 0, draft)
    .apply(stagePosition);
  assert.equal(stagePosition.currentTotalAmountRaw, "50");
  assert.equal(stagePosition.principalAmountRaw, "50");
  assert.equal(stagePosition.holdings[0].liquidityMint, "current-b");
  stagePosition = support
    .getEarnWithdrawStepUpdate(prepared, 1, draft)
    .apply(stagePosition);
  assert.equal(
    stagePosition,
    null,
    "final stage removes the actual second source, not the original draft source twice"
  );
  const publicKey = (value) => ({ toBase58: () => value });
  const depositPrepared = {
    targetReserve: {
      liquidityMint: publicKey("mint"),
      market: publicKey("market"),
      reserve: publicKey("reserve"),
    },
    vault: { usdcAta: publicKey("ata") },
  };
  assert.equal(
    support.buildPostDepositEarnPosition({
      amountRaw: 20n,
      confirmedSlot: "100",
      current: position(90, 150),
      preparedDeposit: depositPrepared,
    }).principalAmountRaw,
    "110",
    "a holding observation cannot suppress the principal delta"
  );
  // Projected principal can win the race independently of the RPC amount.
  for (const amountSlot of [150, 210]) {
    hookCells = [];
    rpcZero = false;
    rpcSlot = amountSlot;
    projectedRows = [evidence("a", 200), b, c];
    rest = position(110, 5);
    hook = render();
    await hook.refresh();
    hook = render();
    hook.setPosition(
      (current) =>
        support.buildPostDepositEarnPosition({
          amountRaw: 20n,
          confirmedSlot: "200",
          current,
          preparedDeposit: depositPrepared,
        }),
      deposit
    );
    hook = render();
    assert.equal(
      hook.position.principalAmountRaw,
      "110",
      "already-projected principal is not added again"
    );
    assert.equal(
      hook.position.currentTotalAmountRaw,
      amountSlot < 200 ? "120" : "100",
      "only a complete post-confirmation RPC amount suppresses the amount delta"
    );
  }
  // An idle remainder never subtracts an unrelated mint with a null token identity.
  const idlePosition = {
    ...position(100, 100),
    currentTotalAmountRaw: "115",
    holdings: [
      {
        ...holding(100),
        liquidityMint: "current-a",
        reserve: "reserve-a",
        amountRaw: "50",
      },
      {
        ...holding(100),
        liquidityMint: "other-idle",
        reserve: null,
        kind: "idle",
        amountRaw: "5",
        provenance: {},
      },
      {
        ...holding(100),
        liquidityMint: "current-a",
        reserve: null,
        kind: "idle",
        amountRaw: "10",
        provenance: {},
      },
      {
        ...holding(100),
        liquidityMint: "current-b",
        reserve: "reserve-b",
        amountRaw: "50",
      },
    ],
  };
  const withIdle = {
    ...prepared,
    withdrawSteps: [
      {
        ...prepared.withdrawSteps[0],
        persistence: {
          ...prepared.withdrawSteps[0].persistence,
          vaultUsdcRemainderRaw: "10",
        },
      },
    ],
  };
  const afterIdle = support
    .getEarnWithdrawStepUpdate(withIdle, 0, {
      ...draft,
      source: { ...draft.source, tokenAccount: null },
    })
    .apply(idlePosition);
  assert.equal(afterIdle.currentTotalAmountRaw, "55");
  assert.equal(
    afterIdle.holdings.find((h) => h.liquidityMint === "other-idle").amountRaw,
    "5"
  );
  console.log(
    "PASS: real optimistic helpers apply each withdrawal source once, exact idle mint, and independent projection/RPC confirmation races"
  );

  // Both web contracts include closed evidence from the same read as principal.
  rows = [
    {
      ...row,
      initialReserve: "reserve",
      status: "closed",
      currentAmountRaw: 0n,
      principalAmountRaw: 0n,
      lastConfirmedSlot: 800n,
    },
  ];
  const webPositionRoute = load(
    "apps/web/src/app/api/smart-accounts/yield-optimization/position/route.ts",
    {
      ...imports,
      "@/features/identity/server/auth-session": {
        resolveAuthenticatedPrincipalFromRequest: async () => ({
          walletAddress: "wallet",
          settingsPda: "settings",
        }),
      },
      "@/lib/yield-optimization/earn-position-display": {},
      "@/lib/yield-optimization/earn-product-mints.shared": {},
    }
  );
  const exitResponse = await (
    await webPositionRoute.GET(new Request("https://app/position"))
  ).json();
  assert.equal(exitResponse.position, null);
  assert.equal(exitResponse.projectedPositions[0].lastConfirmedSlot, "800");
  assert.equal(exitResponse.projectedPositions[0].status, "closed");
  assert.equal(writes, 0);
  console.log(
    "PASS: web null position includes read-only closed-row confirmation evidence"
  );
  const statePublicKey = class {
    constructor(value) {
      this.value = value;
    }
    toBase58() {
      return this.value;
    }
  };
  const webStateRoute = load(
    "apps/web/src/app/api/smart-accounts/yield-optimization/earn-state/route.ts",
    {
      ...imports,
      "@loyal-labs/loyal-smart-accounts": {
        pda: { getSmartAccountPda: () => [new statePublicKey("vault")] },
      },
      "@solana/web3.js": { PublicKey: statePublicKey },
      "@/features/identity/server/auth-session": {
        resolveAuthenticatedPrincipalFromRequest: async () => ({
          walletAddress: "wallet",
          settingsPda: "settings",
        }),
      },
      "@/lib/core/config/server": {
        getServerEnv: () => ({ loyalSmartAccounts: { programId: "program" } }),
      },
      "@/lib/yield-optimization/deployment-policy-signer.server": {
        getDeploymentPolicySignerPublicKey: () => new statePublicKey("signer"),
      },
      "@/lib/yield-optimization/earn-autoswap-rollout.server": {
        isEarnAutoswapEnrollmentEnabled: () => false,
      },
      "@/lib/yield-optimization/earn-autodeposit-repository.server": {
        findCurrentEarnAutodepositState: async () => null,
      },
      "@/lib/yield-optimization/earn-cross-mint-repository.server": {
        findEarnCrossMintSnapshot: async () => null,
      },
      "@/lib/yield-optimization/yield-deposit-repository.server": {
        ...repository,
        findActiveYieldRoutePolicyPair: async () => null,
        findCurrentEarnDepositOnboardingAttempt: async () => null,
        findCurrentNonzeroYieldVaultReservePositions: async () => [],
        findCurrentYieldVaultIdleTokenBalances: async () => [],
      },
    }
  );
  const closedState = await (
    await webStateRoute.GET(new Request("https://app/state"))
  ).json();
  assert.equal(closedState.position, null);
  assert.equal(closedState.projectedPositions[0].lastConfirmedSlot, "800");
  rows = [
    { ...row, initialReserve: "reserve", principalAmountRaw: 90n },
    {
      ...row,
      id: 2n,
      initialReserve: "old-reserve",
      initialLiquidityMint: "other-mint",
      principalAmountRaw: 10n,
      lastConfirmedSlot: 5n,
    },
    {
      ...row,
      id: 3n,
      initialReserve: "closed-reserve",
      status: "closed",
      principalAmountRaw: 0n,
      currentAmountRaw: 0n,
      lastConfirmedSlot: 2n,
    },
  ];
  const activeState = await (
    await webStateRoute.GET(new Request("https://app/state"))
  ).json();
  assert.equal(activeState.position.principalAmountRaw, "100");
  assert.equal(activeState.position.lastConfirmedSlot, "5");
  assert.equal(activeState.projectedPositions.length, 3);
  assert.equal(writes, 0);
  console.log(
    "PASS: earn-state aggregates only active principal, retains conservative MIN and includes old closed siblings independently"
  );

  let suppliedFence,
    hasPolicy = true,
    observed = "900";
  class PublicKey {
    constructor(x) {
      this.x = x;
    }
    toBase58() {
      return this.x;
    }
  }
  const holdingsRoute = load(
    "apps/web/src/app/api/smart-accounts/mobile/earn/holdings/route.ts",
    {
      ...imports,
      "@loyal-labs/loyal-smart-accounts": {
        pda: { getSmartAccountPda: () => [new PublicKey("vault")] },
      },
      "@solana/web3.js": { PublicKey, Connection: class {} },
      "@/lib/core/config/server": {
        getServerEnv: () => ({ loyalSmartAccounts: { programId: "program" } }),
      },
      "@/lib/solana/rpc-endpoints.server": {
        getServerSolanaEndpoints: () => ({ rpcEndpoint: "http://inert" }),
      },
      "@/lib/solana/rpc-rate-limit": { getFrontendSolanaRpcFetch: () => {} },
      "@/lib/yield-optimization/earn-state-serializers.server": {
        serializeRoutePolicyState: () => ({}),
      },
      "@/lib/yield-optimization/yield-deposit-repository.server": {
        ...repository,
        findActiveYieldRoutePolicyPair: async () =>
          hasPolicy ? { routePolicy: {} } : null,
      },
      "@/lib/yield-optimization/earn-rpc-holdings.client": {
        fetchEarnRpcHoldingsSnapshot: async (args) => {
          suppliedFence = args.minContextSlot;
          assert.equal(args.requireCompleteReserveReads, true);
          return { ...snapshot(), observedSlot: observed };
        },
      },
    },
    {
      globalThis: {
        fetch: () => {
          throw new Error("No network");
        },
      },
    }
  );
  const requested = "https://app/holdings?walletAddress=wallet&minContextSlot=";
  assert.equal(
    (await holdingsRoute.GET(new Request(requested + "bad"))).status,
    400
  );
  assert.equal(
    (await holdingsRoute.GET(new Request(requested + "9007199254740992")))
      .status,
    400
  );
  assert.equal(
    (await holdingsRoute.GET(new Request(requested + "800"))).status,
    200
  );
  assert.equal(suppliedFence, 800);
  observed = "799";
  assert.equal(
    (await holdingsRoute.GET(new Request(requested + "800"))).status,
    503
  );
  hasPolicy = false;
  assert.equal(
    (await holdingsRoute.GET(new Request(requested + "800"))).status,
    503
  );
  assert.equal(writes, 0);
  console.log(
    "PASS: mobile RPC minContextSlot validation/forwarding, stale/incomplete evidence stays retryable"
  );

  // Durable, exact-signature recovery: reload creates fresh hook AND module memory.
  recoveryEnabled = true;
  hookCells = [];
  rpcZero = false;
  rpcSlot = 150;
  projectedRows = [a, b, c];
  rest = position(90, 5);
  hook = render();
  await hook.refresh();
  hook = render();
  const missingSlot = {
    signature: "ws-only",
    targets: [
      {
        kind: "withdrawal",
        liquidityMint: "idle-mint",
        reserve: null,
        vaultPubkey: "vault",
      },
    ],
  };
  hook.setPosition(add(-20), missingSlot);
  hook = render();
  let beforeRpc = rpcReads.length;
  await assert.rejects(hook.refresh(), /slot evidence/);
  assert.equal(
    rpcReads.length,
    beforeRpc,
    "no metadata means NO unfenced RPC call"
  );
  recovery = newRecovery();
  hookCells = [];
  hook = render();
  hook = render();
  assert.equal(
    hook.position.principalAmountRaw,
    "70",
    "reload retains pending principal without cache TTL"
  );
  effects[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  hook = render();
  assert.equal(
    rpcReads.length,
    beforeRpc,
    "mount recovery also forbids unfenced reads"
  );
  hook.setPosition(add(-20), missingSlot);
  hook = render();
  assert.equal(
    hook.position.principalAmountRaw,
    "70",
    "reload retains signature deduplication"
  );
  for (const transactions of [
    [
      {
        signature: "wrong-signature",
        kind: "withdraw",
        positionId: "a",
        transactionSlot: "200",
      },
    ],
    [
      {
        signature: "ws-only",
        kind: "deposit",
        positionId: "a",
        transactionSlot: "200",
      },
    ],
    [
      {
        signature: "ws-only",
        kind: "withdraw",
        positionId: "missing",
        transactionSlot: "200",
      },
    ],
    [
      {
        signature: "ws-only",
        kind: "withdraw",
        positionId: "a",
        transactionSlot: "NaN",
      },
    ],
    [
      {
        signature: "ws-only",
        kind: "withdraw",
        positionId: "a",
        confirmedSlot: "200",
      },
    ],
    [
      {
        signature: "ws-only",
        kind: "withdraw",
        positionId: "a",
        transactionSlot: "200",
      },
      {
        signature: "ws-only",
        kind: "withdraw",
        positionId: "b",
        transactionSlot: "201",
      },
    ],
  ]) {
    history = { transactions };
    await assert.rejects(hook.refresh(), /slot evidence/);
    assert.equal(rpcReads.length, beforeRpc);
  }
  history = {
    transactions: [
      {
        signature: "ws-only",
        kind: "withdraw",
        positionId: "foreign",
        transactionSlot: "200",
      },
    ],
  };
  projectedRows.push(evidence("foreign", 200, { vaultPubkey: "other-vault" }));
  await assert.rejects(hook.refresh(), /slot evidence/);
  assert.equal(rpcReads.length, beforeRpc);
  projectedRows = [
    evidence("a", 200, {
      currentLiquidityMint: "rebalance-after-idle",
      currentReserve: "new-reserve",
    }),
    b,
    c,
    projectedRows.at(-1),
  ];
  history = {
    transactions: [
      {
        signature: "ws-only",
        kind: "withdraw",
        positionId: "a",
        transactionSlot: "200",
        confirmedSlot: "999",
      },
    ],
  };
  rest = position(71, 5);
  rpcSlot = 210;
  // Run mounted retry effect: no new SSE or user action is required.
  hook = render();
  effects.at(-2)();
  intervals.at(-1)();
  await new Promise((resolve) => setTimeout(resolve, 0));
  hook = render();
  assert.equal(hook.position.principalAmountRaw, "71");
  assert.equal(
    rpcReads.at(-1).minContextSlot,
    200,
    "history slot fences complete RPC"
  );
  const stageA = {
    signature: "durable-a",
    confirmedSlot: "300",
    targets: [{ ...missingSlot.targets[0], positionIds: ["a"] }],
  };
  const stageB = {
    signature: "durable-b",
    confirmedSlot: "400",
    targets: [{ ...missingSlot.targets[0], positionIds: ["b"] }],
  };
  hook.setPosition(add(-20), stageA);
  hook.setPosition(null, stageB);
  recovery = newRecovery();
  hookCells = [];
  hook = render();
  hook = render();
  assert.equal(hook.position, null, "full exit null is a durable tombstone");
  projectedRows = [
    evidence("a", 300, { status: "closed" }),
    b,
    c,
    projectedRows.at(-1),
  ];
  rest = null;
  rpcZero = true;
  rpcSlot = 410;
  await assert.rejects(hook.refresh(), /still pending/);
  assert.equal(rpcReads.at(-1).minContextSlot, 400);
  projectedRows[1] = evidence("b", 400, { status: "closed" });
  await hook.refresh();
  recovery = newRecovery();
  hookCells = [];
  hook = render();
  hook = render();
  projectedRows[0] = a;
  rest = position(90, 5);
  rpcZero = false;
  await assert.rejects(hook.refresh(), /regressed/);
  hook = render();
  assert.equal(hook.position, null);
  props.walletAddress = "B";
  hook = render();
  hook = render();
  assert.equal(hook.position, null, "A cannot hydrate into B");
  props.walletAddress = "wallet";
  hook = render();
  hook = render();
  hook.setPosition(position(999, 999), stageB);
  hook = render();
  assert.equal(
    hook.position,
    null,
    "A-B-A retains deduplication and tombstone"
  );
  const multiEvidence = accounting.recoverEarnMutationEvidence(
    missingSlot,
    [evidence("a", 200), evidence("b", 199)],
    {
      transactions: ["a", "b"].map((positionId) => ({
        signature: "ws-only",
        kind: "withdraw",
        positionId,
        transactionSlot: "200",
      })),
    }
  );
  assert.equal(
    accounting.isEarnMutationCovered(
      [evidence("a", 999), evidence("b", 199)],
      multiEvidence
    ),
    false,
    "each signature-bound row must cover its stage, not MAX"
  );
  assert.equal(
    accounting.isEarnMutationCovered(
      [evidence("a", 200), evidence("b", 200)],
      multiEvidence
    ),
    true
  );
  let warnings = 0;
  const unavailable = load(
    "apps/web/src/lib/yield-optimization/earn-position-recovery.client.ts",
    {
      "@/lib/client-cache/client-cache": {
        getClientCacheStorage: () => ({
          setItem() {
            throw new Error("quota");
          },
        }),
      },
      "./earn-position-accounting.client": accounting,
    },
    { console: { warn: () => warnings++ } }
  );
  const persisted = recovery.readEarnPositionRecovery(
    "enabled:devnet:wallet:settings"
  );
  unavailable.writeEarnPositionRecovery("scope", persisted);
  assert.equal(unavailable.readEarnPositionRecovery("scope").position, null);
  assert.equal(
    warnings,
    1,
    "storage failure warns but never fails confirmed money action"
  );
  assert.equal(unavailable.readEarnPositionRecovery("other-scope"), null);
  // Scope envelope cannot be replayed under another storage key.
  localData.set(
    "loyal:earn-position-recovery:1:wrong",
    localData.get(
      "loyal:earn-position-recovery:1:enabled:devnet:wallet:settings"
    )
  );
  assert.equal(newRecovery().readEarnPositionRecovery("wrong"), null);
  console.log(
    "PASS: no-slot no-RPC, malformed/wrong-scope history rejection, exact-history idle/rebalance recovery, mounted evidence retry, durable staged/null proofs and A-B-A isolation, storage failure retention"
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
