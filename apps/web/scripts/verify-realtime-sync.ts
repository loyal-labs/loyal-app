import assert from "node:assert/strict";

import { ResourceRefreshCoordinator } from "../src/features/realtime-sync/resource-refresh-coordinator";
import {
  SMART_ACCOUNT_POLICY_FOLLOW_UP_DELAY_MS,
  SmartAccountPolicyFollowUp,
  SmartAccountReadModelLoadOrder,
  SmartAccountRefreshOrder,
  SmartAccountRefreshSingleflight,
  SmartAccountScopeGeneration,
  resolveSmartAccountRefreshError,
  resolveSmartAccountReadModelReuse,
} from "../src/features/smart-accounts/refresh-plan";

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function verifyBurstCoalescing(): Promise<void> {
  const coordinator = new ResourceRefreshCoordinator();
  coordinator.setScope("wallet-a");
  let refreshCount = 0;
  coordinator.register("earn.position", () => {
    refreshCount += 1;
  });

  await Promise.all([
    coordinator.invalidate(["earn.position"]),
    coordinator.invalidate(["earn.position"]),
    coordinator.invalidate(["earn.position"]),
  ]);

  assert.equal(refreshCount, 1, "a synchronous burst must make one request");
}

async function verifyTrailingRefresh(): Promise<void> {
  const coordinator = new ResourceRefreshCoordinator();
  coordinator.setScope("wallet-a");
  const firstStarted = deferred();
  const releaseFirst = deferred();
  let refreshCount = 0;
  coordinator.register("earn.position", async () => {
    refreshCount += 1;
    if (refreshCount === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
  });

  const first = coordinator.invalidate(["earn.position"]);
  await firstStarted.promise;
  const dirtyOnce = coordinator.invalidate(["earn.position"]);
  const dirtyTwice = coordinator.invalidate(["earn.position"]);
  releaseFirst.resolve();
  await Promise.all([first, dirtyOnce, dirtyTwice]);

  assert.equal(
    refreshCount,
    2,
    "invalidation during a request must make exactly one trailing request"
  );
}

async function verifyTargetIsolation(): Promise<void> {
  const coordinator = new ResourceRefreshCoordinator();
  coordinator.setScope("wallet-a");
  let positionCount = 0;
  let proposalCount = 0;
  coordinator.register("earn.position", () => {
    positionCount += 1;
  });
  coordinator.register("smart-account.proposals", () => {
    proposalCount += 1;
  });

  await coordinator.invalidate(["smart-account.proposals"]);

  assert.equal(proposalCount, 1, "the requested resource must refresh");
  assert.equal(positionCount, 0, "an unrelated resource must remain untouched");
}

async function verifyScopeIsolation(): Promise<void> {
  const coordinator = new ResourceRefreshCoordinator();
  coordinator.setScope("wallet-a");
  const oldStarted = deferred();
  const releaseOld = deferred();
  let oldRefreshCount = 0;
  let newRefreshCount = 0;
  let oldSignalWasAborted = false;
  const committedScopes: Array<string | null> = [];
  coordinator.register("earn.state", async (context) => {
    oldRefreshCount += 1;
    oldStarted.resolve();
    await releaseOld.promise;
    oldSignalWasAborted = context.signal.aborted;
    if (context.isCurrent()) {
      committedScopes.push(context.scope);
    }
  });

  const oldRun = coordinator.invalidate(["earn.state"]);
  await oldStarted.promise;
  void coordinator.invalidate(["earn.state"]);
  coordinator.setScope("wallet-b");
  coordinator.register("earn.state", (context) => {
    newRefreshCount += 1;
    if (context.isCurrent()) {
      committedScopes.push(context.scope);
    }
  });
  const newRun = coordinator.invalidate(["earn.state"]);
  releaseOld.resolve();
  await Promise.all([oldRun, newRun]);

  assert.equal(oldRefreshCount, 1, "old-scope dirty work must not rerun");
  assert.equal(newRefreshCount, 1, "the new scope must refresh independently");
  assert.equal(oldSignalWasAborted, true, "the old scope signal must abort");
  assert.deepEqual(
    committedScopes,
    ["wallet-b"],
    "old-scope work must not commit after identity changes"
  );
}

async function verifyDelegatedInFlightCoalescing(): Promise<void> {
  const coordinator = new ResourceRefreshCoordinator();
  coordinator.setScope("wallet-a");
  const firstStarted = deferred();
  const releaseFirst = deferred();
  let innerDirty = false;
  let innerInFlight: Promise<void> | null = null;
  let refreshCount = 0;

  const refresh = () => {
    if (innerInFlight) {
      innerDirty = true;
      return innerInFlight;
    }

    const run = async () => {
      do {
        innerDirty = false;
        refreshCount += 1;
        if (refreshCount === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
      } while (innerDirty);
    };
    const promise = run().finally(() => {
      if (innerInFlight === promise) {
        innerInFlight = null;
      }
    });
    innerInFlight = promise;
    return promise;
  };

  coordinator.register("earn.position", refresh, {
    handlesInFlightInvalidation: true,
  });

  const first = coordinator.invalidate(["earn.position"]);
  await firstStarted.promise;
  const dirtyOnce = coordinator.invalidate(["earn.position"]);
  const dirtyTwice = coordinator.invalidate(["earn.position"]);
  releaseFirst.resolve();
  await Promise.all([first, dirtyOnce, dirtyTwice]);

  assert.equal(
    refreshCount,
    2,
    "a self-coalescing resource must not gain a second coordinator queue"
  );
}

function verifySmartAccountGroupOrdering(): void {
  const order = new SmartAccountRefreshOrder();
  const oldPolicy = order.begin("policies");
  const oldVault = order.begin("vaults");
  const targetedPolicy = order.begin("policies");

  assert.equal(
    order.isCurrent(oldPolicy),
    false,
    "a newer targeted policy read must supersede an older full-read token"
  );
  assert.equal(
    order.isCurrent(oldVault),
    true,
    "ordering for an unrelated group must remain independent"
  );
  assert.equal(order.isCurrent(targetedPolicy), true);

  const recoveryPolicy = order.begin("policies");
  assert.equal(
    order.isCurrent(targetedPolicy),
    false,
    "a newer full recovery must supersede an older targeted read"
  );
  assert.equal(order.isCurrent(recoveryPolicy), true);
}

function verifySmartAccountScopedErrorRecovery(): void {
  const rateLimit = "429 Too Many Requests";
  const failing = {
    base: null,
    bestApyReserves: null,
    policies: rateLimit,
    proposals: null,
    vaults: null,
  };
  assert.equal(resolveSmartAccountRefreshError(failing), rateLimit);
  assert.equal(
    resolveSmartAccountRefreshError({ ...failing, policies: null }),
    null,
    "a recovered targeted group must clear the authoritative error"
  );
  assert.equal(
    resolveSmartAccountRefreshError({
      ...failing,
      policies: null,
      vaults: "vault refresh failed",
    }),
    "vault refresh failed",
    "recovery must not hide a different failing group"
  );
}

async function verifyPolicyFollowUpCoalescing(): Promise<void> {
  const scheduled = new Map<number, () => void>();
  let nextId = 0;
  const followUp = new SmartAccountPolicyFollowUp((callback, delayMs) => {
    assert.equal(delayMs, SMART_ACCOUNT_POLICY_FOLLOW_UP_DELAY_MS);
    nextId += 1;
    const id = nextId;
    scheduled.set(id, () => {
      scheduled.delete(id);
      callback();
    });
    return () => scheduled.delete(id);
  });
  let refreshCount = 0;

  followUp.schedule(() => {
    refreshCount += 1;
  });
  followUp.schedule(() => {
    refreshCount += 1;
  });
  assert.equal(scheduled.size, 1, "policy follow-ups must coalesce");
  scheduled.values().next().value?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(refreshCount, 1, "only the latest policy follow-up may run");

  followUp.schedule(() => {
    refreshCount += 1;
  });
  followUp.reset();
  assert.equal(
    scheduled.size,
    0,
    "an identity reset must cancel the pending policy follow-up"
  );
  assert.equal(refreshCount, 1);

  followUp.schedule(() => {
    refreshCount += 1;
  });
  scheduled.values().next().value?.();
  followUp.reset();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    refreshCount,
    1,
    "an identity reset must cancel a queued follow-up before its read starts"
  );
}

function verifyServerReadOrdering(): void {
  const order = new SmartAccountReadModelLoadOrder();
  const cachedRead = order.begin("wallet-a:policies");
  const forcedRead = order.begin("wallet-a:policies");
  const otherWalletRead = order.begin("wallet-b:policies");

  assert.equal(
    order.isCurrent(cachedRead),
    false,
    "an older policy result must not publish over a forced read"
  );
  assert.equal(order.isCurrent(forcedRead), true);
  assert.equal(
    order.isCurrent(otherWalletRead),
    true,
    "server read ordering must remain isolated by cache key"
  );
}

function verifyServerCacheBypass(): void {
  const cachedResult = { expiresAt: 12_000, result: "stale-policy" };
  const existingLoad = Promise.resolve("old-in-flight-policy");
  assert.equal(
    resolveSmartAccountReadModelReuse({
      cachedResult,
      now: 10_000,
    }).kind,
    "completed",
    "ordinary reads may reuse a fresh completed policy result"
  );
  assert.equal(
    resolveSmartAccountReadModelReuse({
      cachedResult,
      existingLoad,
      now: 10_000,
    }).kind,
    "in-flight",
    "ordinary readers must join the current forced read instead of stale cache"
  );
  assert.equal(
    resolveSmartAccountReadModelReuse({
      bypassCache: true,
      cachedResult,
      existingLoad,
      now: 10_000,
    }).kind,
    "load",
    "a confirmed mutation read must bypass completed and in-flight reuse"
  );
}

async function verifySmartAccountSingleflight(): Promise<void> {
  const singleflight = new SmartAccountRefreshSingleflight();
  const firstStarted = deferred();
  const releaseFirst = deferred();
  let refreshCount = 0;
  const loader = async () => {
    refreshCount += 1;
    if (refreshCount === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
  };

  const first = singleflight.run("wallet-a:policies", loader);
  await firstStarted.promise;
  const dirtyOnce = singleflight.run("wallet-a:policies", loader);
  const dirtyTwice = singleflight.run("wallet-a:policies", loader);
  releaseFirst.resolve();
  await Promise.all([first, dirtyOnce, dirtyTwice]);

  assert.equal(
    refreshCount,
    2,
    "an in-flight smart-account refresh must produce one dirty trailing read"
  );
}

async function verifySmartAccountScopeGeneration(): Promise<void> {
  const scopes = new SmartAccountScopeGeneration("wallet-a");
  const originalA = scopes.update("wallet-a");
  const oldRead = deferred();
  const commits: string[] = [];
  const staleWork = oldRead.promise.then(() => {
    if (scopes.isCurrent(originalA)) commits.push("old-a");
  });

  scopes.update("wallet-b");
  const currentA = scopes.update("wallet-a");
  if (scopes.isCurrent(currentA)) commits.push("current-a");
  oldRead.resolve();
  await staleWork;

  assert.deepEqual(
    commits,
    ["current-a"],
    "A-B-A identity changes must reject work from the first A generation"
  );
}

await verifyBurstCoalescing();
await verifyTrailingRefresh();
await verifyTargetIsolation();
await verifyScopeIsolation();
await verifyDelegatedInFlightCoalescing();
verifySmartAccountGroupOrdering();
verifySmartAccountScopedErrorRecovery();
await verifyPolicyFollowUpCoalescing();
verifyServerReadOrdering();
verifyServerCacheBypass();
await verifySmartAccountSingleflight();
await verifySmartAccountScopeGeneration();

console.info("realtime-sync verifier: PASS");
