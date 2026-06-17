import "server-only";

import {
  heliusWebhookAddresses,
  heliusWebhookDeliveries,
} from "@loyal-labs/db-core/schema";
import { and, eq, inArray } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { sendPushToWallet } from "@/lib/push-notifications/send-to-wallet";

import { resolveMintMetadata } from "./mint-metadata";
import type { ProcessDeps } from "./webhook-handler";

/**
 * Returns the real-deps implementation of the webhook handler's
 * injected interface. The handler itself is mockable; this is the
 * adapter that hits the database and reuses platform helpers.
 */
export function buildWebhookDeps(): ProcessDeps {
  return {
    async lookupWalletsForAddresses(addresses) {
      const out = new Map<string, string>();
      if (addresses.length === 0) return out;
      const db = getDatabase();
      const rows = await db
        .select({
          address: heliusWebhookAddresses.address,
          walletPublicKey: heliusWebhookAddresses.walletPublicKey,
        })
        .from(heliusWebhookAddresses)
        .where(inArray(heliusWebhookAddresses.address, addresses));
      for (const row of rows) {
        out.set(row.address, row.walletPublicKey);
      }
      return out;
    },

    async isDelivered(signature, walletPublicKey) {
      const db = getDatabase();
      const rows = await db
        .select({ signature: heliusWebhookDeliveries.signature })
        .from(heliusWebhookDeliveries)
        .where(
          and(
            eq(heliusWebhookDeliveries.signature, signature),
            eq(heliusWebhookDeliveries.walletPublicKey, walletPublicKey),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async recordDelivery(signature, walletPublicKey) {
      const db = getDatabase();
      await db
        .insert(heliusWebhookDeliveries)
        .values({ signature, walletPublicKey })
        .onConflictDoNothing();
    },

    async resolveMintMetadata(mints) {
      return resolveMintMetadata(mints);
    },

    async sendPushToWallet(walletPublicKey, payload) {
      return sendPushToWallet(walletPublicKey, payload);
    },
  };
}
