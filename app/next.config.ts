import { execSync } from "child_process";
import type { NextConfig } from "next";
import path from "path";

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

const mixpanelProxyPathRaw = process.env.NEXT_PUBLIC_MIXPANEL_PROXY_PATH?.trim();
const mixpanelProxyPath = mixpanelProxyPathRaw
  ? mixpanelProxyPathRaw.startsWith("/")
    ? mixpanelProxyPathRaw
    : `/${mixpanelProxyPathRaw}`
  : "/ingest";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  transpilePackages: [
    "@loyal-labs/db-core",
    "@loyal-labs/db-adapter-neon",
    "@loyal-labs/llm-core",
    "@loyal-labs/llm-server",
    "@loyal-labs/shared",
  ],
  productionBrowserSourceMaps: true,
  env: {
    NEXT_PUBLIC_GIT_COMMIT_HASH: commitHash,
    NEXT_PUBLIC_GIT_BRANCH: branch,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "t.me",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: `${mixpanelProxyPath}/:path*`,
        destination: "https://api-js.mixpanel.com/:path*",
      },
    ];
  },
};

export default nextConfig;
