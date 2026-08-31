import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { MirrorConfig } from "./config";
import {
  addInternalDependencies,
  readJsonFile,
  rewritePackageJsonDependencies,
  writeJsonFile,
} from "./package-rewrites";

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};

const appMirrorKinds = new Set([
  "next-app",
  "telegram-app",
  "expo-app",
  "wxt-extension",
]);

function removeIfExists(filePath: string): void {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
}

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function writeText(filePath: string, value: string): void {
  writeFileSync(filePath, value);
}

function replaceRequired(
  filePath: string,
  search: string,
  replace: string
): void {
  const current = readText(filePath);
  if (!current.includes(search)) {
    throw new Error(
      `${filePath} no longer contains the expected rewrite block`
    );
  }
  writeText(filePath, current.replace(search, replace));
}

function removeExternalTsconfigPaths(tsconfigPath: string): void {
  const tsconfig = readJsonFile<{
    compilerOptions?: { paths?: Record<string, string[]> };
  }>(tsconfigPath);

  const paths = tsconfig.compilerOptions?.paths;
  if (!paths) {
    return;
  }

  for (const [alias, targets] of Object.entries(paths)) {
    if (
      alias.startsWith("@loyal-labs/") &&
      targets.some(
        (target) =>
          target.startsWith("../../packages") || target.startsWith("../../sdk")
      )
    ) {
      delete paths[alias];
    }
  }

  writeJsonFile(tsconfigPath, tsconfig);
}

function removePackageLockfiles(root: string): void {
  removeIfExists(path.join(root, "bun.lock"));
  removeIfExists(path.join(root, "package-lock.json"));
}

function rewriteWorkspaceScripts(packageJsonPath: string): void {
  const packageJson = readJsonFile<PackageJson>(packageJsonPath);
  const scripts = packageJson.scripts;
  if (!scripts) {
    return;
  }

  for (const [name, command] of Object.entries(scripts)) {
    if (!command.includes("--cwd ..")) {
      continue;
    }

    if (name === "predev" || name === "prebuild") {
      if (command.includes("check:drizzle-singleton")) {
        scripts[name] = "bun run check:drizzle-singleton";
      } else {
        delete scripts[name];
      }
      continue;
    }

    scripts[name] = command
      .replace(/bun run --cwd \.\.\/\.\. build:[^&]+&&\s*/g, "")
      .replace(/bun run --cwd \.\.\/\.\. [^&]+&&\s*/g, "")
      .trim();
  }

  writeJsonFile(packageJsonPath, packageJson);
}

function rewriteFrontend(root: string, versions: Map<string, string>): void {
  rewritePackageJsonDependencies(path.join(root, "package.json"), versions);
  rewriteWorkspaceScripts(path.join(root, "package.json"));
  removeExternalTsconfigPaths(path.join(root, "tsconfig.json"));
  writeJsonFile(path.join(root, "vercel.json"), {
    buildCommand: "bun run build",
  });
}

function rewriteTelegramApp(root: string, versions: Map<string, string>): void {
  rewritePackageJsonDependencies(path.join(root, "package.json"), versions);
  rewriteWorkspaceScripts(path.join(root, "package.json"));
  removeExternalTsconfigPaths(path.join(root, "tsconfig.json"));

  replaceRequired(
    path.join(root, "next.config.ts"),
    `  turbopack: {\n    root: path.resolve(__dirname, "../.."),\n  },\n`,
    ""
  );

  writeJsonFile(path.join(root, "vercel.json"), {
    buildCommand: "bun run build && bash scripts/upload-sourcemaps.sh",
    crons: readJsonFile<{ crons?: unknown[] }>(path.join(root, "vercel.json"))
      .crons,
  });

  writeText(
    path.join(root, "drizzle.schema.ts"),
    `export * from "@loyal-labs/db-core/schema";\n`
  );
  replaceRequired(
    path.join(root, "drizzle.config.ts"),
    `schema: "../../packages/db-core/src/schema.ts"`,
    `schema: "./drizzle.schema.ts"`
  );
}

function rewriteMobile(root: string, versions: Map<string, string>): void {
  rewritePackageJsonDependencies(path.join(root, "package.json"), versions);
  removeExternalTsconfigPaths(path.join(root, "tsconfig.json"));
  removeIfExists(path.join(root, "CLAUDE.md"));

  const metroConfig = `// mobile/metro.config.js
const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const privateTransactionsEntryCandidates = [
  path.resolve(
    __dirname,
    "node_modules/@loyal-labs/private-transactions/dist/index.js",
  ),
  path.resolve(
    __dirname,
    "node_modules/@loyal-labs/private-transactions/index.ts",
  ),
];
const privateTransactionsEntry = privateTransactionsEntryCandidates.find((candidate) =>
  fs.existsSync(candidate),
);

if (!privateTransactionsEntry) {
  throw new Error(
    "Unable to resolve @loyal-labs/private-transactions entry file from Metro config.",
  );
}

// SVG transformer
config.transformer.babelTransformerPath = require.resolve(
  "react-native-svg-transformer",
);
config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== "svg",
);
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];

const nativewindConfig = withNativewind(config, {
  inlineVariables: false,
  globalClassNamePolyfill: false,
  inlineRem: 16,
});

const nativewindResolveRequest = nativewindConfig.resolver.resolveRequest;
nativewindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@loyal-labs/private-transactions") {
    return {
      type: "sourceFile",
      filePath: privateTransactionsEntry,
    };
  }

  if (moduleName === "node:crypto") {
    return { type: "empty" };
  }

  if (typeof nativewindResolveRequest === "function") {
    return nativewindResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = nativewindConfig;
`;
  writeText(path.join(root, "metro.config.js"), metroConfig);

  const jestConfigPath = path.join(root, "jest.config.js");
  // Workspace aliases only exist in the monorepo; the mirror resolves
  // @loyal-labs/* from node_modules, so drop every mapper pointing at packages/.
  const jestConfig = readText(jestConfigPath).replace(
    /^[ \t]*"\^@loyal-labs\/[^"]+"\s*:\s*"[^"]*\.\.\/\.\.\/packages[^"]*",[ \t]*\r?\n/gm,
    ""
  );
  writeText(jestConfigPath, jestConfig);

  const easWorkflowPath = path.join(
    root,
    ".eas/workflows/build-preview-android-apk.yml"
  );
  if (existsSync(easWorkflowPath)) {
    writeText(
      easWorkflowPath,
      readText(easWorkflowPath).replaceAll(
        "https://api.github.com/repos/loyal-labs/loyal-app/releases",
        "https://api.github.com/repos/loyal-labs/loyal-mobile/releases"
      )
    );
  }

  removePackageLockfiles(root);
}

function rewriteExtension(root: string, versions: Map<string, string>): void {
  addInternalDependencies(
    path.join(root, "package.json"),
    [
      "@loyal-labs/private-transactions",
      "@loyal-labs/shared",
      "@loyal-labs/solana-rpc",
      "@loyal-labs/solana-wallet",
      "@loyal-labs/wallet-core",
    ],
    versions
  );

  replaceRequired(
    path.join(root, "wxt.config.ts"),
    `\n  alias: {\n    "@loyal-labs/wallet-core": new URL(\n      "../../packages/wallet-core/src",\n      import.meta.url\n    ).pathname,\n    "@loyal-labs/solana-rpc": new URL(\n      "../../packages/solana-rpc/src",\n      import.meta.url\n    ).pathname,\n    "@loyal-labs/solana-wallet": new URL(\n      "../../packages/solana-wallet/src",\n      import.meta.url\n    ).pathname,\n    "@loyal-labs/shared": new URL("../../packages/shared/src", import.meta.url)\n      .pathname,\n    "@loyal-labs/private-transactions": new URL(\n      "../../packages/private-transactions/dist/index.js",\n      import.meta.url\n    ).pathname,\n  },\n`,
    "\n"
  );
}

function addSourceTreePackageJson(root: string, source: "packages"): void {
  writeJsonFile(path.join(root, "package.json"), {
    private: true,
    type: "module",
    packageManager: "bun@1.3.11",
    workspaces: [`${source}/*`],
  });
}

function addRustCliWorkspace(root: string): void {
  writeText(
    path.join(root, "Cargo.toml"),
    `[workspace]
members = [
    "crates/loyal-cli",
    "crates/smart-accounts-cli",
    "crates/loyal-smart-accounts-rs",
]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1

[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1
`
  );
}

function addContractsWorkspace(root: string): void {
  writeText(
    path.join(root, "Cargo.toml"),
    `[workspace]
members = [
    "programs/telegram-private-transfer",
    "programs/telegram-verification",
]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1

[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1
`
  );
}

export function applyMirrorRewrites(
  mirror: MirrorConfig,
  root: string,
  versions: Map<string, string>
): void {
  switch (mirror.kind) {
    case "next-app":
      rewriteFrontend(root, versions);
      removePackageLockfiles(root);
      break;
    case "telegram-app":
      rewriteTelegramApp(root, versions);
      removePackageLockfiles(root);
      break;
    case "expo-app":
      rewriteMobile(root, versions);
      break;
    case "wxt-extension":
      rewriteExtension(root, versions);
      removePackageLockfiles(root);
      break;
    case "source-tree":
      addSourceTreePackageJson(root, mirror.source as "packages");
      break;
    case "rust-cli":
      addRustCliWorkspace(root);
      break;
    case "anchor-programs":
      addContractsWorkspace(root);
      break;
  }
}

export function isGeneratedAppMirror(mirror: MirrorConfig): boolean {
  return appMirrorKinds.has(mirror.kind);
}
