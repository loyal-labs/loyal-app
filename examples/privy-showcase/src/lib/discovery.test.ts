import { accounts, codecs } from "@loyal-labs/loyal-smart-accounts";
import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, test } from "bun:test";
import {
  decodeOwnedSettingsAccount,
  matchSmartAccountSigner,
} from "./discovery";
import { SQUADS_PROGRAM_ID } from "./constants";

const SETTINGS = Keypair.generate().publicKey;
const SIGNER = Keypair.generate().publicKey;

function serializedSettings() {
  return accounts.Settings.fromArgs({
    seed: 4,
    settingsAuthority: PublicKey.default,
    threshold: 1,
    timeLock: 0,
    transactionIndex: 2,
    staleTransactionIndex: 0,
    archivalAuthority: null,
    archivableAfter: 0,
    bump: 255,
    signers: [{ key: SIGNER, permissions: codecs.Permissions.all() }],
    accountUtilization: 1,
    policySeed: null,
    reserved2: 0,
  }).serialize()[0];
}

describe("Settings discovery boundary", () => {
  test("decodes the variable-length signer list", () => {
    const decoded = decodeOwnedSettingsAccount({
      data: serializedSettings(),
      owner: SQUADS_PROGRAM_ID,
      pubkey: SETTINGS,
    });
    expect(decoded?.signerAddresses).toEqual([SIGNER.toBase58()]);
    expect(decoded?.threshold).toBe(1);
    const match = matchSmartAccountSigner(decoded!, SIGNER);
    expect(match?.eligible).toBe(true);
    expect(
      matchSmartAccountSigner(decoded!, Keypair.generate().publicKey)
    ).toBeNull();
  });

  test("rejects wrong owners, discriminators, and malformed Settings", () => {
    const valid = serializedSettings();
    expect(
      decodeOwnedSettingsAccount({
        data: valid,
        owner: Keypair.generate().publicKey,
        pubkey: SETTINGS,
      })
    ).toBeNull();
    expect(
      decodeOwnedSettingsAccount({
        data: Buffer.alloc(80),
        owner: SQUADS_PROGRAM_ID,
        pubkey: SETTINGS,
      })
    ).toBeNull();
    expect(
      decodeOwnedSettingsAccount({
        data: valid.subarray(0, 20),
        owner: SQUADS_PROGRAM_ID,
        pubkey: SETTINGS,
      })
    ).toBeNull();
  });
});
