/**
 * Narrow bounded reads for the transaction boundary.
 *
 * Three methods only — latest blockhash, signature state and finalized
 * transaction — each with the same timeout/attempt/backoff discipline and the
 * same typed failure kinds as the read model's `BoundedRpc`. This is not a
 * general RPC proxy: a method not listed here is unreachable from this app,
 * and results are validated field by field, never taken on trust.
 *
 * The pinned-cluster guard is delegated to the shared read client's cached
 * genesis check, so both read surfaces answer the same identity question.
 */

import bs58 from "bs58";
import { isAddress } from "@solana/kit";

import type { RpcResult } from "./rpc";
import { RPC_BOUNDS, rpcUrlFromEnv } from "./config";
import { getVaultRpc } from "./rpc";

export type LatestBlockhash = Readonly<{ blockhash: string; lastValidBlockHeight: bigint; slot: number }>;

export type TokenBalance = Readonly<{
  accountIndex: number;
  mint: string;
  owner: string;
  amountRaw: string;
  decimals: number;
}>;

export type InnerInstruction = Readonly<{
  outerIndex: number;
  programIdIndex: number;
  accounts: readonly number[];
  dataBase58: string;
}>;

export type FinalizedTransaction = Readonly<{
  slot: number;
  blockTimeSec: bigint | null;
  feeLamports: bigint;
  /** Program-level failure string, or null when the transaction succeeded. */
  err: string | null;
  /** True when the transaction uses address lookup tables, which a demo-prepared transaction never does. */
  usesAddressLookupTables: boolean;
  transactionBase64: string;
  preTokenBalances: readonly TokenBalance[];
  postTokenBalances: readonly TokenBalance[];
  preBalances: readonly string[];
  postBalances: readonly string[];
  innerInstructions: readonly InnerInstruction[] | null;
}>;

export type SignatureState = Readonly<{
  slot: number | null;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  err: string | null;
}>;

type Envelope = { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: { code?: number } };

const MAX_BACKOFF_MS = 4_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number): number {
  return Math.min(400 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

type Extracted<T> = { ok: true; value: T; contextSlot: number | null } | { ok: false; error: string };

function envelopeSlot(result: unknown): number | null {
  const slot = (result as { context?: { slot?: unknown } } | null)?.context?.slot;
  if (typeof slot === "number" && Number.isSafeInteger(slot) && slot >= 0) return slot;
  return null;
}

function unsignedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseTokenBalances(value: unknown): TokenBalance[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  const parsed: TokenBalance[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const entry = item as Record<string, unknown>;
    const amount = entry.uiTokenAmount as { amount?: unknown; decimals?: unknown } | null;
    if (!unsignedInteger(entry.accountIndex) || seen.has(entry.accountIndex) ||
        typeof entry.mint !== "string" || !isAddress(entry.mint) ||
        typeof entry.owner !== "string" || !isAddress(entry.owner) ||
        typeof amount?.amount !== "string" || !/^(0|[1-9][0-9]*)$/.test(amount.amount) ||
        BigInt(amount.amount) > 18_446_744_073_709_551_615n ||
        !unsignedInteger(amount.decimals) || amount.decimals > 255) return null;
    seen.add(entry.accountIndex);
    parsed.push({ accountIndex: entry.accountIndex, mint: entry.mint, owner: entry.owner,
      amountRaw: amount.amount, decimals: amount.decimals });
  }
  return parsed;
}

function parseInnerInstructions(value: unknown): InnerInstruction[] | null | false {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return false;
  const result: InnerInstruction[] = [];
  const groups = new Set<number>();
  for (const group of value) {
    if (!group || !unsignedInteger(group.index) || groups.has(group.index) || !Array.isArray(group.instructions)) return false;
    groups.add(group.index);
    for (const instruction of group.instructions) {
      if (!instruction || !unsignedInteger(instruction.programIdIndex) ||
          !Array.isArray(instruction.accounts) || !instruction.accounts.every(unsignedInteger) ||
          typeof instruction.data !== "string") return false;
      try { bs58.decode(instruction.data); } catch { return false; }
      result.push({ outerIndex: group.index, programIdIndex: instruction.programIdIndex,
        accounts: instruction.accounts, dataBase58: instruction.data });
    }
  }
  return result;
}

function errToString(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "unknown transaction error";
  }
}

export class TransactionReadRpc {
  constructor(
    private readonly url: string,
    private readonly timeoutMs: number = RPC_BOUNDS.timeoutMs,
    private readonly maxAttempts: number = RPC_BOUNDS.maxAttempts,
  ) {}

  private async call<T>(method: string, params: unknown[], extract: (result: unknown) => Extracted<T>): Promise<RpcResult<T>> {
    let lastError = "no attempt made";
    let lastKind: "network" | "rate-limited" | "rpc-error" | "timeout" | "decode" = "network";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (attempt > 1) await sleep(backoffMs(attempt - 1));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: controller.signal,
        });
        if (response.status === 429) {
          lastKind = "rate-limited";
          lastError = `HTTP 429 from ${method}`;
          continue;
        }
        if (!response.ok) {
          lastKind = response.status >= 500 ? "network" : "rpc-error";
          lastError = `HTTP ${response.status} from ${method}`;
          continue;
        }
        const payload = (await response.json()) as Envelope;
        if (!payload || typeof payload !== "object" || payload.jsonrpc !== "2.0" || payload.id !== 1) {
          return { ok: false, kind: "decode", error: `${method}: malformed RPC envelope`, attempts: attempt };
        }
        if (payload.error !== undefined) {
          return { ok: false, kind: "rpc-error", error: `${method}: RPC error ${payload.error?.code ?? "unknown"}`, attempts: attempt };
        }
        if (!("result" in payload)) {
          return { ok: false, kind: "decode", error: `${method}: response has no result`, attempts: attempt };
        }
        const extracted = extract(payload.result);
        if (!extracted.ok) {
          return { ok: false, kind: "decode", error: `${method}: ${extracted.error}`, attempts: attempt };
        }
        return { ok: true, value: extracted.value, contextSlot: extracted.contextSlot, attempts: attempt };
      } catch (error) {
        lastKind = error instanceof Error && error.name === "AbortError" ? "timeout" : "network";
        lastError = lastKind === "timeout" ? "request timed out" : "request failed";
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, kind: lastKind, error: `${method}: ${lastError}`, attempts: this.maxAttempts };
  }

  /** The blockhash a new transaction is bound to, with its validity horizon. */
  async getLatestBlockhash(): Promise<RpcResult<LatestBlockhash>> {
    return this.call<LatestBlockhash>("getLatestBlockhash", [{ commitment: RPC_BOUNDS.commitment }], (result) => {
      const contextSlot = envelopeSlot(result);
      if (contextSlot === null) return { ok: false, error: "missing or invalid context.slot" };
      const value = (result as { value?: unknown } | null)?.value as
        | { blockhash?: unknown; lastValidBlockHeight?: unknown }
        | null
        | undefined;
      if (!value || typeof value.blockhash !== "string" || !isAddress(value.blockhash)) {
        return { ok: false, error: "blockhash is missing" };
      }
      if (!unsignedInteger(value.lastValidBlockHeight)) {
        return { ok: false, error: "lastValidBlockHeight is missing" };
      }
      return {
        ok: true,
        contextSlot,
        value: { blockhash: value.blockhash, lastValidBlockHeight: BigInt(value.lastValidBlockHeight), slot: contextSlot },
      };
    });
  }

  /**
   * A signature is 64 bytes of base58; anything else is rejected before it can
   * reach the endpoint as a query string.
   */
  static isWellFormedSignature(signature: string): boolean {
    if (signature.length < 64 || signature.length > 88) return false;
    try {
      return bs58.decode(signature).byteLength === 64;
    } catch {
      return false;
    }
  }

  /** `value: null` means the cluster has no such transaction yet. */
  async getFinalizedTransaction(signature: string): Promise<RpcResult<FinalizedTransaction | null>> {
    if (!TransactionReadRpc.isWellFormedSignature(signature)) {
      return { ok: false, kind: "decode", error: "signature is not a well-formed 64-byte base58 value", attempts: 0 };
    }
    return this.call<FinalizedTransaction | null>(
      "getTransaction",
      [
        signature,
        {
          encoding: "base64",
          commitment: RPC_BOUNDS.commitment,
          maxSupportedTransactionVersion: 0,
        },
      ],
      (result) => {
        if (result === null) return { ok: true, value: null, contextSlot: null };
        if (typeof result !== "object" || result === null) return { ok: false, error: "transaction result is not an object" };
        const slot = (result as { slot?: unknown }).slot;
        if (!unsignedInteger(slot)) return { ok: false, error: "missing or invalid transaction slot" };
        const record = result as {
          blockTime?: unknown;
          transaction?: unknown;
          meta?: unknown;
        };
        if (!Array.isArray(record.transaction) || record.transaction.length !== 2 ||
            typeof record.transaction[0] !== "string" || record.transaction[1] !== "base64" ||
            record.transaction[0].length === 0 ||
            Buffer.from(record.transaction[0], "base64").toString("base64") !== record.transaction[0]) {
          return { ok: false, error: "transaction payload must be canonical base64 with its encoding tag" };
        }
        if (record.blockTime !== null && !unsignedInteger(record.blockTime)) {
          return { ok: false, error: "invalid transaction block time" };
        }
        const meta = record.meta as
          | {
              err?: unknown;
              fee?: unknown;
              preTokenBalances?: unknown;
              postTokenBalances?: unknown;
              preBalances?: unknown;
              postBalances?: unknown;
              innerInstructions?: unknown;
              loadedAddresses?: { writable?: unknown; readonly?: unknown } | null;
            }
          | null
          | undefined;
        if (!meta || typeof meta !== "object") return { ok: false, error: "transaction meta is missing" };
        if (!("err" in meta) || !unsignedInteger(meta.fee)) {
          return { ok: false, error: "transaction error or fee metadata is missing or invalid" };
        }
        if (meta.err !== null) {
          if (!((typeof meta.err === "string" && meta.err.length > 0) ||
              (typeof meta.err === "object" && !Array.isArray(meta.err)))) {
            return { ok: false, error: "invalid transaction error metadata" };
          }
          // Failed finalized execution needs no token effects to be terminal.
          return { ok: true, contextSlot: slot, value: {
            slot, blockTimeSec: typeof record.blockTime === "number" ? BigInt(record.blockTime) : null,
            feeLamports: BigInt(meta.fee), err: errToString(meta.err), usesAddressLookupTables: false,
            transactionBase64: record.transaction[0], preTokenBalances: [], postTokenBalances: [],
            preBalances: [], postBalances: [], innerInstructions: null,
          } };
        }
        const pre = parseTokenBalances(meta.preTokenBalances);
        const post = parseTokenBalances(meta.postTokenBalances);
        if (pre === null || post === null) return { ok: false, error: "token balance entries are malformed" };
        if (!Array.isArray(meta.preBalances) || !Array.isArray(meta.postBalances) ||
            meta.preBalances.length !== meta.postBalances.length ||
            !meta.preBalances.every(unsignedInteger) || !meta.postBalances.every(unsignedInteger)) {
          return { ok: false, error: "native balance evidence is missing or malformed" };
        }
        const innerInstructions = parseInnerInstructions(meta.innerInstructions);
        if (innerInstructions === false) return { ok: false, error: "inner instruction evidence is malformed" };
        const loaded = meta.loadedAddresses ?? { writable: [], readonly: [] };
        if (!Array.isArray(loaded.writable) || !Array.isArray(loaded.readonly) ||
            ![...loaded.writable, ...loaded.readonly].every((key) => typeof key === "string" && isAddress(key))) {
          return { ok: false, error: "malformed loaded addresses" };
        }
        const lookupCount = loaded.writable.length + loaded.readonly.length;
        return {
          ok: true,
          contextSlot: slot,
          value: {
            slot,
            blockTimeSec: typeof record.blockTime === "number" ? BigInt(record.blockTime) : null,
            feeLamports: typeof meta.fee === "number" ? BigInt(meta.fee) : 0n,
            err: errToString(meta.err),
            usesAddressLookupTables: lookupCount > 0,
            transactionBase64: record.transaction[0],
            preTokenBalances: pre,
            postTokenBalances: post,
            preBalances: meta.preBalances.map(String),
            postBalances: meta.postBalances.map(String),
            innerInstructions,
          },
        };
      },
    );
  }

  /** Confirmation progress for a signature the cluster may not know yet. */
  async getSignatureState(signature: string): Promise<RpcResult<SignatureState | null>> {
    if (!TransactionReadRpc.isWellFormedSignature(signature)) {
      return { ok: false, kind: "decode", error: "signature is not a well-formed 64-byte base58 value", attempts: 0 };
    }
    return this.call<SignatureState | null>(
      "getSignatureStatuses",
      [[signature], { commitment: RPC_BOUNDS.commitment, searchTransactionHistory: true }],
      (result) => {
        const contextSlot = envelopeSlot(result);
        if (contextSlot === null) return { ok: false, error: "missing or invalid context.slot" };
        const list = (result as { value?: unknown } | null)?.value;
        if (!Array.isArray(list) || list.length !== 1) {
          return { ok: false, error: `expected one status, received ${Array.isArray(list) ? list.length : "non-array"}` };
        }
        const entry = list[0];
        if (entry === null) return { ok: true, value: null, contextSlot };
        const candidate = entry as { slot?: unknown; confirmationStatus?: unknown; err?: unknown } | null;
        if (!candidate || typeof candidate !== "object") return { ok: false, error: "status entry is malformed" };
        if (!unsignedInteger(candidate.slot) || !("err" in candidate)) {
          return { ok: false, error: "status slot or error metadata is missing or invalid" };
        }
        const status = candidate.confirmationStatus;
        const normalized =
          status === "processed" || status === "confirmed" || status === "finalized" ? status : null;
        if (normalized === null) return { ok: false, error: "invalid confirmation status" };
        return {
          ok: true,
          contextSlot,
          value: {
            slot: candidate.slot,
            confirmationStatus: normalized,
            err: errToString(candidate.err),
          },
        };
      },
    );
  }
}

let sharedTransactionRpc: TransactionReadRpc | null = null;

/** One process-wide transaction read client; bounded and read-only. */
export function getTransactionRpc(): TransactionReadRpc {
  if (!sharedTransactionRpc) sharedTransactionRpc = new TransactionReadRpc(rpcUrlFromEnv());
  return sharedTransactionRpc;
}

/**
 * The endpoint must be the pinned mainnet cluster before any transaction
 * evidence is believed. Delegates to the shared read client so the check is
 * performed (and cached) once for the whole app.
 */
export async function assertPinnedCluster(): Promise<RpcResult<string>> {
  return getVaultRpc().getGenesisHash();
}
