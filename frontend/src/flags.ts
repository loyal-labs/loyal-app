import { getPublicEnv } from "@/lib/core/config/public";

export type FrontendFlagsManifest = {
  version: string;
  generatedAt: string;
  flags: Array<{
    key: string;
    enabled: boolean;
    audience: "all" | "public" | "team";
    targetEnvironments: Array<"development" | "preview" | "production">;
  }>;
};

export function getFlagsManifestUrl() {
  return getPublicEnv().flagsManifestUrl;
}

export function isSkillsEnabled(): boolean {
  return getPublicEnv().skillsEnabled;
}
