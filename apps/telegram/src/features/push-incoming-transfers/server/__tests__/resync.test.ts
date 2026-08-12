import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let computeResyncDiff: typeof import("../resync").computeResyncDiff;
type DesiredAddress = import("../resync").DesiredAddress;
type CurrentAddress = import("../resync").CurrentAddress;
type WebhookCapacity = import("../resync").WebhookCapacity;

function desired(
  address: string,
  walletPublicKey: string,
  kind: DesiredAddress["kind"] = "wallet",
): DesiredAddress {
  return { address, kind, walletPublicKey };
}

function current(
  address: string,
  walletPublicKey: string,
  webhookId: string,
  kind: CurrentAddress["kind"] = "wallet",
): CurrentAddress {
  return { address, kind, walletPublicKey, webhookId };
}

function webhook(
  webhookId: string,
  heliusWebhookId: string,
  currentAddressCount: number,
): WebhookCapacity {
  return { currentAddressCount, heliusWebhookId, webhookId };
}

describe("computeResyncDiff", () => {
  beforeAll(async () => {
    ({ computeResyncDiff } = await import("../resync"));
  });

  test("desired == current produces an empty diff", () => {
    const wallet = "WalletAAA";
    const ata = "AtaA";
    const desiredSet: DesiredAddress[] = [
      desired(wallet, wallet, "wallet"),
      desired(ata, wallet, "ata"),
    ];
    const currentSet: CurrentAddress[] = [
      current(wallet, wallet, "wh-uuid-1", "wallet"),
      current(ata, wallet, "wh-uuid-1", "ata"),
    ];

    const result = computeResyncDiff({
      current: currentSet,
      desired: desiredSet,
      maxAddressesPerWebhook: 50_000,
      webhooks: [webhook("wh-uuid-1", "helius-1", currentSet.length)],
    });

    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
    expect(result.webhooksToCreate).toEqual([]);
  });

  test("new wallet registered: all addresses go into the only non-full webhook", () => {
    const wallet = "WalletNEW";
    const ata = "AtaNEW";
    const desiredSet: DesiredAddress[] = [
      desired(wallet, wallet, "wallet"),
      desired(ata, wallet, "ata"),
    ];

    const result = computeResyncDiff({
      current: [],
      desired: desiredSet,
      maxAddressesPerWebhook: 50_000,
      webhooks: [webhook("wh-uuid-1", "helius-1", 10)],
    });

    expect(result.toAdd).toHaveLength(2);
    for (const add of result.toAdd) {
      expect(add.assignedWebhookId).toBe("wh-uuid-1");
    }
    expect(result.toRemove).toEqual([]);
    expect(result.webhooksToCreate).toEqual([]);
  });

  test("wallet deregistered: addresses go into toRemove with their webhookId", () => {
    const wallet = "WalletGONE";
    const ata = "AtaGONE";
    const currentSet: CurrentAddress[] = [
      current(wallet, wallet, "wh-uuid-1", "wallet"),
      current(ata, wallet, "wh-uuid-1", "ata"),
    ];

    const result = computeResyncDiff({
      current: currentSet,
      desired: [],
      maxAddressesPerWebhook: 50_000,
      webhooks: [
        webhook("wh-uuid-1", "helius-1", currentSet.length),
      ],
    });

    expect(result.toAdd).toEqual([]);
    expect(result.webhooksToCreate).toEqual([]);
    expect(result.toRemove).toHaveLength(2);
    const addresses = result.toRemove.map((r) => r.address).sort();
    expect(addresses).toEqual([ata, wallet].sort());
    for (const row of result.toRemove) {
      expect(row.webhookId).toBe("wh-uuid-1");
    }
  });

  test("existing wallet, new ATA appeared: toAdd has just the new ATA", () => {
    const wallet = "WalletX";
    const newAta = "AtaNewlyMinted";
    const desiredSet: DesiredAddress[] = [
      desired(wallet, wallet, "wallet"),
      desired(newAta, wallet, "ata"),
    ];
    const currentSet: CurrentAddress[] = [
      current(wallet, wallet, "wh-uuid-1", "wallet"),
    ];

    const result = computeResyncDiff({
      current: currentSet,
      desired: desiredSet,
      maxAddressesPerWebhook: 50_000,
      webhooks: [webhook("wh-uuid-1", "helius-1", 1)],
    });

    expect(result.toAdd).toHaveLength(1);
    const onlyAdd = result.toAdd[0];
    expect(onlyAdd).toBeDefined();
    if (!onlyAdd) return;
    expect(onlyAdd.address).toBe(newAta);
    expect(onlyAdd.assignedWebhookId).toBe("wh-uuid-1");
    expect(result.toRemove).toEqual([]);
    expect(result.webhooksToCreate).toEqual([]);
  });

  test("all webhooks full: 100 addresses spill into 2 shards of 50 each", () => {
    const desiredSet: DesiredAddress[] = [];
    for (let i = 0; i < 100; i++) {
      const addr = `addr-${String(i).padStart(4, "0")}`;
      desiredSet.push(desired(addr, `wallet-${i}`, "wallet"));
    }

    const result = computeResyncDiff({
      current: [],
      desired: desiredSet,
      maxAddressesPerWebhook: 50,
      webhooks: [
        webhook("wh-uuid-1", "helius-1", 50),
        webhook("wh-uuid-2", "helius-2", 50),
      ],
    });

    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
    expect(result.webhooksToCreate).toHaveLength(2);
    for (const shard of result.webhooksToCreate) {
      expect(shard.addresses).toHaveLength(50);
    }
    const total = result.webhooksToCreate.reduce(
      (sum, shard) => sum + shard.addresses.length,
      0,
    );
    expect(total).toBe(100);
  });

  test("partial fill then spill: 30 fit existing, 40 spill to new shard", () => {
    const desiredSet: DesiredAddress[] = [];
    for (let i = 0; i < 70; i++) {
      const addr = `addr-${String(i).padStart(4, "0")}`;
      desiredSet.push(desired(addr, `wallet-${i}`, "wallet"));
    }

    const result = computeResyncDiff({
      current: [],
      desired: desiredSet,
      maxAddressesPerWebhook: 50,
      webhooks: [
        // 20 already present → 30 free slots
        webhook("wh-uuid-1", "helius-1", 20),
      ],
    });

    const goingToExisting = result.toAdd.filter(
      (a) => a.assignedWebhookId === "wh-uuid-1",
    );
    expect(goingToExisting).toHaveLength(30);
    expect(result.toRemove).toEqual([]);
    expect(result.webhooksToCreate).toHaveLength(1);
    const onlyShard = result.webhooksToCreate[0];
    expect(onlyShard).toBeDefined();
    if (!onlyShard) return;
    expect(onlyShard.addresses).toHaveLength(40);
  });

  test("deterministic: input order does not affect output ordering", () => {
    const wallet = "WalletDET";
    const a = "addr-aaa";
    const b = "addr-bbb";
    const c = "addr-ccc";

    const desiredAsc: DesiredAddress[] = [
      desired(a, wallet, "ata"),
      desired(b, wallet, "ata"),
      desired(c, wallet, "ata"),
    ];
    const desiredDesc: DesiredAddress[] = [
      desired(c, wallet, "ata"),
      desired(b, wallet, "ata"),
      desired(a, wallet, "ata"),
    ];

    const resultAsc = computeResyncDiff({
      current: [],
      desired: desiredAsc,
      maxAddressesPerWebhook: 50,
      webhooks: [webhook("wh-uuid-1", "helius-1", 0)],
    });
    const resultDesc = computeResyncDiff({
      current: [],
      desired: desiredDesc,
      maxAddressesPerWebhook: 50,
      webhooks: [webhook("wh-uuid-1", "helius-1", 0)],
    });

    expect(resultAsc).toEqual(resultDesc);
    const addedAddresses = resultAsc.toAdd.map((a) => a.address);
    // Must be sorted lexicographically for determinism.
    expect(addedAddresses).toEqual([...addedAddresses].sort());
  });

  test("toAdd assignments prefer the existing webhook with the most remaining capacity", () => {
    // wh-uuid-1 has 5 free slots, wh-uuid-2 has 20. First adds should
    // land in wh-uuid-2 (more capacity).
    const desiredSet: DesiredAddress[] = [];
    for (let i = 0; i < 10; i++) {
      const addr = `addr-${String(i).padStart(4, "0")}`;
      desiredSet.push(desired(addr, `wallet-${i}`, "wallet"));
    }

    const result = computeResyncDiff({
      current: [],
      desired: desiredSet,
      maxAddressesPerWebhook: 100,
      webhooks: [
        webhook("wh-uuid-1", "helius-1", 95), // 5 free
        webhook("wh-uuid-2", "helius-2", 80), // 20 free
      ],
    });

    expect(result.toAdd).toHaveLength(10);
    expect(result.webhooksToCreate).toEqual([]);

    const byWebhook = new Map<string, number>();
    for (const a of result.toAdd) {
      byWebhook.set(
        a.assignedWebhookId,
        (byWebhook.get(a.assignedWebhookId) ?? 0) + 1,
      );
    }
    // Greedy fill: wh-uuid-2 (20 free) gets all 10, since 10 < 20 and it
    // remains the most-free throughout.
    expect(byWebhook.get("wh-uuid-2")).toBe(10);
    expect(byWebhook.get("wh-uuid-1") ?? 0).toBe(0);
  });
});
