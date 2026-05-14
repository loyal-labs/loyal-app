import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const publishablePackageDirs = [
  "packages/shared",
  "packages/flags",
  "packages/grid-core",
  "packages/auth-core",
  "packages/db-core",
  "packages/db-adapter-neon",
  "packages/llm-core",
  "packages/llm-server",
  "packages/solana-rpc",
  "packages/solana-wallet",
  "sdk/private-transactions",
  "sdk/loyal-smart-accounts-core",
  "sdk/loyal-smart-accounts",
  "packages/solana-instruction-decoder",
  "packages/smart-account-vaults",
  "packages/wallet-core",
] as const;

type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  publishConfig?: Record<string, unknown>;
};

type PackageInfo = {
  dir: string;
  packageJsonPath: string;
  packageJson: PackageJson;
};

const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

function readPackageInfo(dir: string): PackageInfo {
  const packageJsonPath = path.join(dir, "package.json");
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf8")
  ) as PackageJson;

  return { dir, packageJsonPath, packageJson };
}

function run(command: string, args: string[], cwd = process.cwd()): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return result.stdout.trim();
}

function isVersionPublished(packageName: string, version: string): boolean {
  const result = spawnSync(
    "npm",
    ["view", `${packageName}@${version}`, "version"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  return result.status === 0 && result.stdout.trim() === version;
}

function rewriteWorkspaceDependencies(
  packageJson: PackageJson,
  versionsByName: Map<string, string>
): PackageJson {
  const next = structuredClone(packageJson);

  for (const section of dependencySections) {
    const dependencies = next[section];
    if (!dependencies) {
      continue;
    }

    for (const [dependencyName, range] of Object.entries(dependencies)) {
      if (!range.startsWith("workspace:")) {
        continue;
      }

      const version = versionsByName.get(dependencyName);
      if (!version) {
        throw new Error(
          `${packageJson.name} depends on ${dependencyName} with ${range}, but ${dependencyName} is not in the publish set`
        );
      }

      dependencies[dependencyName] = `^${version}`;
    }
  }

  next.publishConfig = {
    ...next.publishConfig,
    access: "public",
  };

  return next;
}

function copyPackageForPublish(
  info: PackageInfo,
  versionsByName: Map<string, string>
): string {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "loyal-package-publish-"));
  const tempPackageDir = path.join(tempRoot, path.basename(info.dir));

  cpSync(info.dir, tempPackageDir, {
    recursive: true,
    filter(source) {
      const relative = path.relative(info.dir, source);
      return ![
        "node_modules",
        ".turbo",
        ".next",
        "coverage",
        "tsconfig.tsbuildinfo",
      ].some(
        (excluded) =>
          relative === excluded || relative.startsWith(`${excluded}${path.sep}`)
      );
    },
  });

  const rewrittenPackageJson = rewriteWorkspaceDependencies(
    info.packageJson,
    versionsByName
  );
  writeFileSync(
    path.join(tempPackageDir, "package.json"),
    `${JSON.stringify(rewrittenPackageJson, null, 2)}\n`
  );

  return tempPackageDir;
}

function ensureBuildOutput(info: PackageInfo): void {
  if (info.packageJson.name === "@loyal-labs/private-transactions") {
    if (!existsSync(path.join(info.dir, "dist/index.js"))) {
      throw new Error(`${info.packageJson.name} is missing dist/index.js`);
    }
    return;
  }

  if (!existsSync(path.join(info.dir, "dist"))) {
    throw new Error(
      `${info.packageJson.name} is missing dist/. Run package builds before publishing.`
    );
  }
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const packages = publishablePackageDirs.map(readPackageInfo);
  const versionsByName = new Map(
    packages.map((info) => [info.packageJson.name, info.packageJson.version])
  );

  for (const info of packages) {
    if (info.packageJson.private) {
      throw new Error(
        `${info.packageJson.name} is still private and cannot be published`
      );
    }
    ensureBuildOutput(info);
  }

  for (const info of packages) {
    const { name, version } = info.packageJson;
    if (isVersionPublished(name, version)) {
      console.log(`${name}@${version} already exists on npm, skipping`);
      continue;
    }

    if (dryRun) {
      console.log(
        `${name}@${version} is not published; dry-run would publish it`
      );
      continue;
    }

    const tempPackageDir = copyPackageForPublish(info, versionsByName);
    const publishArgs = ["publish", "--access", "public", "--ignore-scripts"];
    if (process.env.GITHUB_ACTIONS === "true") {
      publishArgs.push("--provenance");
    }

    try {
      console.log(`Publishing ${name}@${version}`);
      run("npm", publishArgs, tempPackageDir);
    } finally {
      rmSync(path.dirname(tempPackageDir), { recursive: true, force: true });
    }
  }
}

main();
