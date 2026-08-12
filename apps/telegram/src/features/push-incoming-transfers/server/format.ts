import "server-only";

import type { WalletPushPayload } from "@/lib/push-notifications/send-to-wallet";

import type { IncomingTransferEvent } from "../types";

type MintMetadata = {
  symbol: string;
  decimals: number;
};

// Conservative default for unknown mints: show raw whole-token amount
// (decimals = 0) and a truncated mint as symbol. Safer than guessing.
const UNKNOWN_DECIMALS = 0;

export function formatAmount(amountRaw: bigint, decimals: number): string {
  if (decimals <= 0) {
    return amountRaw.toString();
  }
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = amountRaw / scale;
  const fraction = amountRaw % scale;
  if (fraction === BigInt(0)) {
    return whole.toString();
  }
  // Show up to 4 fraction digits, strip trailing zeros.
  const fractionStr = fraction.toString().padStart(decimals, "0");
  const trimmed = fractionStr.slice(0, 4).replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
}

export function truncateAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function formatIncomingTransferPush(
  event: IncomingTransferEvent,
  metadata: MintMetadata | null
): WalletPushPayload {
  const symbol = metadata?.symbol ?? truncateAddress(event.mint);
  const decimals = metadata?.decimals ?? UNKNOWN_DECIMALS;
  const amount = formatAmount(event.amountRaw, decimals);
  const senderLabel = event.sender
    ? `From ${truncateAddress(event.sender)}`
    : "Incoming transfer";

  return {
    title: `+${amount} ${symbol}`,
    body: senderLabel,
    data: {
      screen: "activity",
      signature: event.signature,
      mint: event.mint,
    },
  };
}
