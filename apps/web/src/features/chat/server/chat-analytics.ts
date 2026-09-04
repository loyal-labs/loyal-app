import "server-only";

import type { AuthenticatedPrincipal } from "@/features/identity/server/auth-session";
import { trackServerAnalyticsEvent } from "@/lib/core/analytics-server";
import { FRONTEND_ANALYTICS_EVENTS } from "@/lib/core/analytics/events";

export function trackChatThreadCreatedServer(args: {
  principal: AuthenticatedPrincipal;
  chatId: string;
  initialMessageLength: number;
  source: string;
  clientIp?: string;
}): void {
  trackServerAnalyticsEvent(FRONTEND_ANALYTICS_EVENTS.chatThreadCreated, {
    distinct_id: `wallet:${args.principal.walletAddress}`,
    ...(args.clientIp ? { ip: args.clientIp } : {}),
    auth_method: args.principal.authMethod,
    provider: args.principal.provider,
    wallet_address: args.principal.walletAddress,
    smart_account_address: args.principal.smartAccountAddress,
    settings_pda: args.principal.settingsPda,
    chat_id: args.chatId,
    source: args.source,
    initial_message_length: args.initialMessageLength,
  });
}
