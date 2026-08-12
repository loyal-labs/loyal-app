type FrontendFlagDefinition = {
  key: string;
  enabled: boolean;
  audience: "all" | "public" | "team";
  targetEnvironments: Array<"development" | "preview" | "production">;
};

type FrontendFlagContext = {
  appEnvironment: "development" | "preview" | "production";
  isTeam: boolean;
};

export function evaluateFrontendFlag(
  flag: FrontendFlagDefinition | undefined,
  context: FrontendFlagContext
) {
  if (!flag) return false;
  if (!flag.enabled) return false;
  if (!Array.isArray(flag.targetEnvironments)) return false;
  if (!flag.targetEnvironments.includes(context.appEnvironment)) return false;

  switch (flag.audience) {
    case "all":
      return true;
    case "public":
      return !context.isTeam;
    case "team":
      return context.isTeam;
    default:
      return false;
  }
}
