import "server-only";

import type { WalletPushPayload } from "@/lib/push-notifications/send-to-wallet";

import type { IncomingTransferEvent, IncomingTransferKind } from "../types";
import { NATIVE_SOL_MINT } from "./constants";
import { formatIncomingTransferPush } from "./format";

const NATIVE_SOL_MINT_STR = NATIVE_SOL_MINT.toBase58();
const LAMPORTS_PER_SOL = 1_000_000_000;

export type HeliusEnhancedEvent = {
  type: string;
  signature: string;
  timestamp: number;
  feePayer?: string;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    mint: string;
    tokenAmount: number;
  }>;
  accountData?: Array<{
    account: string;
    nativeBalanceChange: number;
  }>;
};

export type ProcessDeps = {
  lookupWalletsForAddresses(addresses: string[]): Promise<Map<string, string>>;
  isDelivered(signature: string, walletPublicKey: string): Promise<boolean>;
  recordDelivery(signature: string, walletPublicKey: string): Promise<void>;
  resolveMintMetadata(
    mints: Iterable<string>,
  ): Promise<Map<string, { symbol: string; decimals: number }>>;
  sendPushToWallet(
    walletPublicKey: string,
    payload: WalletPushPayload,
  ): Promise<{ sentTo: number }>;
};

export type WebhookStats = {
  eventsReceived: number;
  notificationsSent: number;
  duplicates: number;
  unroutable: number;
  errors: number;
};

type RoutedRecipient = {
  walletPublicKey: string;
  event: IncomingTransferEvent;
};

/**
 * Convert a Helius enhanced event into one or more domain
 * IncomingTransferEvent records keyed by the registered wallet they
 * should fire a push to. Pulls recipient addresses (positive amounts
 * only) from both native and SPL transfers and looks them up in the
 * registered-address map. Returns an empty array if nothing routes.
 */
function routeEventToRecipients(
  event: HeliusEnhancedEvent,
  addressToWallet: Map<string, string>,
): RoutedRecipient[] {
  const recipients: RoutedRecipient[] = [];
  const occurredAt = new Date(event.timestamp * 1000);

  if (Array.isArray(event.tokenTransfers)) {
    for (const transfer of event.tokenTransfers) {
      if (!transfer) continue;
      if (typeof transfer.tokenAmount !== "number") continue;
      if (transfer.tokenAmount <= 0) continue;
      const wallet = addressToWallet.get(transfer.toUserAccount);
      if (!wallet) continue;
      // Helius enhanced webhook gives tokenAmount as a UI-decimal number
      // (already scaled by the mint's decimals). Convert back to raw
      // base units using the metadata we already fetched.
      // We don't have decimals here — caller passes amountRaw as best
      // effort. To preserve precision we delegate scaling later.
      recipients.push({
        walletPublicKey: wallet,
        event: {
          kind: "spl" as IncomingTransferKind,
          recipient: wallet,
          sender: transfer.fromUserAccount || null,
          // Carry the UI amount in amountRaw + decimals=0 will round-trip
          // poorly; instead, store the float as raw and rely on metadata
          // lookup to provide decimals so formatAmount can scale.
          // We store as the integer portion of (tokenAmount * 10^decimals)
          // at format time. For now stash the float in a side channel by
          // storing tokenAmount * 1 as bigint of the unscaled raw.
          // Cleanest: store amountRaw=BigInt(round(tokenAmount * 10^decimals))
          // at format time. We can't do that yet because we resolve
          // decimals globally. So we expose a placeholder and adjust
          // at format time using the metadata map.
          amountRaw: BigInt(0),
          mint: transfer.mint,
          signature: event.signature,
          occurredAt,
        },
      });
    }
  }

  if (Array.isArray(event.nativeTransfers)) {
    for (const transfer of event.nativeTransfers) {
      if (!transfer) continue;
      if (typeof transfer.amount !== "number") continue;
      if (transfer.amount <= 0) continue;
      const wallet = addressToWallet.get(transfer.toUserAccount);
      if (!wallet) continue;
      recipients.push({
        walletPublicKey: wallet,
        event: {
          kind: "sol" as IncomingTransferKind,
          recipient: wallet,
          sender: transfer.fromUserAccount || null,
          amountRaw: BigInt(transfer.amount),
          mint: NATIVE_SOL_MINT_STR,
          signature: event.signature,
          occurredAt,
        },
      });
    }
  }

  return recipients;
}

/**
 * Collect every candidate recipient address across the payload so we
 * can batch-resolve them with a single DB roundtrip. Skips non-TRANSFER
 * events.
 */
function collectCandidateAddresses(
  events: readonly HeliusEnhancedEvent[],
): { addresses: string[]; mints: string[] } {
  const addresses = new Set<string>();
  const mints = new Set<string>();
  mints.add(NATIVE_SOL_MINT_STR);
  for (const event of events) {
    if (event.type !== "TRANSFER") continue;
    // Each event read is wrapped so a forged/corrupt event can't poison
    // the batch-prep pass. The same fields are re-read inside
    // routeEventToRecipients under the main loop's per-event try, where
    // the failure is surfaced into `errors`.
    try {
      const tokenTransfers = event.tokenTransfers;
      if (Array.isArray(tokenTransfers)) {
        for (const t of tokenTransfers) {
          if (!t || typeof t.tokenAmount !== "number" || t.tokenAmount <= 0) {
            continue;
          }
          if (t.toUserAccount) addresses.add(t.toUserAccount);
          if (t.mint) mints.add(t.mint);
        }
      }
    } catch {
      // ignore — will be surfaced in main loop
    }
    try {
      const nativeTransfers = event.nativeTransfers;
      if (Array.isArray(nativeTransfers)) {
        for (const n of nativeTransfers) {
          if (!n || typeof n.amount !== "number" || n.amount <= 0) continue;
          if (n.toUserAccount) addresses.add(n.toUserAccount);
        }
      }
    } catch {
      // ignore — will be surfaced in main loop
    }
  }
  return { addresses: Array.from(addresses), mints: Array.from(mints) };
}

function scaleToRawAmount(
  uiAmount: number,
  decimals: number,
): bigint {
  if (decimals <= 0) {
    return BigInt(Math.max(0, Math.round(uiAmount)));
  }
  // Avoid floating-point drift for typical SPL decimals (≤ 9 in practice,
  // up to 18 in theory). Build the integer string by hand.
  const negative = uiAmount < 0;
  const abs = Math.abs(uiAmount);
  const fixed = abs.toFixed(decimals);
  const [whole, frac = ""] = fixed.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole ?? "0"}${padded}`.replace(/^0+(?=\d)/, "");
  const value = BigInt(combined.length === 0 ? "0" : combined);
  return negative ? -value : value;
}

export async function processHeliusWebhookPayload(
  events: HeliusEnhancedEvent[],
  deps: ProcessDeps,
): Promise<WebhookStats> {
  const stats: WebhookStats = {
    eventsReceived: events.length,
    notificationsSent: 0,
    duplicates: 0,
    unroutable: 0,
    errors: 0,
  };

  if (events.length === 0) return stats;

  // Defensive filter — we configure Helius to only send TRANSFER, but a
  // misconfigured webhook (or a future change) must not be allowed to
  // burn DB calls or fire bogus pushes.
  const transferEvents = events.filter((event) => event.type === "TRANSFER");
  if (transferEvents.length === 0) return stats;

  // Single DB roundtrip for address routing + single roundtrip for mint
  // metadata. Per CLAUDE.md these are `critical` — if they fail, the
  // whole webhook fails so Helius retries.
  const { addresses, mints } = collectCandidateAddresses(transferEvents);

  // No candidate addresses across the payload → nothing routable. Each
  // transfer event contributed nothing, so each counts as unroutable.
  if (addresses.length === 0) {
    stats.unroutable += transferEvents.length;
    return stats;
  }

  const addressToWallet = await deps.lookupWalletsForAddresses(addresses);
  const metadataByMint = await deps.resolveMintMetadata(mints);

  // Per-event try/catch so one malformed entry doesn't poison the batch.
  for (const event of transferEvents) {
    try {
      const recipients = routeEventToRecipients(event, addressToWallet);
      if (recipients.length === 0) {
        stats.unroutable += 1;
        continue;
      }

      for (const { walletPublicKey, event: domainEvent } of recipients) {
        // Idempotency check is `critical` — must succeed before we
        // decide to dispatch. Record BEFORE dispatch so a crash
        // mid-send doesn't double-fire on Helius retry.
        const already = await deps.isDelivered(
          event.signature,
          walletPublicKey,
        );
        if (already) {
          stats.duplicates += 1;
          continue;
        }
        await deps.recordDelivery(event.signature, walletPublicKey);

        // For SPL transfers, scale the UI amount to raw base units now
        // that we have decimals from the metadata lookup. For SOL we
        // already populated amountRaw with lamports.
        let amountRaw = domainEvent.amountRaw;
        const metadata = metadataByMint.get(domainEvent.mint) ?? null;
        if (domainEvent.kind === "spl" && metadata) {
          const splTransfer = event.tokenTransfers?.find(
            (t) =>
              t.toUserAccount === walletPublicKey ||
              (t.toUserAccount &&
                addressToWallet.get(t.toUserAccount) === walletPublicKey &&
                t.mint === domainEvent.mint),
          );
          if (splTransfer && typeof splTransfer.tokenAmount === "number") {
            amountRaw = scaleToRawAmount(
              splTransfer.tokenAmount,
              metadata.decimals,
            );
          }
        }

        const finalEvent: IncomingTransferEvent = {
          ...domainEvent,
          amountRaw,
        };

        // Provide a synthetic SOL metadata fallback so the formatter
        // always renders the SOL symbol with correct decimals.
        const effectiveMetadata =
          metadata ??
          (domainEvent.kind === "sol"
            ? { symbol: "SOL", decimals: 9 }
            : null);
        const payload = formatIncomingTransferPush(
          finalEvent,
          effectiveMetadata,
        );

        // Fire-and-catch dispatch — never block the webhook ack on the
        // Expo push, per the webhook-failure-policy guardrail.
        void deps
          .sendPushToWallet(walletPublicKey, payload)
          .then((result) => {
            stats.notificationsSent += result.sentTo;
          })
          .catch((err: unknown) => {
            stats.errors += 1;
            console.error("[helius-webhook] push dispatch failed", {
              signature: event.signature,
              walletPublicKey,
              errorName: err instanceof Error ? err.name : "Unknown",
              errorMessage:
                err instanceof Error ? err.message : String(err),
            });
          });
      }
    } catch (err) {
      stats.errors += 1;
      console.error("[helius-webhook] event processing failed", {
        signature: event.signature,
        errorName: err instanceof Error ? err.name : "Unknown",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return stats;
}

// Re-export so the route can import a single constant cleanly if needed.
export { LAMPORTS_PER_SOL };
