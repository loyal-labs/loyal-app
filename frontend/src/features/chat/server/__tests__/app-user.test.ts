import { beforeAll, describe, expect, mock, test } from "bun:test";

import type { CurrentUserPrincipal } from "../app-user";

mock.module("server-only", () => ({}));

let getOrCreateCurrentUser: typeof import("../app-user").getOrCreateCurrentUser;

type StoredUser = {
  id: string;
  provider: "solana";
  subjectAddress: string;
};

type StoredWallet = {
  userId: string;
  walletAddress: string;
  verifiedAt: Date;
  lastUsedAt: Date;
};

describe("app user provisioning", () => {
  beforeAll(async () => {
    ({ getOrCreateCurrentUser } = await import("../app-user"));
  });

  function createPrincipal(
    overrides: Partial<CurrentUserPrincipal> = {}
  ): CurrentUserPrincipal {
    return {
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      walletAddress: "wallet-1",
      ...overrides,
    };
  }

  function createFakeDependencies() {
    const users: StoredUser[] = [];
    const wallets: StoredWallet[] = [];
    let idCounter = 0;
    let nowCounter = 0;

    return {
      users,
      wallets,
      dependencies: {
        now: () => new Date(`2026-03-12T00:00:0${nowCounter++}Z`),
        findUserByPrincipal: async (principal: CurrentUserPrincipal) =>
          users.find(
            (user) =>
              user.provider === principal.provider &&
              user.subjectAddress === principal.subjectAddress
          ) ?? null,
        createUser: async (principal: CurrentUserPrincipal) => {
          const user: StoredUser = {
            id: `user-${++idCounter}`,
            provider: principal.provider,
            subjectAddress: principal.subjectAddress,
          };
          users.push(user);
          return user;
        },
        updateUserMetadata: async () => {},
        upsertWalletForUser: async (
          userId: string,
          walletAddress: string,
          now: Date
        ) => {
          const existingWallet = wallets.find(
            (wallet) => wallet.walletAddress === walletAddress
          );
          if (existingWallet) {
            existingWallet.userId = userId;
            existingWallet.verifiedAt = now;
            existingWallet.lastUsedAt = now;
            return;
          }

          wallets.push({
            userId,
            walletAddress,
            verifiedAt: now,
            lastUsedAt: now,
          });
        },
      },
    };
  }

  test("creates one app user and wallet on first wallet session", async () => {
    const { users, wallets, dependencies } = createFakeDependencies();

    const user = await getOrCreateCurrentUser(createPrincipal(), dependencies);

    expect(user.id).toBe("user-1");
    expect(users).toEqual([
      {
        id: "user-1",
        provider: "solana",
        subjectAddress: "wallet-1",
      },
    ]);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({
      userId: "user-1",
      walletAddress: "wallet-1",
    });
  });

  test("reuses the same user for repeated wallet sessions", async () => {
    const { users, wallets, dependencies } = createFakeDependencies();

    const firstUser = await getOrCreateCurrentUser(
      createPrincipal(),
      dependencies
    );
    const secondUser = await getOrCreateCurrentUser(
      createPrincipal(),
      dependencies
    );

    expect(firstUser.id).toBe(secondUser.id);
    expect(users).toHaveLength(1);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]?.lastUsedAt.toISOString()).toBe(
      "2026-03-12T00:00:01.000Z"
    );
  });

  test("recovers when user creation loses a race", async () => {
    const { users, wallets, dependencies } = createFakeDependencies();
    const racedUser: StoredUser = {
      id: "user-raced",
      provider: "solana",
      subjectAddress: "wallet-1",
    };
    let created = false;

    const user = await getOrCreateCurrentUser(createPrincipal(), {
      ...dependencies,
      createUser: async () => {
        created = true;
        users.push(racedUser);
        return null;
      },
    });

    expect(created).toBe(true);
    expect(user).toEqual(racedUser);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]?.userId).toBe("user-raced");
  });
});
