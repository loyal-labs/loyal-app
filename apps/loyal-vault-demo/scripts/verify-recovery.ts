/** Recovery corruption must block replacement, not masquerade as an absent operation. */
import assert from "node:assert/strict";
import bs58 from "bs58";
import { readRecoveryFrom, recoveryKey, RECOVERY_UNREADABLE } from "../src/features/vault/domain/recovery";
import { VAULT_IDENTITY } from "../src/features/vault/domain/identity";
export function verifyRecoveryContract(): { passed: number } {
  const wallet = "BAqgbERmvUViqDSx961xpRBHGt68SpACiWL4t9696qZZ";
  const record = { wallet, signature: bs58.encode(new Uint8Array(64).fill(1)), action: "claim", messageSha256: "a".repeat(64), lastValidBlockHeight: "100", blockhash: bs58.encode(new Uint8Array(32).fill(2)), createdAtMs: 1000 };
  let raw: string | null = null;
  const storage = { getItem: (key: string) => { assert.equal(key, recoveryKey(wallet)); return raw; } };
  let passed = 0;
  assert.equal(readRecoveryFrom(storage, wallet), null); passed++;
  raw = JSON.stringify(record);
  assert.equal(readRecoveryFrom(storage, wallet)?.signature, record.signature); passed++;
  for (const corrupt of ["", "{", "null", "[]", JSON.stringify({ ...record, wallet: VAULT_IDENTITY.manager }), JSON.stringify({ ...record, action: "send" }), JSON.stringify({ ...record, signature: "invalid" }), JSON.stringify({ ...record, messageSha256: "" }), JSON.stringify({ ...record, blockhash: "invalid" }), JSON.stringify({ ...record, lastValidBlockHeight: "18446744073709551616" }), JSON.stringify({ ...record, createdAtMs: -1 })]) {
    raw = corrupt;
    assert.throws(() => readRecoveryFrom(storage, wallet), { message: RECOVERY_UNREADABLE });
    assert.equal(raw, corrupt); passed++;
  }
  assert.throws(() => readRecoveryFrom({ getItem: () => { throw new Error("Storage unavailable"); } }, wallet), { message: RECOVERY_UNREADABLE }); passed++;
  return { passed };
}
