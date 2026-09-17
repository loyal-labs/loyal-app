/** Exercises production reconciliation with explicitly synthetic finalized records. Never signs or broadcasts. */
import assert from "node:assert/strict";
import bs58 from "bs58";
import { address } from "@solana/kit";
import { SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { auditWire, buildUnsignedTransaction, deriveCanonicalUserAccounts, type VaultAction } from "../src/features/vault/domain/transactions";
import { VAULT_IDENTITY } from "../src/features/vault/domain/identity";
import { reconciledSignature } from "../src/features/vault/server/transaction-status";
import type { FinalizedTransaction, TokenBalance } from "../src/features/vault/server/transaction-rpc";

export async function verifyTransactionEffects(): Promise<{ passed: number }> {
  const wallet = address("BAqgbERmvUViqDSx961xpRBHGt68SpACiWL4t9696qZZ");
  const accounts = await deriveCanonicalUserAccounts(wallet);
  const signatureBytes = new Uint8Array(64).fill(1); // Fixture marker, not a cryptographic signature.
  const signature = bs58.encode(signatureBytes);
  let passed = 0;
  for (const [action, withdrawAll] of [["deposit", false], ["request-withdraw", false], ["request-withdraw", true], ["claim", false]] as const) {
    const built = await buildUnsignedTransaction({ wallet, action: action as VaultAction,
      amountRaw: action === "claim" ? null : 1_000_000n, withdrawAll,
      blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1n,
      walletUsdcAtaExists: true, walletLpAtaExists: true });
    assert(built.ok);
    const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction.wireBase64, "base64"));
    tx.signatures[0] = signatureBytes;
    const wire = Buffer.from(tx.serialize()).toString("base64");
    const audit = auditWire(wire); assert(audit.ok);
    const preTokenBalances: TokenBalance[] = [], postTokenBalances: TokenBalance[] = [];
    function add(key: string, mint: string, owner: string, pre: string, post: string) {
      const accountIndex = audit.ok ? audit.accountKeys.indexOf(key) : -1;
      assert(accountIndex >= 0);
      const base = { accountIndex, mint, owner, decimals: mint === VAULT_IDENTITY.assetMint ? 6 : 9 };
      preTokenBalances.push({ ...base, amountRaw: pre });
      postTokenBalances.push({ ...base, amountRaw: post });
    }
    if (action === "deposit") {
      add(accounts.userAssetAta, VAULT_IDENTITY.assetMint, wallet, "2000000", "1000000");
      add(accounts.idleAta, VAULT_IDENTITY.assetMint, accounts.idleAuth, "0", "1000000");
      add(accounts.userLpAta, accounts.lpMint, wallet, "0", "1000");
    } else if (action === "request-withdraw") {
      add(accounts.userLpAta, accounts.lpMint, wallet, "2000000", withdrawAll ? "0" : "1000000");
      add(accounts.escrowLpAta, accounts.lpMint, accounts.receipt, "0", withdrawAll ? "2000000" : "1000000");
    } else {
      add(accounts.escrowLpAta, accounts.lpMint, accounts.receipt, "1000", "0");
      add(accounts.userAssetAta, VAULT_IDENTITY.assetMint, wallet, "0", "700000");
      add(accounts.idleAta, VAULT_IDENTITY.assetMint, accounts.idleAuth, "1000000", "300000");
    }
    const keyIndex = (key: string) => { const index = audit.accountKeys.indexOf(key); assert(index >= 0); return index; };
    const tokenData = Buffer.alloc(9);
    tokenData[0] = action === "deposit" ? 7 : action === "claim" ? 8 : 3;
    tokenData.writeBigUInt64LE(action === "request-withdraw" ? (withdrawAll ? 2_000_000n : 1_000_000n) : 1_000n, 1);
    const tokenAccounts = action === "deposit" ? [accounts.lpMint, accounts.userLpAta, accounts.lpMintAuth] :
      action === "request-withdraw" ? [accounts.userLpAta, accounts.escrowLpAta, wallet] : [accounts.escrowLpAta, accounts.lpMint, accounts.receipt];
    const preBalances = audit.accountKeys.map(() => "0"), postBalances = [...preBalances];
    if (action === "claim") preBalances[keyIndex(accounts.receipt)] = "1000";
    if (action === "request-withdraw") postBalances[keyIndex(accounts.receipt)] = "1000";
    const innerInstructions = [{ outerIndex: 0, programIdIndex: keyIndex(VAULT_IDENTITY.tokenProgram),
      accounts: tokenAccounts.map(keyIndex), dataBase58: bs58.encode(tokenData) }];
    const record: FinalizedTransaction = { slot: 1, blockTimeSec: 1n, feeLamports: 5000n, err: null,
      usesAddressLookupTables: false, transactionBase64: wire, preTokenBalances, postTokenBalances, preBalances, postBalances, innerInstructions };
    const outcome = await reconciledSignature(signature, wallet, record);
    assert(outcome.ok && outcome.response.state === "finalized-reconciled", `${action}: ${JSON.stringify(outcome)}`); passed++;
    const noTokenProof = await reconciledSignature(signature, wallet, { ...record, innerInstructions: [] });
    assert(noTokenProof.ok && noTokenProof.response.state === "finalized-unreconciled"); passed++;
    const wrongTokenData = Buffer.from(tokenData); wrongTokenData.writeBigUInt64LE(999n, 1);
    const wrongTokenProof = await reconciledSignature(signature, wallet, { ...record,
      innerInstructions: [{ ...innerInstructions[0]!, dataBase58: bs58.encode(wrongTokenData) }] });
    assert(wrongTokenProof.ok && wrongTokenProof.response.state === "finalized-unreconciled"); passed++;
    if (action !== "deposit") {
      const noReceiptProof = await reconciledSignature(signature, wallet, { ...record, preBalances: [], postBalances: [] });
      assert(noReceiptProof.ok && noReceiptProof.response.state === "finalized-unreconciled"); passed++;
    }
    const failed = await reconciledSignature(signature, wallet, { ...record, err: "controlled failure", preTokenBalances: [], postTokenBalances: [] });
    assert(failed.ok && failed.response.state === "failed" && failed.response.finalized &&
      failed.response.action === action && failed.response.observation.messageSha256 === outcome.response.observation.messageSha256); passed++;
    const changed = postTokenBalances.map((entry, index) => index === 1 ? { ...entry, amountRaw: (BigInt(entry.amountRaw) + 1n).toString() } : entry);
    const badAmount = await reconciledSignature(signature, wallet, { ...record, postTokenBalances: changed });
    assert(badAmount.ok && badAmount.response.state === "finalized-unreconciled", `${action} accepted nonconserving effects`); passed++;
    const wrongOwner = await reconciledSignature(signature, wallet, { ...record,
      postTokenBalances: postTokenBalances.map((entry, index) => index === 0 ? { ...entry, owner: VAULT_IDENTITY.vault } : entry) });
    assert(wrongOwner.ok && wrongOwner.response.state === "finalized-unreconciled"); passed++;
    const foreign = await reconciledSignature(signature, VAULT_IDENTITY.manager, record);
    assert(foreign.ok && foreign.response.state !== "finalized-reconciled" && !foreign.response.observation.walletSigned); passed++;
    const compound = TransactionMessage.decompile(tx.message);
    compound.instructions.push(SystemProgram.transfer({ fromPubkey: compound.payerKey, toPubkey: compound.payerKey, lamports: 1 }));
    const changedTx = new VersionedTransaction(compound.compileToV0Message()); changedTx.signatures[0] = signatureBytes;
    const extraInstruction = await reconciledSignature(signature, wallet, { ...record, transactionBase64: Buffer.from(changedTx.serialize()).toString("base64") });
    assert(extraInstruction.ok && extraInstruction.response.state === "unrelated"); passed++;
  }
  return { passed };
}
