import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  appSmartAccountSettingsChangeRequests,
  appSmartAccountSigners,
} from "@loyal-labs/db-core/schema";

mock.module("server-only", () => ({}));

type RequestRow = {
  id: string;
  solanaEnv: "mainnet";
  smartAccountAddress: string;
  settingsPda: string;
  signerAddress: string;
  scope: "root_settings";
  action: "add_root_signer" | "remove_root_signer";
  status: "draft" | "submitted" | "confirmed" | "failed";
  idempotencyKey: string;
  requestedByUserId: string | null;
  transactionIndex: string | null;
  signature: string | null;
  submittedAt: Date | null;
  confirmedSlot: bigint | null;
  confirmedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type SignerRow = {
  id: string;
  solanaEnv: "mainnet";
  smartAccountAddress: string;
  settingsPda: string;
  signerAddress: string;
  scope: "root_settings";
  state: "active" | "removed";
  permissionMask: number | null;
  sourceSignature: string | null;
  sourceSlot: bigint | null;
  activatedAt: Date | null;
  removedAt: Date | null;
  lastCheckedAt: Date | null;
  userId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const store: {
  requests: RequestRow[];
  signers: SignerRow[];
} = {
  requests: [],
  signers: [],
};

let idCounter = 0;

function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function createInsertBuilder(table: unknown) {
  let valuesInput: Record<string, unknown> = {};

  return {
    values(values: Record<string, unknown>) {
      valuesInput = values;
      return this;
    },
    onConflictDoUpdate() {
      return this;
    },
    returning() {
      if (table === appSmartAccountSettingsChangeRequests) {
        const existing = store.requests.find(
          (row) =>
            row.solanaEnv === valuesInput.solanaEnv &&
            row.idempotencyKey === valuesInput.idempotencyKey
        );
        if (existing) {
          existing.updatedAt = valuesInput.updatedAt as Date;
          return [existing];
        }

        const row = {
          id: nextId("request"),
          signature: null,
          submittedAt: null,
          confirmedSlot: null,
          confirmedAt: null,
          errorCode: null,
          errorMessage: null,
          ...valuesInput,
        } as RequestRow;
        store.requests.push(row);
        return [row];
      }

      if (table === appSmartAccountSigners) {
        const existing = store.signers.find(
          (row) =>
            row.solanaEnv === valuesInput.solanaEnv &&
            row.settingsPda === valuesInput.settingsPda &&
            row.scope === valuesInput.scope &&
            row.signerAddress === valuesInput.signerAddress
        );
        if (existing) {
          Object.assign(existing, {
            smartAccountAddress: valuesInput.smartAccountAddress,
            state: "active",
            permissionMask: valuesInput.permissionMask,
            sourceSignature: valuesInput.sourceSignature,
            sourceSlot: valuesInput.sourceSlot,
            removedAt: null,
            lastCheckedAt: valuesInput.lastCheckedAt,
            updatedAt: valuesInput.updatedAt,
          });
          if ("userId" in valuesInput) {
            existing.userId = valuesInput.userId as string | null;
          }
          return [existing];
        }

        const row = {
          id: nextId("signer"),
          ...valuesInput,
        } as SignerRow;
        store.signers.push(row);
        return [row];
      }

      throw new Error("Unexpected insert table");
    },
  };
}

function createUpdateBuilder(table: unknown) {
  let setInput: Record<string, unknown> = {};

  return {
    set(values: Record<string, unknown>) {
      setInput = values;
      return this;
    },
    where() {
      return this;
    },
    returning() {
      if (table === appSmartAccountSettingsChangeRequests) {
        const row = store.requests[0];
        if (!row) {
          return [];
        }
        Object.assign(row, setInput);
        return [row];
      }

      if (table === appSmartAccountSigners) {
        const row = store.signers[0];
        if (!row) {
          return [];
        }
        Object.assign(row, setInput);
        return [row];
      }

      throw new Error("Unexpected update table");
    },
  };
}

const getDatabase = mock(() => ({
  insert: createInsertBuilder,
  update: createUpdateBuilder,
  query: {
    appSmartAccountSigners: {
      findMany: mock(async () =>
        store.signers
          .filter((row) => row.state === "active")
          .sort((left, right) => {
            const slotDelta =
              Number(right.sourceSlot ?? BigInt(0)) -
              Number(left.sourceSlot ?? BigInt(0));
            if (slotDelta !== 0) {
              return slotDelta;
            }
            const timeDelta =
              right.updatedAt.getTime() - left.updatedAt.getTime();
            if (timeDelta !== 0) {
              return timeDelta;
            }
            return right.settingsPda.localeCompare(left.settingsPda);
          })
      ),
    },
  },
}));

mock.module("@/lib/core/database", () => ({ getDatabase }));

const repository = await import("./repository");

const dependencies = {
  now: () => new Date("2026-06-16T00:00:00.000Z"),
};

describe("smart account signer repository", () => {
  beforeEach(() => {
    store.requests = [];
    store.signers = [];
    idCounter = 0;
    getDatabase.mockClear();
  });

  test("converges duplicate settings-change requests by idempotency key", async () => {
    const first = await repository.upsertDraftSmartAccountSettingsChangeRequest(
      {
        action: "add_root_signer",
        idempotencyKey: "settings:add:signer",
        settingsPda: "settings",
        signerAddress: "signer",
        smartAccountAddress: "smart-account",
        solanaEnv: "mainnet",
        transactionIndex: BigInt(1),
      },
      dependencies
    );
    const second =
      await repository.upsertDraftSmartAccountSettingsChangeRequest(
        {
          action: "add_root_signer",
          idempotencyKey: "settings:add:signer",
          settingsPda: "settings",
          signerAddress: "signer",
          smartAccountAddress: "smart-account",
          solanaEnv: "mainnet",
          transactionIndex: BigInt(1),
        },
        dependencies
      );

    expect(second.id).toBe(first.id);
    expect(store.requests).toHaveLength(1);

    await repository.markSmartAccountSettingsChangeRequestSubmitted(
      {
        id: first.id,
        signature: "add-signature",
        transactionIndex: BigInt(1),
      },
      dependencies
    );
    await repository.markSmartAccountSettingsChangeRequestConfirmed(
      {
        confirmedSlot: BigInt(123),
        id: first.id,
        signature: "add-signature",
      },
      dependencies
    );

    expect(store.requests[0]).toMatchObject({
      status: "confirmed",
      signature: "add-signature",
      confirmedSlot: BigInt(123),
      errorCode: null,
      errorMessage: null,
    });
  });

  test("reconciles root signer read-model active, linked, and removed states", async () => {
    const active = await repository.upsertActiveRootSmartAccountSigner(
      {
        permissionMask: 7,
        settingsPda: "settings",
        signerAddress: "signer",
        smartAccountAddress: "smart-account",
        solanaEnv: "mainnet",
        sourceSignature: "add-signature",
        sourceSlot: BigInt(123),
      },
      dependencies
    );

    expect(active).toMatchObject({
      state: "active",
      userId: null,
      permissionMask: 7,
    });

    await repository.linkRootSmartAccountSignerToUser(
      {
        settingsPda: "settings",
        signerAddress: "signer",
        solanaEnv: "mainnet",
        userId: "user-1",
      },
      dependencies
    );
    expect(store.signers[0]?.userId).toBe("user-1");

    await repository.markRootSmartAccountSignerRemoved(
      {
        settingsPda: "settings",
        signerAddress: "signer",
        solanaEnv: "mainnet",
        sourceSignature: "remove-signature",
        sourceSlot: BigInt(124),
      },
      dependencies
    );

    expect(store.signers[0]).toMatchObject({
      state: "removed",
      sourceSignature: "remove-signature",
      sourceSlot: BigInt(124),
    });
  });

  test("returns active root signer memberships in deterministic latest order", async () => {
    store.signers = [
      {
        id: "old",
        solanaEnv: "mainnet",
        smartAccountAddress: "smart-old",
        settingsPda: "settings-old",
        signerAddress: "signer",
        scope: "root_settings",
        state: "active",
        permissionMask: 7,
        sourceSignature: "old",
        sourceSlot: BigInt(1),
        activatedAt: dependencies.now(),
        removedAt: null,
        lastCheckedAt: dependencies.now(),
        userId: null,
        createdAt: dependencies.now(),
        updatedAt: dependencies.now(),
      },
      {
        id: "latest",
        solanaEnv: "mainnet",
        smartAccountAddress: "smart-latest",
        settingsPda: "settings-latest",
        signerAddress: "signer",
        scope: "root_settings",
        state: "active",
        permissionMask: 7,
        sourceSignature: "latest",
        sourceSlot: BigInt(2),
        activatedAt: dependencies.now(),
        removedAt: null,
        lastCheckedAt: dependencies.now(),
        userId: null,
        createdAt: dependencies.now(),
        updatedAt: dependencies.now(),
      },
    ];

    const memberships =
      await repository.findActiveRootSmartAccountSignerMemberships({
        signerAddress: "signer",
        solanaEnv: "mainnet",
      });

    expect(memberships.map((membership) => membership.id)).toEqual([
      "latest",
      "old",
    ]);
  });
});
