import {
  __resetServerAnalyticsClientsForTests,
  createMixpanelServerClient,
  type ServerAnalyticsClient,
} from "@loyal-labs/shared/analytics-server";

import { serverEnv } from "@/lib/core/config/server";

type MixpanelTrackPrimitive = boolean | null | number | string;
type TrackingIdentifier = bigint | number | string;

export type MixpanelTrackProperties = Record<string, MixpanelTrackPrimitive>;

const BOT_WORKSPACE = "bot" as const;
let analyticsClient: ServerAnalyticsClient | null = null;
let analyticsClientToken: string | null = null;

type BotTrackingInput = {
  chatId?: TrackingIdentifier | null;
  chatType?: string | null;
  userId?: TrackingIdentifier | null;
};

function normalizeIdentifier(
  value: TrackingIdentifier | null | undefined
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value.toString();
}

function resolveDistinctId(input: BotTrackingInput): string {
  const telegramUserId = normalizeIdentifier(input.userId);
  if (telegramUserId) {
    return `tg:${telegramUserId}`;
  }

  const telegramChatId = normalizeIdentifier(input.chatId);
  if (telegramChatId) {
    return `tg-chat:${telegramChatId}`;
  }

  return "tg:unknown";
}

function getAnalyticsClient(token: string): ServerAnalyticsClient {
  if (analyticsClient && analyticsClientToken === token) {
    return analyticsClient;
  }

  analyticsClient = createMixpanelServerClient({
    token,
    workspace: BOT_WORKSPACE,
  });
  analyticsClientToken = token;
  return analyticsClient;
}

export function createBotTrackingProperties(
  input: BotTrackingInput
): MixpanelTrackProperties {
  return {
    distinct_id: resolveDistinctId(input),
    telegram_chat_id: normalizeIdentifier(input.chatId),
    telegram_chat_type: input.chatType ?? null,
    telegram_user_id: normalizeIdentifier(input.userId),
  };
}

export function trackBotEvent(
  eventName: string,
  properties: MixpanelTrackProperties
): void {
  const token = serverEnv.mixpanelToken;
  if (!token) {
    return;
  }

  try {
    const client = getAnalyticsClient(token);
    client.track(eventName, properties);

    if (
      typeof properties.distinct_id === "string" &&
      typeof properties.telegram_user_id === "string"
    ) {
      client.updateWorkspaceProfile(properties.distinct_id);
    }
  } catch (error) {
    console.error(`Failed to track Mixpanel event: ${eventName}`, error);
  }
}

export function __resetBotAnalyticsStateForTests(): void {
  analyticsClient = null;
  analyticsClientToken = null;
  __resetServerAnalyticsClientsForTests();
}
