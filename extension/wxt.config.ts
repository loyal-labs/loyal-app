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
    "@loyal-labs/shared": new URL("../packages/shared/src", import.meta.url)
      .pathname,
    "@loyal-labs/private-transactions": new URL(
      "../sdk/private-transactions/dist/index.js",
      import.meta.url
    ).pathname,
  },

  manifest: ({ mode, browser }) => ({
    name:
      mode === "development"
        ? "Loyal (Dev)"
        : "Loyal — Private Solana Wallet & AI Agent",
    description:
      "Private open-source Solana wallet with AI agents and shielded transfers. Connect to any dApp, send via Telegram.",
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
      "https://api-js.mixpanel.com/*",
    ],
  }),
});
