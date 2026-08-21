import { describe, expect, test } from "bun:test";

import {
  deriveEarnCrossMintPolicyIndex,
  type EarnCrossMintPolicyProjectionRow,
} from "./earn-cross-mint-policy-index.shared";

const row = (
  sourceShard: "classic" | "token_2022",
  overrides: Partial<EarnCrossMintPolicyProjectionRow> = {}
): EarnCrossMintPolicyProjectionRow => ({
  active: true,
  dailySourceMintSpendingCap: BigInt(300_000_000),
  delegatedSigner: "signer",
  lastMutation: "create",
  lastSeenSignature: `signature-${sourceShard}`,
  lastSeenSlot: BigInt(100),
  maxSlippageBps: 50,
  policyAccount: `account-${sourceShard}`,
  policySeed: sourceShard === "classic" ? BigInt(7) : BigInt(8),
  sourceCommitment: "confirmed",
  sourceShard,
  startEligible: true,
  ...overrides,
});

describe("Earn cross-mint policy projection index", () => {
  test("returns the canonical pair from matching projected policies", () => {
    expect(
      deriveEarnCrossMintPolicyIndex([row("token_2022"), row("classic")])
    ).toEqual({
      policies: [
        expect.objectContaining({
          account: "account-classic",
          seed: "7",
          sourceShard: "classic",
        }),
        expect.objectContaining({
          account: "account-token_2022",
          seed: "8",
          sourceShard: "token_2022",
        }),
      ],
      state: "complete",
    });
  });

  test("fails closed for incomplete or contradictory projections", () => {
    const invalidInputs = [
      [row("classic")],
      [row("classic"), row("classic", { policyAccount: "other" })],
      [row("classic", { policySeed: null })],
      [row("classic", { sourceCommitment: "processed" })],
      [row("classic"), row("token_2022", { maxSlippageBps: 75 })],
    ];

    expect(
      deriveEarnCrossMintPolicyIndex(invalidInputs[0] ?? [])
    ).toMatchObject({ state: "partial" });
    for (const rows of invalidInputs.slice(1)) {
      expect(deriveEarnCrossMintPolicyIndex(rows)).toEqual({
        policies: [],
        state: "ambiguous",
      });
    }
  });
});
