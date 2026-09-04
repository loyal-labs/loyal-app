import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  transpilePackages: [
    "@loyal-labs/db-core",
    "@loyal-labs/db-adapter-neon",
    "@loyal-labs/shared",
  ],
  productionBrowserSourceMaps: true,
};

export default nextConfig;
