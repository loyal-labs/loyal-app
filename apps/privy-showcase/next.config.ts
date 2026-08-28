import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/kamino/klend/deposit-instructions",
        destination:
          "https://api.kamino.finance/ktx/klend/deposit-instructions",
      },
      {
        source: "/api/kamino/klend/withdraw-instructions",
        destination:
          "https://api.kamino.finance/ktx/klend/withdraw-instructions",
      },
    ];
  },
  // rpc-websockets, reached through @solana/web3.js, pulls in ws with a runtime
  // require that webpack bundles as an external. Next's static tracer never sees
  // it, so the file is missing from the Lambda and every route that touches a
  // Connection dies at module load with "Cannot find module 'ws'". Trace from the
  // monorepo root and force ws into the API routes' file list.
  outputFileTracingRoot: resolve(directory, "../.."),
  outputFileTracingIncludes: {
    "/api/**/*": ["../../node_modules/ws/**/*"],
  },
  transpilePackages: [
    "@loyal-labs/actions",
    "@loyal-labs/loyal-smart-accounts",
    "@loyal-labs/smart-account-vaults",
  ],
  turbopack: {
    root: resolve(directory, "../.."),
  },
};

export default nextConfig;
