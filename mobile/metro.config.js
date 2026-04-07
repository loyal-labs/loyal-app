// mobile/metro.config.js
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Resolve monorepo packages outside /mobile
const sharedRoot = path.resolve(__dirname, "../packages/shared");
const solanaRpcRoot = path.resolve(__dirname, "../packages/solana-rpc/src");
const privateTransactionsRoot = path.resolve(__dirname, "../sdk/private-transactions/dist");
config.watchFolders = [sharedRoot, solanaRpcRoot, privateTransactionsRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, ".."),
];
config.resolver.extraNodeModules = {
  "@loyal-labs/solana-rpc": solanaRpcRoot,
  "@loyal-labs/private-transactions": privateTransactionsRoot,
};

// SVG transformer
config.transformer.babelTransformerPath = require.resolve(
  "react-native-svg-transformer",
);
config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== "svg",
);
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];

module.exports = withNativewind(config, {
  inlineVariables: false,
  globalClassNamePolyfill: false,
  inlineRem: 16,
});
