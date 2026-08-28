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
