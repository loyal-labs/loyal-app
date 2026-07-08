import "server-only";

import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import {
  appSmartAccountSettingsChangeRequests,
  appSmartAccountSigners,
  type AppSmartAccountSettingsChangeAction,
  type AppSmartAccountSettingsChangeRequest,
  type AppSmartAccountSettingsChangeRequestStatus,
  type AppSmartAccountSigner,
  appUserSmartAccounts,
  type AppUserSmartAccount,
  type AppUserSmartAccountSolanaEnv,
  type AppUserSmartAccountState,
} from "@loyal-labs/db-core/schema";

import { getDatabase } from "@/lib/core/database";

type SmartAccountRepositoryRecord = Pick<
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

export type AppUserSmartAccountRecord = SmartAccountRepositoryRecord;

type SmartAccountSettingsChangeRequestRepositoryRecord = Pick<
  AppSmartAccountSettingsChangeRequest,
  | "id"
  | "solanaEnv"
  | "smartAccountAddress"
  | "settingsPda"
  | "signerAddress"
  | "scope"
  | "action"
  | "status"
  | "idempotencyKey"
  | "requestedByUserId"
  | "transactionIndex"
  | "signature"
  | "submittedAt"
  | "confirmedSlot"
  | "confirmedAt"
  | "errorCode"
  | "errorMessage"
  | "createdAt"
  | "updatedAt"
>;

export type AppSmartAccountSettingsChangeRequestRecord =
  SmartAccountSettingsChangeRequestRepositoryRecord;

type SmartAccountSignerRepositoryRecord = Pick<
  AppSmartAccountSigner,
  | "id"
  | "solanaEnv"
  | "smartAccountAddress"
  | "settingsPda"
  | "signerAddress"
  | "scope"
  | "state"
  | "permissionMask"
  | "sourceSignature"
  | "sourceSlot"
  | "activatedAt"
  | "removedAt"
  | "lastCheckedAt"
  | "userId"
  | "createdAt"
  | "updatedAt"
>;

export type AppSmartAccountSignerRecord = SmartAccountSignerRepositoryRecord;

type AppUserSmartAccountRepositoryDependencies = {
  now: () => Date;
};

export class AppUserSmartAccountSettingsConflictError extends Error {
  constructor() {
    super(
      "Smart account settings PDA is already reserved for this environment."
    );
    this.name = "AppUserSmartAccountSettingsConflictError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const record = error as Error & { code?: string };
  return (
    record.code === "23505" ||
    /duplicate key|unique constraint/i.test(record.message)
  );
}

function createRepositoryDependencies(): AppUserSmartAccountRepositoryDependencies {
  return {
    now: () => new Date(),
  };
}

export async function findAppUserSmartAccountByUserIdAndEnv(
  userId: string,
  solanaEnv: AppUserSmartAccountSolanaEnv
): Promise<AppUserSmartAccountRecord | null> {
  const db = getDatabase();

  return (
    (await db.query.appUserSmartAccounts.findFirst({
      where: and(
        eq(appUserSmartAccounts.userId, userId),
        eq(appUserSmartAccounts.solanaEnv, solanaEnv)
      ),
    })) ?? null
  );
}

export async function listStaleAppUserSmartAccounts(args: {
  limit: number;
  staleBefore: Date;
  states?: AppUserSmartAccountState[];
}): Promise<AppUserSmartAccountRecord[]> {
  const db = getDatabase();

  return db.query.appUserSmartAccounts.findMany({
    where: and(
      inArray(
        appUserSmartAccounts.state,
        args.states ?? ["provisioning", "failed"]
      ),
      lte(appUserSmartAccounts.updatedAt, args.staleBefore)
    ),
    orderBy: asc(appUserSmartAccounts.updatedAt),
    limit: args.limit,
  });
}

export async function reserveProvisioningAppUserSmartAccount(
  input: {
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    replaceRecordId?: string;
    replaceSettingsPda?: string;
    settingsPda: string;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppUserSmartAccountRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  try {
    const insertResult = await db
      .insert(appUserSmartAccounts)
      .values({
        userId: input.userId,
        solanaEnv: input.solanaEnv,
        settingsPda: input.settingsPda,
        state: "provisioning",
        creationSignature: null,
        lastCheckedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [appUserSmartAccounts.userId, appUserSmartAccounts.solanaEnv],
      })
      .returning();

    if (insertResult[0]) {
      return insertResult[0];
    }

    const existing = await findAppUserSmartAccountByUserIdAndEnv(
      input.userId,
      input.solanaEnv
    );
    if (!existing) {
      throw new Error("Failed to reserve app user smart account provisioning");
    }

    if (!input.replaceRecordId || !input.replaceSettingsPda) {
      if (existing.state === "provisioning" || existing.state === "ready") {
        return existing;
      }
      throw new Error(
        "Smart account provisioning reservation already exists and was not replaceable"
      );
    }

    const updateResult = await db
      .update(appUserSmartAccounts)
      .set({
        settingsPda: input.settingsPda,
        state: "provisioning",
        creationSignature: null,
        lastCheckedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(appUserSmartAccounts.id, input.replaceRecordId),
          eq(appUserSmartAccounts.userId, input.userId),
          eq(appUserSmartAccounts.solanaEnv, input.solanaEnv),
          eq(appUserSmartAccounts.settingsPda, input.replaceSettingsPda)
        )
      )
      .returning();

    if (!updateResult[0]) {
      throw new Error(
        "Smart account provisioning reservation was superseded before it could be replaced"
      );
    }

    return updateResult[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppUserSmartAccountSettingsConflictError();
    }

    throw error;
  }
}

export async function markAppUserSmartAccountReady(
  input: {
    id: string;
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    settingsPda: string;
    creationSignature?: string | null;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppUserSmartAccountRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appUserSmartAccounts)
    .set({
      state: "ready",
      ...(input.creationSignature !== undefined
        ? { creationSignature: input.creationSignature }
        : {}),
      lastCheckedAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(appUserSmartAccounts.id, input.id),
        eq(appUserSmartAccounts.userId, input.userId),
        eq(appUserSmartAccounts.solanaEnv, input.solanaEnv),
        eq(appUserSmartAccounts.settingsPda, input.settingsPda)
      )
    )
    .returning();

  if (!result[0]) {
    throw new Error(
      "Smart account provisioning reservation was superseded before it could be marked ready"
    );
  }

  return result[0];
}

export async function markAppUserSmartAccountFailed(
  input: {
    id: string;
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    settingsPda: string;
    errorCode: string;
    errorMessage: string;
    creationSignature?: string | null;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppUserSmartAccountRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appUserSmartAccounts)
    .set({
      state: "failed",
      ...(input.creationSignature !== undefined
        ? { creationSignature: input.creationSignature }
        : {}),
      lastCheckedAt: now,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      updatedAt: now,
    })
    .where(
      and(
        eq(appUserSmartAccounts.id, input.id),
        eq(appUserSmartAccounts.userId, input.userId),
        eq(appUserSmartAccounts.solanaEnv, input.solanaEnv),
        eq(appUserSmartAccounts.settingsPda, input.settingsPda)
      )
    )
    .returning();

  if (!result[0]) {
    throw new Error(
      "Smart account provisioning reservation was superseded before it could be marked failed"
    );
  }

  return result[0];
}

export async function upsertDraftSmartAccountSettingsChangeRequest(
  input: {
    solanaEnv: AppUserSmartAccountSolanaEnv;
    smartAccountAddress: string;
    settingsPda: string;
    signerAddress: string;
    action: AppSmartAccountSettingsChangeAction;
    idempotencyKey: string;
    requestedByUserId?: string | null;
    transactionIndex?: string | bigint | null;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppSmartAccountSettingsChangeRequestRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .insert(appSmartAccountSettingsChangeRequests)
    .values({
      solanaEnv: input.solanaEnv,
      smartAccountAddress: input.smartAccountAddress,
      settingsPda: input.settingsPda,
      signerAddress: input.signerAddress,
      scope: "root_settings",
      action: input.action,
      status: "draft",
      idempotencyKey: input.idempotencyKey,
      requestedByUserId: input.requestedByUserId ?? null,
      transactionIndex: input.transactionIndex?.toString() ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        appSmartAccountSettingsChangeRequests.solanaEnv,
        appSmartAccountSettingsChangeRequests.idempotencyKey,
      ],
      set: {
        updatedAt: now,
      },
    })
    .returning();

  if (!result[0]) {
    throw new Error("Failed to upsert smart account settings change request");
  }

  return result[0];
}

export async function markSmartAccountSettingsChangeRequestSubmitted(
  input: {
    id: string;
    signature?: string | null;
    transactionIndex?: string | bigint | null;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppSmartAccountSettingsChangeRequestRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appSmartAccountSettingsChangeRequests)
    .set({
      status: "submitted",
      signature: input.signature ?? null,
      transactionIndex: input.transactionIndex?.toString() ?? null,
      submittedAt: now,
      updatedAt: now,
      errorCode: null,
      errorMessage: null,
    })
    .where(eq(appSmartAccountSettingsChangeRequests.id, input.id))
    .returning();

  if (!result[0]) {
    throw new Error("Failed to mark smart account settings change submitted");
  }

  return result[0];
}

export async function markSmartAccountSettingsChangeRequestConfirmed(
  input: {
    id: string;
    signature?: string | null;
    confirmedSlot?: bigint | number | null;
    status?: Extract<
      AppSmartAccountSettingsChangeRequestStatus,
      "confirmed" | "superseded"
    >;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppSmartAccountSettingsChangeRequestRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appSmartAccountSettingsChangeRequests)
    .set({
      status: input.status ?? "confirmed",
      ...(input.signature !== undefined ? { signature: input.signature } : {}),
      confirmedSlot:
        input.confirmedSlot == null ? null : BigInt(input.confirmedSlot),
      confirmedAt: now,
      updatedAt: now,
      errorCode: null,
      errorMessage: null,
    })
    .where(eq(appSmartAccountSettingsChangeRequests.id, input.id))
    .returning();

  if (!result[0]) {
    throw new Error("Failed to mark smart account settings change confirmed");
  }

  return result[0];
}

export async function markSmartAccountSettingsChangeRequestFailed(
  input: {
    id: string;
    errorCode: string;
    errorMessage: string;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppSmartAccountSettingsChangeRequestRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appSmartAccountSettingsChangeRequests)
    .set({
      status: "failed",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      updatedAt: now,
    })
    .where(eq(appSmartAccountSettingsChangeRequests.id, input.id))
    .returning();

  if (!result[0]) {
    throw new Error("Failed to mark smart account settings change failed");
  }

  return result[0];
}

export async function findActiveRootSmartAccountSignerMemberships(input: {
  solanaEnv: AppUserSmartAccountSolanaEnv;
  signerAddress: string;
}): Promise<AppSmartAccountSignerRecord[]> {
  const db = getDatabase();

  return db.query.appSmartAccountSigners.findMany({
    where: and(
      eq(appSmartAccountSigners.solanaEnv, input.solanaEnv),
      eq(appSmartAccountSigners.signerAddress, input.signerAddress),
      eq(appSmartAccountSigners.scope, "root_settings"),
      eq(appSmartAccountSigners.state, "active")
    ),
    orderBy: [
      desc(appSmartAccountSigners.sourceSlot),
      desc(appSmartAccountSigners.updatedAt),
      desc(appSmartAccountSigners.settingsPda),
    ],
  });
}

export async function upsertActiveRootSmartAccountSigner(
  input: {
    solanaEnv: AppUserSmartAccountSolanaEnv;
    smartAccountAddress: string;
    settingsPda: string;
    signerAddress: string;
    permissionMask?: number | null;
    sourceSignature?: string | null;
    sourceSlot?: bigint | number | null;
    userId?: string | null;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppSmartAccountSignerRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .insert(appSmartAccountSigners)
    .values({
      solanaEnv: input.solanaEnv,
      smartAccountAddress: input.smartAccountAddress,
      settingsPda: input.settingsPda,
      signerAddress: input.signerAddress,
      scope: "root_settings",
      state: "active",
      permissionMask: input.permissionMask ?? null,
      sourceSignature: input.sourceSignature ?? null,
      sourceSlot: input.sourceSlot == null ? null : BigInt(input.sourceSlot),
      activatedAt: now,
      removedAt: null,
      lastCheckedAt: now,
      userId: input.userId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        appSmartAccountSigners.solanaEnv,
        appSmartAccountSigners.settingsPda,
        appSmartAccountSigners.scope,
        appSmartAccountSigners.signerAddress,
      ],
      set: {
        smartAccountAddress: input.smartAccountAddress,
        state: "active",
        permissionMask: input.permissionMask ?? null,
        sourceSignature: input.sourceSignature ?? null,
        sourceSlot: input.sourceSlot == null ? null : BigInt(input.sourceSlot),
        removedAt: null,
        lastCheckedAt: now,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        updatedAt: now,
      },
    })
    .returning();

  if (!result[0]) {
    throw new Error("Failed to upsert smart account signer");
  }

  return result[0];
}

export async function markRootSmartAccountSignerRemoved(
  input: {
    solanaEnv: AppUserSmartAccountSolanaEnv;
    settingsPda: string;
    signerAddress: string;
    sourceSignature?: string | null;
    sourceSlot?: bigint | number | null;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppSmartAccountSignerRecord | null> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appSmartAccountSigners)
    .set({
      state: "removed",
      sourceSignature: input.sourceSignature ?? null,
      sourceSlot: input.sourceSlot == null ? null : BigInt(input.sourceSlot),
      removedAt: now,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(appSmartAccountSigners.solanaEnv, input.solanaEnv),
        eq(appSmartAccountSigners.settingsPda, input.settingsPda),
        eq(appSmartAccountSigners.scope, "root_settings"),
        eq(appSmartAccountSigners.signerAddress, input.signerAddress)
      )
    )
    .returning();

  return result[0] ?? null;
}

export async function linkRootSmartAccountSignerToUser(
  input: {
    solanaEnv: AppUserSmartAccountSolanaEnv;
    settingsPda: string;
    signerAddress: string;
    userId: string;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppSmartAccountSignerRecord | null> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appSmartAccountSigners)
    .set({
      userId: input.userId,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(appSmartAccountSigners.solanaEnv, input.solanaEnv),
        eq(appSmartAccountSigners.settingsPda, input.settingsPda),
        eq(appSmartAccountSigners.scope, "root_settings"),
        eq(appSmartAccountSigners.signerAddress, input.signerAddress),
        eq(appSmartAccountSigners.state, "active")
      )
    )
    .returning();

  return result[0] ?? null;
}
