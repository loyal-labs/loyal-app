export type TransferDepositEvent = {
  signature: string;
  instructionIndex: number;
  slot: bigint;
  occurredAt: Date;
  senderAddress: string;
  sourceDepositAddress: string;
  destinationDepositAddress: string;
  tokenMint: string;
  amountRaw: bigint;
};

export type PushShieldedTransfersStats = {
  pagesProcessed: number;
  signaturesFetched: number;
  eventsDetected: number;
  recipientsResolved: number;
  notificationsSent: number;
  errors: number;
  firstRunPinned: boolean;
};
