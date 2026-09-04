import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

export function runGit(args: string[], cwd = process.cwd()): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `git ${args.join(" ")} failed`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return result.stdout.trim();
}

export function runGh(args: string[], token?: string): string {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(token ? { GH_TOKEN: token } : {}),
    },
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `gh ${args.join(" ")} failed`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return result.stdout.trim();
}

export function repoExists(repo: string, token?: string): boolean {
  const result = spawnSync("gh", ["repo", "view", repo, "--json", "name"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(token ? { GH_TOKEN: token } : {}),
    },
  });

  return result.status === 0;
}

export function listTrackedFiles(prefix: string): string[] {
  const output = runGit(["ls-files", "-z", "--", prefix]);
  return output ? output.split("\0").filter(Boolean) : [];
}

export function getHeadSha(): string {
  return runGit(["rev-parse", "HEAD"]);
}

export function getShortHeadSha(): string {
  return runGit(["rev-parse", "--short", "HEAD"]);
}

export function removeDirectoryContentsExceptGit(directory: string): void {
  for (const entry of readdirSync(directory)) {
    if (entry === ".git") {
      continue;
    }
    rmSync(path.join(directory, entry), { recursive: true, force: true });
  }
}

export function hasGitChanges(directory: string): boolean {
  return runGit(["status", "--short"], directory).trim().length > 0;
}

export function assertGitDirectory(directory: string): void {
  if (!existsSync(path.join(directory, ".git"))) {
    throw new Error(`${directory} is not a git repository`);
  }
}
