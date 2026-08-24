import "server-only";

import { and, desc, eq } from "drizzle-orm";

import {
  earnActivityEvents,
  getYieldOptimizationClient,
  type EarnActivityEventType,
} from "./yield-neon-client.server";

type EarnActivityEventRow = typeof earnActivityEvents.$inferSelect;

export type EarnLifecycleActivityEventRecord = {
  actionType: EarnActivityEventType;
  amountRaw: bigint;
  confirmedAt: Date;
  confirmedSlot: bigint;
  id: string;
  metadata: Record<string, unknown>;
  signature: string;
  type: "earn_lifecycle_action";
};

type EarnActivityRepositoryDependencies = {
  loadRows: () => Promise<EarnActivityEventRow[]>;
};

function mapEarnActivityEvent(
  row: EarnActivityEventRow
): EarnLifecycleActivityEventRecord {
  return {
    actionType: row.eventType,
    amountRaw: BigInt(0),
    confirmedAt: row.eventAt,
    confirmedSlot: row.eventSlot,
    id: `earn-activity:${row.id.toString()}`,
    metadata: row.metadata,
    signature: row.signature,
    type: "earn_lifecycle_action",
  };
}

export async function findEarnActivityEventsForVault(
  input: {
    cluster: string;
    settings: string;
    vaultIndex: 1;
    walletAddress: string;
  },
  dependencies?: EarnActivityRepositoryDependencies
): Promise<EarnLifecycleActivityEventRecord[]> {
  const loadRows =
    dependencies?.loadRows ??
    (() => {
      const client = getYieldOptimizationClient();
      return client.db
        .select()
        .from(earnActivityEvents)
        .where(
          and(
            eq(earnActivityEvents.cluster, input.cluster),
            eq(earnActivityEvents.settings, input.settings),
            eq(earnActivityEvents.vaultIndex, input.vaultIndex),
            eq(earnActivityEvents.walletAddress, input.walletAddress)
          )
        )
        .orderBy(
          desc(earnActivityEvents.eventAt),
          desc(earnActivityEvents.eventSlot),
          desc(earnActivityEvents.id)
        );
    });

  return (await loadRows()).map(mapEarnActivityEvent);
}
