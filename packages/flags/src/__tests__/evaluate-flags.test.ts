import { describe, expect, it } from "bun:test";

import { evaluateFlag, evaluateFlags, getFlagValue } from "../index";
import type { FlagDefinition, FlagEvaluationContext } from "../types";

const baseFlag: FlagDefinition = {
  key: "wallet_new_send_flow",
  enabled: true,
  audience: "team",
  targetApps: ["website", "extension"],
  targetEnvironments: ["development", "preview"],
  updatedAt: "2026-04-10T12:00:00.000Z",
};

describe("evaluateFlag", () => {
  it("returns true when app, env, and audience all match", () => {
    const context: FlagEvaluationContext = {
      app: "website",
      environment: "preview",
      isTeam: true,
    };

    expect(evaluateFlag(baseFlag, context)).toBe(true);
  });

  it("returns false when audience does not match", () => {
    const context: FlagEvaluationContext = {
      app: "website",
      environment: "preview",
      isTeam: false,
    };

    expect(evaluateFlag(baseFlag, context)).toBe(false);
  });
});

describe("evaluateFlags", () => {
  it("builds a key/value map for all flags", () => {
    const context: FlagEvaluationContext = {
      app: "extension",
      environment: "development",
      isTeam: true,
    };

    expect(
      evaluateFlags(
        [
          baseFlag,
          {
            ...baseFlag,
            key: "public_only",
            audience: "public",
          },
        ],
        context,
      ),
    ).toEqual({
      wallet_new_send_flow: true,
      public_only: false,
    });
  });
});

describe("getFlagValue", () => {
  it("returns false for unknown keys", () => {
    expect(getFlagValue({}, "missing_flag")).toBe(false);
  });
});
