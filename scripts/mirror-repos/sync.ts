import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { blockedMirrorRepos, mirrors, type MirrorConfig } from "./config";
import { applyMirrorRewrites, isGeneratedAppMirror } from "./file-rewrites";
import {
  assertGitDirectory,
  getHeadSha,
  getShortHeadSha,
  hasGitChanges,
  listTrackedFiles,
  removeDirectoryContentsExceptGit,
  repoExists,
  runGh,
  runGit,
} from "./git";
import {
  getInternalPackageVersions,
  readJsonFile,
  writeJsonFile,
} from "./package-rewrites";

type SyncOptions = {
  dryRun: boolean;
  createRepos: boolean;
  skipRepoCheck: boolean;
  skipIfPackagesUnpublished: boolean;
};

const appMirrorForbiddenPattern =
  "workspace:\\*|file:\\.\\./packages|file:\\.\\./sdk|\\.\\./packages|\\.\\./sdk|--cwd \\.\\.";

function parseOptions(): SyncOptions {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has("--dry-run"),
    createRepos: args.has("--create-repos"),
    skipRepoCheck: args.has("--skip-repo-check"),
    skipIfPackagesUnpublished: args.has("--skip-if-packages-unpublished"),
  };
}

function repoName(repo: string): string {
  return repo.split("/")[1] ?? repo;
}

function copyTrackedFile(sourceFile: string, destinationFile: string): void {
  mkdirSync(path.dirname(destinationFile), { recursive: true });
  copyFileSync(sourceFile, destinationFile);
}

function copyTrackedPrefix(
  prefix: string,
  destinationRoot: string,
  stripPrefix: boolean
): void {
  for (const file of listTrackedFiles(prefix)) {
    const relativePath = stripPrefix ? path.relative(prefix, file) : file;
    copyTrackedFile(file, path.join(destinationRoot, relativePath));
  }
}

function copyRootFile(file: string, destinationRoot: string): void {
  copyTrackedFile(file, path.join(destinationRoot, file));
}

function writeMirrorSource(
  mirror: MirrorConfig,
  destinationRoot: string
): void {
  writeFileSync(
    path.join(destinationRoot, "MIRROR_SOURCE.md"),
    `# Mirror Source

This repository is generated from \`loyal-labs/loyal-app\`.

- Source path: \`${mirror.source}\`
- Source commit: \`${getHeadSha()}\`
- Generated at: \`${new Date().toISOString()}\`

Do not edit this repository directly. Changes should land in \`loyal-app\`.
`
  );
}

function generateContractsPackageJson(destinationRoot: string): void {
  const rootPackage = readJsonFile<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>("package.json");
  const rootDependencyVersions = {
    ...rootPackage.dependencies,
    ...rootPackage.devDependencies,
    bs58: "^6.0.0",
  };

  const dependencyNames = [
    "@coral-xyz/anchor",
    "@magicblock-labs/ephemeral-rollups-sdk",
    "@solana/spl-token",
    "@solana/web3.js",
    "bs58",
    "tweetnacl",
  ];
  const devDependencyNames = [
    "@types/bn.js",
    "@types/chai",
    "@types/mocha",
    "chai",
    "mocha",
    "ts-mocha",
    "typescript",
  ];

  const pick = (names: string[], source?: Record<string, string>) =>
    Object.fromEntries(
      names.map((name) => {
        const version = source?.[name];
        if (!version) {
          throw new Error(`Root package.json is missing ${name}`);
        }
        return [name, version];
      })
    );

  writeJsonFile(path.join(destinationRoot, "package.json"), {
    private: true,
    type: "module",
    packageManager: "bun@1.3.11",
    scripts: {
      test: "bun run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts",
      test_private_transfer:
        "bun run ts-mocha -p ./tsconfig.json -t 1000000 tests/telegram-private-transfer.ts",
    },
    dependencies: pick(dependencyNames, rootDependencyVersions),
    devDependencies: pick(devDependencyNames, rootDependencyVersions),
  });
}

function generateMirror(mirror: MirrorConfig, destinationRoot: string): void {
  rmSync(destinationRoot, { recursive: true, force: true });
  mkdirSync(destinationRoot, { recursive: true });

  switch (mirror.kind) {
    case "next-app":
    case "telegram-app":
    case "expo-app":
    case "wxt-extension":
      copyTrackedPrefix(mirror.source, destinationRoot, true);
      break;
    case "source-tree":
    case "rust-cli":
      copyTrackedPrefix(mirror.source, destinationRoot, false);
      break;
    case "anchor-programs":
      copyTrackedPrefix("programs", destinationRoot, false);
      copyTrackedPrefix("tests", destinationRoot, false);
      copyTrackedPrefix("target/idl", destinationRoot, false);
      copyTrackedPrefix("target/types", destinationRoot, false);
      copyRootFile("Anchor.toml", destinationRoot);
      copyRootFile("tsconfig.json", destinationRoot);
      generateContractsPackageJson(destinationRoot);
      break;
  }

  applyMirrorRewrites(mirror, destinationRoot, getInternalPackageVersions());
  writeMirrorSource(mirror, destinationRoot);
}

function rgMatches(pattern: string, directory: string): string {
  const result = Bun.spawnSync(["rg", "-n", pattern, directory], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode === 1) {
    return "";
  }

  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr).trim());
  }

  return new TextDecoder().decode(result.stdout).trim();
}

function assertGeneratedSafety(
  mirror: MirrorConfig,
  destinationRoot: string
): void {
  if (isGeneratedAppMirror(mirror)) {
    const forbidden = rgMatches(appMirrorForbiddenPattern, destinationRoot);
    if (forbidden) {
      throw new Error(
        `${mirror.repo} generated forbidden monorepo references:\n${forbidden}`
      );
    }
  }

  if (mirror.kind === "expo-app") {
    const packageJson = readJsonFile<{ dependencies?: Record<string, string> }>(
      path.join(destinationRoot, "package.json")
    );
    if (
      packageJson.dependencies?.["expo-seed-vault"] !==
      "./modules/expo-seed-vault"
    ) {
      throw new Error(
        "loyal-mobile must keep expo-seed-vault as ./modules/expo-seed-vault"
      );
    }

    const loyalAppReleaseTarget = rgMatches(
      "loyal-labs/loyal-app/releases",
      destinationRoot
    );
    if (loyalAppReleaseTarget) {
      throw new Error(
        `loyal-mobile EAS workflow still targets loyal-app releases:\n${loyalAppReleaseTarget}`
      );
    }
  }
}

function verifyRepoConfig(
  mirror: MirrorConfig,
  options: SyncOptions,
  token?: string
): void {
  if (blockedMirrorRepos.has(mirror.repo)) {
    throw new Error(`${mirror.repo} is blocked and must not be touched`);
  }

  if (!mirror.repo.startsWith("loyal-labs/")) {
    throw new Error(`${mirror.repo} must be under loyal-labs`);
  }

  if (options.skipRepoCheck) {
    return;
  }

  if (repoExists(mirror.repo, token)) {
    return;
  }

  if (!options.createRepos) {
    throw new Error(
      `${mirror.repo} does not exist. Create it first or pass --create-repos.`
    );
  }

  runGh(
    [
      "repo",
      "create",
      mirror.repo,
      "--public",
      "--description",
      mirror.description,
    ],
    token
  );
}

function isPackageVersionPublished(
  packageName: string,
  version: string
): boolean {
  const result = Bun.spawnSync(
    ["npm", "view", `${packageName}@${version}`, "version"],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  return (
    result.exitCode === 0 &&
    new TextDecoder().decode(result.stdout).trim() === version
  );
}

function findUnpublishedInternalPackages(
  versions: Map<string, string>
): string[] {
  return [...versions.entries()]
    .filter(
      ([packageName, version]) =>
        !isPackageVersionPublished(packageName, version)
    )
    .map(([packageName, version]) => `${packageName}@${version}`);
}

function copyGeneratedToClone(generatedRoot: string, cloneRoot: string): void {
  assertGitDirectory(cloneRoot);
  removeDirectoryContentsExceptGit(cloneRoot);

  for (const entry of readdirSync(generatedRoot)) {
    cpSync(path.join(generatedRoot, entry), path.join(cloneRoot, entry), {
      recursive: true,
      force: true,
    });
  }
}

function pushMirror(
  mirror: MirrorConfig,
  generatedRoot: string,
  token: string
): void {
  const cloneRoot = path.join(
    tmpdir(),
    `loyal-mirror-${repoName(mirror.repo)}-${Date.now()}`
  );
  const cloneUrl = `https://x-access-token:${token}@github.com/${mirror.repo}.git`;

  try {
    runGit(["clone", cloneUrl, cloneRoot]);
    runGit(["checkout", "-B", "main"], cloneRoot);
    copyGeneratedToClone(generatedRoot, cloneRoot);
    runGit(["add", "-A"], cloneRoot);

    if (!hasGitChanges(cloneRoot)) {
      console.log(`${mirror.repo}: no changes`);
      return;
    }

    runGit(["config", "user.name", "loyal mirror bot"], cloneRoot);
    runGit(["config", "user.email", "mirror-bot@loyal.app"], cloneRoot);
    runGit(
      ["commit", "-m", `chore(sync): mirror loyal-app ${getShortHeadSha()}`],
      cloneRoot
    );
    runGit(["push", "origin", "main"], cloneRoot);
  } finally {
    rmSync(cloneRoot, { recursive: true, force: true });
  }
}

function main(): void {
  const options = parseOptions();
  const outputRoot = options.dryRun
    ? path.resolve(".context/mirror-dry-run")
    : path.join(tmpdir(), `loyal-mirror-output-${Date.now()}`);
  const token = process.env.MIRROR_SYNC_TOKEN;
  const internalPackageVersions = getInternalPackageVersions();

  if (!options.dryRun && options.skipIfPackagesUnpublished) {
    const unpublishedPackages = findUnpublishedInternalPackages(
      internalPackageVersions
    );
    if (unpublishedPackages.length > 0) {
      console.log(
        [
          "Skipping mirror sync because these package versions are not published yet:",
          ...unpublishedPackages.map((name) => `- ${name}`),
        ].join("\n")
      );
      return;
    }
  }

  if (!options.dryRun && !token) {
    throw new Error("MIRROR_SYNC_TOKEN is required when syncing mirror repos");
  }

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  for (const mirror of mirrors) {
    verifyRepoConfig(mirror, options, token);

    const generatedRoot = path.join(outputRoot, repoName(mirror.repo));
    generateMirror(mirror, generatedRoot);
    assertGeneratedSafety(mirror, generatedRoot);

    if (options.dryRun) {
      console.log(`${mirror.repo}: generated ${generatedRoot}`);
      continue;
    }

    pushMirror(mirror, generatedRoot, token!);
  }

  if (!options.dryRun) {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}

main();
