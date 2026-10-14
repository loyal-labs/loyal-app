import { expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));

test("heartbeat rejects unauthorized callers before export and exposes delivery failure", async () => {
  const names = [
    "CRON_SECRET",
    "OBSERVABILITY_OTLP_ENDPOINT",
    "OBSERVABILITY_INGESTION_API_KEY",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  process.env.CRON_SECRET = "fixture-cron-secret";
  process.env.OBSERVABILITY_OTLP_ENDPOINT = "https://collector.example.test";
  process.env.OBSERVABILITY_INGESTION_API_KEY = "fixture-ingestion-key";
  let requests = 0;
  let collectorStatus = 503;
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        requests += 1;
        return new Response(null, { status: collectorStatus });
      },
      { preconnect: globalThis.fetch.preconnect }
    )
  );
  try {
    const { GET } = await import(
      "../../app/api/cron/telemetry-heartbeat/route"
    );
    const request = (authorized: boolean) =>
      new Request("https://example.test/api/cron/telemetry-heartbeat", {
        headers: authorized
          ? { authorization: "Bearer fixture-cron-secret" }
          : {},
      });
    expect((await GET(request(false))).status).toBe(401);
    expect(requests).toBe(0);
    expect((await GET(request(true))).status).toBe(503);
    collectorStatus = 200;
    expect((await GET(request(true))).status).toBe(200);
    expect(requests).toBe(2);
  } finally {
    fetchMock.mockRestore();
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
