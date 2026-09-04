import { describe, expect, test } from "bun:test";

import { fetchEarnPrepare } from "./earn-prepare-request.client";

// Regression for ASK-2096: `fetchEarnPrepare` used to invoke the transport as
// `args.fetchImpl(...)`, calling the native fetch with `this === args`.
// Browsers reject that with "Failed to execute 'fetch' on 'Window': Illegal
// invocation", which broke every live web Earn deposit/withdrawal prepare.
// TypeScript cannot catch the receiver, so this guards the invocation shape.
describe("fetchEarnPrepare receiver binding", () => {
  test("invokes the transport without a foreign `this` receiver", async () => {
    const seenReceivers: unknown[] = [];
    function receiverSensitiveFetch(this: unknown): Promise<Response> {
      seenReceivers.push(this);
      if (this !== undefined && this !== globalThis) {
        // Mirrors the browser's Illegal invocation TypeError.
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation"
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }

    const response = await fetchEarnPrepare({
      body: "{}",
      fetchImpl: receiverSensitiveFetch as unknown as typeof fetch,
      url: "https://example.invalid/prepare",
    });

    expect(response.status).toBe(200);
    expect(seenReceivers).toHaveLength(1);
  });
});
