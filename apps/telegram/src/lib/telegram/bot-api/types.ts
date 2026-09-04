export type HandleSummaryCommandOptions = {
  summarySourceChatId?: bigint;
};

export type SummaryDeliveredMessage = {
  destinationChatId: bigint;
  sourceCommunityChatId: bigint;
  messageId: number;
};

export type SendSummaryResult =
  | { deliveredMessage: SummaryDeliveredMessage; sent: true }
  | {
      sent: false;
      reason: "not_activated" | "no_summaries" | "notifications_disabled";
    };

export type SendLatestSummaryOptions = {
  destinationChatId?: bigint;
  replyToMessageId?: number;
};
