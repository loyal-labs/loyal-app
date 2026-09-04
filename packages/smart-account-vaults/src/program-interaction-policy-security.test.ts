import { describe, expect, test } from "bun:test";
import { generated } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { programInteractionPolicySecurityEquals } from "./program-interaction-policy-security";

const programId = new PublicKey("11111111111111111111111111111112");
const alternateProgramId = new PublicKey("11111111111111111111111111111113");
const mint = new PublicKey("11111111111111111111111111111114");
const alternateMint = new PublicKey("11111111111111111111111111111115");

const expected: generated.PolicyCreationPayload = {
  __kind: "ProgramInteraction",
  fields: [
    {
      accountIndex: 1,
      instructionsConstraints: [
        { accountConstraints: [], dataConstraints: [], programId },
      ],
      postHook: null,
      preHook: null,
      spendingLimits: [
        {
          mint,
          quantityConstraints: { maxPerPeriod: new BN(1_000_000) },
          timeConstraints: {
            expiration: null,
            period: { __kind: "Daily" },
            start: new BN(0),
          },
        },
      ],
    },
  ],
};

type RuntimeOverrides = {
  accountIndex?: number;
  accumulateUnused?: boolean;
  dataOffset?: BN;
  enforceExactQuantity?: boolean;
  expiration?: BN | null;
  maxPerPeriod?: BN;
  maxPerUse?: BN;
  mint?: PublicKey;
  period?: generated.PeriodV2;
  postHook?: generated.Hook | null;
  preHook?: generated.Hook | null;
  programId?: PublicKey;
};

function runtimePolicy(
  overrides: RuntimeOverrides = {}
): generated.PolicyState {
  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: overrides.accountIndex ?? 1,
        instructionsConstraints: [
          {
            accountConstraints: [],
            dataConstraints: overrides.dataOffset
              ? [
                  {
                    dataOffset: overrides.dataOffset,
                    dataValue: { __kind: "U8", fields: [1] },
                    operator: generated.DataOperator.Equals,
                  },
                ]
              : [],
            programId: overrides.programId ?? programId,
          },
        ],
        postHook: overrides.postHook ?? null,
        preHook: overrides.preHook ?? null,
        spendingLimits: [
          {
            mint: overrides.mint ?? mint,
            quantityConstraints: {
              enforceExactQuantity: overrides.enforceExactQuantity ?? false,
              maxPerPeriod: overrides.maxPerPeriod ?? new BN(1_000_000),
              maxPerUse: overrides.maxPerUse ?? new BN(0),
            },
            timeConstraints: {
              accumulateUnused: overrides.accumulateUnused ?? false,
              expiration: overrides.expiration ?? null,
              period: overrides.period ?? { __kind: "Daily" },
              start: new BN(1_786_936_896),
            },
            usage: {
              lastReset: new BN(1_786_936_896),
              remainingInPeriod: new BN(750_000),
            },
          },
        ],
      },
    ],
  };
}

describe("ProgramInteraction policy security projection", () => {
  test("accepts materialized runtime counters and defaults", () => {
    expect(
      programInteractionPolicySecurityEquals(expected, runtimePolicy())
    ).toBe(true);
  });

  test("rejects every security-relevant mutation", () => {
    const hook: generated.Hook = {
      accountConstraints: [],
      instructionData: Uint8Array.of(1),
      numExtraAccounts: 0,
      passInnerInstructions: false,
      programId,
    };
    const mutations = [
      runtimePolicy({ accountIndex: 2 }),
      runtimePolicy({ programId: alternateProgramId }),
      runtimePolicy({ dataOffset: new BN(1) }),
      runtimePolicy({ preHook: hook }),
      runtimePolicy({ postHook: hook }),
      runtimePolicy({ mint: alternateMint }),
      runtimePolicy({ expiration: new BN(2_000_000_000) }),
      runtimePolicy({ period: { __kind: "Weekly" } }),
      runtimePolicy({ maxPerPeriod: new BN(999_999) }),
      runtimePolicy({ maxPerUse: new BN(1) }),
      runtimePolicy({ enforceExactQuantity: true }),
      runtimePolicy({ accumulateUnused: true }),
    ];

    expect(
      mutations.every(
        (mutation) =>
          !programInteractionPolicySecurityEquals(expected, mutation)
      )
    ).toBe(true);
  });
});
