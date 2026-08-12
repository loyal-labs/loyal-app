export type IncomingTransferKind = "sol" | "spl";

export type IncomingTransferEvent = {
  kind: IncomingTransferKind;
  recipient: string; // wallet public key
  sender: string | null; // best-effort, null if ambiguous
  amountRaw: bigint;
  mint: string; // "So11111111111111111111111111111111111111112" for SOL
  signature: string;
  occurredAt: Date;
};
