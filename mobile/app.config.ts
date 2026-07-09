import type { ExpoConfig } from "expo/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Free-form release notes for the in-app OTA update banner. Edit ota-notes.txt
// before running `eas update` — the text ships inside the update manifest, and
// the bundle users are currently on reads it from the incoming update and shows
// it in the banner. Leave the file empty to fall back to the generic copy.
// Notes persist across publishes until edited, so clear/replace before each one.
function readOtaNotes(): string | null {
  try {
    const text = readFileSync(join(__dirname, "ota-notes.txt"), "utf8").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

const OTA_NOTES = readOtaNotes();

const IS_DEV = process.env.APP_VARIANT === "development";
const IS_DAPP_STORE = process.env.DAPP_STORE_BUILD === "true";
const IS_PLAY_STORE = process.env.PLAY_STORE_BUILD === "true";
// EAS sets EAS_BUILD_PLATFORM per-platform during builds. Used to keep the
// Firebase (Play Store / Android) plugin out of iOS production builds, since
// production currently ships both iOS App Store and Android Play Store.
const FIREBASE_ENABLED =
  IS_PLAY_STORE && process.env.EAS_BUILD_PLATFORM !== "ios";

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
    package: IS_DEV
      ? "com.loyal.app.dev"
      : IS_PLAY_STORE
        ? "com.askloyal.app"
        : "com.loyal.app",
    // google-services.json registers both `com.askloyal.app` (Play Store) and
    // `com.loyal.app` (dApp Store). Only Play Store builds consume Firebase
    // (Analytics), so we register the file only for that target — keeps the
    // Google Services Gradle plugin off dApp Store builds.
    ...(FIREBASE_ENABLED
      ? { googleServicesFile: "./google-services.json" }
      : {}),
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
    // Firebase (GA) is enabled only for the Play Store build (Android only).
    // iOS production builds use the same `production` EAS profile but lack a
    // Firebase iOS plist, so the plugin is gated on EAS_BUILD_PLATFORM too.
    // Only `@react-native-firebase/app` exposes a config plugin; the
    // `analytics` module is autolinked natively from the dependency alone.
    ...(FIREBASE_ENABLED ? ["@react-native-firebase/app"] : []),
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
    // Surfaced to the runtime so the client can hide quests in the public dApp
    // Store build only (preview/development/Play Store keep them visible). Read
    // via QUESTS_ENABLED in src/lib/feature-flags.ts.
    isDappStoreBuild: IS_DAPP_STORE,
    ...(OTA_NOTES ? { otaNotes: OTA_NOTES } : {}),
  },
  owner: "loyal-labs",
};

export default { expo: config };
