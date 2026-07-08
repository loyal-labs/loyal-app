import { describe, expect, mock, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

import {
  deriveCanonicalSmartAccountAddress,
  deriveSettingsPdaAddress,
} from "@/features/smart-accounts/derivation";
import {
  ensureUserSmartAccount,
  type SmartAccountServiceDependencies,
} from "./service";

const programId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";
const walletAddress = "11111111111111111111111111111113";
const userId = "user-1";
const readySettingsPda = deriveSettingsPdaAddress({
  programId,
  accountIndex: BigInt(2),
});
const delegatedSettingsPda = deriveSettingsPdaAddress({
  programId,
  accountIndex: BigInt(7),
});
const delegatedSmartAccountAddress = deriveCanonicalSmartAccountAddress({
  programId,
  settingsPda: delegatedSettingsPda,
});
const olderDelegatedSettingsPda = deriveSettingsPdaAddress({
  programId,
  accountIndex: BigInt(6),
});
const olderDelegatedSmartAccountAddress = deriveCanonicalSmartAccountAddress({
  programId,
  settingsPda: olderDelegatedSettingsPda,
});

function createReadyRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-16T00:00:00.000Z");

  return {
    id: "smart-account-record",
    userId,
    solanaEnv: "mainnet" as const,
    settingsPda: readySettingsPda,
    state: "ready" as const,
    creationSignature: "signature",
    lastCheckedAt: now,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createDependencies(
  overrides: Partial<SmartAccountServiceDependencies> = {}
): SmartAccountServiceDependencies {
  const reservedSettingsPda = deriveSettingsPdaAddress({
    programId,
    accountIndex: BigInt(11),
  });
  const reservedRecord = createReadyRecord({
    creationSignature: null,
    id: "reserved-record",
    settingsPda: reservedSettingsPda,
    state: "provisioning",
  });

  return {
    getCurrentConfig: () => ({
      solanaEnv: "mainnet",
      programId,
    }),
    findByUserIdAndEnv: mock(async () => null),
    reserveProvisioning: mock(async () => reservedRecord),
    markReady: mock(async () =>
      createReadyRecord({
        creationSignature: "sponsor-signature",
        settingsPda: reservedSettingsPda,
      })
    ),
    markFailed: mock(async () => createReadyRecord({ state: "failed" })),
    fetchProgramConfig: mock(async () => ({
      smartAccountIndex: { toString: () => "10" },
      treasury: PublicKey.default,
    })),
    createSmartAccount: mock(async () => "sponsor-signature"),
    findSignerAddressesForSettings: mock(async () => null),
    findActiveRootSignerMemberships: mock(async () => []),
    fetchRootSettingsSigners: mock(async () => []),
    recordActiveRootSignerMembership: mock(async (input) => ({
      id: "membership",
      solanaEnv: input.solanaEnv,
      smartAccountAddress: input.smartAccountAddress,
      settingsPda: input.settingsPda,
      signerAddress: input.signerAddress,
      permissionMask: input.permissionMask ?? null,
      sourceSignature: input.sourceSignature ?? null,
      sourceSlot: input.sourceSlot == null ? null : BigInt(input.sourceSlot),
      updatedAt: new Date("2026-06-16T00:00:00.000Z"),
    })),
    markRootSignerRemoved: mock(async (input) => ({
      id: "membership",
      solanaEnv: input.solanaEnv,
      smartAccountAddress: delegatedSmartAccountAddress,
      settingsPda: input.settingsPda,
      signerAddress: input.signerAddress,
      permissionMask: null,
      sourceSignature: null,
      sourceSlot: null,
      updatedAt: new Date("2026-06-16T00:00:00.000Z"),
    })),
    isSettingsReservationConflict: () => false,
    ...overrides,
  };
}

describe("ensureUserSmartAccount delegated root signer onboarding", () => {
  test("keeps ready personal smart account precedence over delegated memberships", async () => {
    const dependencies = createDependencies({
      findByUserIdAndEnv: mock(async () => createReadyRecord()),
      findActiveRootSignerMemberships: mock(async () => {
        throw new Error("delegated lookup should not run");
      }),
    });

    const result = await ensureUserSmartAccount(
      { userId, walletAddress },
      dependencies
    );

    expect(result.provisioningOutcome).toBe("existing_ready");
    expect(result.smartAccount.settingsPda).toBe(readySettingsPda);
  });

  test("uses an active root Settings signer membership without sponsorship", async () => {
    const dependencies = createDependencies({
      findActiveRootSignerMemberships: mock(async () => [
        {
          id: "membership",
          solanaEnv: "mainnet" as const,
          smartAccountAddress: delegatedSmartAccountAddress,
          settingsPda: delegatedSettingsPda,
          signerAddress: walletAddress,
          permissionMask: 7,
          sourceSignature: "add-signature",
          sourceSlot: BigInt(10),
          updatedAt: new Date("2026-06-16T00:00:00.000Z"),
        },
      ]),
      fetchRootSettingsSigners: mock(async () => [
        { address: walletAddress, permissionMask: 7 },
      ]),
      createSmartAccount: mock(async () => {
        throw new Error("sponsorship should not run");
      }),
    });

    const result = await ensureUserSmartAccount(
      { userId, walletAddress },
      dependencies
    );

    expect(result.provisioningOutcome).toBe("delegated_root_signer");
    expect(result.smartAccount.settingsPda).toBe(delegatedSettingsPda);
    expect(result.smartAccount.smartAccountAddress).toBe(
      delegatedSmartAccountAddress
    );
    expect(dependencies.recordActiveRootSignerMembership).toHaveBeenCalled();
  });

  test("uses the first deterministic active membership when several exist", async () => {
    const dependencies = createDependencies({
      findActiveRootSignerMemberships: mock(async () => [
        {
          id: "latest-membership",
          solanaEnv: "mainnet" as const,
          smartAccountAddress: delegatedSmartAccountAddress,
          settingsPda: delegatedSettingsPda,
          signerAddress: walletAddress,
          permissionMask: 7,
          sourceSignature: "latest-add-signature",
          sourceSlot: BigInt(20),
          updatedAt: new Date("2026-06-16T00:00:00.000Z"),
        },
        {
          id: "older-membership",
          solanaEnv: "mainnet" as const,
          smartAccountAddress: olderDelegatedSmartAccountAddress,
          settingsPda: olderDelegatedSettingsPda,
          signerAddress: walletAddress,
          permissionMask: 7,
          sourceSignature: "older-add-signature",
          sourceSlot: BigInt(10),
          updatedAt: new Date("2026-06-15T00:00:00.000Z"),
        },
      ]),
      fetchRootSettingsSigners: mock(async () => [
        { address: walletAddress, permissionMask: 7 },
      ]),
      createSmartAccount: mock(async () => {
        throw new Error("sponsorship should not run");
      }),
    });

    const result = await ensureUserSmartAccount(
      { userId, walletAddress },
      dependencies
    );

    expect(result.provisioningOutcome).toBe("delegated_root_signer");
    expect(result.smartAccount.settingsPda).toBe(delegatedSettingsPda);
  });

  test("rejects a stale DB signer row after checking chain state", async () => {
    const dependencies = createDependencies({
      findActiveRootSignerMemberships: mock(async () => [
        {
          id: "stale-membership",
          solanaEnv: "mainnet" as const,
          smartAccountAddress: delegatedSmartAccountAddress,
          settingsPda: delegatedSettingsPda,
          signerAddress: walletAddress,
          permissionMask: 7,
          sourceSignature: "old-add-signature",
          sourceSlot: BigInt(1),
          updatedAt: new Date("2026-06-16T00:00:00.000Z"),
        },
      ]),
      fetchRootSettingsSigners: mock(async () => []),
    });

    const result = await ensureUserSmartAccount(
      { userId, walletAddress },
      dependencies
    );

    expect(dependencies.markRootSignerRemoved).toHaveBeenCalled();
    expect(result.provisioningOutcome).toBe("sponsored_new_record");
  });

  test("ignores a delegated membership for the wrong smart account owner", async () => {
    const dependencies = createDependencies({
      findActiveRootSignerMemberships: mock(async () => [
        {
          id: "wrong-owner-membership",
          solanaEnv: "mainnet" as const,
          smartAccountAddress: olderDelegatedSmartAccountAddress,
          settingsPda: delegatedSettingsPda,
          signerAddress: walletAddress,
          permissionMask: 7,
          sourceSignature: "add-signature",
          sourceSlot: BigInt(10),
          updatedAt: new Date("2026-06-16T00:00:00.000Z"),
        },
      ]),
    });

    const result = await ensureUserSmartAccount(
      { userId, walletAddress },
      dependencies
    );

    expect(dependencies.fetchRootSettingsSigners).not.toHaveBeenCalled();
    expect(result.provisioningOutcome).toBe("sponsored_new_record");
  });

  test("does not treat missing root Settings membership as delegated identity", async () => {
    const dependencies = createDependencies({
      findActiveRootSignerMemberships: mock(async () => []),
      fetchRootSettingsSigners: mock(async () => {
        throw new Error("root chain lookup should not run without membership");
      }),
    });

    const result = await ensureUserSmartAccount(
      { userId, walletAddress },
      dependencies
    );

    expect(result.provisioningOutcome).toBe("sponsored_new_record");
    expect(dependencies.createSmartAccount).toHaveBeenCalled();
  });
});

describe("ensureUserSmartAccount concurrent-signup index race", () => {
  test("re-reserves and retries once when a racing signup takes the reserved settings PDA", async () => {
    const firstPda = deriveSettingsPdaAddress({
      programId,
      accountIndex: BigInt(11),
    });
    const secondPda = deriveSettingsPdaAddress({
      programId,
      accountIndex: BigInt(12),
    });
    let reservations = 0;
    let creates = 0;
    const markFailed = mock(async () => createReadyRecord({ state: "failed" }));
    const dependencies = createDependencies({
      reserveProvisioning: mock(async () => {
        reservations += 1;
        return createReadyRecord({
          creationSignature: null,
          id: `reserved-${reservations}`,
          settingsPda: reservations === 1 ? firstPda : secondPda,
          state: "provisioning",
        });
      }),
      createSmartAccount: mock(async (input) => {
        creates += 1;
        if (creates === 1) {
          throw new Error("Missing account");
        }
        expect(input.settingsPda).toBe(secondPda);
        return "sponsor-signature-2";
      }),
      // After the failed create, the first PDA holds the RACING user's
      // settings — our wallet is not among its signers (owner_mismatch).
      findSignerAddressesForSettings: mock(async () => [
        "SomeOtherWa11etAddre55111111111111111111111",
      ]),
      markFailed,
      markReady: mock(async (input) =>
        createReadyRecord({
          creationSignature: input.creationSignature ?? null,
          settingsPda: secondPda,
        })
      ),
    });

    const result = await ensureUserSmartAccount(
      { userId, walletAddress },
      dependencies
    );

    expect(result.provisioningOutcome).toBe("sponsored_new_record");
    expect(result.smartAccount.settingsPda).toBe(secondPda);
    expect(reservations).toBe(2);
    expect(creates).toBe(2);
    expect(markFailed).not.toHaveBeenCalled();
  });
});
