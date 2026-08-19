import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { autoswapCanaryDatabaseEndpointFingerprint } = await import(
  "./autoswap-verifier-runtime"
);

describe("Autoswap canary database pin", () => {
  test("binds the production host, port, and database name", () => {
    const production =
      "postgresql://ignored:ignored@ep-ancient-grass-aqb5aalu.c-8.us-east-1.aws.neon.tech/neondb";
    const fingerprint = autoswapCanaryDatabaseEndpointFingerprint(production);

    expect(fingerprint).toBe(
      "f5bf9367f769718e58899375cb0c5ada166190f87b7141402d2057c9cfd3fd66"
    );
    expect(
      autoswapCanaryDatabaseEndpointFingerprint(`${production}-staging`)
    ).not.toBe(fingerprint);
    expect(
      autoswapCanaryDatabaseEndpointFingerprint(
        production.replace("/neondb", ":5433/neondb")
      )
    ).not.toBe(fingerprint);
  });
});
