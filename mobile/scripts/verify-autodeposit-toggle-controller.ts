import { readFile } from "node:fs/promises";

import { createAutodepositToggleController } from "../src/lib/solana/earn/autodeposit-toggle-controller";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${message}: expected ${String(expected)}, received ${String(actual)}`
    );
  }
}

function sequence<T>(actual: T[], expected: T[], message: string): void {
  equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(
  predicate: () => boolean,
  message: string
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function verifyPreflightDebounce(): Promise<void> {
  const submitted: boolean[] = [];
  const optimistic: boolean[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  let refreshes = 0;

  const controller = createAutodepositToggleController({
    debounceMs: 10,
    onOptimisticActive: (active) => optimistic.push(active),
    onReconciledActive: () => undefined,
    refresh: async () => {
      refreshes += 1;
      return false;
    },
    submit: async (active) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      submitted.push(active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      concurrent -= 1;
    },
  });

  const first = controller.request(false);
  const second = controller.request(true);
  const third = controller.request(false);

  equal(first, second, "debounced requests must share one completion promise");
  equal(second, third, "all coalesced requests must share one promise");
  sequence(
    optimistic,
    [false, true, false],
    "every press must update optimistic state immediately"
  );
  equal(submitted.length, 0, "debounce must delay the first submission");

  await third;

  sequence(submitted, [false], "debounce must submit only the latest value");
  equal(maxConcurrent, 1, "debounced submissions must be serialized");
  equal(refreshes, 1, "a drained queue must refresh exactly once");
}

async function verifyInFlightCoalescing(): Promise<void> {
  const firstSubmit = deferred();
  const finalSubmit = deferred();
  const submitted: boolean[] = [];
  const optimistic: boolean[] = [];
  const events: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  let submitCount = 0;
  let cycleSettled = false;

  const controller = createAutodepositToggleController({
    debounceMs: 0,
    onOptimisticActive: (active) => optimistic.push(active),
    onReconciledActive: (active) => events.push(`reconcile:${active}`),
    refresh: async () => {
      events.push("refresh");
      return true;
    },
    submit: async (active) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      submitted.push(active);
      submitCount += 1;
      events.push(`submit:${active}`);
      await (submitCount === 1 ? firstSubmit.promise : finalSubmit.promise);
      concurrent -= 1;
      events.push(`settled:${active}`);
    },
  });

  const cycle = controller.request(false);
  void cycle.finally(() => {
    cycleSettled = true;
    events.push("cycle:settled");
  });
  await waitUntil(
    () => submitted.length === 1,
    "first toggle submission did not start"
  );

  const followUpA = controller.request(true);
  const followUpB = controller.request(false);
  const followUpC = controller.request(true);
  equal(cycle, followUpA, "in-flight presses must join the active cycle");
  equal(followUpA, followUpB, "intermediate press must join the active cycle");
  equal(followUpB, followUpC, "final press must join the active cycle");
  sequence(
    optimistic,
    [false, true, false, true],
    "in-flight presses must remain optimistic and interactive"
  );
  equal(submitted.length, 1, "no concurrent follow-up may start");

  firstSubmit.resolve();
  await waitUntil(
    () => submitted.length === 2,
    "latest queued toggle submission did not start"
  );

  sequence(
    submitted,
    [false, true],
    "intermediate in-flight values must be skipped"
  );
  equal(maxConcurrent, 1, "only one HTTP submission may be in flight");
  equal(cycleSettled, false, "cycle settled before the final request");
  assert(
    !events.includes("refresh"),
    "authoritative refresh ran before the final request settled"
  );

  finalSubmit.resolve();
  await cycle;

  equal(maxConcurrent, 1, "follow-up submission overlapped the first");
  const refreshIndex = events.indexOf("refresh");
  const finalSettledIndex = events.indexOf("settled:true");
  const reconcileIndex = events.indexOf("reconcile:true");
  assert(
    refreshIndex > finalSettledIndex,
    "refresh must run after the final submission settles"
  );
  assert(
    reconcileIndex > refreshIndex,
    "reconciliation must run after authoritative refresh"
  );
}

async function verifyFinalFailureReconciliation(): Promise<void> {
  const finalError = new Error("request_failed");
  const events: string[] = [];

  const controller = createAutodepositToggleController({
    debounceMs: 0,
    onOptimisticActive: (active) => events.push(`optimistic:${active}`),
    onReconciledActive: (active) => events.push(`reconcile:${active}`),
    refresh: async () => {
      events.push("refresh");
      return true;
    },
    submit: async () => {
      events.push("submit");
      throw finalError;
    },
  });

  let rejected: unknown;
  try {
    await controller.request(false);
  } catch (error) {
    rejected = error;
    events.push("rejected");
  }

  equal(rejected, finalError, "the final submission error must be preserved");
  sequence(
    events,
    ["optimistic:false", "submit", "refresh", "reconcile:true", "rejected"],
    "failure must refresh and reconcile before rejecting"
  );
}

async function verifyIntegrationWiring(): Promise<void> {
  const autodepositSource = await readFile(
    new URL("../src/lib/solana/earn/autodeposit.ts", import.meta.url),
    "utf8"
  );
  const apiSource = await readFile(
    new URL("../src/lib/solana/earn/earn-api.ts", import.meta.url),
    "utf8"
  );
  const screenSource = await readFile(
    new URL("../app/(tabs)/index.tsx", import.meta.url),
    "utf8"
  );

  assert(
    /toggleEarnAutodeposit\(\{[\s\S]*?flowId:\s*flow\.flowId,[\s\S]*?\}\)/.test(
      autodepositSource
    ),
    "toggle lifecycle flowId is not forwarded to the API client"
  );
  assert(
    /export async function toggleEarnAutodeposit\([\s\S]*?flowId\?: string;[\s\S]*?earnHeaders\(flowId\)/.test(
      apiSource
    ),
    "toggle API does not send flowId through earnHeaders"
  );
  assert(
    !/accessibilityLabel="Toggle Autodeposit"[\s\S]{0,300}\bdisabled=/.test(
      screenSource
    ),
    "Autodeposit switch must remain interactive while work is pending"
  );
}

await verifyPreflightDebounce();
await verifyInFlightCoalescing();
await verifyFinalFailureReconciliation();
await verifyIntegrationWiring();

console.log("ASK-1917 verifier: PASS");
