import type { ExpoConfig } from "expo/config";

const IS_DEV = process.env.APP_VARIANT === "development";
const IS_DAPP_STORE = process.env.DAPP_STORE_BUILD === "true";

const config: ExpoConfig = {
  name: IS_DEV ? "Loyal (Dev)" : "Loyal",
  slug: "loyal-app",
  scheme: IS_DEV ? "loyal-dev" : "loyal",
  version: "0.1.2",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  runtimeVersion: { policy: "appVersion" },
  updates: {
    url: "https://u.expo.dev/7ecfef22-fa74-4fc9-b2f1-bf80acb81401",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: IS_DEV ? "com.loyal.app.dev" : "com.loyal.app",
  },
  android: {
    adaptiveIcon: {
      foregroundImage: "./assets/images/android-icon-foreground.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
      backgroundColor: "#F9363C",
    },
    package: IS_DEV ? "com.loyal.app.dev" : "com.loyal.app",
    // google-services.json is only registered for `com.loyal.app` (prod).
    // Dev/simulator builds don't need FCM, so skip the file there —
    // supplying it with a non-matching package name would fail prebuild.
    ...(IS_DEV ? {} : { googleServicesFile: "./google-services.json" }),
    edgeToEdgeEnabled: true,
    softwareKeyboardLayoutMode: "resize",
  },
  web: {
    output: "static" as const,
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-local-authentication",
    [
      "expo-camera",
      {
        cameraPermission: "Allow Loyal to scan wallet QR codes",
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/android-icon-foreground.png",
        imageWidth: 260,
        resizeMode: "contain",
        backgroundColor: "#F9363C",
      },
    ],
    [
      "expo-notifications",
      {
        // Android requires a transparent PNG with a white silhouette for the
        // small icon — any non-alpha pixels are stripped. The monochrome
        // adaptive icon fits that shape already; notification-icon.png was
        // flat RGB and got ignored by the platform.
        icon: "./assets/images/android-icon-monochrome.png",
        color: "#F9363C",
      },
    ],
    ...(IS_DAPP_STORE
      ? [
          [
            "expo-build-properties",
            {
              android: {
                buildArchs: ["arm64-v8a"],
              },
            },
          ] satisfies [string, Record<string, unknown>],
        ]
      : []),
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
