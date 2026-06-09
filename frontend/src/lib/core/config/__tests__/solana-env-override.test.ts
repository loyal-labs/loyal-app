import { describe, expect, test } from "bun:test";

import {
  resolveLoyalWebSolanaEnv,
  resolveLoyalWebSolanaEnvFromEnv,
} from "../solana-env-override";

describe("Loyal web Solana env resolution", () => {
  test("defaults to mainnet without an explicit env", () => {
    expect(resolveLoyalWebSolanaEnv(undefined)).toBe("mainnet");
  });

  test("accepts devnet when explicitly configured", () => {
    expect(resolveLoyalWebSolanaEnv(" devnet ")).toBe("devnet");
  });

  test("falls back to mainnet for invalid env values", () => {
    expect(resolveLoyalWebSolanaEnv("local")).toBe("mainnet");
    expect(resolveLoyalWebSolanaEnv("staging")).toBe("mainnet");
  });

  test("resolves only from the local env source", () => {
    expect(
      resolveLoyalWebSolanaEnvFromEnv({
        NEXT_PUBLIC_SOLANA_ENV: "devnet",
      })
    ).toBe("devnet");
  });
});
