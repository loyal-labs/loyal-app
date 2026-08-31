export type MirrorKind =
  | "next-app"
  | "telegram-app"
  | "expo-app"
  | "wxt-extension"
  | "source-tree"
  | "rust-cli";

export type MirrorConfig = {
  source: string;
  repo: `loyal-labs/${string}`;
  kind: MirrorKind;
  description: string;
  excludePaths?: readonly string[];
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
    // Operator e2e verifier; hardcodes monorepo-relative package paths that
    // trip the generated-mirror safety check.
    excludePaths: ["apps/mobile/scripts/verify-withdraw-latency-e2e.ts"],
  },
  {
    source: "apps/extension",
    repo: "loyal-labs/loyal-extension",
    kind: "wxt-extension",
    description: "Generated mirror of loyal-app/extension",
  },
  {
    source: "packages",
    repo: "loyal-labs/loyal-packages",
    kind: "source-tree",
    description: "Generated mirror of loyal-app/packages",
    excludePaths: ["packages/private-transactions"],
  },
  {
    source: "crates",
    repo: "loyal-labs/loyal-cli",
    kind: "rust-cli",
    description: "Generated mirror of loyal-app/crates",
    excludePaths: ["crates/private-transfers-cli"],
  },
] as const satisfies readonly MirrorConfig[];

export const blockedMirrorRepos = new Set([
  "loyal-labs/loyal-contracts",
  "loyal-labs/loyal-solana",
  "loyal-labs/loyal-frontend",
  "loyal-labs/loyal-docs",
  "loyal-labs/loyal-sdk",
]);
