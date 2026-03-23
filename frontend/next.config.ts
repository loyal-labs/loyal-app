import { execSync } from "child_process";
import type { NextConfig } from "next";

function getGitInfo() {
  const vercelCommit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const vercelBranch = process.env.VERCEL_GIT_COMMIT_REF;

  try {
    const commitHash =
      vercelCommit || execSync("git rev-parse --short HEAD").toString().trim();
    const gitBranch = execSync("git rev-parse --abbrev-ref HEAD")
      .toString()
      .trim();
    const branch =
      vercelBranch || (gitBranch !== "HEAD" ? gitBranch : "unknown");
    return { commitHash, branch };
  } catch {
    return {
      commitHash: vercelCommit ?? "unknown",
      branch: vercelBranch ?? "unknown",
    };
  }
}

const { commitHash, branch } = getGitInfo();

const nextConfig: NextConfig = {
  transpilePackages: ["@loyal-labs/shared"],
  env: {
    NEXT_PUBLIC_GIT_COMMIT_HASH: commitHash,
    NEXT_PUBLIC_GIT_BRANCH: branch,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "img.logo.dev",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "cdn.instadapp.io",
      },
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
