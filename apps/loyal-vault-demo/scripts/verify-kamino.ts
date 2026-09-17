/** Wire invariants for the observed-position decoder. No RPC or signing. */
import { recordedKaminoValuation } from "../src/features/vault/domain/kamino-valuation";
import assert from "node:assert/strict";
import { collateralToLiquidityRaw, storedDebtRaw } from "../src/features/vault/domain/kamino-conversion";
import { PublicKey } from "@solana/web3.js";
import { decodeObligation, KLEND_PROGRAM_ID } from "../src/features/vault/domain/kamino-obligation";
import { VAULT_IDENTITY } from "../src/features/vault/domain/identity";

export function verifyKaminoDecoder(): { passed: number } {
  const data = Buffer.alloc(3344);
  Buffer.from([168, 206, 141, 106, 88, 76, 172, 167]).copy(data);
  new PublicKey(VAULT_IDENTITY.vault).toBuffer().copy(data, 32);
  new PublicKey(VAULT_IDENTITY.manager).toBuffer().copy(data, 64);
  data.writeBigUInt64LE(123n, 16);
  // Placeholder bytes are not economic fields and the SDK does not require zero.
  data[26] = 255;
  const account = { owner: KLEND_PROGRAM_ID, data };
  const address = VAULT_IDENTITY.vault;
  let passed = 0;
  const empty = decodeObligation(address, account);
  assert(empty.kind === "decoded" && !empty.funded); passed++;
  assert.equal(decodeObligation(address, null).kind, "absent"); passed++;
  for (let index = 0; index < 8; index++) {
    const bytes = Buffer.from(data), offset = 96 + index * 136;
    new PublicKey(VAULT_IDENTITY.assetMint).toBuffer().copy(bytes, offset);
    bytes.writeBigUInt64LE((1n << 64n) - 1n, offset + 32);
    const read = decodeObligation(address, { ...account, data: bytes });
    assert(read.kind === "decoded" && read.funded);
    assert.equal(read.obligation.deposits[index]?.depositedAmount, "18446744073709551615"); passed++;
  }
  for (let index = 0; index < 5; index++) {
    const bytes = Buffer.from(data), offset = 1208 + index * 200;
    new PublicKey(VAULT_IDENTITY.assetMint).toBuffer().copy(bytes, offset);
    bytes.writeBigUInt64LE(7n, offset + 88);
    bytes.writeBigUInt64LE(1n << 63n, offset + 96);
    const read = decodeObligation(address, { ...account, data: bytes });
    assert(read.kind === "decoded" && read.funded);
    assert.equal(read.obligation.borrows[index]?.borrowedAmountSf, ((1n << 127n) + 7n).toString()); passed++;
  }
  for (const mutate of [
    (bytes: Buffer) => { bytes[0] = 0; },
    (bytes: Buffer) => { bytes[64] = bytes[64]! ^ 1; },
    (bytes: Buffer) => { bytes[24] = 2; },
    (bytes: Buffer) => { bytes.writeBigUInt64LE(1n, 128); },
    (bytes: Buffer) => { bytes.writeBigUInt64LE(1n, 1296); },
  ]) {
    const bytes = Buffer.from(data); mutate(bytes);
    assert.equal(decodeObligation(address, { ...account, data: bytes }).kind, "invalid"); passed++;
  }
  assert.equal(decodeObligation(address, { ...account, data: data.subarray(0, 3343) }).kind, "invalid"); passed++;
  assert.equal(decodeObligation(address, { ...account, owner: address }).kind, "invalid"); passed++;
  const sf = 1n << 60n;
  assert.equal(collateralToLiquidityRaw(3n, 2n, 1n, sf, sf / 2n, 0n, 0n), 2n); passed++;
  assert.equal(storedDebtRaw(sf + 1n), 2n); passed++;
  assert.equal(storedDebtRaw(sf), 1n); passed++;
  assert.equal(storedDebtRaw(0n), 0n); passed++;
  assert.throws(() => collateralToLiquidityRaw(1n, 0n, 1n, 0n, 0n, 0n, 0n)); passed++;
  assert.throws(() => collateralToLiquidityRaw(1n, 1n, 0n, 0n, 1n, 0n, 0n)); passed++;
  assert.equal(collateralToLiquidityRaw((1n << 64n) - 1n, 1n, 1n, 0n, 0n, 0n, 0n), (1n << 64n) - 1n); passed++;
  assert(empty.kind === "decoded");
  const valuationInput = { ...empty.obligation,
    deposits: [{ reserve: address, active: true, depositedAmount: "1", marketValueSf: (3n * sf).toString() }],
    borrows: [{ reserve: address, active: true, borrowedAmountSf: "1", marketValueSf: sf.toString() }],
  };
  const valued = recordedKaminoValuation(valuationInput);
  assert.equal(valued?.netEquityUsdRaw, "2000000");
  assert.equal(valued?.ltvBps, "3334"); passed++;
  valuationInput.borrows[0]!.marketValueSf = (4n * sf).toString();
  assert.equal(recordedKaminoValuation(valuationInput)?.netEquityUsdRaw, "-1000000"); passed++;
  valuationInput.borrows[0]!.marketValueSf = "1";
  assert.equal(recordedKaminoValuation(valuationInput)?.debtUsdRaw, "1"); passed++;
  valuationInput.deposits[0]!.marketValueSf = "1";
  assert.equal(recordedKaminoValuation(valuationInput)?.collateralUsdRaw, "0"); passed++;
  valuationInput.deposits[0]!.marketValueSf = "0";
  assert.equal(recordedKaminoValuation(valuationInput), null); passed++;
  valuationInput.deposits[0]!.marketValueSf = (1n << 128n).toString();
  assert.throws(() => recordedKaminoValuation(valuationInput)); passed++;
  assert.equal(recordedKaminoValuation({ ...valuationInput, deposits: [] })?.ltvBps, null); passed++;
  return { passed };
}
