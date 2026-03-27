import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  alias: {
    "@loyal-labs/wallet-core": new URL(
      "../packages/wallet-core/src",
      import.meta.url
    ).pathname,
    "@loyal-labs/solana-rpc": new URL(
      "../packages/solana-rpc/src",
      import.meta.url
    ).pathname,
    "@loyal-labs/solana-wallet": new URL(
      "../packages/solana-wallet/src",
      import.meta.url
    ).pathname,
  },

  manifest: ({ mode, browser }) => ({
    name: mode === "development" ? "Loyal (Dev)" : "Loyal",
    description: "Loyal standalone wallet extension",
    permissions: [
      "storage",
      "idle",
      "alarms",
      ...(browser === "firefox" ? [] : ["sidePanel"]),
    ],
    host_permissions: [
      "https://api.mainnet-beta.solana.com/*",
      "https://*.helius-rpc.com/*",
      "https://api.jup.ag/*",
    ],
  }),
});
