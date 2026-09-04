import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { blockedMirrorRepos, mirrors } from "./config";
import type { MirrorConfig } from "./config";
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
import { selectMirrorsForChangedPaths } from "./selection";

type SyncOptions = {
  dryRun: boolean;
  createRepos: boolean;
  skipRepoCheck: boolean;
  skipIfPackagesUnpublished: boolean;
  changedOnly: boolean;
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
    changedOnly: args.has("--changed-only"),
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
  stripPrefix: boolean,
  excludePaths: readonly string[] = []
): void {
  for (const file of listTrackedFiles(prefix)) {
    if (
      excludePaths.some(
        (excluded) => file === excluded || file.startsWith(`${excluded}/`)
      )
    ) {
      continue;
    }
    const relativePath = stripPrefix ? path.relative(prefix, file) : file;
    copyTrackedFile(file, path.join(destinationRoot, relativePath));
  }
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

function generateMirror(mirror: MirrorConfig, destinationRoot: string): void {
  rmSync(destinationRoot, { recursive: true, force: true });
  mkdirSync(destinationRoot, { recursive: true });

  switch (mirror.kind) {
    case "next-app":
    case "telegram-app":
    case "expo-app":
    case "wxt-extension":
      copyTrackedPrefix(
        mirror.source,
        destinationRoot,
        true,
        mirror.excludePaths
      );
      break;
    case "source-tree":
    case "rust-cli":
      copyTrackedPrefix(
        mirror.source,
        destinationRoot,
        false,
        mirror.excludePaths
      );
      break;
  }

  applyMirrorRewrites(mirror, destinationRoot, getInternalPackageVersions());
  writeMirrorSource(mirror, destinationRoot);
}

function findTextMatches(pattern: string, directory: string): string {
  const matcher = new RegExp(pattern);
  const matches: string[] = [];
  const ignoredDirectories = new Set([
    ".git",
    ".next",
    ".turbo",
    "build",
    "dist",
    "node_modules",
  ]);

  function walk(currentDirectory: string): void {
    for (const entry of readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          walk(entryPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const contents = readFileSync(entryPath);
      if (contents.includes(0)) {
        continue;
      }

      const lines = contents.toString("utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (matcher.test(line)) {
          matches.push(
            `${path.relative(directory, entryPath)}:${index + 1}:${line}`
          );
        }
      });
    }
  }

  walk(directory);
  return matches.join("\n");
}

function assertGeneratedSafety(
  mirror: MirrorConfig,
  destinationRoot: string
): void {
  if (isGeneratedAppMirror(mirror)) {
    const forbidden = findTextMatches(
      appMirrorForbiddenPattern,
      destinationRoot
    );
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

    const loyalAppReleaseTarget = findTextMatches(
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

function getChangedPathsSinceFirstParent(): string[] {
  const revisionLine = runGit(["rev-list", "--parents", "-n", "1", "HEAD"]);
  const [, firstParent] = revisionLine.split(/\s+/);

  if (!firstParent) {
    return [];
  }

  const output = runGit(["diff", "--name-only", firstParent, "HEAD"]);
  return output ? output.split("\n").filter(Boolean) : [];
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
  const mirrorsToSync = options.changedOnly
    ? selectMirrorsForChangedPaths(getChangedPathsSinceFirstParent())
    : [...mirrors];

  if (options.changedOnly) {
    console.log(
      mirrorsToSync.length > 0
        ? `Selected mirrors: ${mirrorsToSync
            .map((mirror) => mirror.repo)
            .join(", ")}`
        : "No mirror source paths changed; skipping mirror sync."
    );
  }

  if (mirrorsToSync.length === 0) {
    return;
  }

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

  for (const mirror of mirrorsToSync) {
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
