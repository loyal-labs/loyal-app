/**
 * Client-side audit of a server-prepared quote, plus strict UI amount parsing.
 *
 * Pure and browser-safe: no signing, no RPC, no storage, no UI, no side
 * effects. Everything here either parses text into bigint or verifies bytes.
 *
 * The audit never trusts what a quote says about itself. `PrepareSuccess`
 * carries self-describing fields — canonical instruction labels, required
 * signers, a `signaturesZeroed` flag — and all of them are treated as
 * unverified claims. The only accepted evidence is a byte-exact match between
 * the wire the server quoted and a wire this module rebuilds independently
 * from the caller's own intent plus the quote's blockhash. Because the
 * rebuild goes through `buildUnsignedTransaction`, every account, signer,
 * amount and create-ATA decision is re-derived from the pinned identity table,
 * so an extra instruction, recipient or signer can only appear as a mismatch.
 *
 * `PrepareSuccess` is imported as a type only: the server prepare module is
 * never pulled into a client graph.
 */

import { Buffer } from "buffer";
import type { Address } from "@solana/kit";
import { VersionedTransaction, type MessageV0 } from "@solana/web3.js";

import { parseWalletParam, VAULT_IDENTITY } from "./identity";
import { buildUnsignedTransaction, U64_MAX, VAULT_ACTIONS, type VaultAction } from "./transactions";
import type { PrepareSuccess } from "../server/transaction-prepare";

/** Hard client bound on every quoted timestamp. Not configurable by the quote. */
export const MAX_QUOTE_AGE_MS = 15_000;

/** Clock-skew allowance: a quote may be barely ahead of this device, never far ahead. */
export const MAX_FUTURE_SKEW_MS = 2_000;

/** Solana packet limit; a wire at or over it cannot be submitted. */
export const MAX_WIRE_BYTES = 1_232;

const SCHEMA_VERSION = "loyal-vault-demo.transaction-preparation/1";

/** User intent for one audited quote. Nothing else may be supplied. */
export type QuoteAuditIntent = Readonly<{
  wallet: string;
  action: VaultAction;
  /** withdrawAll: true carries the caller-observed wallet LP balance, not null. */
  amountRaw: bigint | null;
  withdrawAll: boolean;
}>;

/**
 * The only chain states a quote may have been built against, per action. Each
 * variant is rebuilt and byte-compared; anything outside this set is not a
 * transaction this client will show a wallet.
 */
const PERMITTED_ATA_VARIANTS: Readonly<Record<VaultAction, readonly (Readonly<{ usdc: boolean; lp: boolean }>)[]>> = {
  deposit: [
    { usdc: true, lp: true },
    // A missing LP account gets an idempotent create-ATA pre-instruction.
    { usdc: true, lp: false },
  ],
  "request-withdraw": [{ usdc: true, lp: true }],
  claim: [
    // A missing USDC destination gets an idempotent create-ATA pre-instruction.
    { usdc: false, lp: true },
    { usdc: true, lp: true },
  ],
};

const QUOTE_TOP_LEVEL_KEYS = [
  "schemaVersion",
  "action",
  "wallet",
  "cluster",
  "bound",
  "transaction",
  "preview",
  "prerequisites",
  "observation",
  "quote",
  "warnings",
] as const;

const QUOTE_BOUND_KEYS = ["vault", "voltrProgram", "assetMint", "assetDecimals", "lpMint", "lpDecimals"] as const;

const QUOTE_TRANSACTION_KEYS = [
  "wireBase64",
  "messageSha256",
  "wireByteLength",
  "feePayer",
  "requiredSigners",
  "signaturesZeroed",
  "blockhash",
  "lastValidBlockHeight",
  "instructions",
] as const;

const QUOTE_EXPIRY_KEYS = ["preparedAt", "validForBlockHeight", "expiresWhen", "maxStalenessMs"] as const;

const QUOTE_OBSERVATION_KEYS = [
  "vaultSlot",
  "vaultObservedAt",
  "positionSlot",
  "positionObservedAt",
  "snapshotCoherent",
  "navStatus",
  "navDetail",
  "idleCustody",
  "workerObservation",
] as const;

const INTENT_KEYS = ["wallet", "action", "amountRaw", "withdrawAll"] as const;

/* ------------------------------------------------------------------ helpers */

function fail(reason: string): never {
  throw new Error(`prepared quote rejected: ${reason}`);
}

/** Rejects any object carrying keys outside the audited schema, or missing one. */
function requireExactKeys(value: object, expected: readonly string[], label: string): void {
  const present = Object.keys(value).sort();
  const want = [...expected].sort();
  const unexpected = present.filter((key) => !want.includes(key));
  const missing = want.filter((key) => !present.includes(key));
  if (unexpected.length > 0 || missing.length > 0) {
    const parts: string[] = [];
    if (unexpected.length > 0) parts.push(`unexpected ${unexpected.join(", ")}`);
    if (missing.length > 0) parts.push(`missing ${missing.join(", ")}`);
    fail(`${label} does not match schema version ${SCHEMA_VERSION}: ${parts.join("; ")}`);
  }
}

function requireDecimalU64(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    fail(`${label} must be a positive decimal integer string`);
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX) fail(`${label} exceeds the u64 maximum ${U64_MAX}`);
  return parsed;
}

function requireTimestamp(value: unknown, label: string): number {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be an ISO-8601 timestamp string`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail(`${label} is not a parseable timestamp`);
  return ms;
}

/* ------------------------------------------------------------- ui -> bigint */

/**
 * Parses a user-entered amount into raw integer units with pure bigint math:
 * no float is ever involved. Requires plain decimal digits, at most one ".",
 * no sign, no exponent, no surrounding whitespace, no fractional digits
 * beyond `decimals`, and a result strictly positive and within u64.
 */
export function parseUiAmount(text: string, decimals: number): bigint {
  if (typeof text !== "string") throw new TypeError("ui amount must be a string");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError(`decimals must be an integer between 0 and 18, got ${decimals}`);
  }
  if (/[eE]/.test(text)) throw new Error("ui amount must not use exponent notation");
  if (/[+-]/.test(text)) throw new Error("ui amount must not be signed");
  if (/\s/.test(text)) throw new Error("ui amount must not contain whitespace");
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text)) {
    throw new Error("ui amount must be plain decimal digits with at most one decimal point");
  }

  const [integerPart, fractionPart] = text.split(".");
  if (fractionPart !== undefined && fractionPart.length > decimals) {
    throw new Error(`ui amount carries more precision than ${decimals} decimals allow`);
  }

  const scale = 10n ** BigInt(decimals);
  const whole = BigInt(integerPart!);
  const fraction = BigInt((fractionPart ?? "").padEnd(decimals, "0"));
  const value = whole * scale + fraction;

  if (value === 0n) throw new Error("ui amount must be greater than zero");
  if (value > U64_MAX) throw new Error(`ui amount exceeds the u64 maximum ${U64_MAX}`);
  return value;
}

/* ------------------------------------------------------------ schema + time */

function auditQuoteSchema(quote: PrepareSuccess): void {
  if (typeof quote !== "object" || quote === null || Array.isArray(quote)) fail("quote must be a JSON object");
  requireExactKeys(quote, QUOTE_TOP_LEVEL_KEYS, "quote");
  if (quote.schemaVersion !== SCHEMA_VERSION) {
    fail(`unsupported schemaVersion ${String(quote.schemaVersion)}; expected ${SCHEMA_VERSION}`);
  }

  requireExactKeys(quote.bound, QUOTE_BOUND_KEYS, "quote.bound");
  requireExactKeys(quote.transaction, QUOTE_TRANSACTION_KEYS, "quote.transaction");
  requireExactKeys(quote.quote, QUOTE_EXPIRY_KEYS, "quote.quote");
  requireExactKeys(quote.observation, QUOTE_OBSERVATION_KEYS, "quote.observation");

  const transaction = quote.transaction;
  if (!Number.isInteger(transaction.wireByteLength) || transaction.wireByteLength <= 0) {
    fail("quote.transaction.wireByteLength must be a positive integer");
  }
  if (typeof transaction.blockhash !== "string" || transaction.blockhash.length === 0) {
    fail("quote.transaction.blockhash must be a non-empty string");
  }
  if (typeof transaction.feePayer !== "string" || transaction.feePayer.length === 0) {
    fail("quote.transaction.feePayer must be a non-empty string");
  }
  if (!Array.isArray(transaction.requiredSigners) || transaction.requiredSigners.some((value) => typeof value !== "string")) {
    fail("quote.transaction.requiredSigners must be an array of address strings");
  }
  if (!Array.isArray(quote.warnings)) fail("quote.warnings must be an array");
  if (typeof quote.preview !== "object" || quote.preview === null) fail("quote.preview must be an object");
  if (!Array.isArray(quote.prerequisites)) fail("quote.prerequisites must be an array");

  const observation = quote.observation;
  if (!Number.isSafeInteger(observation.vaultSlot) || observation.vaultSlot <= 0 ||
      observation.vaultSlot !== observation.positionSlot || observation.snapshotCoherent !== true) {
    fail("quote observations must share one coherent positive slot");
  }
}

/**
 * Applies the hard freshness bound to every timestamp the quote is only as
 * good as. `quote.maxStalenessMs` is disclosure and never widens the bound.
 */
function auditQuoteFreshness(quote: PrepareSuccess, nowMs: number): void {
  const declaredMaxStalenessMs = quote.quote.maxStalenessMs;
  if (typeof declaredMaxStalenessMs !== "number" || !Number.isInteger(declaredMaxStalenessMs) || declaredMaxStalenessMs <= 0) {
    fail("quote.quote.maxStalenessMs must be a positive integer number of milliseconds");
  }
  if (declaredMaxStalenessMs > MAX_QUOTE_AGE_MS) {
    fail(
      `quote declares maxStalenessMs ${declaredMaxStalenessMs}, wider than this client's hard ${MAX_QUOTE_AGE_MS}ms bound; the client bound is not negotiable`,
    );
  }
  if (typeof quote.quote.expiresWhen !== "string" || quote.quote.expiresWhen.length === 0) {
    fail("quote.quote.expiresWhen must be a non-empty disclosure string");
  }

  const timestamps: readonly (readonly [unknown, string])[] = [
    [quote.quote.preparedAt, "quote.quote.preparedAt"],
    [quote.observation.vaultObservedAt, "quote.observation.vaultObservedAt"],
    [quote.observation.positionObservedAt, "quote.observation.positionObservedAt"],
  ];
  for (const [value, label] of timestamps) {
    const observedMs = requireTimestamp(value, label);
    const ageMs = nowMs - observedMs;
    if (ageMs < -MAX_FUTURE_SKEW_MS) {
      fail(`${label} is ${-ageMs}ms in the future, beyond the ${MAX_FUTURE_SKEW_MS}ms clock-skew allowance`);
    }
    if (ageMs > MAX_QUOTE_AGE_MS) {
      fail(`${label} is ${ageMs}ms old, past the hard ${MAX_QUOTE_AGE_MS}ms client bound: re-quote before signing`);
    }
  }
}

function auditPinnedIdentities(quote: PrepareSuccess): void {
  if (quote.cluster !== VAULT_IDENTITY.cluster) {
    fail(`quote targets cluster ${String(quote.cluster)}, not the pinned ${VAULT_IDENTITY.cluster}`);
  }
  const bound = quote.bound;
  if (bound.vault !== VAULT_IDENTITY.vault) fail("quote is bound to a foreign vault");
  if (bound.voltrProgram !== VAULT_IDENTITY.voltrProgram) fail("quote is bound to a foreign Voltr program");
  if (bound.assetMint !== VAULT_IDENTITY.assetMint) fail("quote is bound to a foreign asset mint");
  if (bound.lpMint !== VAULT_IDENTITY.lpMint) fail("quote is bound to a foreign LP mint");
  if (bound.assetDecimals !== VAULT_IDENTITY.assetDecimals) fail("quote declares foreign asset decimals");
  if (bound.lpDecimals !== VAULT_IDENTITY.lpDecimals) fail("quote declares foreign LP decimals");
  if (quote.action === "deposit" && quote.observation.navStatus !== "fresh") fail("deposit NAV is not fresh");
}

/* ------------------------------------------------------------------- intent */

function auditIntent(intent: QuoteAuditIntent): { wallet: Address } {
  if (typeof intent !== "object" || intent === null) fail("intent must be an object");
  requireExactKeys(intent, INTENT_KEYS, "intent");
  if (!VAULT_ACTIONS.includes(intent.action)) fail(`intent.action ${String(intent.action)} is not a supported action`);

  const walletParse = parseWalletParam(intent.wallet);
  if (!walletParse.ok) fail(`intent.wallet is not a usable wallet: ${walletParse.reason}`);
  return { wallet: walletParse.wallet };
}

/**
 * Checks the intent's own shape against the action, and pins the withdraw-all
 * rule: the amount there is the caller's own observation of the wallet LP
 * balance. The server writes that same figure into the instruction, so a
 * balance that moved after the caller looked is caught by the byte comparison
 * below and the only remedy is a fresh quote.
 */
function auditIntentAmounts(intent: QuoteAuditIntent): { amountRaw: bigint | null; withdrawAll: boolean } {
  const { action, amountRaw, withdrawAll } = intent;
  if (typeof withdrawAll !== "boolean") fail("intent.withdrawAll must be a boolean");

  if (action === "claim") {
    if (amountRaw !== null) fail("claim intent must carry no amountRaw: the on-chain receipt defines the payout");
    if (withdrawAll) fail("claim intent takes no withdrawAll flag");
    return { amountRaw: null, withdrawAll: false };
  }

  if (typeof amountRaw !== "bigint") fail(`${action} intent requires amountRaw as a bigint, not a number or string`);
  if (amountRaw <= 0n) fail(`${action} intent amount must be greater than zero`);
  if (amountRaw > U64_MAX) fail(`${action} intent amount exceeds the u64 maximum ${U64_MAX}`);
  if (action === "deposit" && withdrawAll) fail("deposit intent takes no withdrawAll flag");

  return { amountRaw, withdrawAll: action === "deposit" ? false : withdrawAll };
}

/* --------------------------------------------------------------------- wire */

function decodeWire(wireBase64: string, declaredByteLength: number): Uint8Array {
  if (typeof wireBase64 !== "string" || wireBase64.length === 0) fail("quote wireBase64 must be a non-empty base64 string");
  const bytes = Buffer.from(wireBase64, "base64");
  // Buffer's base64 decoder silently drops characters it does not accept, so
  // only a re-encode round trip proves the string is the canonical form.
  if (Buffer.from(bytes).toString("base64") !== wireBase64) fail("quote wireBase64 is not canonical base64");
  if (bytes.byteLength > MAX_WIRE_BYTES) {
    fail(`quoted wire is ${bytes.byteLength} bytes, over the ${MAX_WIRE_BYTES}-byte packet limit`);
  }
  if (bytes.byteLength !== declaredByteLength) {
    fail(`quoted wire is ${bytes.byteLength} bytes but declares ${declaredByteLength}`);
  }
  return new Uint8Array(bytes);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Decodes the quoted wire and checks the facts that must hold no matter what
 * the rebuild says: one v0 message, no lookup tables, one zeroed signature
 * slot, the wallet as the only required signer and fee payer, and the quoted
 * blockhash. Signers and accounts come from the decoded message, never from
 * the quote's own labels.
 */
function auditQuotedWire(bytes: Uint8Array, wallet: string, blockhash: string): VersionedTransaction {
  let parsed: VersionedTransaction;
  try {
    parsed = VersionedTransaction.deserialize(bytes);
  } catch (error) {
    fail(`quoted wire is not a decodable versioned transaction: ${error instanceof Error ? error.message : String(error)}`);
  }

  const message = parsed.message;
  if (message.version === "legacy") fail("quoted wire must carry a v0 message, not a legacy one");
  const v0 = message as MessageV0;

  if (v0.addressTableLookups.length > 0) fail("quoted wire must not resolve accounts through lookup tables");
  if (parsed.signatures.length !== 1) fail(`quoted wire carries ${parsed.signatures.length} signature slots, expected exactly 1`);
  const signature = parsed.signatures[0]!;
  if (!signature.every((byte) => byte === 0)) fail("quoted wire signature slot is not zeroed: it may already be signed by someone");
  if (v0.header.numRequiredSignatures !== 1) fail(`quoted wire requires ${v0.header.numRequiredSignatures} signatures, expected exactly 1`);

  const requiredSigners = v0.staticAccountKeys
    .slice(0, v0.header.numRequiredSignatures)
    .map((key) => key.toBase58());
  if (requiredSigners.length !== 1 || requiredSigners[0] !== wallet) {
    fail(`quoted wire required signers (${requiredSigners.join(", ")}) are not exactly the wallet`);
  }
  if (v0.staticAccountKeys.length === 0 || v0.staticAccountKeys[0]!.toBase58() !== wallet) {
    fail("quoted wire fee payer is not the wallet");
  }
  if (v0.recentBlockhash !== blockhash) {
    fail(`quoted wire blockhash ${v0.recentBlockhash} is not the quoted ${blockhash}`);
  }
  return parsed;
}

/* -------------------------------------------------------------------- audit */

/**
 * Audits a server-prepared quote against the user's exact intent and returns
 * the decoded transaction only if an independently rebuilt wire matches the
 * quoted wire byte for byte. Anything else throws, and nothing here signs,
 * sends, reads the chain or touches storage.
 */
export async function auditPreparedQuote(quote: PrepareSuccess, intent: QuoteAuditIntent): Promise<VersionedTransaction> {
  auditQuoteSchema(quote);

  const { wallet } = auditIntent(intent);
  if (quote.wallet !== intent.wallet) fail(`quote is bound to wallet ${quote.wallet}, not the requested ${intent.wallet}`);
  if (quote.action !== intent.action) fail(`quote is for action ${quote.action}, not the requested ${intent.action}`);

  auditQuoteFreshness(quote, Date.now());
  auditPinnedIdentities(quote);

  const lastValidBlockHeight = requireDecimalU64(quote.transaction.lastValidBlockHeight, "quote.transaction.lastValidBlockHeight");
  const quotedValidForBlockHeight = requireDecimalU64(quote.quote.validForBlockHeight, "quote.quote.validForBlockHeight");
  if (lastValidBlockHeight !== quotedValidForBlockHeight) {
    fail("quote expiry metadata does not match the quoted transaction's block height bound");
  }

  const { amountRaw, withdrawAll } = auditIntentAmounts(intent);
  const wireBytes = decodeWire(quote.transaction.wireBase64, quote.transaction.wireByteLength);
  const decoded = auditQuotedWire(wireBytes, intent.wallet, quote.transaction.blockhash);

  let matched = false;
  for (const variant of PERMITTED_ATA_VARIANTS[intent.action]) {
    const rebuilt = await buildUnsignedTransaction({
      wallet,
      action: intent.action,
      amountRaw,
      withdrawAll,
      blockhash: quote.transaction.blockhash,
      lastValidBlockHeight,
      walletUsdcAtaExists: variant.usdc,
      walletLpAtaExists: variant.lp,
    });
    if (!rebuilt.ok) continue;
    const rebuiltBytes = new Uint8Array(Buffer.from(rebuilt.transaction.wireBase64, "base64"));
    if (!bytesEqual(rebuiltBytes, wireBytes)) continue;
    matched = true;
    break;
  }

  if (!matched) {
    const variants = PERMITTED_ATA_VARIANTS[intent.action]
      .map((variant) => `usdc=${variant.usdc},lp=${variant.lp}`)
      .join(" | ");
    fail(
      `no permitted token-account variant (${variants}) reproduces the quoted wire for ${intent.action} amountRaw=${String(amountRaw)} withdrawAll=${String(withdrawAll)}: the quoted instructions, accounts, signers or amounts diverge from this intent, so re-quote`,
    );
  }

  if (typeof quote.transaction.messageSha256 !== "string" ||
      quote.transaction.messageSha256 !== await transactionMessageDigest(decoded)) {
    fail("prepared message fingerprint does not match the decoded transaction");
  }
  return decoded;
}

/** Same message fingerprint as server reconciliation, computed without server imports. */
export async function transactionMessageDigest(transaction: VersionedTransaction): Promise<string> {
  const bytes = Uint8Array.from(transaction.message.serialize());
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
