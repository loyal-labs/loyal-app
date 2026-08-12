export type MirrorKind =
  | "next-app"
  | "telegram-app"
  | "expo-app"
  | "wxt-extension"
  | "source-tree"
  | "rust-cli"
  | "anchor-programs";

export type MirrorConfig = {
  source: string;
  repo: `loyal-labs/${string}`;
  kind: MirrorKind;
  description: string;
};

export const mirrors = [
  {
    source: "apps/web",
    repo: "loyal-labs/loyal-webapp",
    kind: "next-app",
    description: "Generated mirror of loyal-app/frontend",
  },
  {
    source: "apps/telegram",
    repo: "loyal-labs/loyal-telegram-app",
    kind: "telegram-app",
    description: "Generated mirror of loyal-app/app",
  },
  {
    source: "apps/mobile",
    repo: "loyal-labs/loyal-mobile",
    kind: "expo-app",
    description: "Generated mirror of loyal-app/mobile",
  },
  {
    source: "apps/extension",
    repo: "loyal-labs/loyal-extension",
    kind: "wxt-extension",
    description: "Generated mirror of loyal-app/extension",
  },
  {
    source: "sdk",
    repo: "loyal-labs/loyal-sdk",
    kind: "source-tree",
    description: "Generated mirror of loyal-app/sdk",
  },
  {
    source: "packages",
    repo: "loyal-labs/loyal-packages",
    kind: "source-tree",
    description: "Generated mirror of loyal-app/packages",
  },
  {
    source: "cli",
    repo: "loyal-labs/loyal-cli",
    kind: "rust-cli",
    description: "Generated mirror of loyal-app/cli",
  },
  {
    source: "programs",
    repo: "loyal-labs/loyal-contracts",
    kind: "anchor-programs",
    description: "Generated mirror of loyal-app/programs",
  },
] as const satisfies readonly MirrorConfig[];

export const blockedMirrorRepos = new Set([
  "loyal-labs/loyal-solana",
  "loyal-labs/loyal-frontend",
  "loyal-labs/loyal-docs",
]);
