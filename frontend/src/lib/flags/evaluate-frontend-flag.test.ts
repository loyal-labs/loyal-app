import { describe, expect, it } from "bun:test";

import { evaluateFrontendFlag } from "./evaluate-frontend-flag";

describe("evaluateFrontendFlag", () => {
  it("returns false for unknown data", () => {
    expect(
      evaluateFrontendFlag(undefined, {
        appEnvironment: "production",
        isTeam: false,
      })
    ).toBe(false);
  });

  it("evaluates team-only frontend flags", () => {
    expect(
      evaluateFrontendFlag(
        {
          key: "wallet_new_send_flow",
          enabled: true,
          audience: "team",
          targetEnvironments: ["preview", "production"],
        },
        {
          appEnvironment: "preview",
          isTeam: true,
        }
      )
    ).toBe(true);
  });
});
