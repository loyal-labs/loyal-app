import { describe, expect, test } from "bun:test";
import type { SmartAccountPreparedEarnUsdcDeposit } from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import { buildEarnDepositConfirmRequestBody } from "./earn-confirm-contracts.shared";
import {
  getEarnDepositReviewStages,
  resolveEarnDepositConfirmPolicySignature,
} from "./earn-deposit-flow.shared";

const POLICY_ACCOUNT = new PublicKey("11111111111111111111111111111111");

function createPreparedDeposit(args: {
  finalize?: boolean;
  policyInitialization: "create" | "reuse";
  setup?: boolean;
}): SmartAccountPreparedEarnUsdcDeposit {
  return {
    persistence: {
      policyInitialization: args.policyInitialization,
    },
    policy: {
      account: POLICY_ACCOUNT,
      seed: BigInt(7),
    },
    policyFinalizePrepared: args.finalize ? ({} as never) : null,
    policySetupPrepared: args.setup ? ({} as never) : null,
  } as SmartAccountPreparedEarnUsdcDeposit;
}

describe("Earn deposit flow helpers", () => {
  test("resumed finalize retains its new proof without demanding the old route citation", () => {
    const preparedDeposit = createPreparedDeposit({
      policyInitialization: "reuse",
      finalize: true,
    });
    const resolution = resolveEarnDepositConfirmPolicySignature({
      preparedDeposit,
      resolveReusedPolicyOnServer: true,
      setupPolicySignature: "new-setup-signature",
      setupPolicyConfirmedSlot: "122",
    });
    expect("error" in resolution).toBe(false);
    if ("error" in resolution) throw new Error(resolution.error);
    const body = buildEarnDepositConfirmRequestBody({
      ...resolution,
      preparedDeposit,
      signature: "deposit-signature",
      confirmedSlot: "123",
      smartAccountAddress: POLICY_ACCOUNT.toBase58(),
    });
    // Reuse selects server citation recovery; the just-confirmed setup proof
    // must survive the same wire builder used by batch and sequential sends.
    expect(body.policyInitialization).toBe("reuse");
    expect(body.setupPolicySignature).toBe("new-setup-signature");
    expect(body.setupPolicyConfirmedSlot).toBe("122");
    expect(resolution.policySignature).toBeUndefined();
  });

  test("resumed finalize still rejects a missing or incomplete new setup proof", () => {
    for (const proof of [
      {},
      { setupPolicySignature: "new-setup-signature" },
      { setupPolicyConfirmedSlot: "122" },
      { setupPolicySignature: " ", setupPolicyConfirmedSlot: "122" },
    ]) {
      const resolution = resolveEarnDepositConfirmPolicySignature({
        preparedDeposit: createPreparedDeposit({
          policyInitialization: "reuse",
          finalize: true,
        }),
        resolveReusedPolicyOnServer: true,
        ...proof,
      });
      expect("error" in resolution).toBe(true);
    }
  });

  test("server citation recovery never waives a new route-policy signature", () => {
    for (const policyInitialization of ["create", "reuse"] as const) {
      const resolution = resolveEarnDepositConfirmPolicySignature({
        preparedDeposit: createPreparedDeposit({
          policyInitialization,
          setup: true,
          finalize: true,
        }),
        resolveReusedPolicyOnServer: true,
        setupPolicySignature: "new-setup-signature",
        setupPolicyConfirmedSlot: "122",
      });
      expect("error" in resolution).toBe(true);
    }
  });

  test("ordinary reuse delegates citation recovery only to a capable endpoint", () => {
    const preparedDeposit = createPreparedDeposit({
      policyInitialization: "reuse",
    });
    expect(
      "error" in resolveEarnDepositConfirmPolicySignature({ preparedDeposit })
    ).toBe(true);
    const resolution = resolveEarnDepositConfirmPolicySignature({
      preparedDeposit,
      resolveReusedPolicyOnServer: true,
      policySignature: "stale-onboarding-citation",
      policyConfirmedSlot: "100",
      setupPolicySignature: "incomplete-stale-setup-citation",
    });
    expect("error" in resolution).toBe(false);
    if ("error" in resolution) throw new Error(resolution.error);
    expect(resolution.policySignature).toBeUndefined();
    expect(resolution.policyConfirmedSlot).toBeUndefined();
    expect(resolution.setupPolicySignature).toBeUndefined();
  });

  test("first deposit without finalize requires setup then deposit", () => {
    const preparedDeposit = createPreparedDeposit({
      policyInitialization: "create",
      setup: true,
    });

    expect(getEarnDepositReviewStages({ preparedDeposit }).join(">")).toBe(
      "policy>deposit"
    );
    const resolution = resolveEarnDepositConfirmPolicySignature({
      policyConfirmedSlot: "121",
      policySignature: "setup-signature",
      preparedDeposit,
    });
    expect(
      "policySignature" in resolution ? resolution.policySignature : ""
    ).toBe("setup-signature");
  });

  test("first deposit with finalize requires setup, finalize, then deposit", () => {
    const preparedDeposit = createPreparedDeposit({
      finalize: true,
      policyInitialization: "create",
      setup: true,
    });

    expect(getEarnDepositReviewStages({ preparedDeposit }).join(">")).toBe(
      "policy>policy-finalize>deposit"
    );
    const resolution = resolveEarnDepositConfirmPolicySignature({
      policyConfirmedSlot: "121",
      policySignature: "policy-signature",
      preparedDeposit,
      setupPolicyConfirmedSlot: "122",
      setupPolicySignature: "setup-policy-signature",
    });
    expect(
      "setupPolicySignature" in resolution
        ? resolution.setupPolicySignature
        : ""
    ).toBe("setup-policy-signature");
  });

  test("first deposit with finalize rejects missing setup policy signature", () => {
    const preparedDeposit = createPreparedDeposit({
      finalize: true,
      policyInitialization: "create",
      setup: true,
    });

    const resolution = resolveEarnDepositConfirmPolicySignature({
      policyConfirmedSlot: "121",
      policySignature: "policy-signature",
      preparedDeposit,
    });

    expect("error" in resolution ? resolution.error : "").toContain(
      "setup policy signature"
    );
  });

  test("top-up uses the active policy signature", () => {
    const preparedDeposit = createPreparedDeposit({
      policyInitialization: "reuse",
    });

    expect(getEarnDepositReviewStages({ preparedDeposit }).join(">")).toBe(
      "deposit"
    );
    const resolution = resolveEarnDepositConfirmPolicySignature({
      activePolicy: {
        account: POLICY_ACCOUNT.toBase58(),
        lastSeenSignature: "active-policy-signature",
        lastSeenSlot: "121",
        seed: "7",
      },
      preparedDeposit,
    });
    expect(
      "policySignature" in resolution ? resolution.policySignature : ""
    ).toBe("active-policy-signature");
  });

  test("top-up rejects a missing active policy signature", () => {
    const preparedDeposit = createPreparedDeposit({
      policyInitialization: "reuse",
    });

    const resolution = resolveEarnDepositConfirmPolicySignature({
      activePolicy: null,
      preparedDeposit,
    });
    expect("error" in resolution ? resolution.error : "").toContain(
      "active policy"
    );
  });
});
