import { PublicKey } from "@solana/web3.js";
import type { AppUserSmartAccountSolanaEnv } from "@loyal-labs/db-core/schema";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import type { SmartAccountProvisioningResponse } from "@/features/smart-accounts/contracts";
import {
  deriveCanonicalSmartAccountAddress,
  deriveSettingsPdaAddress,
} from "@/features/smart-accounts/derivation";

type ServiceRecord = {
  id: string;
  userId: string;
  solanaEnv: AppUserSmartAccountSolanaEnv;
  settingsPda: string;
  state: "pending" | "ready";
  creationSignature: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type PendingRecordResolution =
  | { kind: "missing" }
  | { kind: "owner_mismatch" }
  | { kind: "ready"; record: ServiceRecord };

export type SmartAccountSummary = {
  programId: string;
  settingsPda: string;
  smartAccountAddress: string;
  creationSignature: string | null;
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
  upsertPending: (input: {
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    settingsPda: string;
  }) => Promise<ServiceRecord>;
  markReady: (input: {
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    creationSignature?: string | null;
  }) => Promise<ServiceRecord>;
  fetchProgramConfig: (input: {
    solanaEnv: SolanaEnv;
    programId: string;
  }) => Promise<{
    smartAccountIndex: { toString(): string };
    treasury: PublicKey;
  }>;
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

function toProvisioningResponse(args: {
  solanaEnv: SolanaEnv;
  programId: string;
  record: ServiceRecord;
  treasury: string | null;
}): SmartAccountProvisioningResponse {
  const summary = toSummary({
    programId: args.programId,
    settingsPda: args.record.settingsPda,
    creationSignature: args.record.creationSignature,
  });

  return {
    state: args.record.state,
    solanaEnv: args.solanaEnv,
    programId: summary.programId,
    settingsPda: summary.settingsPda,
    smartAccountAddress: summary.smartAccountAddress,
    creationSignature: summary.creationSignature,
    treasury: args.treasury,
  };
}

function assertMatchingSettingsPda(
  record: ServiceRecord,
  settingsPda: string | undefined
): void {
  if (!settingsPda || record.settingsPda === settingsPda) {
    return;
  }

  throw new SmartAccountProvisioningError({
    code: "settings_pda_mismatch",
    message: "The submitted settings PDA does not match the pending record.",
    status: 409,
  });
}

async function maybePromotePendingRecord(args: {
  record: ServiceRecord;
  programId: string;
  walletAddress: string;
  creationSignature?: string | null;
  dependencies: SmartAccountServiceDependencies;
}): Promise<PendingRecordResolution> {
  if (args.record.state !== "pending") {
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
      creationSignature:
        args.creationSignature ?? args.record.creationSignature ?? undefined,
    }),
  };
}

async function reservePendingRecord(args: {
  userId: string;
  solanaEnv: AppUserSmartAccountSolanaEnv;
  programId: string;
  dependencies: SmartAccountServiceDependencies;
}): Promise<{
  record: ServiceRecord;
  treasury: string;
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
      const record = await args.dependencies.upsertPending({
        userId: args.userId,
        solanaEnv: args.solanaEnv,
        settingsPda: nextSettingsPda,
      });

      return {
        record,
        treasury: programConfig.treasury.toBase58(),
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

export async function ensureUserSmartAccount(
  args: {
    userId: string;
    walletAddress: string;
    refreshPending?: boolean;
    settingsPda?: string;
    signature?: string;
  },
  dependencies: SmartAccountServiceDependencies
): Promise<SmartAccountProvisioningResponse> {
  const { solanaEnv, programId } = dependencies.getCurrentConfig();
  const existingRecord = await dependencies.findByUserIdAndEnv(
    args.userId,
    solanaEnv
  );

  if (args.settingsPda && !existingRecord) {
    throw new SmartAccountProvisioningError({
      code: "smart_account_not_found",
      message: "No smart account provisioning record exists for this user.",
      status: 404,
    });
  }

  if (existingRecord) {
    assertMatchingSettingsPda(existingRecord, args.settingsPda);

    if (existingRecord.state === "ready") {
      if (args.signature && !existingRecord.creationSignature) {
        const updatedRecord = await dependencies.markReady({
          userId: existingRecord.userId,
          solanaEnv: existingRecord.solanaEnv,
          creationSignature: args.signature,
        });

        return toProvisioningResponse({
          solanaEnv,
          programId,
          record: updatedRecord,
          treasury: null,
        });
      }

      return toProvisioningResponse({
        solanaEnv,
        programId,
        record: existingRecord,
        treasury: null,
      });
    }

    const reconciledRecord = await maybePromotePendingRecord({
      record: existingRecord,
      programId,
      walletAddress: args.walletAddress,
      creationSignature: args.signature ?? null,
      dependencies,
    });

    if (reconciledRecord.kind === "ready") {
      return toProvisioningResponse({
        solanaEnv,
        programId,
        record: reconciledRecord.record,
        treasury: null,
      });
    }

    if (reconciledRecord.kind === "missing" && !args.refreshPending) {
      const programConfig = await dependencies.fetchProgramConfig({
        solanaEnv,
        programId,
      });

      return toProvisioningResponse({
        solanaEnv,
        programId,
        record: existingRecord,
        treasury: programConfig.treasury.toBase58(),
      });
    }
  }

  const reservation = await reservePendingRecord({
    userId: args.userId,
    solanaEnv,
    programId,
    dependencies,
  });

  return toProvisioningResponse({
    solanaEnv,
    programId,
    record: reservation.record,
    treasury: reservation.treasury,
  });
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
