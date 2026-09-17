/** Controlled wire-format checks, invoked by the sole acceptance verifier. No chain writes. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import bs58 from "bs58";
import { TransactionReadRpc } from "../src/features/vault/server/transaction-rpc";

export async function verifyTransactionRpcContract(): Promise<{ passed: number }> {
  const signature = bs58.encode(new Uint8Array(64).fill(1));
  const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const owner = "BAqgbERmvUViqDSx961xpRBHGt68SpACiWL4t9696qZZ";
  const token = { accountIndex: 1, mint, owner, uiTokenAmount: { amount: "1000000", decimals: 6 } };
  const valid = { slot: 123, blockTime: 1700000000, transaction: ["AQ==", "base64"],
    meta: { err: null, fee: 5000, preBalances: [10000, 1], postBalances: [5000, 1], innerInstructions: [], preTokenBalances: [token], postTokenBalances: [token], loadedAddresses: { writable: [], readonly: [] } } };
  let result: unknown = valid;
  let envelope: unknown = undefined;
  let calls = 0;
  const server = createServer((_request, response) => {
    calls++;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(envelope ?? { jsonrpc: "2.0", id: 1, result }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const location = server.address();
  assert(location && typeof location === "object");
  const rpc = new TransactionReadRpc(`http://127.0.0.1:${location.port}`, 1000, 1);
  let passed = 0;
  try {
    const accepted = await rpc.getFinalizedTransaction(signature);
    assert(accepted.ok && accepted.value);
    assert.equal(accepted.value.slot, 123);
    assert.equal(accepted.value.transactionBase64, "AQ==");
    assert.equal(accepted.value.preTokenBalances[0]?.amountRaw, "1000000");
    passed++;
    result = null;
    const missing = await rpc.getFinalizedTransaction(signature);
    assert(missing.ok && missing.value === null); passed++;
    for (const [label, mutation] of [
      ["missing transaction slot", { ...valid, slot: undefined, context: { slot: 123 } }],
      ["wrong encoding", { ...valid, transaction: ["AQ==", "base58"] }],
      ["invalid base64", { ...valid, transaction: ["AQ==?", "base64"] }],
      ["missing fee", { ...valid, meta: { ...valid.meta, fee: undefined } }],
      ["missing error state", { ...valid, meta: { ...valid.meta, err: undefined } }],
      ["missing token effects", { ...valid, meta: { ...valid.meta, preTokenBalances: undefined } }],
      ["negative amount", { ...valid, meta: { ...valid.meta, postTokenBalances: [{ ...token, uiTokenAmount: { amount: "-1", decimals: 6 } }] } }],
      ["duplicate account index", { ...valid, meta: { ...valid.meta, postTokenBalances: [token, token] } }],
      ["fractional account index", { ...valid, meta: { ...valid.meta, postTokenBalances: [{ ...token, accountIndex: 1.5 }] } }],
      ["unsafe numeric slot", { ...valid, slot: Number.MAX_SAFE_INTEGER + 1 }],
    ] as const) {
      result = mutation;
      const rejected = await rpc.getFinalizedTransaction(signature);
      assert(!rejected.ok && rejected.kind === "decode", label); passed++;
    }
    result = { ...valid, meta: { err: { InstructionError: [0, "Custom"] }, fee: 5000 } };
    const failedExecution = await rpc.getFinalizedTransaction(signature);
    assert(failedExecution.ok && failedExecution.value?.err); passed++;
    envelope = { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "private-provider-url-secret" } };
    const redacted = await rpc.getFinalizedTransaction(signature);
    assert(!redacted.ok && !redacted.error.includes("private-provider")); passed++;
    envelope = { jsonrpc: "2.0", id: 1 };
    const absentResult = await rpc.getFinalizedTransaction(signature);
    assert(!absentResult.ok && absentResult.kind === "decode"); passed++;
    const before = calls;
    const invalid = await rpc.getFinalizedTransaction("invalid");
    assert(!invalid.ok && calls === before); passed++;
    return { passed };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}
