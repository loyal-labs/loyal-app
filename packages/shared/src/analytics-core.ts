export type AnalyticsPrimitive = boolean | null | number | string;

export type AnalyticsListPrimitive = boolean | number | string;

export type AnalyticsProperties = Record<string, unknown>;

export type AnalyticsWorkspace = "miniapp" | "bot" | "website";

export type AnalyticsProfileProperties = Record<string, AnalyticsPrimitive>;

export type AnalyticsProfileUnionProperties = Record<
  string,
  AnalyticsListPrimitive[]
>;

export type AnalyticsWorkspaceProfileUpdate = {
  set: AnalyticsProfileProperties;
  setOnce: AnalyticsProfileProperties;
  union: AnalyticsProfileUnionProperties;
};

export function withWorkspaceProperties(
  workspace: AnalyticsWorkspace,
  properties?: AnalyticsProperties
): AnalyticsProperties {
  return {
    workspace,
    ...(properties ?? {}),
  };
}

export function createWorkspaceProfileUpdate(
  workspace: AnalyticsWorkspace,
  occurredAt: Date = new Date()
): AnalyticsWorkspaceProfileUpdate {
  const timestamp = occurredAt.toISOString();

  return {
    set: {
      last_workspace: workspace,
      [`${workspace}_last_seen_at`]: timestamp,
    },
    setOnce: {
      first_workspace: workspace,
      [`${workspace}_first_seen_at`]: timestamp,
    },
    union: {
      workspaces: [workspace],
    },
  };
}
