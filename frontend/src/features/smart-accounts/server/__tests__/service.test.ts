import { describe, expect, mock, test } from "bun:test";
import { Keypair } from "@solana/web3.js";

import { deriveSettingsPdaAddress } from "@/features/smart-accounts/derivation";

const treasury = Keypair.generate().publicKey;
const configuredProgramId = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";

async function loadServiceModule() {
  return import("@/features/smart-accounts/service");
}

function createRecord(args: {
  settingsPda?: string;
  state?: "pending" | "ready";
  creationSignature?: string | null;
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
    state: args.state ?? "pending",
    creationSignature: args.creationSignature ?? null,
    createdAt,
    updatedAt,
  };
}

function createDependencies(overrides: Record<string, unknown> = {}) {
  const markReady = mock(
    async (input: {
      userId: string;
      solanaEnv: "devnet";
      creationSignature?: string | null;
    }) =>
      createRecord({
        state: "ready",
        creationSignature:
          input.creationSignature === undefined ? null : input.creationSignature,
      })
  );
  const upsertPending = mock(
    async (input: {
      userId: string;
      solanaEnv: "devnet";
      settingsPda: string;
    }) =>
      createRecord({
        settingsPda: input.settingsPda,
        state: "pending",
      })
  );
  const fetchProgramConfig = mock(async () => ({
    smartAccountIndex: {
      toString: () => "8",
    },
    treasury,
  }));
  const findSignerAddressesForSettings = mock(async () => null);
  const findByUserIdAndEnv = mock(async () => null);
  const isSettingsReservationConflict = mock(() => false);

  return {
    markReady,
    upsertPending,
    fetchProgramConfig,
    findSignerAddressesForSettings,
    findByUserIdAndEnv,
    isSettingsReservationConflict,
    dependencies: {
      getCurrentConfig: () => ({
        solanaEnv: "devnet" as const,
        programId: configuredProgramId,
      }),
      findByUserIdAndEnv,
      upsertPending,
      markReady,
      fetchProgramConfig,
      findSignerAddressesForSettings,
      isSettingsReservationConflict,
      ...overrides,
    },
  };
}

describe("smart-account service", () => {
  test("ensure returns an existing ready record without re-preparing", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const existingRecord = createRecord({ state: "ready" });
    const { dependencies, fetchProgramConfig, upsertPending } =
      createDependencies({
        findByUserIdAndEnv: async () => existingRecord,
      });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response.state).toBe("ready");
    expect(response.settingsPda).toBe(existingRecord.settingsPda);
    expect(response.treasury).toBeNull();
    expect(fetchProgramConfig).not.toHaveBeenCalled();
    expect(upsertPending).not.toHaveBeenCalled();
  });

  test("ensure upgrades a pending record when the settings account already exists", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const existingRecord = createRecord({ state: "pending" });
    const { dependencies, markReady } = createDependencies({
      findByUserIdAndEnv: async () => existingRecord,
      findSignerAddressesForSettings: async () => ["wallet-1"],
    });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response.state).toBe("ready");
    expect(response.settingsPda).toBe(existingRecord.settingsPda);
    expect(markReady).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      creationSignature: undefined,
    });
  });

  test("ensure creates a pending record from the current program index", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const { dependencies, upsertPending } = createDependencies();

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response.state).toBe("pending");
    expect(response.treasury).toBe(treasury.toBase58());
    expect(upsertPending).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      settingsPda: deriveSettingsPdaAddress({
        programId: configuredProgramId,
        accountIndex: 8n,
      }),
    });
  });

  test("ensure refreshes a stale pending record when asked to rerun", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const staleRecord = createRecord({
      state: "pending",
      settingsPda: deriveSettingsPdaAddress({
        programId: configuredProgramId,
        accountIndex: 1n,
      }),
    });
    const { dependencies, upsertPending } = createDependencies({
      findByUserIdAndEnv: async () => staleRecord,
    });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
        refreshPending: true,
      },
      dependencies as never
    );

    expect(response.state).toBe("pending");
    expect(upsertPending).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      settingsPda: deriveSettingsPdaAddress({
        programId: configuredProgramId,
        accountIndex: 8n,
      }),
    });
  });

  test("second ensure with a signature stores it when pending becomes ready", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const pendingRecord = createRecord({ state: "pending" });
    const { dependencies, markReady } = createDependencies({
      findByUserIdAndEnv: async () => pendingRecord,
      findSignerAddressesForSettings: async () => ["wallet-1"],
    });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
        settingsPda: pendingRecord.settingsPda,
        signature: "sig-123",
      },
      dependencies as never
    );

    expect(response.state).toBe("ready");
    expect(markReady).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      creationSignature: "sig-123",
    });
  });

  test("ready-only resolver ignores pending rows instead of self-healing them", async () => {
    const { findReadyUserSmartAccount } = await loadServiceModule();
    const pendingRecord = createRecord({ state: "pending" });
    const { dependencies, findSignerAddressesForSettings } = createDependencies({
      findByUserIdAndEnv: async () => pendingRecord,
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

  test("ensure re-provisions when the pending settings account belongs to another wallet", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const staleRecord = createRecord({ state: "pending" });
    const nextRecord = createRecord({
      settingsPda: deriveSettingsPdaAddress({
        programId: configuredProgramId,
        accountIndex: 8n,
      }),
    });
    const nextUpsertPending = mock(async () => nextRecord);
    const { dependencies, markReady } = createDependencies({
      findByUserIdAndEnv: async () => staleRecord,
      findSignerAddressesForSettings: async () => ["wallet-other"],
      upsertPending: nextUpsertPending,
    });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response.state).toBe("pending");
    expect(response.settingsPda).toBe(nextRecord.settingsPda);
    expect(markReady).not.toHaveBeenCalled();
    expect(nextUpsertPending).toHaveBeenCalledWith({
      userId: "user-1",
      solanaEnv: "devnet",
      settingsPda: nextRecord.settingsPda,
    });
  });

  test("ensure retries reservation when the candidate settings PDA is already reserved", async () => {
    const { ensureUserSmartAccount } = await loadServiceModule();
    const conflictError = new Error("duplicate key value violates unique constraint");
    let fetchCalls = 0;
    let upsertCalls = 0;
    const retryingFetchProgramConfig = mock(async () => ({
      smartAccountIndex: {
        toString: () => `${8 + fetchCalls++}`,
      },
      treasury,
    }));
    const retryingUpsertPending = mock(async (input: {
      userId: string;
      solanaEnv: "devnet";
      settingsPda: string;
    }) => {
      if (upsertCalls++ === 0) {
        throw conflictError;
      }

      return createRecord({
        settingsPda: input.settingsPda,
        state: "pending",
      });
    });
    const { dependencies } = createDependencies({
      fetchProgramConfig: retryingFetchProgramConfig,
      upsertPending: retryingUpsertPending,
      isSettingsReservationConflict: (error: unknown) => error === conflictError,
    });

    const response = await ensureUserSmartAccount(
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
      dependencies as never
    );

    expect(response.state).toBe("pending");
    expect(retryingFetchProgramConfig).toHaveBeenCalledTimes(2);
    expect(retryingUpsertPending).toHaveBeenCalledTimes(2);
  });
});
