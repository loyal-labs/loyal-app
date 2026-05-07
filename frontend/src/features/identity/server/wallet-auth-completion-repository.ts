import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import {
  appWalletAuthCompletions,
  type AppWalletAuthCompletion,
  type AppWalletAuthProvisioningOutcome,
  type AppUserSmartAccountSolanaEnv,
} from "@loyal-labs/db-core/schema";

import { getDatabase } from "@/lib/core/database";

export type WalletAuthCompletionRecord = Pick<
  AppWalletAuthCompletion,
  | "id"
  | "challengeHash"
  | "walletAddress"
  | "solanaEnv"
  | "state"
  | "processingToken"
  | "processingStartedAt"
  | "userId"
  | "smartAccountAddress"
  | "provisioningOutcome"
  | "lastErrorCode"
  | "lastErrorMessage"
  | "completedAt"
  | "createdAt"
  | "updatedAt"
>;

type WalletAuthCompletionRepositoryDependencies = {
  now: () => Date;
};

export type WalletAuthCompletionLease =
  | { kind: "owned"; record: WalletAuthCompletionRecord }
  | { kind: "completed"; record: WalletAuthCompletionRecord }
  | { kind: "failed"; record: WalletAuthCompletionRecord }
  | { kind: "in_progress"; record: WalletAuthCompletionRecord };

function createRepositoryDependencies(): WalletAuthCompletionRepositoryDependencies {
  return {
    now: () => new Date(),
  };
}

export async function findWalletAuthCompletionByChallengeHash(
  challengeHash: string
): Promise<WalletAuthCompletionRecord | null> {
  const db = getDatabase();

  return (
    (await db.query.appWalletAuthCompletions.findFirst({
      where: eq(appWalletAuthCompletions.challengeHash, challengeHash),
    })) ?? null
  );
}

function classifyWalletAuthCompletionRecord(args: {
  record: WalletAuthCompletionRecord;
  processingToken: string;
}): WalletAuthCompletionLease {
  if (args.record.state === "completed") {
    return {
      kind: "completed",
      record: args.record,
    };
  }

  if (args.record.state === "failed") {
    return {
      kind: "failed",
      record: args.record,
    };
  }

  if (args.record.processingToken === args.processingToken) {
    return {
      kind: "owned",
      record: args.record,
    };
  }

  return {
    kind: "in_progress",
    record: args.record,
  };
}

export async function beginWalletAuthCompletion(
  input: {
    challengeHash: string;
    walletAddress: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    processingToken: string;
    staleBefore: Date;
  },
  dependencies: WalletAuthCompletionRepositoryDependencies = createRepositoryDependencies()
): Promise<WalletAuthCompletionLease> {
  const db = getDatabase();
  const now = dependencies.now();

  await db
    .insert(appWalletAuthCompletions)
    .values({
      challengeHash: input.challengeHash,
      walletAddress: input.walletAddress,
      solanaEnv: input.solanaEnv,
      state: "processing",
      processingToken: input.processingToken,
      processingStartedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  let record = await findWalletAuthCompletionByChallengeHash(input.challengeHash);
  if (!record) {
    throw new Error("Failed to create wallet auth completion record");
  }

  if (
    record.state === "processing" &&
    record.processingToken !== input.processingToken &&
    (!record.processingStartedAt ||
      record.processingStartedAt.getTime() <= input.staleBefore.getTime())
  ) {
    const staleStartedAtClause = record.processingStartedAt
      ? eq(appWalletAuthCompletions.processingStartedAt, record.processingStartedAt)
      : isNull(appWalletAuthCompletions.processingStartedAt);

      const takeover = await db
        .update(appWalletAuthCompletions)
        .set({
          processingToken: input.processingToken,
          processingStartedAt: now,
          updatedAt: now,
          lastErrorCode: null,
          lastErrorMessage: null,
        })
        .where(
          and(
            eq(appWalletAuthCompletions.challengeHash, input.challengeHash),
            eq(appWalletAuthCompletions.state, "processing"),
            staleStartedAtClause
          )
        )
        .returning();

    if (takeover[0]) {
      record = takeover[0];
    } else {
      record =
        (await findWalletAuthCompletionByChallengeHash(input.challengeHash)) ??
        record;
    }
  }

  return classifyWalletAuthCompletionRecord({
    record,
    processingToken: input.processingToken,
  });
}

export async function markWalletAuthCompletionCompleted(
  input: {
    challengeHash: string;
    processingToken: string;
    userId: string;
    smartAccountAddress: string;
    provisioningOutcome: AppWalletAuthProvisioningOutcome;
  },
  dependencies: WalletAuthCompletionRepositoryDependencies = createRepositoryDependencies()
): Promise<WalletAuthCompletionRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appWalletAuthCompletions)
    .set({
      state: "completed",
      processingToken: null,
      processingStartedAt: null,
      userId: input.userId,
      smartAccountAddress: input.smartAccountAddress,
      provisioningOutcome: input.provisioningOutcome,
      lastErrorCode: null,
      lastErrorMessage: null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(appWalletAuthCompletions.challengeHash, input.challengeHash),
        eq(appWalletAuthCompletions.processingToken, input.processingToken)
      )
    )
    .returning();

  if (!result[0]) {
    throw new Error("Failed to mark wallet auth completion completed");
  }

  return result[0];
}

export async function markWalletAuthCompletionFailed(
  input: {
    challengeHash: string;
    processingToken: string;
    errorCode: string;
    errorMessage: string;
    userId?: string;
  },
  dependencies: WalletAuthCompletionRepositoryDependencies = createRepositoryDependencies()
): Promise<WalletAuthCompletionRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appWalletAuthCompletions)
    .set({
      state: "failed",
      processingToken: null,
      processingStartedAt: null,
      ...(input.userId ? { userId: input.userId } : {}),
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(appWalletAuthCompletions.challengeHash, input.challengeHash),
        eq(appWalletAuthCompletions.processingToken, input.processingToken)
      )
    )
    .returning();

  if (!result[0]) {
    throw new Error("Failed to mark wallet auth completion failed");
  }

  return result[0];
}
