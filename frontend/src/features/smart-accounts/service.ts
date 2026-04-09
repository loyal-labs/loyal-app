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
    settingsPda: string;
  }) => Promise<ServiceRecord>;
  markReady: (input: {
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    creationSignature?: string | null;
  }) => Promise<ServiceRecord>;
  markFailed: (input: {
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
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
}): SmartAccountSummary {
  return {
    programId: args.programId,
    settingsPda: args.settingsPda,
    smartAccountAddress: deriveCanonicalSmartAccountAddress({
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
    /DEPLOYMENT_PK is not set/i.test(args.error.message)
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
  if (args.record.state === "ready") {
    return { kind: "ready", record: args.record };
  }

  const signerAddresses = await args.dependencies.findSignerAddressesForSettings({
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

  return {
    kind: "ready",
    record: await args.dependencies.markReady({
      userId: args.record.userId,
      solanaEnv: args.record.solanaEnv,
      creationSignature: args.record.creationSignature ?? undefined,
    }),
  };
}

async function reserveProvisioningRecord(args: {
  userId: string;
  solanaEnv: AppUserSmartAccountSolanaEnv;
  programId: string;
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
    const nextSettingsPda = deriveSettingsPdaAddress({
      programId: args.programId,
      accountIndex: toBigInt(programConfig.smartAccountIndex),
    });

    try {
      const record = await args.dependencies.reserveProvisioning({
        userId: args.userId,
        solanaEnv: args.solanaEnv,
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
  let signature: string | null = null;

  try {
    signature = await args.dependencies.createSmartAccount({
      solanaEnv: args.record.solanaEnv,
      programId: args.programId,
      settingsPda: args.record.settingsPda,
      treasury: args.treasury,
      walletAddress: args.walletAddress,
    });

    return await args.dependencies.markReady({
      userId: args.record.userId,
      solanaEnv: args.record.solanaEnv,
      creationSignature: signature,
    });
  } catch (error) {
    const reconciledRecord = await maybePromoteRecord({
      record: args.record,
      programId: args.programId,
      walletAddress: args.walletAddress,
      dependencies: args.dependencies,
    });

    if (reconciledRecord.kind === "ready") {
      return reconciledRecord.record;
    }

    const failure = toFailure({ error });
    await args.dependencies.markFailed({
      userId: args.record.userId,
      solanaEnv: args.record.solanaEnv,
      errorCode: failure.code,
      errorMessage: failure.message,
      ...(signature ? { creationSignature: signature } : {}),
    });
    throw failure;
  }
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

  if (existingRecord?.state === "ready") {
    return {
      smartAccount: toSummary({
        programId,
        settingsPda: existingRecord.settingsPda,
        creationSignature: existingRecord.creationSignature,
      }),
      provisioningOutcome: "existing_ready",
    };
  }

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
        provisioningOutcome: "reconciled_ready",
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

  const reservation = await reserveProvisioningRecord({
    userId: args.userId,
    solanaEnv,
    programId,
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
    provisioningOutcome: "sponsored_new_record",
  };
}

export async function findReadyUserSmartAccount(
  args: {
    userId: string;
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

  return toSummary({
    programId,
    settingsPda: existingRecord.settingsPda,
    creationSignature: existingRecord.creationSignature,
  });
}
