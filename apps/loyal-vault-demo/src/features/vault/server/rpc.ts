/**
 * Bounded read-only JSON-RPC client.
 *
 * Deliberately narrow: three methods, a timeout, exponential backoff and
 * finalized commitment. The JSON-RPC envelope is validated: a missing `result`
 * is a decode failure, an explicit JSON `null` is preserved as "account
 * missing", and `context.slot` must be a real slot where one is expected.
 * Failures are typed, never converted into an empty success, a zero balance or
 * a missing account, and never carry endpoint details.
 */

import { isAddress } from "@solana/kit";
import { RPC_BOUNDS, VAULT_IDENTITY, rpcUrlFromEnv } from "./config";

export type RpcFailure = Readonly<{
  ok: false;
  kind: "network" | "rate-limited" | "rpc-error" | "timeout" | "decode";
  error: string;
  attempts: number;
}>;

export type RpcSuccess<T> = Readonly<{
  ok: true;
  value: T;
  contextSlot: number | null;
  attempts: number;
}>;
export type RpcResult<T> = RpcSuccess<T> | RpcFailure;

export type AccountData = Readonly<{
  address: string;
  owner: string;
  lamports: number;
  /** Undefined when a transport response did not supply this identity field. */
  executable?: boolean;
  data: Uint8Array;
}>;

const MAX_BACKOFF_MS = 4_000;

type Envelope = {
  jsonrpc?: unknown;
  id?: unknown;
  result?: unknown;
  error?: { message?: string; code?: number };
};

function backoffMs(attempt: number): number {
  return Math.min(400 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Extracted<T> =
  | { ok: true; value: T; contextSlot: number | null }
  | { ok: false; error: string };

function decodeAccount(
  value: unknown,
  address: string
): AccountData | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || !value) return undefined;
  const a = value as { owner?: unknown; lamports?: unknown; data?: unknown; executable?: unknown };
  if (
    typeof a.owner !== "string" ||
    !isAddress(a.owner) ||
    typeof a.lamports !== "number" ||
    !Number.isSafeInteger(a.lamports) ||
    a.lamports < 0 ||
    !Array.isArray(a.data) ||
    a.data.length !== 2 ||
    a.data[1] !== "base64" ||
    typeof a.data[0] !== "string"
  )
    return undefined;
  const bytes = Buffer.from(a.data[0], "base64");
  if (bytes.toString("base64") !== a.data[0]) return undefined;
  return {
    address,
    owner: a.owner,
    lamports: a.lamports,
    executable: typeof a.executable === "boolean" ? a.executable : undefined,
    data: new Uint8Array(bytes),
  };
}

export class BoundedRpc {
  private genesis: RpcResult<string> | null = null;

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number = RPC_BOUNDS.timeoutMs,
    private readonly maxAttempts: number = RPC_BOUNDS.maxAttempts
  ) {}

  /**
   * One bounded JSON-RPC call. `result` must be present as a property (an
   * explicit JSON null is meaningful). `context.slot` is required unless the
   * method has no slot semantics.
   */
  private async call<T>(
    method: string,
    params: unknown[],
    extract: (result: unknown) => Extracted<T>
  ): Promise<RpcResult<T>> {
    let lastError = "no attempt made";
    let lastKind: RpcFailure["kind"] = "network";
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
          continue; // retried only after the backoff above
        }
        if (!response.ok) {
          lastKind = response.status >= 500 ? "network" : "rpc-error";
          lastError = `HTTP ${response.status} from ${method}`;
          continue;
        }
        const payload = (await response.json()) as Envelope;
        if (
          !payload ||
          typeof payload !== "object" ||
          payload.jsonrpc !== "2.0" ||
          payload.id !== 1
        )
          return {
            ok: false,
            kind: "decode",
            error: `${method}: invalid RPC envelope`,
            attempts: attempt,
          };
        if (payload.error) {
          // A lagging finalized node may need one bounded retry to reach the
          // caller's discovery slot. Preserve the same request and slot floor.
          if (payload.error.code === -32016 && method === "getMultipleAccounts" && attempt < this.maxAttempts) {
            lastKind = "rpc-error";
            lastError = "getMultipleAccounts: minimum context slot not reached";
            continue;
          }
          return {
            ok: false,
            kind: "rpc-error",
            error: `${method}: RPC error ${
              typeof payload.error.code === "number"
                ? payload.error.code
                : "unknown"
            }`,
            attempts: attempt,
          };
        }
        if (!("result" in payload)) {
          return {
            ok: false,
            kind: "decode",
            error: `${method}: response has no result`,
            attempts: attempt,
          };
        }
        const extracted = extract(payload.result);
        if (!extracted.ok) {
          return {
            ok: false,
            kind: "decode",
            error: `${method}: ${extracted.error}`,
            attempts: attempt,
          };
        }
        return {
          ok: true,
          value: extracted.value,
          contextSlot: extracted.contextSlot,
          attempts: attempt,
        };
      } catch (error) {
        lastKind =
          error instanceof Error && error.name === "AbortError"
            ? "timeout"
            : "network";
        lastError =
          lastKind === "timeout" ? "request timed out" : "request failed";
      } finally {
        clearTimeout(timer);
      }
    }
    return {
      ok: false,
      kind: lastKind,
      error: `${method}: ${lastError}`,
      attempts: this.maxAttempts,
    };
  }

  /** null when context.slot is absent or not a real slot. */
  private static slot(result: unknown): number | null {
    const slot = (result as { context?: { slot?: unknown } } | null)?.context
      ?.slot;
    if (typeof slot === "number" && Number.isSafeInteger(slot) && slot >= 0)
      return slot;
    return null;
  }

  /** `value: null` means the account does not exist; failures are typed. */
  async getAccountInfo(
    account: string
  ): Promise<RpcResult<AccountData | null>> {
    return this.call<AccountData | null>(
      "getAccountInfo",
      [account, { encoding: "base64", commitment: RPC_BOUNDS.commitment }],
      (result) => {
        const contextSlot = BoundedRpc.slot(result);
        if (contextSlot === null)
          return { ok: false, error: "missing or invalid context.slot" };
        // The account (or an explicit null) is wrapped in `value`.
        const unwrapped = (result as { value?: unknown } | null)?.value;
        const value = decodeAccount(unwrapped, account);
        if (value === undefined)
          return { ok: false, error: "missing or malformed account value" };
        return { ok: true, value, contextSlot };
      }
    );
  }

  /**
   * Every requested account must appear, in order: a shorter array is a decode
   * failure, never a silent empty success.
   */
  async getMultipleAccounts(
    accounts: readonly string[],
    minContextSlot?: number
  ): Promise<RpcResult<ReadonlyArray<AccountData | null>>> {
    if (minContextSlot !== undefined && (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0)) return { ok: false, kind: "decode", error: "Invalid minimum context slot", attempts: 0 };
    return this.call<ReadonlyArray<AccountData | null>>(
      "getMultipleAccounts",
      [accounts, { encoding: "base64", commitment: RPC_BOUNDS.commitment, ...(minContextSlot === undefined ? {} : { minContextSlot }) }],
      (result) => {
        const contextSlot = BoundedRpc.slot(result);
        if (contextSlot === null || (minContextSlot !== undefined && contextSlot < minContextSlot))
          return { ok: false, error: "missing, invalid or regressing context.slot" };
        const list = (result as { value?: unknown } | null)?.value;
        if (!Array.isArray(list) || list.length !== accounts.length) {
          return {
            ok: false,
            error: `expected ${accounts.length} accounts, received ${
              Array.isArray(list) ? list.length : "non-array"
            }`,
          };
        }
        const values = list.map((value, index) =>
          decodeAccount(value, accounts[index]!)
        );
        if (values.some((value) => value === undefined))
          return { ok: false, error: "malformed account in batch" };
        return {
          ok: true,
          contextSlot,
          value: values as Array<AccountData | null>,
        };
      }
    );
  }

  /** Fixed smart-account discovery; callers cannot select another owner/program. */
  async getSmartAccountTokens(token2022 = false): Promise<RpcResult<readonly AccountData[]>> {
    const program = token2022 ? "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" : VAULT_IDENTITY.tokenProgram;
    return this.call<readonly AccountData[]>("getTokenAccountsByOwner", [VAULT_IDENTITY.manager, { programId: program }, { encoding: "base64", commitment: RPC_BOUNDS.commitment }], result => {
      const contextSlot = BoundedRpc.slot(result);
      const list = (result as { value?: unknown } | null)?.value;
      if (contextSlot === null || !Array.isArray(list) || list.length > 50) return { ok: false, error: "Invalid or excessive token discovery" };
      const seen = new Set<string>(), accounts: AccountData[] = [];
      for (const item of list) {
        if (!item || typeof item.pubkey !== "string" || !isAddress(item.pubkey) || seen.has(item.pubkey)) return { ok: false, error: "Invalid or duplicate token address" };
        const account = decodeAccount(item.account, item.pubkey);
        if (!account || account.owner !== program) return { ok: false, error: "Invalid token account program" };
        seen.add(item.pubkey); accounts.push(account);
      }
      return { ok: true, value: accounts, contextSlot };
    });
  }

  /** Owner discovery deliberately omits a size filter so new layouts fail visibly. */
  async getKaminoObligations(): Promise<RpcResult<readonly AccountData[]>> {
    const program = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
    return this.call<readonly AccountData[]>(
      "getProgramAccounts",
      [program, {
        encoding: "base64",
        commitment: RPC_BOUNDS.commitment,
        withContext: true,
        filters: [{ memcmp: { offset: 64, bytes: VAULT_IDENTITY.manager } }],
      }],
      (result) => {
        const contextSlot = BoundedRpc.slot(result);
        if (contextSlot === null) return { ok: false, error: "missing discovery slot" };
        const list = (result as { value?: unknown } | null)?.value;
        if (!Array.isArray(list) || list.length > 100) {
          return { ok: false, error: "invalid or excessive owner discovery result" };
        }
        const seen = new Set<string>();
        const accounts: AccountData[] = [];
        for (const item of list) {
          if (!item || typeof item !== "object" || typeof item.pubkey !== "string" ||
              !isAddress(item.pubkey) || seen.has(item.pubkey)) {
            return { ok: false, error: "invalid or duplicate discovery address" };
          }
          const account = decodeAccount(item.account, item.pubkey);
          if (!account || account.owner !== program) {
            return { ok: false, error: "invalid discovery account or program owner" };
          }
          seen.add(item.pubkey);
          accounts.push(account);
        }
        return { ok: true, value: accounts, contextSlot };
      }
    );
  }

  /**
   * Genesis hash is enforced, not just reported: anything but the pinned
   * mainnet hash is a decode failure. The result is cached for the lifetime of
   * this client, so a misconfigured endpoint is rejected once and remembered.
   */
  async getGenesisHash(): Promise<RpcResult<string>> {
    if (this.genesis) return this.genesis;
    const result = await this.call<string>("getGenesisHash", [], (result) => {
      const contextSlot = BoundedRpc.slot(result);
      if (typeof result !== "string" || result.length === 0)
        return { ok: false, error: "genesis hash is not a string" };
      if (result !== VAULT_IDENTITY.expectedGenesisHash) {
        return {
          ok: false,
          error: "endpoint is not the pinned mainnet-beta cluster",
        };
      }
      return { ok: true, value: result, contextSlot };
    });
    if (result.ok) this.genesis = result;
    return result;
  }
}

let sharedRpc: BoundedRpc | null = null;

/** One process-wide read client; bounded and read-only. */
export function getVaultRpc(): BoundedRpc {
  if (!sharedRpc) sharedRpc = new BoundedRpc(rpcUrlFromEnv());
  return sharedRpc;
}
