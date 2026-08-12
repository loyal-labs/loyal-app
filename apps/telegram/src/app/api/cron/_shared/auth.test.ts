import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const TEST_ENV_KEYS = ["CRON_SECRET"] as const;

function clearTestEnv(): void {
  for (const key of TEST_ENV_KEYS) {
    delete process.env[key];
  }
}

describe("cron auth helper", () => {
  beforeEach(() => {
    clearTestEnv();
  });

  afterEach(() => {
    clearTestEnv();
  });

  test("returns 500 when CRON_SECRET is missing", async () => {
    const { validateCronAuthHeader } = await import("./auth");
    const request = new Request("http://localhost/api/cron/example", {
      method: "POST",
      headers: { authorization: "Bearer anything" },
    });

    const response = validateCronAuthHeader(request);
    expect(response?.status).toBe(500);
  });

  test("returns 401 for missing or invalid auth", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const { validateCronAuthHeader } = await import("./auth");

    const missingHeaderRequest = new Request(
      "http://localhost/api/cron/example",
      {
        method: "POST",
      }
    );
    const missingHeaderResponse = validateCronAuthHeader(missingHeaderRequest);
    expect(missingHeaderResponse?.status).toBe(401);

    const invalidHeaderRequest = new Request(
      "http://localhost/api/cron/example",
      {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      }
    );
    const invalidHeaderResponse = validateCronAuthHeader(invalidHeaderRequest);
    expect(invalidHeaderResponse?.status).toBe(401);
  });

  test("returns null for valid bearer token", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const { validateCronAuthHeader } = await import("./auth");

    const request = new Request("http://localhost/api/cron/example", {
      method: "POST",
      headers: { authorization: "Bearer expected-secret" },
    });

    expect(validateCronAuthHeader(request)).toBeNull();
  });
});
