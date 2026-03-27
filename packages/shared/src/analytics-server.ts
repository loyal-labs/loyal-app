import "server-only";

import Mixpanel from "mixpanel";

import {
  createWorkspaceProfileUpdate,
  type AnalyticsProfileProperties,
  type AnalyticsProfileUnionProperties,
  type AnalyticsWorkspace,
  withWorkspaceProperties,
} from "./analytics-core";

export type ServerAnalyticsPrimitive = boolean | null | number | string;

export type ServerAnalyticsProperties = Record<
  string,
  ServerAnalyticsPrimitive
>;

type ServerAnalyticsConfig = {
  token?: string;
  workspace: AnalyticsWorkspace;
};

export type ServerAnalyticsClient = {
  track: (
    eventName: string,
    properties?: ServerAnalyticsProperties
  ) => void;
  setUserProfile: (
    distinctId: string,
    properties: AnalyticsProfileProperties
  ) => void;
  setUserProfileOnce: (
    distinctId: string,
    properties: AnalyticsProfileProperties
  ) => void;
  unionUserProfile: (
    distinctId: string,
    properties: AnalyticsProfileUnionProperties
  ) => void;
  updateWorkspaceProfile: (distinctId: string, occurredAt?: Date) => void;
};

const serverClients = new Map<string, ReturnType<typeof Mixpanel.init>>();

function getServerClient(token: string): ReturnType<typeof Mixpanel.init> {
  const existingClient = serverClients.get(token);
  if (existingClient) {
    return existingClient;
  }

  const nextClient = Mixpanel.init(token);
  serverClients.set(token, nextClient);
  return nextClient;
}

function logMixpanelError(action: string, target: string, error: unknown): void {
  console.error(`Failed to ${action} Mixpanel ${target}`, error);
}

export function createMixpanelServerClient(
  config: ServerAnalyticsConfig
): ServerAnalyticsClient {
  function withClient(
    action: string,
    target: string,
    callback: (client: ReturnType<typeof Mixpanel.init>) => void
  ): void {
    if (!config.token) {
      return;
    }

    try {
      callback(getServerClient(config.token));
    } catch (error) {
      logMixpanelError(action, target, error);
    }
  }

  function track(
    eventName: string,
    properties?: ServerAnalyticsProperties
  ): void {
    withClient("track", `event: ${eventName}`, (client) => {
      client.track(
        eventName,
        withWorkspaceProperties(
          config.workspace,
          properties
        ) as ServerAnalyticsProperties,
        (error: unknown) => {
          if (error) {
            logMixpanelError("track", `event: ${eventName}`, error);
          }
        }
      );
    });
  }

  function setUserProfile(
    distinctId: string,
    properties: AnalyticsProfileProperties
  ): void {
    withClient("set", `profile: ${distinctId}`, (client) => {
      client.people.set(distinctId, properties, (error: unknown) => {
        if (error) {
          logMixpanelError("set", `profile: ${distinctId}`, error);
        }
      });
    });
  }

  function setUserProfileOnce(
    distinctId: string,
    properties: AnalyticsProfileProperties
  ): void {
    withClient("set_once", `profile: ${distinctId}`, (client) => {
      client.people.set_once(distinctId, properties, (error: unknown) => {
        if (error) {
          logMixpanelError("set_once", `profile: ${distinctId}`, error);
        }
      });
    });
  }

  function unionUserProfile(
    distinctId: string,
    properties: AnalyticsProfileUnionProperties
  ): void {
    withClient("union", `profile: ${distinctId}`, (client) => {
      client.people.union(distinctId, properties, (error: unknown) => {
        if (error) {
          logMixpanelError("union", `profile: ${distinctId}`, error);
        }
      });
    });
  }

  function updateWorkspaceProfile(
    distinctId: string,
    occurredAt: Date = new Date()
  ): void {
    const update = createWorkspaceProfileUpdate(config.workspace, occurredAt);

    unionUserProfile(distinctId, update.union);
    setUserProfileOnce(distinctId, update.setOnce);
    setUserProfile(distinctId, update.set);
  }

  return {
    track,
    setUserProfile,
    setUserProfileOnce,
    unionUserProfile,
    updateWorkspaceProfile,
  };
}

export function __resetServerAnalyticsClientsForTests(): void {
  serverClients.clear();
}
