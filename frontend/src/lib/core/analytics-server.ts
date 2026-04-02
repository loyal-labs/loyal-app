import "server-only";

import {
  createMixpanelServerClient,
  type ServerAnalyticsClient,
  type ServerAnalyticsProperties,
} from "@loyal-labs/shared/analytics-server";

import { getServerEnv } from "@/lib/core/config/server";

const WEBSITE_WORKSPACE = "website" as const;

let serverClient: ServerAnalyticsClient | null = null;
let serverClientToken: string | null = null;

function getServerAnalyticsClient(token: string): ServerAnalyticsClient {
  if (serverClient && serverClientToken === token) {
    return serverClient;
  }

  serverClient = createMixpanelServerClient({
    token,
    workspace: WEBSITE_WORKSPACE,
  });
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
    client.track(eventName, properties);

    if (typeof properties.distinct_id === "string") {
      client.updateWorkspaceProfile(properties.distinct_id);
    }
  } catch (error) {
    console.error(`Failed to track Mixpanel event: ${eventName}`, error);
  }
}
