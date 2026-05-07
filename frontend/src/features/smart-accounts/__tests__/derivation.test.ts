import { describe, expect, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import { pda } from "@loyal-labs/loyal-smart-accounts";

import {
  DEFAULT_CANONICAL_SMART_ACCOUNT_INDEX,
  deriveCanonicalSmartAccountAddress,
  deriveSettingsPdaAddress,
} from "../derivation";

describe("smart-account derivation", () => {
  test("derives the canonical smart-account address from settings PDA", () => {
    const programId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
    const accountIndex = 42n;
    const settingsPda = deriveSettingsPdaAddress({
      programId,
      accountIndex,
    });
    const [expectedSettingsPda] = pda.getSettingsPda({
      programId: new PublicKey(programId),
      accountIndex,
    });
    const [expectedSmartAccountAddress] = pda.getSmartAccountPda({
      programId: new PublicKey(programId),
      settingsPda: expectedSettingsPda,
      accountIndex: DEFAULT_CANONICAL_SMART_ACCOUNT_INDEX,
    });

    expect(settingsPda).toBe(expectedSettingsPda.toBase58());
    expect(
      deriveCanonicalSmartAccountAddress({
        programId,
        settingsPda,
      })
    ).toBe(expectedSmartAccountAddress.toBase58());
  });

  test("uses index zero as the canonical default", () => {
    const programId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
    const settingsPda = deriveSettingsPdaAddress({
      programId,
      accountIndex: 1n,
    });

    expect(DEFAULT_CANONICAL_SMART_ACCOUNT_INDEX).toBe(0);
    expect(
      deriveCanonicalSmartAccountAddress({
        programId,
        settingsPda,
        accountIndex: 0,
      })
    ).toBe(
      deriveCanonicalSmartAccountAddress({
        programId,
        settingsPda,
      })
    );
  });
});
