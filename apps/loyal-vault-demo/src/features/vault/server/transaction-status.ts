/**
 * Server side of GET /api/transactions/status — read-only, signature-scoped
 * reconciliation.
 *
 * A signature is accepted only when the finalized transaction is exactly what
 * this app prepares: the pinned Voltr program, a recognised action
 * discriminator, the canonical account set for that action and this wallet, the
 * wallet as fee payer and only required signer, and token effects in the
 * directions the action implies. Signature presence and token deltas alone are
 * never enough, an unrelated transaction from the same wallet is rejected, and
 * every outcome short of a proven reconciliation is reported as such.
 *
 * Nothing is persisted: the endpoint is a pure function of chain state, over
 * two bounded RPC reads.
 */

import { createHash } from "node:crypto";
import bs58 from "bs58";
import {
  DEPOSIT_VAULT_DISCRIMINATOR,
  REQUEST_WITHDRAW_VAULT_DISCRIMINATOR,
  WITHDRAW_VAULT_DISCRIMINATOR,
  getDepositVaultInstructionDataDecoder,
  getRequestWithdrawVaultInstructionDataDecoder,
} from "@voltr/vault-sdk";

import {
  auditWire,
  buildCanonicalInstruction,
  buildUnsignedTransaction,
  deriveCanonicalUserAccounts,
  VAULT_ACTIONS,
  type CanonicalAccount,
  type CanonicalInstruction,
  type CanonicalUserAccounts,
  type VaultAction,
} from "../domain/transactions";
import { VAULT_IDENTITY } from "./config";
import { assertPinnedCluster, getTransactionRpc, type TokenBalance, type FinalizedTransaction } from "./transaction-rpc";

export type TransactionStatusState =
  | "unknown"
  | "pending"
  | "failed"
  | "unrelated"
  | "finalized-unreconciled"
  | "finalized-reconciled";

export type TokenEffect = Readonly<{
  label: string;
  address: string;
  mint: string;
  owner: string;
  preRaw: string;
  postRaw: string;
  deltaRaw: string;
  expected: ">0" | "<0" | "any";
  matchesExpectation: boolean;
  /** "pre-only"/"post-only" mark an account created or emptied by this transaction. */
  presentIn: "pre-and-post" | "post-only" | "pre-only";
  note?: string;
}>;

export type StatusObservation = Readonly<{
  /** Present only when the complete finalized message has been decoded. */
  messageSha256?: string;
  slot: number | null;
  blockTimeSec: string | null;
  confirmationStatus: string | null;
  err: string | null;
  feeLamports: string | null;
  feePayer: string | null;
  signatureCount: number | null;
  walletSigned: boolean;
  usesAddressLookupTables: boolean;
}>;

export type StatusBinding = Readonly<{
  voltrInstructionIndex: number | null;
  discriminatorBase58: string | null;
  expectedDiscriminatorBase58: string | null;
  canonicalAccountsMatch: boolean;
  canonicalAccounts: readonly CanonicalAccount[];
  mismatches: readonly string[];
  signerMismatches: readonly string[];
}>;

export type TransactionStatus = Readonly<{
  schemaVersion: "loyal-vault-demo.transaction-status/1";
  signature: string;
  wallet: string;
  cluster: typeof VAULT_IDENTITY.cluster;
  state: TransactionStatusState;
  action: VaultAction | null;
  reason: string | null;
  checkedAt: string;
  finalized: boolean;
  observation: StatusObservation;
  binding: StatusBinding | null;
  effects: Readonly<{
    basis: string;
    entries: readonly TokenEffect[];
    allExpectationsMet: boolean;
    programEvidence: readonly string[];
  }> | null;
}>;

export type StatusOutcome =
  | { ok: true; httpStatus: 200; response: TransactionStatus }
  | {
      ok: false;
      httpStatus: 400 | 503;
      body: { unavailable: true; reason: string; kind: "invalid-input" | "rpc-error" | "decode-error" };
    };

/** The discriminators are read from the pinned SDK, never hand-copied. */
const ACTION_DISCRIMINATORS: Readonly<Record<VaultAction, Uint8Array>> = {
  deposit: DEPOSIT_VAULT_DISCRIMINATOR,
  "request-withdraw": REQUEST_WITHDRAW_VAULT_DISCRIMINATOR,
  claim: WITHDRAW_VAULT_DISCRIMINATOR,
};

function recognizedAction(discriminatorBase58: string): VaultAction | null {
  for (const action of VAULT_ACTIONS) {
    if (bs58.encode(ACTION_DISCRIMINATORS[action]) === discriminatorBase58) return action;
  }
  return null;
}

function balanceAt(
  entries: readonly TokenBalance[],
  accountKeys: readonly string[],
  address: string,
  mint: string,
): { entry: TokenBalance; present: true } | { present: false } {
  for (const entry of entries) {
    if (entry.mint !== mint) continue;
    if (accountKeys[entry.accountIndex] === address) return { entry, present: true };
  }
  return { present: false };
}

function presence(pre: { present: boolean }, post: { present: boolean }): TokenEffect["presentIn"] | null {
  if (pre.present && post.present) return "pre-and-post";
  if (post.present) return "post-only";
  if (pre.present) return "pre-only";
  return null;
}

function sideValue(
  pre: { present: boolean; entry?: TokenBalance },
  post: { present: boolean; entry?: TokenBalance },
  side: "pre" | "post",
): bigint {
  const source = side === "pre" ? pre : post;
  return source.present && source.entry ? BigInt(source.entry.amountRaw) : 0n;
}

function effect(args: {
  label: string;
  address: string;
  mint: string;
  owner: string;
  pre: bigint;
  post: bigint;
  presentIn: TokenEffect["presentIn"];
  expected: TokenEffect["expected"];
  note?: string;
}): TokenEffect {
  const delta = args.post - args.pre;
  const matchesExpectation =
    args.expected === "any"
      ? delta === 0n
      : args.expected === ">0"
        ? delta > 0n
        : delta < 0n;
  return {
    label: args.label,
    address: args.address,
    mint: args.mint,
    owner: args.owner,
    preRaw: args.pre.toString(),
    postRaw: args.post.toString(),
    deltaRaw: delta.toString(),
    expected: args.expected,
    matchesExpectation,
    presentIn: args.presentIn,
    ...(args.note ? { note: args.note } : {}),
  };
}

type DecodedAction =
  | { ok: true; canonical: CanonicalInstruction; accounts: CanonicalUserAccounts; exactAmount: bigint | null; withdrawAll: boolean }
  | { ok: false; reason: string };

/**
 * Rebuilds this app's canonical instruction for the action the chain reports,
 * from the instruction's own decoded arguments. If the arguments are not ones
 * this app ever writes — an amount-in-assets request, say — the transaction is
 * not ours regardless of which accounts it touches.
 */
async function canonicalForChainInstruction(
  action: VaultAction,
  wallet: string,
  dataBase64: string,
): Promise<DecodedAction> {
  const data = new Uint8Array(Buffer.from(dataBase64, "base64"));
  if (action === "claim") {
    const built = await buildCanonicalInstruction(action, wallet as never, { amountRaw: null, withdrawAll: false });
    return { ok: true, canonical: built.canonical, accounts: await deriveCanonicalUserAccounts(wallet as never), exactAmount: null, withdrawAll: false };
  }
  if (action === "deposit") {
    let amount: bigint;
    try {
      amount = getDepositVaultInstructionDataDecoder().decode(data).amount;
    } catch (error) {
      return { ok: false, reason: `deposit instruction data could not be decoded: ${error instanceof Error ? error.message : String(error)}` };
    }
    const built = await buildCanonicalInstruction(action, wallet as never, { amountRaw: amount, withdrawAll: false });
    return { ok: true, canonical: built.canonical, accounts: await deriveCanonicalUserAccounts(wallet as never), exactAmount: amount, withdrawAll: false };
  }
  let decoded: { amount: bigint; isAmountInLp: boolean; isWithdrawAll: boolean };
  try {
    decoded = getRequestWithdrawVaultInstructionDataDecoder().decode(data);
  } catch (error) {
    return { ok: false, reason: `request instruction data could not be decoded: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!decoded.isAmountInLp) {
    return { ok: false, reason: "the request is denominated in assets, which this app never prepares (it always requests in LP)" };
  }
  const built = await buildCanonicalInstruction(action, wallet as never, {
    amountRaw: decoded.amount,
    withdrawAll: decoded.isWithdrawAll,
  });
  return {
    ok: true,
    canonical: built.canonical,
    accounts: await deriveCanonicalUserAccounts(wallet as never),
    exactAmount: decoded.amount,
    withdrawAll: decoded.isWithdrawAll,
  };
}

/**
 * Reconciles one signature against the action it claims to be. `unknown`,
 * `pending`, `failed`, `unrelated`, `finalized-unreconciled` and
 * `finalized-reconciled` stay distinct; only the last proves anything.
 */
export async function reconcileTransaction(signature: string, wallet: string): Promise<StatusOutcome> {
  const cluster = await assertPinnedCluster();
  if (!cluster.ok) {
    return {
      ok: false,
      httpStatus: 503,
      body: { unavailable: true, reason: `cluster check failed: ${cluster.error}`, kind: "rpc-error" },
    };
  }

  const rpc = getTransactionRpc();
  const read = await rpc.getFinalizedTransaction(signature);
  if (!read.ok) {
    const kind = read.kind === "decode" ? "decode-error" : "rpc-error";
    return { ok: false, httpStatus: 503, body: { unavailable: true, reason: read.error, kind } };
  }

  if (read.value === null) {
    return await unresolvedSignature(signature, wallet, rpc);
  }
  return await reconciledSignature(signature, wallet, read.value);
}

async function unresolvedSignature(
  signature: string,
  wallet: string,
  rpc: ReturnType<typeof getTransactionRpc>,
): Promise<StatusOutcome> {
  const state = await rpc.getSignatureState(signature);
  if (!state.ok) {
    return { ok: false, httpStatus: 503, body: { unavailable: true, reason: state.error, kind: "rpc-error" } };
  }
  const status = state.value;
  const observation: StatusObservation = {
    slot: status?.slot ?? null,
    blockTimeSec: null,
    confirmationStatus: status?.confirmationStatus ?? null,
    err: status?.err ?? null,
    feeLamports: null,
    feePayer: null,
    signatureCount: null,
    walletSigned: false,
    usesAddressLookupTables: false,
  };
  const respond = (
    state_: TransactionStatusState,
    finalized: boolean,
    reason: string,
  ): StatusOutcome => ({
    ok: true,
    httpStatus: 200,
    response: {
      schemaVersion: "loyal-vault-demo.transaction-status/1",
      signature,
      wallet,
      cluster: VAULT_IDENTITY.cluster,
      state: state_,
      action: null,
      finalized,
      reason,
      checkedAt: new Date().toISOString(),
      observation,
      binding: null,
      effects: null,
    },
  });

  if (status === null) {
    return respond("unknown", false, "the cluster reports no transaction for this signature at finalized commitment");
  }
  if (status.err) {
    return respond(status.confirmationStatus === "finalized" ? "failed" : "pending",
      status.confirmationStatus === "finalized", `the transaction reports an execution error: ${status.err}`);
  }
  if (status.confirmationStatus && status.confirmationStatus !== "finalized") {
    return respond(
      "pending",
      false,
      `the transaction is ${status.confirmationStatus} but not finalized, so its effects cannot be proven yet`,
    );
  }
  return respond(
    "unknown",
    true,
    "the cluster marks the signature finalized but did not return the transaction, so nothing is proven",
  );
}

export async function reconciledSignature(
  signature: string,
  wallet: string,
  record: FinalizedTransaction,
): Promise<StatusOutcome> {
  const respond = (
    response: Omit<TransactionStatus, "schemaVersion" | "signature" | "wallet" | "cluster" | "checkedAt">,
  ): StatusOutcome => ({
    ok: true,
    httpStatus: 200,
    response: {
      schemaVersion: "loyal-vault-demo.transaction-status/1",
      signature,
      wallet,
      cluster: VAULT_IDENTITY.cluster,
      checkedAt: new Date().toISOString(),
      ...response,
    },
  });

  if (record.err) {
    const failedAudit = auditWire(record.transactionBase64);
    const walletSigned = failedAudit.ok && failedAudit.signatureCount === 1 &&
      failedAudit.requiredSigners.length === 1 && failedAudit.requiredSigners[0] === wallet &&
      failedAudit.feePayer === wallet && failedAudit.primarySignatureBase58 === signature;
    const instructions = failedAudit.ok ? failedAudit.instructions.filter((instruction) => instruction.programAddress === VAULT_IDENTITY.voltrProgram) : [];
    return respond({
      state: walletSigned ? "failed" : "unrelated",
      action: instructions.length === 1 ? recognizedAction(instructions[0]!.discriminatorBase58) : null,
      finalized: true,
      reason: `the finalized transaction failed on chain: ${record.err}`,
      observation: {
        ...(failedAudit.ok ? { messageSha256: createHash("sha256").update(Buffer.from(failedAudit.messageBase64, "base64")).digest("hex") } : {}),
        slot: record.slot, blockTimeSec: record.blockTimeSec?.toString() ?? null,
        confirmationStatus: "finalized", err: record.err,
        feeLamports: record.feeLamports.toString(),
        feePayer: failedAudit.ok ? failedAudit.feePayer : null,
        signatureCount: failedAudit.ok ? failedAudit.signatureCount : null,
        walletSigned, usesAddressLookupTables: record.usesAddressLookupTables,
      },
      binding: null, effects: null,
    });
  }
  if (record.usesAddressLookupTables) {
    return respond({
      state: "unrelated",
      action: null,
      finalized: true,
      reason: "the transaction uses address lookup tables, which no transaction this app prepares can",
      observation: {
        slot: record.slot,
        blockTimeSec: record.blockTimeSec?.toString() ?? null,
        confirmationStatus: "finalized",
        err: null,
        feeLamports: record.feeLamports.toString(),
        feePayer: null,
        signatureCount: null,
        walletSigned: false,
        usesAddressLookupTables: true,
      },
      binding: null,
      effects: null,
    });
  }

  const audit = auditWire(record.transactionBase64);
  if (!audit.ok) {
    return respond({
      state: "finalized-unreconciled",
      action: null,
      finalized: true,
      reason: `the finalized transaction could not be decoded for verification: ${audit.reason}`,
      observation: {
        slot: record.slot,
        blockTimeSec: record.blockTimeSec?.toString() ?? null,
        confirmationStatus: "finalized",
        err: null,
        feeLamports: record.feeLamports.toString(),
        feePayer: null,
        signatureCount: null,
        walletSigned: false,
        usesAddressLookupTables: false,
      },
      binding: null,
      effects: null,
    });
  }

  const voltrIndexes = audit.instructions
    .map((instruction, index) => (instruction.programAddress === VAULT_IDENTITY.voltrProgram ? index : -1))
    .filter((index) => index >= 0);

  const observation: StatusObservation = {
    messageSha256: createHash("sha256").update(Buffer.from(audit.messageBase64, "base64")).digest("hex"),
    slot: record.slot,
    blockTimeSec: record.blockTimeSec?.toString() ?? null,
    confirmationStatus: "finalized",
    err: null,
    feeLamports: record.feeLamports.toString(),
    feePayer: audit.feePayer,
    signatureCount: audit.signatureCount,
    walletSigned: audit.signatureCount === 1 && audit.requiredSigners.length === 1 &&
      audit.requiredSigners[0] === wallet && audit.feePayer === wallet &&
      !audit.signaturesZeroed && audit.primarySignatureBase58 === signature,
    usesAddressLookupTables: false,
  };

  // Built up in a mutable local builder, then frozen once complete: every
  // response below hands back the same immutable readonly evidence.
  const binding: { -readonly [TKey in keyof StatusBinding]: StatusBinding[TKey] } = {
    voltrInstructionIndex: voltrIndexes.length === 1 ? voltrIndexes[0]! : null,
    discriminatorBase58: null,
    expectedDiscriminatorBase58: null,
    canonicalAccountsMatch: false,
    canonicalAccounts: [],
    mismatches: [],
    signerMismatches: [],
  };

  if (voltrIndexes.length === 0) {
    return respond({
      state: "unrelated",
      action: null,
      finalized: true,
      reason: `the finalized transaction contains no instruction for the pinned Voltr program ${VAULT_IDENTITY.voltrProgram}`,
      observation,
      binding,
      effects: null,
    });
  }
  if (voltrIndexes.length > 1) {
    return respond({
      state: "unrelated",
      action: null,
      finalized: true,
      reason: `the transaction contains ${voltrIndexes.length} Voltr instructions; this app prepares exactly one`,
      observation,
      binding,
      effects: null,
    });
  }

  const onChain = audit.instructions[voltrIndexes[0]!]!;
  binding.discriminatorBase58 = onChain.discriminatorBase58;
  const action = recognizedAction(onChain.discriminatorBase58);
  binding.expectedDiscriminatorBase58 = action === null ? null : bs58.encode(ACTION_DISCRIMINATORS[action]);

  if (action === null) {
    return respond({
      state: "unrelated",
      action: null,
      finalized: true,
      reason: `the Voltr instruction discriminator ${onChain.discriminatorBase58} is not one of this app's three money actions`,
      observation,
      binding,
      effects: null,
    });
  }

  const decoded = await canonicalForChainInstruction(action, wallet, onChain.dataBase64);
  if (!decoded.ok) {
    return respond({
      state: "unrelated",
      action,
      finalized: true,
      reason: decoded.reason,
      observation,
      binding,
      effects: null,
    });
  }

  // Bind the whole message, including privileges and any ATA creation. Checking
  // only the Voltr instruction would accept additional transfers in the same tx.
  let messageMatches = false;
  for (const createsAta of [false, true]) {
    const expected = await buildUnsignedTransaction({
      wallet: wallet as never, action, amountRaw: decoded.exactAmount,
      withdrawAll: decoded.withdrawAll, blockhash: audit.blockhash,
      lastValidBlockHeight: 0n,
      walletUsdcAtaExists: action === "claim" ? !createsAta : true,
      walletLpAtaExists: action === "deposit" ? !createsAta : true,
    });
    if (expected.ok) {
      const expectedAudit = auditWire(expected.transaction.wireBase64);
      if (expectedAudit.ok && expectedAudit.messageBase64 === audit.messageBase64) {
        messageMatches = true;
        break;
      }
    }
  }
  if (!messageMatches) {
    return respond({ state: "unrelated", action, finalized: true,
      reason: "the complete transaction message differs from the canonical user action",
      observation, binding, effects: null });
  }

  const canonical = decoded.canonical;
  binding.canonicalAccounts = canonical.accounts;
  const mismatches: string[] = [];
  if (onChain.discriminatorBase58 !== canonical.discriminatorBase58) {
    mismatches.push("instruction discriminator does not match this app's canonical instruction");
  }
  if (onChain.accountAddresses.length !== canonical.accounts.length) {
    mismatches.push(
      `instruction carries ${onChain.accountAddresses.length} accounts; the canonical form has ${canonical.accounts.length}`,
    );
  }
  canonical.accounts.forEach((account) => {
    const actual = onChain.accountAddresses[account.index];
    if (actual !== account.address) {
      mismatches.push(
        `account ${account.index} (${account.label}) is ${actual ?? "absent"}; expected ${account.address}`,
      );
    }
  });
  binding.mismatches = mismatches;
  binding.canonicalAccountsMatch = mismatches.length === 0;

  const signerMismatches: string[] = [];
  if (audit.feePayer !== wallet) signerMismatches.push(`fee payer is ${audit.feePayer}, not the wallet`);
  if (audit.requiredSigners.length !== 1 || audit.requiredSigners[0] !== wallet) {
    signerMismatches.push(`required signers are [${audit.requiredSigners.join(", ")}]; expected only the wallet`);
  }
  if (audit.primarySignatureBase58 !== signature) {
    signerMismatches.push("signature slot zero is not the requested signature, so this wallet did not sign it");
  }
  binding.signerMismatches = signerMismatches;
  Object.freeze(binding);

  if (mismatches.length > 0 || signerMismatches.length > 0) {
    return respond({
      state: "unrelated",
      action,
      finalized: true,
      reason: [...mismatches, ...signerMismatches].join("; "),
      observation,
      binding,
      effects: null,
    });
  }

  // Effects, attributed by resolved account address within this transaction.
  const accounts = decoded.accounts;
  const entries: TokenEffect[] = [];
  const unresolved: string[] = [];
  const build = (args: {
    label: string;
    address: string;
    mint: string;
    owner: string;
    expected: TokenEffect["expected"];
    note?: string;
  }): void => {
    const pre = balanceAt(record.preTokenBalances, audit.accountKeys, args.address, args.mint);
    const post = balanceAt(record.postTokenBalances, audit.accountKeys, args.address, args.mint);
    const presentIn = presence(pre, post);
    if (presentIn === null) {
      unresolved.push(`${args.label} (${args.address}) appears in neither the pre nor the post token balances`);
      return;
    }
    for (const side of [pre, post]) {
      if (side.present && side.entry.owner !== args.owner) {
        unresolved.push(`${args.label} token authority does not match the canonical owner`);
        return;
      }
      if (side.present && args.mint === VAULT_IDENTITY.assetMint && side.entry.decimals !== VAULT_IDENTITY.assetDecimals) {
        unresolved.push(`${args.label} USDC decimals do not match`);
        return;
      }
    }
    if (pre.present && post.present && pre.entry.decimals !== post.entry.decimals) {
      unresolved.push(`${args.label} decimals changed within the transaction`);
      return;
    }
    entries.push(
      effect({
        label: args.label,
        address: args.address,
        mint: args.mint,
        owner: args.owner,
        pre: sideValue(pre, post, "pre"),
        post: sideValue(pre, post, "post"),
        presentIn,
        expected: args.expected,
        note: args.note,
      }),
    );
  };

  if (action === "deposit") {
    build({
      label: "wallet USDC",
      address: accounts.userAssetAta,
      mint: VAULT_IDENTITY.assetMint,
      owner: wallet,
      expected: "<0",
      note:
        decoded.exactAmount === null
          ? undefined
          : `the instruction moved exactly ${decoded.exactAmount} raw USDC`,
    });
    build({ label: "vault idle USDC", address: accounts.idleAta, mint: VAULT_IDENTITY.assetMint, owner: accounts.idleAuth, expected: ">0" });
    build({ label: "wallet LP", address: accounts.userLpAta, mint: accounts.lpMint, owner: wallet, expected: ">0" });
  } else if (action === "request-withdraw") {
    build({
      label: "wallet LP",
      address: accounts.userLpAta,
      mint: accounts.lpMint,
      owner: wallet,
      expected: "<0",
      note: decoded.exactAmount === null ? undefined : `the instruction escrowed exactly ${decoded.exactAmount} raw LP`,
    });
    build({ label: "request escrow LP", address: accounts.escrowLpAta, mint: accounts.lpMint, owner: accounts.receipt, expected: ">0" });
  } else {
    build({ label: "request escrow LP", address: accounts.escrowLpAta, mint: accounts.lpMint, owner: accounts.receipt, expected: "<0" });
    build({ label: "wallet USDC", address: accounts.userAssetAta, mint: VAULT_IDENTITY.assetMint, owner: wallet, expected: ">0" });
    build({ label: "vault idle USDC", address: accounts.idleAta, mint: VAULT_IDENTITY.assetMint, owner: accounts.idleAuth, expected: "<0" });
  }

  const byLabel = (label: string) => entries.find((entry) => entry.label === label);
  const delta = (label: string) => BigInt(byLabel(label)?.deltaRaw ?? "0");
  if (action === "deposit") {
    if (decoded.exactAmount === null || decoded.exactAmount <= 0n ||
        delta("wallet USDC") !== -decoded.exactAmount || delta("vault idle USDC") !== decoded.exactAmount) {
      unresolved.push("deposit USDC debit and custody credit do not equal the instruction amount");
    }
  } else if (action === "request-withdraw") {
    const expectedLp = decoded.withdrawAll ? BigInt(byLabel("wallet LP")?.preRaw ?? "0") : decoded.exactAmount;
    if (expectedLp === null || expectedLp <= 0n || delta("wallet LP") !== -expectedLp || delta("request escrow LP") !== expectedLp) {
      unresolved.push("request LP debit and escrow credit do not equal the requested shares");
    }
  } else {
    if (delta("wallet USDC") !== -delta("vault idle USDC")) {
      unresolved.push("claim payout and vault custody debit do not conserve USDC");
    }
    if (byLabel("request escrow LP")?.postRaw !== "0") {
      unresolved.push("claim did not consume the complete request escrow");
    }
  }

  const programEvidence: string[] = [];
  const inner = record.innerInstructions;
  if (inner === null) unresolved.push("inner SPL instruction evidence is unavailable");
  else {
    let tokenAmount = 0n;
    for (const instruction of inner) {
      if (instruction.outerIndex !== voltrIndexes[0] ||
          audit.accountKeys[instruction.programIdIndex] !== VAULT_IDENTITY.tokenProgram) continue;
      const data = bs58.decode(instruction.dataBase58);
      const keys = instruction.accounts.map((index) => audit.accountKeys[index]);
      let matches = false;
      // Pinned SPL Token instruction encodings: Transfer(3/12), MintTo(7/14), Burn(8/15).
      if (action === "deposit") matches = (data[0] === 7 || data[0] === 14) &&
        keys[0] === accounts.lpMint && keys[1] === accounts.userLpAta && keys[2] === accounts.lpMintAuth;
      else if (action === "request-withdraw") matches =
        (data[0] === 3 && keys[0] === accounts.userLpAta && keys[1] === accounts.escrowLpAta && keys[2] === wallet) ||
        (data[0] === 12 && keys[0] === accounts.userLpAta && keys[1] === accounts.lpMint && keys[2] === accounts.escrowLpAta && keys[3] === wallet);
      else matches = (data[0] === 8 || data[0] === 15) &&
        keys[0] === accounts.escrowLpAta && keys[1] === accounts.lpMint && keys[2] === accounts.receipt;
      if (matches && (data.length === 9 || data.length === 10)) {
        tokenAmount += new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true);
      }
    }
    const expected = action === "deposit" ? delta("wallet LP") :
      action === "request-withdraw" ? delta("request escrow LP") : -delta("request escrow LP");
    if (expected <= 0n || tokenAmount !== expected) unresolved.push("inner SPL mint/transfer/burn amount does not prove the LP effect");
    else programEvidence.push(`${action}: inner SPL instruction proves ${tokenAmount} raw LP`);
  }
  if (record.preBalances.length !== audit.accountKeys.length || record.postBalances.length !== audit.accountKeys.length) {
    unresolved.push("native account balance evidence does not match the transaction keys");
  } else if (action !== "deposit") {
    const receiptIndex = audit.accountKeys.indexOf(accounts.receipt);
    const before = record.preBalances[receiptIndex], after = record.postBalances[receiptIndex];
    if (before === undefined || after === undefined ||
        (action === "request-withdraw" ? before !== "0" || BigInt(after) <= 0n : BigInt(before) <= 0n || after !== "0")) {
      unresolved.push("withdrawal receipt creation/closure is not proven by this transaction");
    } else programEvidence.push(`${action}: receipt ${accounts.receipt} ${action === "claim" ? "closed" : "created"}`);
  }

  const allExpectationsMet = entries.length > 0 && entries.every((entry) => entry.matchesExpectation);
  const reasons = [
    ...unresolved.map((entry) => `could not verify: ${entry}`),
    ...(allExpectationsMet
      ? []
      : entries
          .filter((entry) => !entry.matchesExpectation)
          .map((entry) => `${entry.label} moved ${entry.deltaRaw} raw, contradicting the expected ${entry.expected} movement`)),
  ];

  return respond({
    state: reasons.length === 0 ? "finalized-reconciled" : "finalized-unreconciled",
    action,
    finalized: true,
    reason: reasons.length === 0 ? null : reasons.join("; "),
    observation,
    binding,
    effects: {
      basis: "pre/post token balances of this finalized transaction, attributed by resolved account address",
      entries,
      programEvidence,
      allExpectationsMet: allExpectationsMet && unresolved.length === 0,
    },
  });
}
