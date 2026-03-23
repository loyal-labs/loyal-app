import "server-only";

import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";
import { trackServerAnalyticsEvent } from "@/lib/core/analytics-server";
import { FRONTEND_ANALYTICS_EVENTS } from "@/lib/core/analytics/events";

export function trackChatThreadCreatedServer(args: {
  principal: AuthenticatedPrincipal;
  chatId: string;
  initialMessageLength: number;
  source: string;
}): void {
  trackServerAnalyticsEvent(FRONTEND_ANALYTICS_EVENTS.chatThreadCreated, {
    distinct_id: `wallet:${args.principal.walletAddress}`,
    workspace: "frontend",
    auth_method: args.principal.authMethod,
    provider: args.principal.provider,
    wallet_address: args.principal.walletAddress,
    ...(args.principal.gridUserId
      ? { grid_user_id: args.principal.gridUserId }
      : {}),
    ...(args.principal.smartAccountAddress
      ? { smart_account_address: args.principal.smartAccountAddress }
      : {}),
    chat_id: args.chatId,
    source: args.source,
    initial_message_length: args.initialMessageLength,
  });
}
