import { describe, expect, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

import {
  depositVaultInstruction,
  requestWithdrawVaultInstruction,
  VOLTR_IDLE_ATA,
  VOLTR_LP_MINT,
  voltrUserAccounts,
  withdrawVaultInstruction,
} from "./program";

// Wire format of hand-encoded Voltr instructions. A wrong discriminator,
// account order or signer flag still compiles but moves money wrongly or
// fails on chain; expectations come from @voltr/vault-sdk generated code and
// mainnet (LP mint, and the index-2 vault of BAqgbE...'s smart account).
const authority = new PublicKey("DjxqqbiSueebrM1ZurkE4pEMo16WFsXKNttxAFdDDgM5");
const user = voltrUserAccounts(authority);

const shape = (ix: ReturnType<typeof depositVaultInstruction>) =>
  ix.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable]);

describe("Voltr instruction wire format", () => {
  test("PDAs match mainnet", () => {
    expect(VOLTR_LP_MINT.toBase58()).toBe(
      "6tNheTBYSpQkfMLhcczKgmTLSGffK54npKMG1WQR2tvb"
    );
    expect(user.receipt.toBase58()).toBe(
      "62zEJ11nMuuHiJcbHhfE1bmQeAKsjP6rYSbfGEQ1dPkr"
    );
    expect(user.escrowLpAta.toBase58()).toBe(
      "EmKc4CopsN4YFiEEUW5Qc926x4WkUa7LY3p7BTuJe8i9"
    );
  });

  test("depositVault", () => {
    const ix = depositVaultInstruction(authority, BigInt(1_000_000));
    expect([...ix.data]).toEqual([
      126, 224, 21, 255, 228, 53, 117, 33, 64, 66, 15, 0, 0, 0, 0, 0,
    ]);
    const keys = shape(ix);
    expect(keys[0]).toEqual([authority.toBase58(), true, true]);
    expect(keys[5]).toEqual([user.assetAta.toBase58(), false, true]);
    expect(keys[6]).toEqual([VOLTR_IDLE_ATA.toBase58(), false, true]);
    expect(keys[8]).toEqual([user.lpAta.toBase58(), false, true]);
    expect(keys).toHaveLength(13);
  });

  test("requestWithdrawVault escrows LP amounts", () => {
    const ix = requestWithdrawVaultInstruction({
      amountLpRaw: BigInt(2700),
      authority,
      payer: authority,
      withdrawAll: true,
    });
    expect([...ix.data]).toEqual([
      248, 225, 47, 22, 116, 144, 23, 143, 140, 10, 0, 0, 0, 0, 0, 0, 1, 1,
    ]);
    const keys = shape(ix);
    expect(keys[0]).toEqual([authority.toBase58(), true, true]);
    expect(keys[1]).toEqual([authority.toBase58(), true, false]);
    expect(keys[6]).toEqual([user.escrowLpAta.toBase58(), false, true]);
    expect(keys[7]).toEqual([user.receipt.toBase58(), false, true]);
    expect(keys).toHaveLength(10);
  });

  test("withdrawVault pays the authority's USDC account", () => {
    const ix = withdrawVaultInstruction(authority);
    expect([...ix.data]).toEqual([135, 7, 237, 120, 149, 94, 95, 7]);
    const keys = shape(ix);
    expect(keys[0]).toEqual([authority.toBase58(), true, true]);
    expect(keys[5]).toEqual([user.escrowLpAta.toBase58(), false, true]);
    expect(keys[8]).toEqual([user.assetAta.toBase58(), false, true]);
    expect(keys[9]).toEqual([user.receipt.toBase58(), false, true]);
    expect(keys).toHaveLength(13);
  });
});
