import { execSync } from "node:child_process";
import type { NextConfig } from "next";

const FULL_GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function normalizeGitCommit(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && FULL_GIT_COMMIT_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

function getGitInfo() {
  const vercelCommit = normalizeGitCommit(process.env.VERCEL_GIT_COMMIT_SHA);
  const vercelBranch = process.env.VERCEL_GIT_COMMIT_REF;

  try {
    const commitHash =
      vercelCommit ??
      normalizeGitCommit(execSync("git rev-parse HEAD").toString()) ??
      "unknown";
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

// Privy's recommended CSP (docs.privy.io/security/implementation-guide/
// content-security-policy) plus what this app actually loads. Shipped as
// Report-Only first: violations POST to /api/csp-report and nothing is
// blocked. Flip to enforcing once the report stream is quiet.
// ponytail: 'unsafe-inline'/'unsafe-eval' in script-src — Next inline
// bootstrap + wallet-adapter libs need them; nonces are the upgrade path.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
  "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
  // Own API + Privy + Solana RPC/WS (Helius) + Jupiter + realtime + analytics.
  "connect-src 'self' https://auth.privy.io https://api.privy.io https://*.rpc.privy.systems wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://explorer-api.walletconnect.com https://*.helius-rpc.com wss://*.helius-rpc.com https://api.mainnet-beta.solana.com https://api.devnet.solana.com https://api.jup.ag https://lite-api.jup.ag https://loyal-yield-realtime.onrender.com wss://loyal-yield-realtime.onrender.com https://api.mixpanel.com https://stats.askloyal.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "report-uri /api/csp-report",
].join("; ");

const COMMON_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: CONTENT_SECURITY_POLICY,
  },
] as const;

const nextConfig: NextConfig = {
  compiler: {
    removeConsole: {
      exclude: ["error"],
    },
  },
  transpilePackages: ["@loyal-labs/shared"],
  // capjs-core lazily requires esbuild (native binary) for its high
  // obfuscation levels; bundling that breaks Turbopack, so load it from
  // node_modules at runtime instead.
  serverExternalPackages: ["capjs-core"],
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
        // apple-app-site-association has no file extension, so Next/Vercel
        // would otherwise serve it as application/octet-stream. Apple's CDN
        // requires application/json (and no redirect) for Universal Links.
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        // The Earn banner carousel remounts its artwork every few seconds, and
        // Next serves /public with `max-age=0, must-revalidate`, so each
        // rotation cost a revalidation round-trip per asset (ASK-2214).
        // earn-banner.tsx requests these with a ?v=<commit> buster, so a deploy
        // always produces a fresh URL — hence immutable is safe here, and the
        // `has` guard keeps it off unversioned (hand-typed) requests.
        source: "/wallet-workspace/facelift/:asset(earn-banner-.*)",
        has: [{ type: "query", key: "v" }],
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/app/cherry",
        headers: [
          ...COMMON_SECURITY_HEADERS,
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://chat.cherry.fun",
          },
        ],
      },
      {
        // Keep clickjacking protection everywhere except the one Cherry entry
        // that has an explicit frame-ancestors allowlist above.
        source: "/((?!app/cherry/?$).*)",
        headers: [
          ...COMMON_SECURITY_HEADERS,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
