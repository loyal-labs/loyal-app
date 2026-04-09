import "server-only";

import { findAppUserById } from "@/features/chat/server/app-user";

import {
  ensureWalletUserSmartAccount,
  listRecoverableSmartAccountRecords,
} from "./service";

export type SmartAccountReconcilerResult = {
  scanned: number;
  repaired: number;
  failed: number;
  skipped: number;
};

export async function reconcileRecoverableSmartAccounts(args?: {
  limit?: number;
  staleBefore?: Date;
}): Promise<SmartAccountReconcilerResult> {
  const staleBefore =
    args?.staleBefore ?? new Date(Date.now() - 5 * 60 * 1000);
  const limit = args?.limit ?? 25;
  const records = await listRecoverableSmartAccountRecords({
    limit,
    staleBefore,
  });

  let repaired = 0;
  let failed = 0;
  let skipped = 0;

  for (const record of records) {
    const user = await findAppUserById(record.userId);
    if (!user) {
      skipped += 1;
      console.warn("[smart-accounts] skipping reconciliation for missing user", {
        userId: record.userId,
        smartAccountRecordId: record.id,
      });
      continue;
    }

    try {
      await ensureWalletUserSmartAccount({
        userId: user.id,
        walletAddress: user.subjectAddress,
      });
      repaired += 1;
    } catch (error) {
      failed += 1;
      console.error("[smart-accounts] reconciliation failed", {
        userId: user.id,
        smartAccountRecordId: record.id,
        state: record.state,
        error,
      });
    }
  }

  return {
    scanned: records.length,
    repaired,
    failed,
    skipped,
  };
}
