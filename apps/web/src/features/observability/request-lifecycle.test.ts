import { expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));
const pending: (() => Promise<void>)[] = [];
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  after: (callback: () => Promise<void>) => pending.push(callback),
}));

test("request correlation preserves responses and errors even when the collector fails", async () => {
  const names = [
    "OBSERVABILITY_OTLP_ENDPOINT",
    "OBSERVABILITY_INGESTION_API_KEY",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  process.env.OBSERVABILITY_OTLP_ENDPOINT = "https://collector.example.test";
  process.env.OBSERVABILITY_INGESTION_API_KEY = "fixture";
  const payloads: string[] = [];
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_url: unknown, init?: RequestInit) => {
        payloads.push(String(init?.body));
        throw new Error("controlled collector outage");
      },
      { preconnect: globalThis.fetch.preconnect }
    )
  );
  try {
    const { withRequestLifecycle } = await import("./lifecycle.server");
    const request = new Request("https://example.test/api/confirm", {
      headers: {
        "x-loyal-flow-id": "123e4567-e89b-42d3-a456-426614174000",
        "x-loyal-journey-id": "123e4567-e89b-42d3-a456-426614174001",
        "x-loyal-attempt-number": "2",
        "x-loyal-flow-variant": "top_up",
        traceparent: "00-12345678901234567890123456789012-1234567890123456-01",
      },
    });
    const response = Response.json(
      {
        error: {
          code: "unconfirmed_signature",
          message: "private fixture payload",
        },
      },
      { status: 409 }
    );
    const args = {
      request,
      flowName: "earn.deposit" as const,
      flowVariant: "initial" as const,
      stage: "backend_confirm" as const,
    };
    expect(
      await withRequestLifecycle({ ...args, run: async () => response })
    ).toBe(response);
    expect((await response.json()).error.code).toBe("unconfirmed_signature");
    const original = new Error("private fixture exception");
    await expect(
      withRequestLifecycle({
        ...args,
        run: async () => {
          throw original;
        },
      })
    ).rejects.toBe(original);
    const success = Response.json({ position: "private fixture position" });
    expect(
      await withRequestLifecycle({
        ...args,
        success: { chainState: "confirmed", persistenceState: "recorded" },
        run: async () => success,
      })
    ).toBe(success);
    for (const callback of pending.splice(0)) await callback();
    const exported = payloads.join("\n");
    expect(exported).toContain("12345678901234567890123456789012");
    expect(exported).toContain("123e4567-e89b-42d3-a456-426614174001");
    expect(exported).toContain("unconfirmed_signature");
    expect(exported).toContain("recorded");
    expect(exported).toContain("top_up");
    expect(exported).not.toContain("private fixture");
  } finally {
    pending.length = 0;
    fetchMock.mockRestore();
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
