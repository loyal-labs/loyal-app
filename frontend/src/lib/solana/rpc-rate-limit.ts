const FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS = 90;

type RpcFetch = typeof fetch;

type RpcQueueState = {
  nextRunAt: number;
  tail: Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __loyalFrontendSolanaRpcQueue: RpcQueueState | undefined;
}

function getQueue() {
  globalThis.__loyalFrontendSolanaRpcQueue ??= {
    nextRunAt: 0,
    tail: Promise.resolve(),
  };

  return globalThis.__loyalFrontendSolanaRpcQueue;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getFrontendSolanaRpcFetch(fetchImpl?: RpcFetch): RpcFetch {
  const runFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  return (async (input, init) => {
    const queue = getQueue();
    const previous = queue.tail;
    let release!: () => void;
    queue.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous.catch(() => undefined);

    try {
      const delay = Math.max(0, queue.nextRunAt - Date.now());
      if (delay > 0) {
        await wait(delay);
      }

      queue.nextRunAt = Date.now() + FRONTEND_SOLANA_RPC_MIN_INTERVAL_MS;
      return await runFetch(input, init);
    } finally {
      release();
    }
  }) as RpcFetch;
}
