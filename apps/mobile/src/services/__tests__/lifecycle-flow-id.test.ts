// Guards the join between the two telemetry streams (ASK-1949). A loading
// metric is started in the UI; the lifecycle flow it wraps is started deeper,
// inside the earn module. When each mints its own id the streams share a
// `loyal.flow.id` attribute name but not an id space, so a failed point on the
// metrics dashboard cannot be traced to the error that caused it. Nothing in
// the type system catches that — both ids are valid uuids — so the emitted
// envelope is asserted directly against the id the caller handed down.

import { startLifecycleFlow } from "../observability";

// Hoisted above the imports by babel-plugin-jest-hoist.
jest.mock("expo-updates", () => ({
  channel: "production",
  runtimeVersion: "1.0.0",
  updateId: undefined,
}));
jest.mock("@/config/env", () => ({
  env: { earnApiBaseUrl: "https://example.test" },
}));

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METRIC_FLOW_ID = "3f29ecc4-cbf6-4795-bf42-2fb4850e8cb8";

function captureEnvelopes(): { flowId: string }[] {
  const sent: { flowId: string }[] = [];
  global.fetch = jest.fn(async (_url: unknown, init: unknown) => {
    sent.push(JSON.parse((init as { body: string }).body) as { flowId: string });
    return { ok: true, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
  return sent;
}

describe("lifecycle flow id adoption", () => {
  beforeEach(() => jest.clearAllMocks());

  it("emits every stage under the flow id the caller handed down", () => {
    const sent = captureEnvelopes();
    const flow = startLifecycleFlow({
      flowId: METRIC_FLOW_ID,
      flowName: "earn.withdrawal",
      flowVariant: "full",
    });
    flow.start("prepare");
    flow.fail("prepare");

    expect(flow.flowId).toBe(METRIC_FLOW_ID);
    expect(sent).toHaveLength(2);
    expect(sent.every((envelope) => envelope.flowId === METRIC_FLOW_ID)).toBe(
      true,
    );
  });

  it("mints its own id when the caller supplies none", () => {
    const sent = captureEnvelopes();
    const flow = startLifecycleFlow({
      flowName: "earn.withdrawal",
      flowVariant: "full",
    });
    flow.start("prepare");

    expect(flow.flowId).toMatch(UUID_V4_PATTERN);
    expect(sent[0].flowId).toBe(flow.flowId);
  });

  // The ingest drops any envelope whose flowId isn't a canonical v4. Falling
  // back keeps a malformed id from costing the whole flow's events — losing the
  // join is survivable, losing the trace is not.
  it("falls back to a generated id when the supplied one is malformed", () => {
    const sent = captureEnvelopes();
    const flow = startLifecycleFlow({
      flowId: "not-a-uuid",
      flowName: "earn.withdrawal",
      flowVariant: "full",
    });
    flow.start("prepare");

    expect(flow.flowId).toMatch(UUID_V4_PATTERN);
    expect(sent[0].flowId).toMatch(UUID_V4_PATTERN);
  });
});
