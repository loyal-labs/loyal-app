import { PublicKey } from "@solana/web3.js";
import type {
  AppUserSmartAccount,
  AppUserSmartAccountSolanaEnv,
  AppWalletAuthProvisioningOutcome,
} from "@loyal-labs/db-core/schema";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import {
  deriveCanonicalSmartAccountAddress,
  deriveSettingsPdaAddress,
} from "@/features/smart-accounts/derivation";

type ServiceRecord = Pick<
  AppUserSmartAccount,
  | "id"
  | "userId"
  | "solanaEnv"
  | "settingsPda"
  | "state"
  | "creationSignature"
  | "lastCheckedAt"
  | "lastErrorCode"
  | "lastErrorMessage"
  | "createdAt"
  | "updatedAt"
>;

type PendingRecordResolution =
  | { kind: "missing" }
  | { kind: "owner_mismatch" }
  | { kind: "ready"; record: ServiceRecord };

type RootSignerMembershipRecord = {
  id: string;
  solanaEnv: AppUserSmartAccountSolanaEnv;
  settingsPda: string;
  smartAccountAddress: string;
  signerAddress: string;
  permissionMask: number | null;
  sourceSignature: string | null;
  sourceSlot: bigint | null;
  updatedAt: Date;
};

export type SmartAccountProvisioningOutcome = AppWalletAuthProvisioningOutcome;

export type SmartAccountSummary = {
  programId: string;
  settingsPda: string;
  smartAccountAddress: string;
  creationSignature: string | null;
};

export type EnsureUserSmartAccountResult = {
  smartAccount: SmartAccountSummary;
  provisioningOutcome: SmartAccountProvisioningOutcome;
};

export type SmartAccountServiceDependencies = {
  getCurrentConfig: () => {
    solanaEnv: SolanaEnv;
    programId: string;
  };
  findByUserIdAndEnv: (
    userId: string,
    solanaEnv: AppUserSmartAccountSolanaEnv
  ) => Promise<ServiceRecord | null>;
  reserveProvisioning: (input: {
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    replaceRecordId?: string;
    replaceSettingsPda?: string;
    settingsPda: string;
  }) => Promise<ServiceRecord>;
  markReady: (input: {
    id: string;
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    settingsPda: string;
    creationSignature?: string | null;
  }) => Promise<ServiceRecord>;
  markFailed: (input: {
    id: string;
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    settingsPda: string;
    errorCode: string;
    errorMessage: string;
    creationSignature?: string | null;
  }) => Promise<ServiceRecord>;
  fetchProgramConfig: (input: {
    solanaEnv: SolanaEnv;
    programId: string;
  }) => Promise<{
    smartAccountIndex: { toString(): string };
    treasury: PublicKey;
  }>;
  createSmartAccount: (input: {
    solanaEnv: SolanaEnv;
    programId: string;
    settingsPda: string;
    treasury: PublicKey;
    walletAddress: string;
  }) => Promise<string>;
  findSignerAddressesForSettings: (input: {
    solanaEnv: SolanaEnv;
    programId: string;
    settingsPda: string;
  }) => Promise<string[] | null>;
  findActiveRootSignerMemberships: (input: {
    solanaEnv: AppUserSmartAccountSolanaEnv;
    signerAddress: string;
  }) => Promise<RootSignerMembershipRecord[]>;
  fetchRootSettingsSigners: (input: {
    solanaEnv: SolanaEnv;
    programId: string;
    settingsPda: string;
  }) => Promise<Array<{ address: string; permissionMask: number }> | null>;
  recordActiveRootSignerMembership: (input: {
    solanaEnv: AppUserSmartAccountSolanaEnv;
    smartAccountAddress: string;
    settingsPda: string;
    signerAddress: string;
    permissionMask?: number | null;
    sourceSignature?: string | null;
    sourceSlot?: bigint | number | null;
    userId?: string | null;
  }) => Promise<RootSignerMembershipRecord>;
  markRootSignerRemoved: (input: {
    solanaEnv: AppUserSmartAccountSolanaEnv;
    settingsPda: string;
    signerAddress: string;
  }) => Promise<RootSignerMembershipRecord | null>;
  isSettingsReservationConflict: (error: unknown) => boolean;
};

export class SmartAccountProvisioningError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(args: { code: string; message: string; status?: number }) {
    super(args.message);
    this.name = "SmartAccountProvisioningError";
    this.code = args.code;
    this.status = args.status ?? 400;
  }
}

function createSignerMismatchError(): SmartAccountProvisioningError {
  return new SmartAccountProvisioningError({
    code: "smart_account_signer_mismatch",
    message:
      "The smart account settings are no longer controlled by this wallet.",
    status: 409,
  });
}

export function isSmartAccountProvisioningError(
  error: unknown
): error is SmartAccountProvisioningError {
  return error instanceof SmartAccountProvisioningError;
}

function toBigInt(value: { toString(): string }): bigint {
  return BigInt(value.toString());
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function toSummary(args: {
  programId: string;
  settingsPda: string;
  creationSignature: string | null;
  smartAccountAddress?: string;
}): SmartAccountSummary {
  return {
    programId: args.programId,
    settingsPda: args.settingsPda,
    smartAccountAddress:
      args.smartAccountAddress ??
      deriveCanonicalSmartAccountAddress({
        programId: args.programId,
        settingsPda: args.settingsPda,
      }),
    creationSignature: args.creationSignature,
  };
}

function toFailure(args: { error: unknown }): SmartAccountProvisioningError {
  if (args.error instanceof SmartAccountProvisioningError) {
    return args.error;
  }

  if (
    args.error instanceof Error &&
    /SMART_ACCOUNT_SPONSOR_PK is not set/i.test(args.error.message)
  ) {
    return new SmartAccountProvisioningError({
      code: "smart_account_sponsor_not_configured",
      message:
        "Sponsored smart account creation is not configured on this environment.",
      status: 500,
    });
  }

  return new SmartAccountProvisioningError({
    code: "smart_account_provisioning_failed",
    message:
      args.error instanceof Error
        ? args.error.message
        : "Failed to provision the smart account.",
    status: 502,
  });
}

async function maybePromoteRecord(args: {
  record: ServiceRecord;
  programId: string;
  walletAddress: string;
  dependencies: SmartAccountServiceDependencies;
}): Promise<PendingRecordResolution> {
  const signerAddresses =
    await args.dependencies.findSignerAddressesForSettings({
      solanaEnv: args.record.solanaEnv,
      programId: args.programId,
      settingsPda: args.record.settingsPda,
    });

  if (!signerAddresses) {
    return { kind: "missing" };
  }

  if (!signerAddresses.includes(args.walletAddress)) {
    return { kind: "owner_mismatch" };
  }

  if (args.record.state === "ready") {
    return { kind: "ready", record: args.record };
  }

  return {
    kind: "ready",
    record: await args.dependencies.markReady({
      id: args.record.id,
      userId: args.record.userId,
      solanaEnv: args.record.solanaEnv,
      settingsPda: args.record.settingsPda,
      creationSignature: args.record.creationSignature ?? undefined,
    }),
  };
}

async function reserveProvisioningRecord(args: {
  userId: string;
  solanaEnv: AppUserSmartAccountSolanaEnv;
  programId: string;
  replaceRecord?: ServiceRecord;
  dependencies: SmartAccountServiceDependencies;
}): Promise<{
  record: ServiceRecord;
  treasury: PublicKey;
}> {
  let lastConflictError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const programConfig = await args.dependencies.fetchProgramConfig({
      solanaEnv: args.solanaEnv,
      programId: args.programId,
    });
    const nextAccountIndex =
      toBigInt(programConfig.smartAccountIndex) + BigInt(1);
    const nextSettingsPda = deriveSettingsPdaAddress({
      programId: args.programId,
      accountIndex: nextAccountIndex,
    });

    try {
      const record = await args.dependencies.reserveProvisioning({
        userId: args.userId,
        solanaEnv: args.solanaEnv,
        ...(args.replaceRecord
          ? {
              replaceRecordId: args.replaceRecord.id,
              replaceSettingsPda: args.replaceRecord.settingsPda,
            }
          : {}),
        settingsPda: nextSettingsPda,
      });

      return {
        record,
        treasury: programConfig.treasury,
      };
    } catch (error) {
      if (!args.dependencies.isSettingsReservationConflict(error)) {
        throw error;
      }

      lastConflictError = error;
      if (attempt < 2) {
        await wait(150 * (attempt + 1));
      }
    }
  }

  throw new SmartAccountProvisioningError({
    code: "smart_account_reservation_conflict",
    message:
      lastConflictError instanceof Error
        ? lastConflictError.message
        : "Failed to reserve a unique smart account settings PDA.",
    status: 409,
  });
}

async function sponsorRecord(args: {
  record: ServiceRecord;
  programId: string;
  walletAddress: string;
  treasury: PublicKey;
  dependencies: SmartAccountServiceDependencies;
}): Promise<ServiceRecord> {
  let record = args.record;
  let treasury = args.treasury;

  for (let attempt = 0; ; attempt += 1) {
    let signature: string | null = null;

    try {
      signature = await args.dependencies.createSmartAccount({
        solanaEnv: record.solanaEnv,
        programId: args.programId,
        settingsPda: record.settingsPda,
        treasury,
        walletAddress: args.walletAddress,
      });

      const signerAddresses =
        await args.dependencies.findSignerAddressesForSettings({
          solanaEnv: record.solanaEnv,
          programId: args.programId,
          settingsPda: record.settingsPda,
        });
      if (!signerAddresses?.includes(args.walletAddress)) {
        throw createSignerMismatchError();
      }

      return await args.dependencies.markReady({
        id: record.id,
        userId: record.userId,
        solanaEnv: record.solanaEnv,
        settingsPda: record.settingsPda,
        creationSignature: signature,
      });
    } catch (error) {
      if (
        signature &&
        error instanceof SmartAccountProvisioningError &&
        error.code === "smart_account_signer_mismatch"
      ) {
        await args.dependencies.markFailed({
          id: record.id,
          userId: record.userId,
          solanaEnv: record.solanaEnv,
          settingsPda: record.settingsPda,
          errorCode: error.code,
          errorMessage: error.message,
          creationSignature: signature,
        });
        throw error;
      }

      const reconciledRecord = await maybePromoteRecord({
        record,
        programId: args.programId,
        walletAddress: args.walletAddress,
        dependencies: args.dependencies,
      });

      if (reconciledRecord.kind === "ready") {
        return reconciledRecord.record;
      }

      // Concurrent-signup index race: another user's create landed on the
      // settings PDA this record had reserved, so our create failed and the
      // PDA now belongs to them. Reserve the next index and retry once
      // instead of surfacing a transient error to the user.
      if (reconciledRecord.kind === "owner_mismatch" && attempt === 0) {
        const reservation = await reserveProvisioningRecord({
          userId: record.userId,
          solanaEnv: record.solanaEnv,
          programId: args.programId,
          replaceRecord: record,
          dependencies: args.dependencies,
        });
        record = reservation.record;
        treasury = reservation.treasury;
        continue;
      }

      const failure = toFailure({ error });
      await args.dependencies.markFailed({
        id: record.id,
        userId: record.userId,
        solanaEnv: record.solanaEnv,
        settingsPda: record.settingsPda,
        errorCode: failure.code,
        errorMessage: failure.message,
        ...(signature ? { creationSignature: signature } : {}),
      });
      throw failure;
    }
  }
}

async function resolveDelegatedRootSignerMembership(args: {
  userId: string;
  solanaEnv: AppUserSmartAccountSolanaEnv;
  programId: string;
  walletAddress: string;
  dependencies: SmartAccountServiceDependencies;
}): Promise<SmartAccountSummary | null> {
  const memberships = await args.dependencies.findActiveRootSignerMemberships({
    solanaEnv: args.solanaEnv,
    signerAddress: args.walletAddress,
  });

  for (const membership of memberships) {
    const expectedSmartAccountAddress = deriveCanonicalSmartAccountAddress({
      programId: args.programId,
      settingsPda: membership.settingsPda,
    });

    if (membership.smartAccountAddress !== expectedSmartAccountAddress) {
      continue;
    }

    const rootSigners = await args.dependencies.fetchRootSettingsSigners({
      solanaEnv: membership.solanaEnv,
      programId: args.programId,
      settingsPda: membership.settingsPda,
    });

    const rootSigner = rootSigners?.find(
      (signer) => signer.address === args.walletAddress
    );

    if (!rootSigner) {
      await args.dependencies.markRootSignerRemoved({
        solanaEnv: membership.solanaEnv,
        settingsPda: membership.settingsPda,
        signerAddress: args.walletAddress,
      });
      continue;
    }

    await args.dependencies.recordActiveRootSignerMembership({
      solanaEnv: membership.solanaEnv,
      smartAccountAddress: membership.smartAccountAddress,
      settingsPda: membership.settingsPda,
      signerAddress: args.walletAddress,
      permissionMask: rootSigner.permissionMask,
      sourceSignature: membership.sourceSignature,
      sourceSlot: membership.sourceSlot,
      userId: args.userId,
    });

    return toSummary({
      programId: args.programId,
      settingsPda: membership.settingsPda,
      smartAccountAddress: membership.smartAccountAddress,
      creationSignature: null,
    });
  }

  return null;
}

export async function ensureUserSmartAccount(
  args: {
    userId: string;
    walletAddress: string;
  },
  dependencies: SmartAccountServiceDependencies
): Promise<EnsureUserSmartAccountResult> {
  const { solanaEnv, programId } = dependencies.getCurrentConfig();
  const existingRecord = await dependencies.findByUserIdAndEnv(
    args.userId,
    solanaEnv
  );

  if (existingRecord) {
    const reconciledRecord = await maybePromoteRecord({
      record: existingRecord,
      programId,
      walletAddress: args.walletAddress,
      dependencies,
    });

    if (reconciledRecord.kind === "ready") {
      return {
        smartAccount: toSummary({
          programId,
          settingsPda: reconciledRecord.record.settingsPda,
          creationSignature: reconciledRecord.record.creationSignature,
        }),
        provisioningOutcome:
          existingRecord.state === "ready"
            ? "existing_ready"
            : "reconciled_ready",
      };
    }

    const delegatedSmartAccount = await resolveDelegatedRootSignerMembership({
      userId: args.userId,
      solanaEnv,
      programId,
      walletAddress: args.walletAddress,
      dependencies,
    });

    if (delegatedSmartAccount) {
      return {
        smartAccount: delegatedSmartAccount,
        provisioningOutcome: "delegated_root_signer",
      };
    }

    if (reconciledRecord.kind === "missing") {
      const programConfig = await dependencies.fetchProgramConfig({
        solanaEnv,
        programId,
      });
      const readyRecord = await sponsorRecord({
        record: existingRecord,
        programId,
        walletAddress: args.walletAddress,
        treasury: programConfig.treasury,
        dependencies,
      });

      return {
        smartAccount: toSummary({
          programId,
          settingsPda: readyRecord.settingsPda,
          creationSignature: readyRecord.creationSignature,
        }),
        provisioningOutcome:
          existingRecord.state === "failed"
            ? "retried_failed_record"
            : "sponsored_existing_record",
      };
    }

    const reservation = await reserveProvisioningRecord({
      userId: args.userId,
      solanaEnv,
      programId,
      replaceRecord: existingRecord,
      dependencies,
    });
    const readyRecord = await sponsorRecord({
      record: reservation.record,
      programId,
      walletAddress: args.walletAddress,
      treasury: reservation.treasury,
      dependencies,
    });

    return {
      smartAccount: toSummary({
        programId,
        settingsPda: readyRecord.settingsPda,
        creationSignature: readyRecord.creationSignature,
      }),
      provisioningOutcome:
        existingRecord.state === "failed"
          ? "retried_failed_record"
          : "sponsored_existing_record",
    };
  }

  const delegatedSmartAccount = await resolveDelegatedRootSignerMembership({
    userId: args.userId,
    solanaEnv,
    programId,
    walletAddress: args.walletAddress,
    dependencies,
  });

  if (delegatedSmartAccount) {
    return {
      smartAccount: delegatedSmartAccount,
      provisioningOutcome: "delegated_root_signer",
    };
  }

  const reservation = await reserveProvisioningRecord({
    userId: args.userId,
    solanaEnv,
    programId,
    dependencies,
  });
  let recordForSponsorship = reservation.record;
  let treasuryForSponsorship = reservation.treasury;
  let sponsoredOutcome: SmartAccountProvisioningOutcome =
    "sponsored_new_record";

  if (reservation.record.state === "ready") {
    const reconciledRecord = await maybePromoteRecord({
      record: reservation.record,
      programId,
      walletAddress: args.walletAddress,
      dependencies,
    });

    if (reconciledRecord.kind === "ready") {
      return {
        smartAccount: toSummary({
          programId,
          settingsPda: reconciledRecord.record.settingsPda,
          creationSignature: reconciledRecord.record.creationSignature,
        }),
        provisioningOutcome: "existing_ready",
      };
    }

    const replacementReservation = await reserveProvisioningRecord({
      userId: args.userId,
      solanaEnv,
      programId,
      replaceRecord: reservation.record,
      dependencies,
    });
    recordForSponsorship = replacementReservation.record;
    treasuryForSponsorship = replacementReservation.treasury;
    sponsoredOutcome = "sponsored_existing_record";
  }

  const readyRecord = await sponsorRecord({
    record: recordForSponsorship,
    programId,
    walletAddress: args.walletAddress,
    treasury: treasuryForSponsorship,
    dependencies,
  });

  return {
    smartAccount: toSummary({
      programId,
      settingsPda: readyRecord.settingsPda,
      creationSignature: readyRecord.creationSignature,
    }),
    provisioningOutcome: sponsoredOutcome,
  };
}

export async function findReadyUserSmartAccount(
  args: {
    userId: string;
    walletAddress?: string;
  },
  dependencies: SmartAccountServiceDependencies
): Promise<SmartAccountSummary | null> {
  const { solanaEnv, programId } = dependencies.getCurrentConfig();
  const existingRecord = await dependencies.findByUserIdAndEnv(
    args.userId,
    solanaEnv
  );

  if (!existingRecord || existingRecord.state !== "ready") {
    return null;
  }

  if (args.walletAddress) {
    const signerResolution = await maybePromoteRecord({
      record: existingRecord,
      programId,
      walletAddress: args.walletAddress,
      dependencies,
    });
    if (signerResolution.kind !== "ready") {
      await dependencies.markFailed({
        id: existingRecord.id,
        userId: existingRecord.userId,
        solanaEnv: existingRecord.solanaEnv,
        settingsPda: existingRecord.settingsPda,
        errorCode: "smart_account_signer_mismatch",
        errorMessage:
          "Ready smart account settings are not controlled by this wallet.",
        creationSignature: existingRecord.creationSignature,
      });
      return null;
    }
  }

  return toSummary({
    programId,
    settingsPda: existingRecord.settingsPda,
    creationSignature: existingRecord.creationSignature,
  });
}
