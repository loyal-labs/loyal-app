import { describe, expect, test } from "bun:test";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  assertEarnPolicySupportsTokenProgram,
  EARN_POLICY_UPDATE_REQUIRED_CODE,
  isEarnPolicyUpdateRequiredError,
} from "./client";

describe("Earn policy token-program compatibility", () => {
  test("legacy policies remain usable for classic SPL stablecoins", () => {
    expect(() =>
      assertEarnPolicySupportsTokenProgram({
        generation: "legacy_token_program",
        tokenProgramId: TOKEN_PROGRAM_ID,
      })
    ).not.toThrow();
  });

  test("legacy policies block Token-2022 deposits with the typed update code", () => {
    try {
      assertEarnPolicySupportsTokenProgram({
        generation: "legacy_token_program",
        tokenProgramId: TOKEN_2022_PROGRAM_ID,
      });
      throw new Error("expected policy capability failure");
    } catch (error) {
      expect(isEarnPolicyUpdateRequiredError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(
        EARN_POLICY_UPDATE_REQUIRED_CODE
      );
    }
  });

  test("new compatible policies accept both token programs", () => {
    for (const tokenProgramId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      expect(() =>
        assertEarnPolicySupportsTokenProgram({
          generation: "compatible",
          tokenProgramId,
        })
      ).not.toThrow();
    }
  });
});
