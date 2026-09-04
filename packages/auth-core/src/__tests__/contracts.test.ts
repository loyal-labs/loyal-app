import { describe, expect, test } from "bun:test";

import {
  getAuthSessionResponseSchema,
  walletChallengeRequestSchema,
  walletChallengeResponseSchema,
  walletCompleteResponseSchema,
} from "../contracts";

describe("auth contracts", () => {
  test("accepts wallet challenge requests", () => {
    const parsed = walletChallengeRequestSchema.safeParse({
      walletAddress: "9xQeWvG816bUx9EPfEzr1f8H2L8dS2jU5Q2JdJtYQY4M",
    });

    expect(parsed.success).toBe(true);
  });

  test("accepts wallet challenge responses", () => {
    const parsed = walletChallengeResponseSchema.safeParse({
      challengeToken: "challenge-token",
      message: "Sign in to askloyal",
      expiresAt: "2026-03-11T12:00:00.000Z",
    });

    expect(parsed.success).toBe(true);
  });

  test("accepts principal-based wallet auth sessions", () => {
    const parsed = getAuthSessionResponseSchema.safeParse({
      user: {
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        walletAddress: "wallet-1",
        provider: "solana",
      },
    });

    expect(parsed.success).toBe(true);
  });

  test("accepts wallet completion responses", () => {
    const parsed = walletCompleteResponseSchema.safeParse({
      user: {
        authMethod: "wallet",
        subjectAddress: "wallet-1",
        displayAddress: "wallet-1",
        walletAddress: "wallet-1",
      },
    });

    expect(parsed.success).toBe(true);
  });
});
