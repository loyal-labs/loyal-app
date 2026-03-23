import "server-only";

import Mixpanel from "mixpanel";

import { getServerEnv } from "@/lib/core/config/server";

type ServerAnalyticsPrimitive = boolean | null | number | string;

export type ServerAnalyticsProperties = Record<string, ServerAnalyticsPrimitive>;

let serverClient: ReturnType<typeof Mixpanel.init> | null = null;
let serverClientToken: string | null = null;

function getServerAnalyticsClient(token: string): ReturnType<typeof Mixpanel.init> {
  if (serverClient && serverClientToken === token) {
    return serverClient;
  }

  serverClient = Mixpanel.init(token);
  serverClientToken = token;
  return serverClient;
}

export function trackServerAnalyticsEvent(
  eventName: string,
  properties: ServerAnalyticsProperties
): void {
  const { mixpanelToken } = getServerEnv();
  if (!mixpanelToken) {
    return;
  }

  try {
    const client = getServerAnalyticsClient(mixpanelToken);
    client.track(eventName, properties, (error: unknown) => {
      if (error) {
        console.error(`Failed to track Mixpanel event: ${eventName}`, error);
      }
    });
  } catch (error) {
    console.error(`Failed to track Mixpanel event: ${eventName}`, error);
  }
}
