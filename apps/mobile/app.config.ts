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
    // Signs every native target, including the OneSignal Notification Service
    // Extension — without it that target builds with DEVELOPMENT_TEAM unset,
    // which EAS papers over but local `expo run:ios` does not.
    appleTeamId: "AP32T55T29",
    // NOT com.loyal.app — that identifier is already taken in Apple's global
    // App ID namespace and cannot be registered. Unrelated to the Android
    // package of the same name, which is the shipped dApp Store build and
    // stays as-is. Must never change after the first App Store release.
    bundleIdentifier: IS_DEV ? "com.askloyal.app.dev" : "com.askloyal.app",
    // Answers App Store Connect's export-compliance question at build time.
    // Without it every upload lands in "Missing Compliance" and cannot be
    // distributed to any tester until a human answers the questionnaire, per
    // build. `false` = the app qualifies for the exemption: the only
    // non-Apple crypto is standard AES-256-GCM + PBKDF2 (@noble/ciphers,
    // src/lib/wallet/crypto.ts) used to encrypt the wallet key at rest, with
    // no proprietary algorithm.
    config: {
      usesNonExemptEncryption: false,
    },
    infoPlist: {
      UIBackgroundModes: ["remote-notification"],
      // The app never requests location and this prompt never shows. The
      // OneSignal XCFramework ships an optional location module whose bare
      // CLLocationManager reference makes App Store Connect demand a purpose
      // string for every delivery (ITMS-90683). Honest copy on purpose — do
      // not reword this to imply the app uses location.
      NSLocationWhenInUseUsageDescription:
        "Loyal does not use your location. This notice exists because a notifications library includes optional location code.",
    },
    entitlements: {
      "aps-environment": IS_DEV ? "development" : "production",
    },
    // Apple requires a reason for each "required reason API" a binary links.
    // Expo emits PrivacyInfo.xcprivacy only when this key is present, and the
    // manifests shipped by static CocoaPods dependencies are not reliably
    // parsed, so the app target declares the union used by its Expo modules:
    // expo-constants (UserDefaults), expo-application/expo-file-system (file
    // timestamps, disk space) and expo-device (system boot time). Omitting
    // this produces ITMS-91053 on upload.
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: ["C617.1", "0A2A.1", "3B52.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
          NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
          NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
        },
      ],
      // No SDK collects IDFA: Firebase (the only IDFA-capable dependency) is
      // excluded from Apple autolinking in package.json, Mixpanel uses IDFV
      // and Datadog its own session id. Keep this false unless that changes,
      // and do not add NSUserTrackingUsageDescription without calling ATT.
      NSPrivacyTracking: false,
    },
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
    // Must stay first in this array — later plugins otherwise break the
    // generated iOS Notification Service Extension ("OneSignal.h not found").
    [
      "onesignal-expo-plugin",
      {
        mode: IS_DEV ? "development" : "production",
        // The plugin otherwise hardcodes the Notification Service Extension
        // target to iOS 11.0, while Expo SDK 54 builds everything else at
        // 15.1. That mismatch is what produces the "OneSignal.h not found"
        // class of pod failure the comment above refers to.
        iPhoneDeploymentTarget: "15.1",
      },
    ],
    "expo-router",
    [
      "expo-local-authentication",
      {
        // Ships instead of the plugin default ("Allow Loyal to use Face ID").
        // Face ID gates wallet-key unlock, and Guideline 5.1.1 expects the
        // purpose string to say what it is used for.
        faceIDPermission: "Use Face ID to unlock your Loyal wallet.",
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Allow Loyal to scan wallet QR codes",
        // The plugin injects a default NSMicrophoneUsageDescription unless
        // this is explicitly false. The camera is only ever used for QR
        // scanning (SendSheet), so declaring the microphone would be an
        // unused sensitive permission on the privacy label.
        microphonePermission: false,
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
      // iCloud Drive wallet backup (ASK-2163). The plugin writes the iCloud
      // entitlements and derives the container from the bundle identifier
      // (iCloud.com.askloyal.app / .dev). Backups go to the hidden AppData
      // scope, so no folder shows up in the Files app despite the plugin's
      // public-scope Info.plist default.
      "react-native-cloud-storage",
      {
        iCloudContainerEnvironment: "Production",
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
