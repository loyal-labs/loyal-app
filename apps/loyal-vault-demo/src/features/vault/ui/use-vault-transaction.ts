"use client";

/**
 * Wallet-side lifecycle for one audited vault transaction, in two explicit
 * clicks: `prepare(intent)` fetches and independently audits a quote,
 * `signAndSubmit()` walks it through the wallet and one `sendRawTransaction`.
 * Nothing here signs or sends from an effect — a mount, reload or wallet
 * switch can only restore a pending signature and read its status.
 *
 * Held guarantees: the quote is re-audited right before the prompt and its
 * freshness plus blockhash horizon re-checked after it; the signed message is
 * byte-compared to the audited one and carries exactly one nonzero wallet
 * signature; nonsensitive recovery metadata is persisted per wallet before any
 * send, and a failed persistence cancels it; exactly one send per reviewed
 * quote with `maxRetries: 0`, never retried or resent, so a lost response stays
 * pending; success means a finalized-reconciled status matching the pending
 * wallet, signature, action and message digest — RPC acceptance is not
 * success, and the recovery record survives until that exact outcome or a
 * finalized failure resolves it. Server imports are types only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { VersionedTransaction, type Connection } from "@solana/web3.js";

import {
  MAX_QUOTE_AGE_MS,
  auditPreparedQuote,
  transactionMessageDigest,
  type QuoteAuditIntent,
} from "../domain/client-transaction";
import { readRecoveryFrom, recoveryKey, type RecoveryRecord } from "../domain/recovery";
import type { PrepareSuccess } from "../server/transaction-prepare";
import type { TransactionStatus } from "../server/transaction-status";

/** Genesis hash of the only cluster this demo will ever sign for. */
const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const STATUS_POLL_INTERVAL_MS = 5_000;
const MAX_STATUS_POLLS = 12;

const STATUS_SCHEMA_VERSION = "loyal-vault-demo.transaction-status/1";

export type VaultTransactionPhase =
  | "idle"
  | "preparing"
  | "review"
  | "signing"
  | "submitting"
  | "pending"
  | "success"
  | "failed"
  | "expired"
  | "error";

/** Always wallet-scoped: every field belongs to `wallet`, or the state is hidden. */
export type VaultTransactionState = Readonly<{
  phase: VaultTransactionPhase;
  wallet: string | null;
  quote: PrepareSuccess | null;
  intent: QuoteAuditIntent | null;
  signature: string | null;
  reason: string | null;
  status: TransactionStatus | null;
}>;

export type VaultTransactionApi = Readonly<{
  state: VaultTransactionState;
  prepare(intent: QuoteAuditIntent): Promise<void>;
  signAndSubmit(): Promise<void>;
  checkStatus(): Promise<TransactionStatus | null>;
  clearQuote(): void;
}>;

/* ------------------------------------------------------------------ helpers */

function makeState(
  wallet: string | null,
  phase: VaultTransactionPhase,
  extras: Partial<VaultTransactionState> = {},
): VaultTransactionState {
  return { phase, wallet, quote: null, intent: null, signature: null, reason: null, status: null, ...extras };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wire shape the prepare route accepts: claim carries neither field. */
function prepareRequestBody(intent: QuoteAuditIntent): Record<string, string | boolean> {
  const body: Record<string, string | boolean> = { action: intent.action, wallet: intent.wallet };
  if (intent.action !== "claim") {
    if (intent.withdrawAll) body.withdrawAll = true;
    else if (typeof intent.amountRaw === "bigint") body.amountRaw = intent.amountRaw.toString();
  }
  return body;
}

function describeFailure(payload: unknown): string {
  const reason = (payload as { error?: { reason?: unknown } } | null)?.error?.reason;
  return typeof reason === "string" ? reason : "the server refused to prepare this transaction";
}

function isTransactionStatus(value: unknown): value is TransactionStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<TransactionStatus>;
  return status.schemaVersion === STATUS_SCHEMA_VERSION &&
    ["unknown", "pending", "failed", "unrelated", "finalized-unreconciled", "finalized-reconciled"].includes(status.state ?? "") &&
    typeof status.finalized === "boolean" && typeof status.wallet === "string" &&
    typeof status.signature === "string" && !!status.observation &&
    (status.action === null || ["deposit", "request-withdraw", "claim"].includes(status.action ?? "")) &&
    (status.observation.messageSha256 === undefined || /^[a-f0-9]{64}$/.test(status.observation.messageSha256));
}

async function fetchStatus(wallet: string, signature: string): Promise<TransactionStatus | null> {
  try {
    const query = new URLSearchParams({ signature, wallet });
    const response = await fetch(`/api/transactions/status?${query.toString()}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return isTransactionStatus(payload) ? payload : null;
  } catch {
    return null;
  }
}

function readRecovery(wallet: string): RecoveryRecord | null {
  if (typeof window === "undefined") return null;
  return readRecoveryFrom(window.localStorage, wallet);
}

/** Writes and reads back: only a verified record counts as persisted. */
function writeRecovery(record: RecoveryRecord): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(recoveryKey(record.wallet), JSON.stringify(record));
    const saved = readRecovery(record.wallet);
    return saved?.signature === record.signature && saved.messageSha256 === record.messageSha256 && saved.blockhash === record.blockhash;
  } catch {
    return false;
  }
}

async function clearRecovery(record: RecoveryRecord): Promise<void> {
  await navigator.locks.request(recoveryKey(record.wallet), async () => {
    const stored = readRecovery(record.wallet);
    if (stored?.signature === record.signature && stored.messageSha256 === record.messageSha256) {
      window.localStorage.removeItem(recoveryKey(record.wallet));
    }
  });
}

/** Re-applies the hard quote-age bound once the wallet prompt has resolved. */
function assertQuoteStillFresh(quote: PrepareSuccess, nowMs: number): void {
  const stamps = [
    quote.quote.preparedAt,
    quote.observation.vaultObservedAt,
    quote.observation.positionObservedAt,
  ];
  for (const stamp of stamps) {
    const ageMs = nowMs - Date.parse(stamp);
    if (!Number.isFinite(ageMs) || ageMs > MAX_QUOTE_AGE_MS) {
      throw new Error(`quote is no longer fresh (${stamp}); re-quote before signing`);
    }
  }
}

async function assertPinnedCluster(connection: Connection): Promise<void> {
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== MAINNET_GENESIS_HASH) {
    throw new Error(`RPC serves genesis ${genesisHash}, not the pinned mainnet one; refusing to sign`);
  }
}

async function assertBlockhashValid(connection: Connection, blockhash: string): Promise<void> {
  // PublicNode's getBlockHeight was observed returning a slot, inconsistent
  // with its own blockhash expiry height. Ask about the actual message hash.
  const validity = await connection.isBlockhashValid(blockhash, { commitment: "confirmed" });
  if (validity.value !== true) throw new Error("The quote blockhash is no longer valid. Review a new quote.");
}

type Verdict = "confirming" | "success" | "failed";

/** Success needs the exact pending binding; "finalized" alone proves nothing. */
function reconcilePending(record: RecoveryRecord, status: TransactionStatus): Verdict {
  const matches = status.finalized && status.wallet === record.wallet &&
    status.signature === record.signature && status.action === record.action &&
    status.observation?.messageSha256 === record.messageSha256;
  if (!matches) return "confirming";
  if (status.state === "finalized-reconciled") return "success";
  return status.state === "failed" ? "failed" : "confirming";
}

/* --------------------------------------------------------------------- hook */

export function useVaultTransaction(): VaultTransactionApi {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const walletKey = connected ? publicKey?.toBase58() ?? null : null;
  const [state, setState] = useState<VaultTransactionState>(makeState(null, "idle"));

  const walletRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  // Invalidate continuations as soon as a different wallet renders, including A→B→A.
  if (walletRef.current !== walletKey) {
    walletRef.current = walletKey;
    generationRef.current++;
  }
  const busyRef = useRef(false);
  const quoteRef = useRef<PrepareSuccess | null>(null);
  const intentRef = useRef<QuoteAuditIntent | null>(null);
  const decodedRef = useRef<VersionedTransaction | null>(null);
  const activeRef = useRef<RecoveryRecord | null>(null);
  const prepareAbortRef = useRef<AbortController | null>(null);
  const pollingRef = useRef<{ cancelled: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);

  /** Wallet-gated write: no late continuation of an old wallet ever renders here. */
  const apply = useCallback((wallet: string | null, phase: VaultTransactionPhase, extras: Partial<VaultTransactionState>) => {
    if (!mountedRef.current || walletRef.current !== wallet) return;
    setState(makeState(wallet, phase, extras));
  }, []);

  const stopPolling = useCallback(() => {
    const active = pollingRef.current;
    if (!active) return;
    pollingRef.current = null;
    active.cancelled = true;
    clearTimeout(active.timer);
  }, []);

  /** Absorbs one status read; a failed read is never a resolution. */
  const absorbStatus = useCallback(
    async (record: RecoveryRecord, status: TransactionStatus | null): Promise<TransactionStatus | null> => {
      if (!mountedRef.current || walletRef.current !== record.wallet || activeRef.current?.signature !== record.signature) return null;
      if (!status) {
        apply(record.wallet, "pending", {
          signature: record.signature,
          reason: "status is temporarily unavailable; the transaction is still tracked",
        });
        return null;
      }
      if (status.state === "unknown" && status.finalized === false &&
          status.signature === record.signature && status.wallet === record.wallet) {
        try {
          const ageMs = Date.now() - record.createdAtMs;
          // A much older absent history result may reflect pruning, not nonexecution.
          if (ageMs >= 0 && ageMs <= 20 * 60 * 1000) {
            const validity = await connection.isBlockhashValid(record.blockhash, { commitment: "finalized" });
            if (validity.value === false) {
              const lastCheck = await connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true });
              if (lastCheck.context.slot >= validity.context.slot && lastCheck.value.length === 1 && lastCheck.value[0] === null) {
                await clearRecovery(record);
                if (mountedRef.current && walletRef.current === record.wallet && activeRef.current?.signature === record.signature) {
                  activeRef.current = readRecovery(record.wallet);
                  if (!activeRef.current) apply(record.wallet, "expired", { signature: record.signature,
                    reason: "The blockhash expired and the cluster still reports no transaction. Review a new quote to try again." });
                }
                return status;
              }
            }
          }
        } catch { /* An unavailable check cannot release the pending operation. */ }
      }
      const verdict = reconcilePending(record, status);
      if (verdict === "confirming") {
        apply(record.wallet, "pending", { signature: record.signature, status, reason: status.reason });
        return status;
      }
      // Only a finalized success or a finalized failure clears the recovery record.
      try { await clearRecovery(record); } catch { return status; }
      if (!mountedRef.current || walletRef.current !== record.wallet || activeRef.current?.signature !== record.signature) return status;
      try { activeRef.current = readRecovery(record.wallet); }
      catch (error) {
        apply(record.wallet, "pending", { signature: record.signature, reason: messageOf(error) });
        return status;
      }
      if (activeRef.current) {
        apply(record.wallet, "pending", { signature: activeRef.current.signature, reason: "Another pending transaction is still being verified." });
        return status;
      }
      apply(record.wallet, verdict, { signature: record.signature, status, reason: status.reason });
      return status;
    },
    [apply, connection],
  );

  const startPolling = useCallback(
    (record: RecoveryRecord) => {
      stopPolling();
      const session = { cancelled: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      pollingRef.current = session;
      let remaining = MAX_STATUS_POLLS;
      const tick = async () => {
        if (session.cancelled) return;
        // Bounded monitoring only: a hidden tab or a wallet switch cancels it,
        // and checkStatus() is always available for continued monitoring.
        if (document.hidden || walletRef.current !== record.wallet) {
          stopPolling();
          return;
        }
        remaining -= 1;
        const status = await fetchStatus(record.wallet, record.signature);
        if (session.cancelled || document.hidden) { stopPolling(); return; }
        const absorbed = await absorbStatus(record, status);
        if (session.cancelled || walletRef.current !== record.wallet) return;
        if (!activeRef.current || remaining <= 0) {
          if (activeRef.current && !session.cancelled) {
            apply(record.wallet, "pending", {
              signature: record.signature,
              status: absorbed,
              reason: "status polling reached its bound; call checkStatus() to keep monitoring",
            });
          }
          return;
        }
        session.timer = setTimeout(() => void tick(), STATUS_POLL_INTERVAL_MS);
      };
      session.timer = setTimeout(() => void tick(), STATUS_POLL_INTERVAL_MS);
    },
    [absorbStatus, apply, stopPolling],
  );

  const checkStatus = useCallback(async (): Promise<TransactionStatus | null> => {
    const record = activeRef.current;
    if (!record || record.wallet !== walletRef.current) return null;
    const status = await fetchStatus(record.wallet, record.signature);
    await absorbStatus(record, status);
    return status;
  }, [absorbStatus]);

  /** Restores wallet scope: aborts preparation, hides the old wallet, restores its pending record. */
  useEffect(() => {
    const wallet = walletKey;
    busyRef.current = false;
    prepareAbortRef.current?.abort();
    prepareAbortRef.current = null;
    stopPolling();
    quoteRef.current = null;
    intentRef.current = null;
    decodedRef.current = null;
    let record: RecoveryRecord | null;
    try { record = wallet ? readRecovery(wallet) : null; }
    catch (error) {
      activeRef.current = null;
      setState(makeState(wallet, "error", { reason: messageOf(error) }));
      return;
    }
    activeRef.current = record;
    setState(makeState(wallet, "idle"));
    if (record) {
      // A reload or a switch back restores the signature and reads status; it never sends.
      setState(makeState(wallet, "pending", { signature: record.signature, reason: "restored an in-flight transaction; verifying its status" }));
      void checkStatus();
    }
  }, [walletKey, checkStatus, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current++;
    return () => {
      mountedRef.current = false;
      prepareAbortRef.current?.abort();
      stopPolling();
    };
  }, [stopPolling]);

  const prepare = useCallback(
    async (intent: QuoteAuditIntent): Promise<void> => {
      if (busyRef.current) return; // duplicate click: the first attempt is still running
      const wallet = walletRef.current;
      if (!wallet) {
        apply(wallet, "error", { reason: "connect a wallet before preparing a transaction" });
        return;
      }
      if (intent.wallet !== wallet || activeRef.current) {
        apply(wallet, activeRef.current ? "pending" : "error", {
          signature: activeRef.current?.signature ?? null,
          reason: activeRef.current ? "An earlier transaction is still being verified." : "The selected wallet changed. Review again.",
        });
        return;
      }
      const generation = generationRef.current;
      const current = () => mountedRef.current && generationRef.current === generation && walletRef.current === wallet;
      busyRef.current = true;
      quoteRef.current = null;
      intentRef.current = null;
      decodedRef.current = null;
      const controller = new AbortController();
      prepareAbortRef.current?.abort();
      prepareAbortRef.current = controller;
      apply(wallet, "preparing", {});
      try {
        const pending = readRecovery(wallet);
        if (pending) {
          activeRef.current = pending;
          apply(wallet, "pending", { signature: pending.signature, reason: "An earlier transaction is still being verified." });
          return;
        }
        const response = await fetch("/api/transactions/prepare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(prepareRequestBody(intent)),
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!current() || controller.signal.aborted) return;
        const payload: unknown = await response.json();
        if (!response.ok) {
          apply(wallet, "error", { intent, reason: describeFailure(payload) });
          return;
        }
        const quote = payload as PrepareSuccess;
        // Independent audit: the quote is only ever trusted after its wire has
        // been rebuilt from this intent and compared byte for byte.
        const decoded = await auditPreparedQuote(quote, intent);
        if (!current() || controller.signal.aborted) return;
        quoteRef.current = quote;
        intentRef.current = intent;
        decodedRef.current = decoded;
        apply(wallet, "review", { quote, intent });
      } catch (error) {
        if (current() && !controller.signal.aborted) {
          apply(wallet, "error", { intent, reason: messageOf(error) });
        }
      } finally {
        if (prepareAbortRef.current === controller) prepareAbortRef.current = null;
        if (current()) busyRef.current = false;
      }
    },
    [apply],
  );

  const signAndSubmit = useCallback(async (): Promise<void> => {
    if (busyRef.current) return;
    const wallet = walletRef.current;
    const quote = quoteRef.current;
    const intent = intentRef.current;
    if (!wallet || !quote || !intent || !decodedRef.current) {
      apply(wallet, "error", { reason: "prepare and review a quote before signing" });
      return;
    }
    if (activeRef.current || intent.wallet !== wallet) return;
    const generation = generationRef.current;
    const current = () => mountedRef.current && generationRef.current === generation && walletRef.current === wallet;
    busyRef.current = true;
    try {
      if (!navigator.locks) throw new Error("This browser cannot protect transaction recovery across tabs. Use a current browser.");
      const pending = readRecovery(wallet);
      if (pending) {
        activeRef.current = pending;
        apply(wallet, "pending", { signature: pending.signature, reason: "Another tab has a pending transaction." });
        startPolling(pending);
        return;
      }
      // Re-audit at the last moment: this is what catches a quote that aged out
      // while the review panel was open.
      const audited = await auditPreparedQuote(quote, intent);
      if (!current()) return;
      if (typeof signTransaction !== "function") {
        apply(wallet, "error", { quote, intent, reason: "this wallet does not expose signTransaction(); the demo signs no other way" });
        return;
      }
      await assertPinnedCluster(connection);
      await assertBlockhashValid(connection, quote.transaction.blockhash);
      const messageSha256 = await transactionMessageDigest(audited);
      if (!current()) return;
      assertQuoteStillFresh(quote, Date.now());
      apply(wallet, "signing", { quote, intent });
      const signed = await signTransaction(audited);
      // The prompt is interactive: confirm the very same connected wallet is
      // still holding it before anything leaves this device.
      if (!current()) return;
      assertQuoteStillFresh(quote, Date.now());
      await assertBlockhashValid(connection, quote.transaction.blockhash);
      if (!(signed instanceof VersionedTransaction)) {
        apply(wallet, "error", { quote, intent, reason: "the wallet returned something other than a versioned transaction" });
        return;
      }
      const wire = signed.serialize();
      const inspected = VersionedTransaction.deserialize(wire);
      // A wallet may only add a signature; the message must stay byte-identical.
      if ((await transactionMessageDigest(inspected)) !== messageSha256) {
        apply(wallet, "error", { quote, intent, reason: "the signed message differs from the audited quote; nothing was submitted" });
        return;
      }
      const signatureBytes = inspected.signatures.length === 1 ? inspected.signatures[0] : undefined;
      if (!signatureBytes || signatureBytes.every((byte) => byte === 0)) {
        apply(wallet, "error", { quote, intent, reason: "the wallet returned no usable wallet signature; nothing was submitted" });
        return;
      }
      const verifyKey = await crypto.subtle.importKey("raw", Uint8Array.from(inspected.message.staticAccountKeys[0]!.toBytes()).buffer,
        { name: "Ed25519" }, false, ["verify"]);
      const validSignature = await crypto.subtle.verify("Ed25519", verifyKey, Uint8Array.from(signatureBytes).buffer,
        Uint8Array.from(inspected.message.serialize()).buffer);
      if (!validSignature) throw new Error("The wallet signature does not verify. Nothing was submitted.");
      if (!current()) return;
      assertQuoteStillFresh(quote, Date.now());
      const signature = bs58.encode(signatureBytes);
      const record: RecoveryRecord = {
        wallet,
        signature,
        action: intent.action,
        messageSha256,
        lastValidBlockHeight: quote.transaction.lastValidBlockHeight,
        blockhash: quote.transaction.blockhash,
        createdAtMs: Date.now(),
      };
      if (!navigator.locks) throw new Error("This browser cannot protect transaction recovery across tabs. Use a current browser.");
      await navigator.locks.request(recoveryKey(wallet), async () => {
        if (!current()) return;
        const existing = readRecovery(wallet);
        if (existing) {
          activeRef.current = existing;
          apply(wallet, "pending", { signature: existing.signature, reason: "Another tab already has a pending transaction." });
          startPolling(existing);
          return;
        }
        assertQuoteStillFresh(quote, Date.now());
      quoteRef.current = null;
      intentRef.current = null;
      decodedRef.current = null;
      apply(wallet, "submitting", { signature });
      // Recovery metadata must be durable before anything is sent.
      if (!writeRecovery(record)) {
        apply(wallet, "error", { signature, reason: "could not persist recovery metadata, so nothing was sent" });
        return;
      }
      activeRef.current = record;
      try {
        const accepted = await connection.sendRawTransaction(wire, { maxRetries: 0, skipPreflight: false });
        if (!current()) return; // a finished send never renders to the new wallet
        apply(wallet, "pending", {
          signature,
          reason: accepted === signature ? null : `the RPC acknowledged ${accepted}, not the derived signature; tracking the derived one`,
        });
      } catch (error) {
        if (!current()) return;
        // A lost response may still have landed: stay pending on the known
        // signature. This path never resends.
        apply(wallet, "pending", {
          signature,
          reason: `the send response was not received (${messageOf(error)}); the transaction is tracked by signature and never resent`,
        });
      }
      startPolling(record);
      });
    } catch (error) {
      if (!current()) return;
      apply(wallet, "error", { quote, intent, reason: messageOf(error) });
    } finally {
      if (current()) busyRef.current = false;
    }
  }, [apply, connection, signTransaction, startPolling]);

  /** Drops the reviewed quote but never the pending recovery record. */
  const clearQuote = useCallback(() => {
    if (busyRef.current) return;
    quoteRef.current = null;
    intentRef.current = null;
    decodedRef.current = null;
    const record = activeRef.current;
    const wallet = walletRef.current;
    if (record && wallet) {
      apply(wallet, "pending", {
        signature: record.signature,
        reason: "an earlier transaction is still unresolved; it is tracked until it finalizes",
      });
      return;
    }
    apply(wallet, "idle", {});
  }, [apply]);

  const visibleState = state.wallet === walletKey ? state : makeState(walletKey, "idle");
  return { state: visibleState, prepare, signAndSubmit, checkStatus, clearQuote };
}
