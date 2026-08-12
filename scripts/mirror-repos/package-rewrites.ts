import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const packageDirs = [
  "packages/auth-core",
  "packages/db-adapter-neon",
  "packages/db-core",
  "packages/flags",
  "packages/llm-core",
  "packages/llm-server",
  "packages/loyal-actions",
  "packages/shared",
  "packages/smart-account-vaults",
  "packages/solana-instruction-decoder",
  "packages/solana-rpc",
  "packages/solana-wallet",
  "packages/wallet-core",
  "sdk/loyal-smart-accounts-core",
  "sdk/loyal-smart-accounts",
  "sdk/private-transactions",
] as const;

const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;

type PackageJson = {
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

export function getInternalPackageVersions(
  root = process.cwd()
): Map<string, string> {
  const versions = new Map<string, string>();

  for (const dir of packageDirs) {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, dir, "package.json"), "utf8")
    ) as PackageJson;

    if (!packageJson.name || !packageJson.version) {
      throw new Error(`${dir}/package.json is missing name or version`);
    }

    versions.set(packageJson.name, packageJson.version);
  }

  return versions;
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function rewriteInternalDependencyRanges(
  packageJson: PackageJson,
  versions: Map<string, string>
): PackageJson {
  const next = structuredClone(packageJson);

  for (const section of dependencySections) {
    const dependencies = next[section];
    if (!dependencies) {
      continue;
    }

    for (const [name, range] of Object.entries(dependencies)) {
      if (
        range === "workspace:*" ||
        /^file:(\.\.\/)+(packages|sdk)\//.test(range)
      ) {
        const version = versions.get(name);
        if (!version) {
          throw new Error(
            `Cannot rewrite ${name}@${range}; package version is unknown`
          );
        }
        dependencies[name] = `^${version}`;
      }
    }
  }

  return next;
}

export function rewritePackageJsonDependencies(
  packageJsonPath: string,
  versions: Map<string, string>
): PackageJson {
  const packageJson = readJsonFile<PackageJson>(packageJsonPath);
  const rewritten = rewriteInternalDependencyRanges(packageJson, versions);
  writeJsonFile(packageJsonPath, rewritten);
  return rewritten;
}

export function addInternalDependencies(
  packageJsonPath: string,
  packageNames: string[],
  versions: Map<string, string>
): PackageJson {
  const packageJson = readJsonFile<PackageJson>(packageJsonPath);
  packageJson.dependencies ??= {};

  for (const name of packageNames) {
    const version = versions.get(name);
    if (!version) {
      throw new Error(`Cannot add ${name}; package version is unknown`);
    }
    packageJson.dependencies[name] = `^${version}`;
  }

  const rewritten = rewriteInternalDependencyRanges(packageJson, versions);
  writeJsonFile(packageJsonPath, rewritten);
  return rewritten;
}
