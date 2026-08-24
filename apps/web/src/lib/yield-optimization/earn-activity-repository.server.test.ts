import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { findEarnActivityEventsForVault } = await import(
  "./earn-activity-repository.server"
);

describe("Earn activity repository", () => {
  test("returns every immutable lifecycle event without rebuilding state history", async () => {
    const eventAt = new Date("2026-08-24T07:00:00.000Z");
    const eventTypes = [
      "autodeposit_created",
      "autodeposit_closed",
      "autoswap_created",
      "autoswap_closed",
    ] as const;

    const events = await findEarnActivityEventsForVault(
      {
        cluster: "mainnet-beta",
        settings: "settings",
        vaultIndex: 1,
        walletAddress: "wallet",
      },
      {
        loadRows: async () =>
          eventTypes.map((eventType, index) => ({
            authority: "authority",
            cluster: "mainnet-beta",
            createdAt: eventAt,
            entityKey: `${eventType}-entity`,
            entityKind: eventType.startsWith("auto") ? "policy" : "unknown",
            eventAt,
            eventSlot: BigInt(100 + index),
            eventType,
            id: BigInt(index + 1),
            idempotencyKey: `${eventType}-key`,
            instructionIndex: index,
            metadata: { source: "finalized_chain" },
            settings: "settings",
            signature: `${eventType}-signature`,
            vaultIndex: 1,
            vaultPubkey: "vault",
            walletAddress: "wallet",
          })),
      }
    );

    expect(events.map((event) => event.actionType)).toEqual([...eventTypes]);
    expect(events.map((event) => event.signature)).toEqual(
      eventTypes.map((eventType) => `${eventType}-signature`)
    );
    expect(
      events.every((event) => event.type === "earn_lifecycle_action")
    ).toBe(true);
  });
});
