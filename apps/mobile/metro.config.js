// mobile/metro.config.js
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Resolve monorepo packages outside /mobile
const sharedRoot = path.resolve(__dirname, "../../packages/shared");
const solanaRpcRoot = path.resolve(__dirname, "../../packages/solana-rpc/src");
const walletCoreRoot = path.resolve(__dirname, "../../packages/wallet-core/src");
// Smart-account-vaults SDK (device-side Earn autodeposit prepare) and its
// workspace deps — all resolved from source, same pattern as wallet-core.
const smartAccountVaultsRoot = path.resolve(
  __dirname,
  "../../packages/smart-account-vaults/src",
);
const loyalActionsRoot = path.resolve(__dirname, "../../packages/loyal-actions/src");
const loyalSmartAccountsRoot = path.resolve(
  __dirname,
  "../../packages/loyal-smart-accounts/src",
);
const loyalSmartAccountsCoreRoot = path.resolve(
  __dirname,
  "../../packages/loyal-smart-accounts-core/src",
);
const solanaWalletRoot = path.resolve(__dirname, "../../packages/solana-wallet/src");
const solanaInstructionDecoderRoot = path.resolve(
  __dirname,
  "../../packages/solana-instruction-decoder/src",
);
config.watchFolders = [
  sharedRoot,
  solanaRpcRoot,
  walletCoreRoot,
  smartAccountVaultsRoot,
  loyalActionsRoot,
  loyalSmartAccountsRoot,
  loyalSmartAccountsCoreRoot,
  solanaWalletRoot,
  solanaInstructionDecoderRoot,
];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, ".."),
];
config.resolver.extraNodeModules = {
  "@loyal-labs/solana-rpc": solanaRpcRoot,
  "@loyal-labs/wallet-core/lib": path.resolve(walletCoreRoot, "lib/index.ts"),
  "@loyal-labs/smart-account-vaults": smartAccountVaultsRoot,
  "@loyal-labs/actions": loyalActionsRoot,
  "@loyal-labs/loyal-smart-accounts": loyalSmartAccountsRoot,
  "@loyal-labs/loyal-smart-accounts-core": loyalSmartAccountsCoreRoot,
  "@loyal-labs/loyal-smart-accounts-core/internal": path.resolve(
    loyalSmartAccountsCoreRoot,
    "internal/index.ts",
  ),
  "@loyal-labs/solana-wallet": solanaWalletRoot,
  "@loyal-labs/solana-instruction-decoder": solanaInstructionDecoderRoot,
};

// SVG transformer
config.transformer.babelTransformerPath = require.resolve(
  "react-native-svg-transformer",
);
config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== "svg",
);
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];

const nativewindConfig = withNativewind(config, {
  inlineVariables: false,
  globalClassNamePolyfill: false,
  inlineRem: 16,
});

const nativewindResolveRequest = nativewindConfig.resolver.resolveRequest;
nativewindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  // The SDK's webcrypto.ts guards a `await import("node:crypto")` behind a
  // Node-only runtime check, but Metro still walks the import graph eagerly.
  // Shim it to an empty module so the bundler stops complaining; the guard
  // prevents the branch from ever executing on React Native.
  if (moduleName === "node:crypto") {
    return { type: "empty" };
  }

  const defaultResolve = (name) => {
    if (typeof nativewindResolveRequest === "function") {
      return nativewindResolveRequest(context, name, platform);
    }
    return context.resolveRequest(context, name, platform);
  };

  // The monorepo TS packages (loyal-smart-accounts-core etc.) use ESM
  // ".js"-suffixed relative imports that point at .ts sources (TypeScript
  // nodenext convention). Metro resolves specifiers literally, so when that
  // fails retry without the extension and let sourceExts find the .ts file.
  try {
    return defaultResolve(moduleName);
  } catch (error) {
    if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
      return defaultResolve(moduleName.slice(0, -3));
    }
    throw error;
  }
};

module.exports = nativewindConfig;
