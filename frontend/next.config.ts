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
  compiler: {
    removeConsole: {
      exclude: ["error"],
    },
  },
  transpilePackages: ["@loyal-labs/shared"],
  env: {
    NEXT_PUBLIC_GIT_COMMIT_HASH: commitHash,
    NEXT_PUBLIC_GIT_BRANCH: branch,
  },
  // The (dynamic) /blog listing reads post markdown from
  // public/blog/<slug>/post.md at request time. public/ assets aren't bundled
  // into the serverless function by default, so include them explicitly. (The
  // body is named post.md, not index.md, so Vercel's static layer doesn't serve
  // the raw markdown at /blog/<slug> — see src/features/blog/data.ts.)
  outputFileTracingIncludes: {
    "/blog": ["./public/blog/**/*.md"],
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
  productionBrowserSourceMaps: true,
  async headers() {
    return [
      {
        // Applied to every route. HSTS is already set by Vercel at the
        // platform level; these three add the clickjacking / MIME-sniffing /
        // sensor-permission protections that were missing (audit M-3).
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
