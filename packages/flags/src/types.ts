export type RuntimeApp = "telegram_miniapp" | "website" | "mobile" | "extension";

export type RuntimeEnvironment = "development" | "preview" | "production";

export type FlagAudience = "all" | "public" | "team";

export type FlagDefinition = {
  key: string;
  enabled: boolean;
  audience: FlagAudience;
  targetApps: RuntimeApp[];
  targetEnvironments: RuntimeEnvironment[];
  updatedAt: string;
};

export type FlagsManifest = {
  version: string;
  generatedAt: string;
  flags: FlagDefinition[];
};

export type FlagEvaluationContext = {
  app: RuntimeApp;
  environment: RuntimeEnvironment;
  isTeam: boolean;
};
