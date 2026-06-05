import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { clearSmartAccountReadModelCachesForTest, loadSmartAccountReadModel } =
  await import("./read-model");

afterEach(() => {
  clearSmartAccountReadModelCachesForTest();
  mock.restore();
});

describe("loadSmartAccountReadModel", () => {
  test("returns a completed result from the short TTL cache", async () => {
    const load = mock(async () => ({ value: 1 }));

    await expect(
      loadSmartAccountReadModel({ cacheKey: "devnet:settings:base", load })
    ).resolves.toEqual({ value: 1 });
    await expect(
      loadSmartAccountReadModel({ cacheKey: "devnet:settings:base", load })
    ).resolves.toEqual({ value: 1 });

    expect(load).toHaveBeenCalledTimes(1);
  });

  test("bypasses the completed result cache when requested", async () => {
    let value = 0;
    const load = mock(async () => {
      value += 1;
      return { value };
    });

    await expect(
      loadSmartAccountReadModel({ cacheKey: "devnet:settings:base", load })
    ).resolves.toEqual({ value: 1 });
    await expect(
      loadSmartAccountReadModel({
        bypassCache: true,
        cacheKey: "devnet:settings:base",
        load,
      })
    ).resolves.toEqual({ value: 2 });

    expect(load).toHaveBeenCalledTimes(2);
  });

  test("does not cache failed loads", async () => {
    let calls = 0;
    const load = mock(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("temporary failure");
      }
      return { value: 2 };
    });

    await expect(
      loadSmartAccountReadModel({ cacheKey: "devnet:settings:base", load })
    ).rejects.toThrow("temporary failure");
    await expect(
      loadSmartAccountReadModel({ cacheKey: "devnet:settings:base", load })
    ).resolves.toEqual({ value: 2 });

    expect(load).toHaveBeenCalledTimes(2);
  });

  test("keeps RPC rate-limit cooldown behavior", async () => {
    const load = mock(async () => {
      throw new Error("429 Too Many Requests");
    });

    await expect(
      loadSmartAccountReadModel({ cacheKey: "devnet:settings:base", load })
    ).rejects.toMatchObject({
      name: "SmartAccountOverviewRateLimitError",
      retryAfterSeconds: expect.any(Number),
    });
    await expect(
      loadSmartAccountReadModel({ cacheKey: "devnet:settings:base", load })
    ).rejects.toMatchObject({
      name: "SmartAccountOverviewRateLimitError",
      retryAfterSeconds: expect.any(Number),
    });

    expect(load).toHaveBeenCalledTimes(1);
  });
});
