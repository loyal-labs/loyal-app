import { describe, expect, mock, test } from "bun:test";
import { Keypair } from "@solana/web3.js";

import {
  deriveCanonicalSmartAccountAddress,
  deriveSettingsPdaAddress,
} from "@/features/smart-accounts/derivation";

const treasury = Keypair.generate().publicKey;
const configuredProgramId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";

async function loadServiceModule() {
  return import("@/features/smart-accounts/service");
}

function createRecord(args: {
  settingsPda?: string;
  state?: "provisioning" | "ready" | "failed";
  creationSignature?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}) {
  const createdAt = new Date("2026-04-08T00:00:00.000Z");
  const updatedAt = new Date("2026-04-08T00:00:00.000Z");

  return {
    id: "record-1",
    userId: "user-1",
    solanaEnv: "devnet" as const,
    settingsPda:
      args.settingsPda ??
      deriveSettingsPdaAddress({
        programId: configuredProgramId,
        accountIndex: 5n,
      }),
    state: args.state ?? "provisioning",
    creationSignature: args.creationSignature ?? null,
    lastCheckedAt: updatedAt,
    lastErrorCode: args.lastErrorCode ?? null,
    lastErrorMessage: args.lastErrorMessage ?? null,
    createdAt,
    updatedAt,
  };
}

function createSummary(args: {
  settingsPda: string;
  creationSignature: string | null;
}) {
  return {
    programId: configuredProgramId,
    settingsPda: args.settingsPda,
    smartAccountAddress: deriveCanonicalSmartAccountAddress({
      programId: configuredProgramId,
      settingsPda: args.settingsPda,
    }),
    creationSignature: args.creationSignature,
  };
}

function createDependencies(args: {
  existingRecord?: ReturnType<typeof createRecord> | null;
  createSmartAccount?: ReturnType<typeof mock>;
  fetchProgramConfig?: ReturnType<typeof mock>;
  findSignerAddressesForSettings?: ReturnType<typeof mock>;
  findByUserIdAndEnv?: ReturnType<typeof mock>;
  isSettingsReservationConflict?: ReturnType<typeof mock>;
  reserveProvisioning?: ReturnType<typeof mock>;
  markReady?: ReturnType<typeof mock>;
  markFailed?: ReturnType<typeof mock>;
} = {}) {
  const state = {
    currentRecord: args.existingRecord ?? null,
  };

  const createSmartAccount = args.createSmartAccount ?? mock(async () => "sig-created");
  const fetchProgramConfig =
    args.fetchProgramConfig ??
    mock(async () => ({
      smartAccountIndex: {
        toString: () => "8",
      },
      treasury,
    }));
  const findSignerAddressesForSettings =
    args.findSignerAddressesForSettings ?? mock(async () => null);
  const findByUserIdAndEnv =
    args.findByUserIdAndEnv ?? mock(async () => state.currentRecord);
  const reserveProvisioningImpl =
    args.reserveProvisioning ??
    mock(
      async (input: {
        userId: string;
        solanaEnv: "devnet";
        settingsPda: string;
      }) =>
        createRecord({
          settingsPda: input.settingsPda,
          state: "provisioning",
        })
    );
  const markReadyImpl =
    args.markReady ??
    mock(
      async (input: {
        userId: string;
        solanaEnv: "devnet";
        creationSignature?: string | null;
      }) =>
        createRecord({
          settingsPda: state.currentRecord?.settingsPda,
          state: "ready",
          creationSignature:
            input.creationSignature === undefined ? null : input.creationSignature,
        })
    );
  const markFailedImpl =
    args.markFailed ??
    mock(
      async (input: {
        userId: string;
        solanaEnv: "devnet";
        errorCode: string;
        errorMessage: string;
        creationSignature?: string | null;
      }) =>
        createRecord({
          settingsPda: state.currentRecord?.settingsPda,
          state: "failed",
          creationSignature:
            input.creationSignature === undefined ? null : input.creationSignature,
          lastErrorCode: input.errorCode,
          lastErrorMessage: input.errorMessage,
        })
    );
  const reserveProvisioning = mock(
    async (input: {
      userId: string;
      solanaEnv: "devnet";
      settingsPda: string;
    }) => {
      const record = await reserveProvisioningImpl(input);
      state.currentRecord = record;
      return record;
    }
  );
  const markReady = mock(
    async (input: {
      userId: string;
      solanaEnv: "devnet";
      creationSignature?: string | null;
    }) => {
      const record = await markReadyImpl(input);
      state.currentRecord = record;
      return record;
    }
  );
  const markFailed = mock(
    async (input: {
      userId: string;
      solanaEnv: "devnet";
      errorCode: string;
      errorMessage: string;
      creationSignature?: string | null;
    }) => {
      const record = await markFailedImpl(input);
      state.currentRecord = record;
      return record;
    }
  );

  return {
    createSmartAccount,
    fetchProgramConfig,
    findSignerAddressesForSettings,
    findByUserIdAndEnv,
    reserveProvisioning,
    markReady,
    markFailed,
    dependencies: {
      getCurrentConfig: () => ({
        solanaEnv: "devnet" as const,
        programId: configuredProgramId,
      }),
      findByUserIdAndEnv,
      reserveProvisioning,
      markReady,
      markFailed,
      fetchProgramConfig,
      createSmartAccount,
      findSignerAddressesForSettings,
      isSettingsReservationConflict:
        args.isSettingsReservationConflict ?? mock(() => false),
    },
  };
}

describe("smart-account service", () => {
  test("reuses an existing ready record without re-sponsoring", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const existingRecord = createRecord({
      state: "ready",
      creationSignature: "sig-existing",
    });
    const { createSmartAccount, dependencies, fetchProgramConfig, reserveProvisioning } =
      createDependencies({
        existingRecord,
      });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response).toEqual({
      smartAccount: createSummary({
        settingsPda: existingRecord.settingsPda,
        creationSignature: "sig-existing",
      }),
      provisioningOutcome: "existing_ready",
    });
    expect(createSmartAccount).not.toHaveBeenCalled();
    expect(fetchProgramConfig).not.toHaveBeenCalled();
    expect(reserveProvisioning).not.toHaveBeenCalled();
  });

  test("reconciles a provisioning record when the settings account already exists", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const existingRecord = createRecord({ state: "provisioning" });
    const { createSmartAccount, dependencies, markReady } = createDependencies({
      existingRecord,
      findSignerAddressesForSettings: mock(async () => ["wallet-1"]),
    });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response).toEqual({
      smartAccount: createSummary({
        settingsPda: existingRecord.settingsPda,
        creationSignature: null,
      }),
      provisioningOutcome: "reconciled_ready",
    });
    expect(createSmartAccount).not.toHaveBeenCalled();
    expect(markReady).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      creationSignature: undefined,
    });
  });

  test("sponsors a smart account when no env record exists", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const { createSmartAccount, dependencies, reserveProvisioning } =
      createDependencies();
    const expectedSettingsPda = deriveSettingsPdaAddress({
      programId: configuredProgramId,
      accountIndex: 8n,
    });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response).toEqual({
      smartAccount: createSummary({
        settingsPda: expectedSettingsPda,
        creationSignature: "sig-created",
      }),
      provisioningOutcome: "sponsored_new_record",
    });
    expect(reserveProvisioning).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      settingsPda: expectedSettingsPda,
    });
    expect(createSmartAccount).toHaveBeenCalledWith({
      solanaEnv: "devnet",
      programId: configuredProgramId,
      settingsPda: expectedSettingsPda,
      treasury,
      walletAddress: "wallet-1",
    });
  });

  test("sponsors an existing provisioning record when the on-chain settings are missing", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const existingRecord = createRecord({
      state: "provisioning",
      settingsPda: deriveSettingsPdaAddress({
        programId: configuredProgramId,
        accountIndex: 1n,
      }),
    });
    const { createSmartAccount, dependencies, reserveProvisioning } =
      createDependencies({
        existingRecord,
      });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response).toEqual({
      smartAccount: createSummary({
        settingsPda: existingRecord.settingsPda,
        creationSignature: "sig-created",
      }),
      provisioningOutcome: "sponsored_existing_record",
    });
    expect(reserveProvisioning).not.toHaveBeenCalled();
    expect(createSmartAccount).toHaveBeenCalledWith({
      solanaEnv: "devnet",
      programId: configuredProgramId,
      settingsPda: existingRecord.settingsPda,
      treasury,
      walletAddress: "wallet-1",
    });
  });

  test("ready-only resolver ignores non-ready rows", async () => {
    const { findReadyUserSmartAccount } = await loadServiceModule();
    const provisioningRecord = createRecord({ state: "provisioning" });
    const { dependencies, findSignerAddressesForSettings } = createDependencies({
      existingRecord: provisioningRecord,
    });

    const summary = await findReadyUserSmartAccount(
      {
        userId: "user-1",
      },
      dependencies as never
    );

    expect(summary).toBeNull();
    expect(findSignerAddressesForSettings).not.toHaveBeenCalled();
  });

  test("re-reserves when an existing record belongs to a different signer", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const staleRecord = createRecord({ state: "provisioning" });
    const nextSettingsPda = deriveSettingsPdaAddress({
      programId: configuredProgramId,
      accountIndex: 8n,
    });
    const { createSmartAccount, dependencies, markReady, reserveProvisioning } =
      createDependencies({
        existingRecord: staleRecord,
        findSignerAddressesForSettings: mock(async () => ["wallet-other"]),
      });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response).toEqual({
      smartAccount: createSummary({
        settingsPda: nextSettingsPda,
        creationSignature: "sig-created",
      }),
      provisioningOutcome: "sponsored_existing_record",
    });
    expect(markReady).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      creationSignature: "sig-created",
    });
    expect(reserveProvisioning).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      settingsPda: nextSettingsPda,
    });
    expect(createSmartAccount).toHaveBeenCalledWith({
      solanaEnv: "devnet",
      programId: configuredProgramId,
      settingsPda: nextSettingsPda,
      treasury,
      walletAddress: "wallet-1",
    });
  });

  test("retries reservation when the candidate settings PDA is already reserved", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const conflictError = new Error("duplicate key value violates unique constraint");
    let fetchCalls = 0;
    let reserveCalls = 0;
    const retryingFetchProgramConfig = mock(async () => ({
      smartAccountIndex: {
        toString: () => `${8 + fetchCalls++}`,
      },
      treasury,
    }));
    const retryingReserveProvisioning = mock(
      async (input: {
        userId: string;
        solanaEnv: "devnet";
        settingsPda: string;
      }) => {
        if (reserveCalls++ === 0) {
          throw conflictError;
        }

        return createRecord({
          settingsPda: input.settingsPda,
          state: "provisioning",
        });
      }
    );
    const { createSmartAccount, dependencies } = createDependencies({
      fetchProgramConfig: retryingFetchProgramConfig,
      reserveProvisioning: retryingReserveProvisioning,
      isSettingsReservationConflict: mock((error: unknown) => error === conflictError),
    });
    const expectedSettingsPda = deriveSettingsPdaAddress({
      programId: configuredProgramId,
      accountIndex: 9n,
    });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response).toEqual({
      smartAccount: createSummary({
        settingsPda: expectedSettingsPda,
        creationSignature: "sig-created",
      }),
      provisioningOutcome: "sponsored_new_record",
    });
    expect(retryingFetchProgramConfig).toHaveBeenCalledTimes(2);
    expect(retryingReserveProvisioning).toHaveBeenCalledTimes(2);
    expect(createSmartAccount).toHaveBeenCalledWith({
      solanaEnv: "devnet",
      programId: configuredProgramId,
      settingsPda: expectedSettingsPda,
      treasury,
      walletAddress: "wallet-1",
    });
  });

  test("reconciles successfully when chain creation succeeded but the first ready write failed", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    let markReadyCalls = 0;
    const existingRecord = createRecord({ state: "provisioning" });
    const markReady = mock(
      async (input: {
        userId: string;
        solanaEnv: "devnet";
        creationSignature?: string | null;
      }) => {
        if (input.creationSignature === "sig-created" && markReadyCalls === 0) {
          markReadyCalls += 1;
          throw new Error("temporary db write failure");
        }
        markReadyCalls += 1;

        return createRecord({
          settingsPda: existingRecord.settingsPda,
          state: "ready",
          creationSignature:
            input.creationSignature === undefined ? null : input.creationSignature,
        });
      }
    );
    const { dependencies, markFailed } = createDependencies({
      existingRecord,
      markReady,
      createSmartAccount: mock(async () => "sig-created"),
      findSignerAddressesForSettings: mock(async () => ["wallet-1"]),
    });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response).toEqual({
      smartAccount: createSummary({
        settingsPda: existingRecord.settingsPda,
        creationSignature: null,
      }),
      provisioningOutcome: "reconciled_ready",
    });
    expect(markReady).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
  });

  test("marks the record failed when sponsorship cannot be recovered", async () => {
    const { ensureUserSmartAccount, isSmartAccountProvisioningError } =
      await loadServiceModule();
    const existingRecord = createRecord({ state: "failed" });
    const createSmartAccount = mock(async () => {
      throw new Error("rpc unavailable");
    });
    const { dependencies, markFailed } = createDependencies({
      existingRecord,
      createSmartAccount,
      findSignerAddressesForSettings: mock(async () => null),
    });

    try {
      await ensureUserSmartAccount(
        {
          userId: "user-1",
          walletAddress: "wallet-1",
        },
        dependencies as never
      );
      throw new Error("Expected smart-account provisioning to fail");
    } catch (error) {
      expect(isSmartAccountProvisioningError(error)).toBe(true);
      expect(error).toMatchObject({
        code: "smart_account_provisioning_failed",
      });
    }

    expect(markFailed).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      errorCode: "smart_account_provisioning_failed",
      errorMessage: "rpc unavailable",
    });
  });
});
