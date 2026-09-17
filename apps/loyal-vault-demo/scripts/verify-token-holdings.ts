import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { decodeTokenHolding, TOKEN_2022 } from "../src/features/vault/domain/token-holdings";
import { VAULT_IDENTITY as id } from "../src/features/vault/domain/identity";
export function verifyTokenHoldings() {
  let passed = 0;
  for (const program of [id.tokenProgram, TOKEN_2022]) {
    const extended = program === TOKEN_2022;
    const data = Buffer.alloc(extended ? 166 : 165), mintData = Buffer.alloc(extended ? 166 : 82);
    new PublicKey(id.assetMint).toBuffer().copy(data);
    new PublicKey(id.manager).toBuffer().copy(data, 32);
    data.writeBigUInt64LE((1n << 64n) - 1n, 64); data[108] = 1;
    mintData[44] = 6; mintData[45] = 1;
    if (extended) { data[165] = 2; mintData[165] = 1; }
    const account = { address: id.vault, owner: program, data }, mint = { address: id.assetMint, owner: program, data: mintData };
    assert.equal(decodeTokenHolding(account, mint).raw, "18446744073709551615"); passed++;
    const foreign = Buffer.from(data); foreign[32] ^= 1;
    assert.throws(() => decodeTokenHolding({ ...account, data: foreign }, mint)); passed++;
    assert.throws(() => decodeTokenHolding(account, { ...mint, address: id.lpMint })); passed++;
    assert.throws(() => decodeTokenHolding(account, null)); passed++;
    assert.throws(() => decodeTokenHolding(account, { ...mint, owner: id.vault })); passed++;
    const frozen = Buffer.from(data); frozen[108] = 2;
    assert(decodeTokenHolding({ ...account, data: frozen }, mint).frozen); passed++;
  }
  return { passed };
}

export async function verifyTokenDiscoveryConsistency() {
  const { BoundedRpc } = await import("../src/features/vault/server/rpc");
  let calls = 0, regress = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json(); calls++;
    assert.equal(body.method, "getMultipleAccounts");
    assert.equal(body.params[1].minContextSlot, 100);
    if (calls === 1) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32016 } });
    return Response.json({ jsonrpc: "2.0", id: 1, result: { context: { slot: regress ? 99 : 100 }, value: [null] } });
  } });
  try {
    const rpc = new BoundedRpc(`http://127.0.0.1:${server.port}`, 1000, 2);
    const result = await rpc.getMultipleAccounts([id.manager], 100);
    assert(result.ok && result.contextSlot === 100); assert.equal(calls, 2);
    regress = true;
    const stale = await rpc.getMultipleAccounts([id.manager], 100);
    assert(!stale.ok && stale.kind === "decode"); assert.equal(calls, 3);
    return { passed: 2 };
  } finally { server.stop(true); }
}
