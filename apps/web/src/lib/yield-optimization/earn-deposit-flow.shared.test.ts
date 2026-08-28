import { describe, expect, test } from "bun:test";
import type { SmartAccountPreparedEarnUsdcDeposit } from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import {
  EARN_DEPOSIT_POLICY_SUBMITTED_CONFIRMATION_UNRESOLVED_MESSAGE,
  EARN_DEPOSIT_SUBMITTED_CONFIRMATION_UNRESOLVED_MESSAGE,
  getEarnDepositReviewStages,
  getEarnDepositSubmittedTransactionMessage,
  resolveEarnDepositConfirmedSlot,
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
  test("uses the wallet confirmation slot without another RPC lookup", async () => {
    let fallbackCalls = 0;

    const slot = await resolveEarnDepositConfirmedSlot({
      fallback: async () => {
        fallbackCalls += 1;
        throw new Error("duplicate RPC lookup");
      },
      transportSlot: 123,
    });

    expect(slot).toBe("123");
    expect(fallbackCalls).toBe(0);
  });

  test("falls back when the wallet transport omits its confirmation slot", async () => {
    let fallbackCalls = 0;

    const slot = await resolveEarnDepositConfirmedSlot({
      fallback: async () => {
        fallbackCalls += 1;
        return "456";
      },
    });

    expect(slot).toBe("456");
    expect(fallbackCalls).toBe(1);
  });

  test("distinguishes ambiguous setup from an ambiguous money movement", () => {
    expect(getEarnDepositSubmittedTransactionMessage("policy")).toBe(
      EARN_DEPOSIT_POLICY_SUBMITTED_CONFIRMATION_UNRESOLVED_MESSAGE
    );
    expect(getEarnDepositSubmittedTransactionMessage("policy-finalize")).toBe(
      EARN_DEPOSIT_POLICY_SUBMITTED_CONFIRMATION_UNRESOLVED_MESSAGE
    );
    expect(getEarnDepositSubmittedTransactionMessage("deposit")).toBe(
      EARN_DEPOSIT_SUBMITTED_CONFIRMATION_UNRESOLVED_MESSAGE
    );
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
