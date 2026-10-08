#!/usr/bin/env bun

import assert from "node:assert/strict";
import { ACCOUNT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  type AccountInfo,
  type Connection,
  Keypair,
  type PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import {
  VoltrClaimLiquidityError,
  voltrClaimPlan,
} from "../src/features/earn-max/voltr/plans";
import {
  readVoltrPosition,
  VOLTR_ASSET_MINT,
  VOLTR_IDLE_ATA,
  VOLTR_IDLE_AUTH,
  VOLTR_LP_MINT,
  VOLTR_VAULT,
  voltrClaimBlockReason,
  voltrUserAccounts,
} from "../src/features/earn-max/voltr/program";
import { normalizeLifecycleErrorCode } from "../src/features/observability/lifecycle-contract";

// Synthetic account snapshots only. No network connection, signing or secrets.
const authority = Keypair.generate().publicKey;
const owner = Keypair.generate().publicKey;
const user = voltrUserAccounts(authority);
const payout = BigInt(20);
const account = (
  data: Buffer,
  program = TOKEN_PROGRAM_ID
): AccountInfo<Buffer> => ({
  data,
  executable: false,
  lamports: 0,
  owner: program,
});
const vault = Buffer.alloc(688);
vault.writeBigUInt64LE(BigInt(1000), 168);
const mint = Buffer.alloc(82);
mint.writeBigUInt64LE(BigInt(1000), 36);
const dust = Buffer.alloc(ACCOUNT_SIZE);
dust.writeBigUInt64LE(payout * BigInt(10), 64);
const receipt = Buffer.alloc(112);
receipt.writeBigUInt64LE(payout, 72);
receipt.writeBigUInt64LE(payout << BigInt(48), 80);
receipt.writeBigUInt64LE(BigInt(Math.floor(Date.now() / 1000) - 60), 96);
const idleData = Buffer.alloc(ACCOUNT_SIZE);
VOLTR_ASSET_MINT.toBuffer().copy(idleData, 0);
VOLTR_IDLE_AUTH.toBuffer().copy(idleData, 32);
idleData.writeBigUInt64LE(payout, 64);
idleData[108] = 1;
let idle: AccountInfo<Buffer> | null = account(idleData);
const accounts = new Map<string, AccountInfo<Buffer>>([
  [VOLTR_VAULT.toBase58(), account(vault)],
  [VOLTR_LP_MINT.toBase58(), account(mint)],
  [user.assetAta.toBase58(), account(dust)],
  [user.receipt.toBase58(), account(receipt)],
]);
const connection = {
  getMultipleAccountsInfo: async (keys: PublicKey[]) =>
    keys.map((key) =>
      key.equals(VOLTR_IDLE_ATA) ? idle : accounts.get(key.toBase58()) ?? null
    ),
} as Connection;
const context = { authority, owner };

const funded = await readVoltrPosition(connection, authority);
assert.equal(voltrClaimBlockReason(funded), null);
assert.equal(voltrClaimBlockReason(funded, 0), "not_ready");
await voltrClaimPlan(connection, context);

// A formerly claimable summary must not authorize a now-unfunded prepare.
// Leave enough for the post-headroom sweep, but not the full pool payout.
idleData.writeBigUInt64LE(payout - BigInt(1), 64);
const unfunded = await readVoltrPosition(connection, authority);
assert.ok(unfunded.assetRaw > payout); // User dust must not fund pool coverage.
assert.equal(voltrClaimBlockReason(unfunded), "insufficient_liquidity");
await assert.rejects(
  voltrClaimPlan(connection, context),
  VoltrClaimLiquidityError
);
assert.equal(voltrClaimBlockReason(unfunded, 0), "not_ready");

// Nullable or invalid pool accounts must never enable signing.
const wrongMint = Buffer.from(idleData);
owner.toBuffer().copy(wrongMint, 0);
const wrongAuthority = Buffer.from(idleData);
owner.toBuffer().copy(wrongAuthority, 32);
const frozen = Buffer.from(idleData);
frozen[108] = 2;
const uninitialized = Buffer.from(idleData);
uninitialized[108] = 0;
const invalidState = Buffer.from(idleData);
invalidState[108] = 3;
for (const invalid of [
  null,
  account(Buffer.alloc(0)),
  account(idleData, SystemProgram.programId),
  account(wrongMint),
  account(wrongAuthority),
  account(frozen),
  account(uninitialized),
  account(invalidState),
  { ...account(idleData), executable: true },
]) {
  idle = invalid;
  const unknown = await readVoltrPosition(connection, authority);
  assert.equal(unknown.idleAssetRaw, null);
  assert.equal(voltrClaimBlockReason(unknown), "liquidity_unavailable");
  await assert.rejects(
    voltrClaimPlan(connection, context),
    VoltrClaimLiquidityError
  );
}

idle = account(idleData);
idleData.writeBigUInt64LE(payout, 64);
receipt.writeBigUInt64LE(BigInt(Math.floor(Date.now() / 1000) + 3600), 96);
assert.equal(
  voltrClaimBlockReason(await readVoltrPosition(connection, authority)),
  "not_ready"
);
await assert.rejects(voltrClaimPlan(connection, context), /not claimable yet/);
const failedRead = {
  getMultipleAccountsInfo: async () => {
    throw new Error("Read unavailable");
  },
} as unknown as Connection;
await assert.rejects(voltrClaimPlan(failedRead, context), /Read unavailable/);
assert.equal(
  normalizeLifecycleErrorCode("earn_max_liquidity_unavailable"),
  "earn_max_liquidity_unavailable"
);
console.log("Earn MAX claim liquidity contract checks passed (offline).");
