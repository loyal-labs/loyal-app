import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/lib/flags/get-frontend-flags-manifest", () => ({
  getFrontendFlagsManifest: async () => ({
    version: "2026-04-10T12:00:00.000Z",
    generatedAt: "2026-04-10T12:00:00.000Z",
    flags: [],
  }),
}));

let GET: () => Promise<Response>;

describe("frontend flags manifest route", () => {
  beforeAll(async () => {
    ({ GET } = await import("./route"));
  });

  test("returns versioned JSON", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toHaveProperty("version");
    expect(payload).toHaveProperty("generatedAt");
    expect(payload).toHaveProperty("flags");
  });
});
