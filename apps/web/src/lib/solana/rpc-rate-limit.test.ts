import { afterEach, expect, mock, test } from "bun:test";

import {
  getFrontendSolanaRpcFetch,
  SolanaRpcRateLimitError,
} from "./rpc-rate-limit";

afterEach(() => {
  globalThis.__loyalFrontendSolanaRpcEndpoints = undefined;
  globalThis.__loyalFrontendSolanaRpcInflight = undefined;
  globalThis.__loyalFrontendSolanaRpcRecent = undefined;
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = undefined;
});

const rpcRequest = (method: string) =>
  [
    "https://example.invalid/rpc",
    {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params: [] }),
      method: "POST",
    },
  ] as const;

test("dispatches a burst concurrently and defers overflow to the next window", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "3";
  globalThis.__loyalFrontendSolanaRpcEndpoints = undefined;

  const startedAt = Date.now();
  const dispatchOffsets: number[] = [];
  const rpcFetch = getFrontendSolanaRpcFetch((() => {
    dispatchOffsets.push(Date.now() - startedAt);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch);

  await Promise.all(
    Array.from({ length: 5 }, () => rpcFetch("https://example.invalid/rpc"))
  );

  expect(dispatchOffsets).toHaveLength(5);
  const immediate = dispatchOffsets.filter((offset) => offset < 500);
  const deferred = dispatchOffsets.filter((offset) => offset >= 900);
  expect(immediate).toHaveLength(3);
  expect(deferred).toHaveLength(2);
});

test("prioritizes transaction RPCs ahead of queued background reads", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "2";
  const methods: string[] = [];
  const fetchImpl = mock(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : null;
      methods.push(body ? JSON.parse(body).method : "filler");
      return new Response('{"jsonrpc":"2.0","id":1,"result":null}', {
        status: 200,
      });
    }
  );
  const rpcFetch = getFrontendSolanaRpcFetch(fetchImpl as never);

  await Promise.all([
    rpcFetch("https://example.invalid/rpc"),
    rpcFetch("https://example.invalid/rpc"),
  ]);
  await Promise.all([
    rpcFetch(...rpcRequest("getSignaturesForAddress")),
    rpcFetch(...rpcRequest("getLatestBlockhash")),
  ]);

  expect(methods).toEqual([
    "filler",
    "filler",
    "getLatestBlockhash",
    "getSignaturesForAddress",
  ]);
});

test("retries a sustained burst of browser-obscured read failures", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "100";
  const responses: Array<Response | TypeError> = [
    new Response("rate limited", { status: 429 }),
    new TypeError("Failed to fetch"),
    new Response("temporarily unavailable", { status: 503 }),
    new TypeError("Failed to fetch"),
    new Response('{"jsonrpc":"2.0","id":1,"result":null}', {
      status: 200,
    }),
  ];
  const fetchImpl = mock(() => {
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("mock RPC response queue is empty");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  const rpcFetch = getFrontendSolanaRpcFetch(fetchImpl as never);

  const response = await rpcFetch(...rpcRequest("getAccountInfo"));

  expect(response.status).toBe(200);
  expect(fetchImpl).toHaveBeenCalledTimes(5);
});

test("retries activity reads without caching their result", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "100";
  const responses: Array<Response | TypeError> = [
    new TypeError("Failed to fetch"),
    new Response('{"jsonrpc":"2.0","id":1,"result":[]}', { status: 200 }),
    new Response('{"jsonrpc":"2.0","id":2,"result":[]}', { status: 200 }),
  ];
  const fetchImpl = mock(() => {
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("mock RPC response queue is empty");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  const rpcFetch = getFrontendSolanaRpcFetch(fetchImpl as never);

  const firstResponse = await rpcFetch(
    ...rpcRequest("getSignaturesForAddress")
  );
  const secondResponse = await rpcFetch(
    ...rpcRequest("getSignaturesForAddress")
  );

  expect(firstResponse.status).toBe(200);
  expect(secondResponse.status).toBe(200);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

test("retries confirmation status reads without caching their result", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "100";
  const responses: Array<Response | TypeError> = [
    new TypeError("Failed to fetch"),
    new Response(
      '{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":[null]}}',
      { status: 200 }
    ),
    new Response(
      '{"jsonrpc":"2.0","id":2,"result":{"context":{"slot":2},"value":[null]}}',
      { status: 200 }
    ),
  ];
  const fetchImpl = mock(() => {
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("mock RPC response queue is empty");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  const rpcFetch = getFrontendSolanaRpcFetch(fetchImpl as never);

  const firstResponse = await rpcFetch(...rpcRequest("getSignatureStatuses"));
  const secondResponse = await rpcFetch(...rpcRequest("getSignatureStatuses"));

  expect(firstResponse.status).toBe(200);
  expect(secondResponse.status).toBe(200);
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

test("honors a positive Retry-After before probing again", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "100";
  const startedAt = Date.now();
  let callCount = 0;
  const fetchImpl = mock(async () => {
    callCount += 1;
    return callCount === 1
      ? new Response("rate limited", {
          headers: { "retry-after": "0.4" },
          status: 429,
        })
      : new Response('{"jsonrpc":"2.0","id":1,"result":null}', {
          status: 200,
        });
  });
  const rpcFetch = getFrontendSolanaRpcFetch(fetchImpl as never);

  const response = await rpcFetch(...rpcRequest("getAccountInfo"));

  expect(response.status).toBe(200);
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(380);
});

test("allows one recovery probe before releasing concurrent read retries", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "100";
  let callCount = 0;
  let recoveryCallsInFlight = 0;
  let maxRecoveryCallsInFlight = 0;
  const fetchImpl = mock(async () => {
    callCount += 1;
    if (callCount <= 2) {
      return new Response("rate limited", { status: 429 });
    }

    recoveryCallsInFlight += 1;
    maxRecoveryCallsInFlight = Math.max(
      maxRecoveryCallsInFlight,
      recoveryCallsInFlight
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    recoveryCallsInFlight -= 1;
    return new Response('{"jsonrpc":"2.0","id":1,"result":null}', {
      status: 200,
    });
  });
  const rpcFetch = getFrontendSolanaRpcFetch(fetchImpl as never);
  const firstRequest = rpcRequest("getAccountInfo");
  const secondRequest = [
    firstRequest[0],
    {
      ...firstRequest[1],
      body: JSON.stringify({
        id: 2,
        jsonrpc: "2.0",
        method: "getAccountInfo",
        params: ["different-account"],
      }),
    },
  ] as const;

  const responses = await Promise.all([
    rpcFetch(...firstRequest),
    rpcFetch(...secondRequest),
  ]);

  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect(fetchImpl).toHaveBeenCalledTimes(4);
  expect(maxRecoveryCallsInFlight).toBe(1);
});

test("returns a structured error after exhausting throttled read retries", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "100";
  const fetchImpl = mock(
    async () => new Response("rate limited", { status: 429 })
  );
  const rpcFetch = getFrontendSolanaRpcFetch(fetchImpl as never);

  await expect(
    rpcFetch(...rpcRequest("getAccountInfo"))
  ).rejects.toBeInstanceOf(SolanaRpcRateLimitError);
});

test("never retries transaction submission", async () => {
  process.env.FRONTEND_SOLANA_RPC_MAX_REQUESTS_PER_SECOND = "100";
  const fetchImpl = mock(
    async () => new Response("rate limited", { status: 429 })
  );
  const rpcFetch = getFrontendSolanaRpcFetch(fetchImpl as never);

  const response = await rpcFetch(...rpcRequest("sendTransaction"));

  expect(response.status).toBe(429);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
