import { describe, expect, test } from "bun:test";
import type { SmartAccountPreparedEarnUsdcDeposit } from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import {
  getEarnDepositReviewStages,
  resolveEarnDepositConfirmPolicySignature,
} from "./earn-deposit-flow.shared";

const POLICY_ACCOUNT = new PublicKey(
  "11111111111111111111111111111111"
);

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
  test("first deposit without finalize requires setup then deposit", () => {
    const preparedDeposit = createPreparedDeposit({
      policyInitialization: "create",
      setup: true,
    });

    expect(getEarnDepositReviewStages({ preparedDeposit })).toEqual([
      "policy",
      "deposit",
    ]);
    expect(
      resolveEarnDepositConfirmPolicySignature({
        policyConfirmedSlot: "121",
        policySignature: "setup-signature",
        preparedDeposit,
      })
    ).toEqual({
      policyConfirmedSlot: "121",
      policySignature: "setup-signature",
    });
  });

  test("first deposit with finalize requires setup, finalize, then deposit", () => {
    const preparedDeposit = createPreparedDeposit({
      finalize: true,
      policyInitialization: "create",
      setup: true,
    });

    expect(getEarnDepositReviewStages({ preparedDeposit })).toEqual([
      "policy",
      "policy-finalize",
      "deposit",
    ]);
    expect(
      resolveEarnDepositConfirmPolicySignature({
        policyConfirmedSlot: "121",
        policySignature: "policy-signature",
        preparedDeposit,
        setupPolicyConfirmedSlot: "122",
        setupPolicySignature: "setup-policy-signature",
      })
    ).toEqual({
      policyConfirmedSlot: "121",
      policySignature: "policy-signature",
      setupPolicyConfirmedSlot: "122",
      setupPolicySignature: "setup-policy-signature",
    });
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

    expect(getEarnDepositReviewStages({ preparedDeposit })).toEqual([
      "deposit",
    ]);
    expect(
      resolveEarnDepositConfirmPolicySignature({
        activePolicy: {
          account: POLICY_ACCOUNT.toBase58(),
          lastSeenSignature: "active-policy-signature",
          lastSeenSlot: "121",
          seed: "7",
        },
        preparedDeposit,
      })
    ).toEqual({
      policyConfirmedSlot: "121",
      policySignature: "active-policy-signature",
    });
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
