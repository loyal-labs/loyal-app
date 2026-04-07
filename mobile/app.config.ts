import type { ExpoConfig } from "expo/config";

const IS_DEV = process.env.APP_VARIANT === "development";

const config: ExpoConfig = {
  name: IS_DEV ? "Loyal (Dev)" : "Loyal",
  slug: "loyal-app",
  scheme: IS_DEV ? "loyal-dev" : "loyal",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  ios: {
    supportsTablet: false,
    bundleIdentifier: IS_DEV ? "com.loyallabs.app.dev" : "com.loyallabs.app",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/android-icon-foreground.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
      backgroundColor: "#000000",
    },
    package: IS_DEV ? "com.loyallabs.app.dev" : "com.loyallabs.app",
    edgeToEdgeEnabled: true,
    softwareKeyboardLayoutMode: "pan",
  },
  web: {
    output: "static" as const,
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-local-authentication",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/images/notification-icon.png",
        color: "#ffffff",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: "7ecfef22-fa74-4fc9-b2f1-bf80acb81401",
    },
  },
  owner: "loyal-labs",
};

export default { expo: config };
