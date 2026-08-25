import type { SmartAccountNativeSolRequirement } from "@loyal-labs/smart-account-vaults";

import {
  assertNativeSolRequirement,
  InsufficientSolError,
} from "../insufficient-sol-error";

const requirement = (
  overrides: Partial<SmartAccountNativeSolRequirement> = {},
): SmartAccountNativeSolRequirement => ({
  balanceLamports: "11887572",
  canProceed: false,
  deficitLamports: "27645228",
  items: [],
  payer: "11111111111111111111111111111111",
  requiredLamports: "39532800",
  ...overrides,
});

describe("native SOL requirement", () => {
  it("blocks an underfunded Earn preparation with the exact top-up", () => {
    expect(() => assertNativeSolRequirement(requirement())).toThrow(
      new InsufficientSolError(
        "Add at least 0.027645228 SOL to your wallet before depositing. This Earn setup needs 0.0395328 SOL for account rent and network fees.",
      ),
    );
  });

  it("allows a funded Earn preparation", () => {
    expect(() =>
      assertNativeSolRequirement(
        requirement({ canProceed: true, deficitLamports: "0" }),
      ),
    ).not.toThrow();
  });
});
