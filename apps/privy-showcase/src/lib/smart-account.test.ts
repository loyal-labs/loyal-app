import { accounts } from "@loyal-labs/loyal-smart-accounts";
import type { GetProgramAccountsConfig } from "@solana/web3.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, test } from "bun:test";
import {
  assertCreatedSettingsBoundary,
  findExistingSmartAccount,
} from "./smart-account";

describe("sponsored Settings boundary", () => {
  test("accepts only the exact one-of-one all-permissions Privy root signer", () => {
    const wallet = Keypair.generate().publicKey;
    expect(() =>
      assertCreatedSettingsBoundary({
        wallet,
        threshold: 1,
        timeLock: 0,
        signers: [{ key: wallet, permissionMask: 0b111 }],
      })
    ).not.toThrow();
    expect(() =>
      assertCreatedSettingsBoundary({
        wallet,
        threshold: 2,
        timeLock: 0,
        signers: [{ key: wallet, permissionMask: 0b111 }],
      })
    ).toThrow("threshold");
    expect(() =>
      assertCreatedSettingsBoundary({
        wallet,
        threshold: 1,
        timeLock: 0,
        signers: [
          { key: wallet, permissionMask: 0b111 },
          { key: Keypair.generate().publicKey, permissionMask: 0b111 },
        ],
      })
    ).toThrow("exactly one");
    expect(() =>
      assertCreatedSettingsBoundary({
        wallet,
        threshold: 1,
        timeLock: 0,
        signers: [{ key: wallet, permissionMask: 0b001 }],
      })
    ).toThrow("permissions");
  });

  test("filters confirmed discovery by wallet without assuming allocation size", async () => {
    const wallet = Keypair.generate().publicKey;
    const configs: GetProgramAccountsConfig[] = [];
    const connection = {
      getProgramAccounts: async (
        _programId: unknown,
        config: GetProgramAccountsConfig
      ) => {
        configs.push(config);
        return [];
      },
    } as unknown as Connection;

    expect(await findExistingSmartAccount({ connection, wallet })).toBeNull();
    expect(configs).toHaveLength(2);
    expect(configs.map((config) => config.commitment)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    expect(configs.map((config) => config.filters)).toEqual([
      [
        expect.objectContaining({ memcmp: expect.objectContaining({ offset: 0 }) }),
        { memcmp: { offset: 92, bytes: wallet.toBase58() } },
      ],
      [
        expect.objectContaining({ memcmp: expect.objectContaining({ offset: 0 }) }),
        { memcmp: { offset: 124, bytes: wallet.toBase58() } },
      ],
    ]);
  });

  test("reuses the newest exact account when earlier demo attempts created duplicates", async () => {
    const wallet = Keypair.generate().publicKey;
    const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
    const encode = (seed: bigint) => {
      const [serialized] = accounts.Settings.fromArgs({
        seed: Number(seed),
        settingsAuthority: PublicKey.default,
        threshold: 1,
        timeLock: 0,
        transactionIndex: 0,
        staleTransactionIndex: 0,
        archivalAuthority: null,
        archivableAfter: 0,
        bump: 1,
        signers: [{ key: wallet, permissions: { mask: 0b111 } }],
        accountUtilization: 0,
        policySeed: null,
        reserved2: 0,
      }).serialize();
      return Buffer.concat([serialized, Buffer.alloc(64)]);
    };
    const older = Keypair.generate().publicKey;
    const newer = Keypair.generate().publicKey;
    const connection = {
      getProgramAccounts: async () => [
        { pubkey: older, account: { owner: programId, data: encode(41n) } },
        { pubkey: newer, account: { owner: programId, data: encode(42n) } },
      ],
    } as unknown as Connection;

    const found = await findExistingSmartAccount({ connection, wallet });
    expect(found?.settings.toBase58()).toBe(newer.toBase58());
    expect(found?.accountIndex).toBe(42n);
  });
});
