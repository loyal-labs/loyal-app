import "server-only";

import {
  formatAmount,
  truncateAddress,
} from "@/features/push-incoming-transfers/server/format";
import type { WalletPushPayload } from "@/lib/push-notifications/send-to-wallet";

import type { TransferDepositEvent } from "../types";

type MintMetadata = {
  symbol: string;
  decimals: number;
};

// Conservative default for unknown mints — same as the incoming-transfer
// formatter. Raw whole-token amounts are safer than guessing decimals.
const UNKNOWN_DECIMALS = 0;

export function formatShieldedTransferPush(
  event: TransferDepositEvent,
  metadata: MintMetadata | null,
): WalletPushPayload {
  const symbol = metadata?.symbol ?? truncateAddress(event.tokenMint);
  const decimals = metadata?.decimals ?? UNKNOWN_DECIMALS;
  const amount = formatAmount(event.amountRaw, decimals);

  return {
    body: `From ${truncateAddress(event.senderAddress)} privately`,
    data: {
      kind: "shielded-transfer",
      mint: event.tokenMint,
      screen: "activity",
      sender: event.senderAddress,
      signature: event.signature,
    },
    title: `+${amount} ${symbol}`,
  };
}
