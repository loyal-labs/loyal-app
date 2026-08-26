# Mobile App — CLAUDE.md

## Overview

Expo React Native mobile app for Loyal. Uses Expo SDK 54, React Native 0.81, Expo Router (file-based routing), and NativeWind v5 (Tailwind CSS) for styling.

## Commands

```bash
npx expo start --clear     # Start dev server (requires dev client build)
npx expo lint              # ESLint
npm test                   # Jest unit tests
```

### Earn Verification

From `/apps/mobile`, run the focused insufficient-native-SOL verifier with its
explicit read-only acknowledgement:

```bash
CONFIRM_NATIVE_SOL_E2E=I_ACKNOWLEDGE_MAINNET_READ_ONLY bun run verify:insufficient-sol:e2e
```

### EAS Build Profiles

```bash
# Dev client for iOS simulator
npx eas build --profile development-simulator --platform ios

# Dev client for physical device (internal distribution)
npx eas build --profile development --platform ios

# Preview APK (Android, internal distribution)
npx eas build --profile preview --platform android

# Production build
npx eas build --profile production --platform all

# Dapp Store Android APK (production EAS environment)
npx eas build --profile dapp-store --platform android
```

### OTA Release Notes

OTA publishes use `ota-notes.txt` by default. For an iOS-only publish, set
`OTA_NOTES_FILE=ios` so `app.config.ts` reads `ota-notes-ios.txt`:

```bash
OTA_NOTES_FILE=ios eas update --platform ios ...
```

## Architecture

### Directory Structure

```
mobile/
  app/                     # Expo Router file-based routes
    _layout.tsx            # Root layout (fonts, splash, navigation)
    (tabs)/                # Main tab routes (home, wallet, browser, etc.)
    ul/[...path].tsx       # Wallet deeplink return route
    +not-found.tsx         # 404 screen
    summaries/             # Summary detail screens
  src/
    components/            # Reusable UI components
      summaries/           # Summaries feature components
    config/
      env.ts               # Environment config (API base URL)
    hooks/                 # Custom hooks
    services/
      api.ts               # API client (fetch from /app backend)
      notifications.ts     # Push notification setup
    tw/                    # NativeWind/Tailwind utility wrappers
    global.css             # Tailwind CSS entry
    types/                 # Type declarations (SVG, etc.)
  assets/                  # Images, icons, fonts, animations
```

### Key Conventions

- **Path alias**: `@/*` maps to `./src/*` (configured in `tsconfig.json` and `jest.config.js`)
- **Shared packages**:
  - `@loyal-labs/shared` for generic shared types such as summaries
  - `@loyal-labs/grid-core` for runtime-agnostic Grid auth/domain helpers
- **API layer**: All API calls go through `src/services/api.ts`, which reads base URL from `src/config/env.ts`
- **Styling**: NativeWind v5 (Tailwind CSS v4) — use `className` prop on components from `src/tw/` wrappers
- **SVGs**: Imported as React components via `react-native-svg-transformer` (configured in `metro.config.js`)
- **Animations**: Lottie via `@lottiefiles/dotlottie-react` and `lottie-react-native`
- **iOS wallet deeplinks**: Phantom and Solflare connections return through the custom `loyal://` (or `loyal-dev://`) scheme and are handled by `app/ul/[...path].tsx`; generated redirects should not be changed back to the HTTPS universal link.
- **Wallet recovery**: For supported iOS local wallets with iCloud backup enabled, “Remove from this device” keeps the iCloud copy while “Delete everywhere” removes it. A restored wallet re-enables biometrics after its first successful PIN unlock.

### Environment Variables

Expo uses `EXPO_PUBLIC_` prefix for client-accessible env vars.

**Local development** (`.env`, gitignored):
```env
EXPO_PUBLIC_API_BASE_URL=https://your-app.vercel.app
EXPO_PUBLIC_GRID_AUTH_BASE_URL=https://auth.askloyal.com
EXPO_PUBLIC_EARN_API_BASE_URL=https://askloyal.com
EXPO_PUBLIC_SOLANA_ENV=mainnet
```

- `EXPO_PUBLIC_API_BASE_URL` selects the chat/wallet API; its fallback is
  `https://solana-telegram-transactions.vercel.app`.
- `EXPO_PUBLIC_GRID_AUTH_BASE_URL` selects the passkey auth domain; its fallback
  is `https://auth.askloyal.com`.
- `EXPO_PUBLIC_EARN_API_BASE_URL` selects the mobile Earn API; its fallback is
  `https://askloyal.com`.
- `EXPO_PUBLIC_SOLANA_ENV` selects the Solana cluster.
- `EXPO_PUBLIC_VERCEL_PROTECTION_BYPASS` is optional and is sent only when
  testing a protected preview deployment.
- `EXPO_PUBLIC_EARN_SPONSORED_DEPOSITS` enables sponsored deposits only when set
  to `true`; other values keep the self-paid flow.
- `EXPO_PUBLIC_MIXPANEL_TOKEN` and `EXPO_PUBLIC_ONESIGNAL_APP_ID` configure
  optional telemetry and push notification services. The EAS profiles currently
  set `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SOLANA_ENV=mainnet`, and
  `EXPO_PUBLIC_ONESIGNAL_APP_ID` in `eas.json`.

- `.env` files are NOT uploaded to EAS build servers — `eas.json` is the only way to set env vars for EAS builds
- `src/config/env.ts` provides a hardcoded fallback when a variable is unset
- Non-public env vars (no `EXPO_PUBLIC_` prefix) are build-time only, not embedded in the JS bundle
- Mobile should call the passkey auth domain via `EXPO_PUBLIC_GRID_AUTH_BASE_URL`; do not import browser/WebAuthn flow code from `passkey`

### Metro Configuration

- Custom `metro.config.js` extends Expo defaults with:
  - **Monorepo support**: `watchFolders` includes `../../packages/shared`
  - **SVG transformer**: `.svg` files treated as source (React components), not assets
  - **NativeWind**: `withNativewind()` wrapper for Tailwind CSS processing

### Testing

- Jest with `ts-jest` preset, `node` test environment
- Path aliases mirrored in `jest.config.js` `moduleNameMapper`
- Test files co-located: `src/**/__tests__/*.test.ts`

### Build Configuration

- **EAS project**: `loyal-labs/loyal-app` (ID: `7ecfef22-fa74-4fc9-b2f1-bf80acb81401`)
- **App variant**: `APP_VARIANT=development` gives separate bundle ID (`com.loyal.app.dev`) and name ("Loyal (Dev)")
- **New Architecture**: Enabled (`newArchEnabled: true`)
- **React Compiler**: Enabled (`experiments.reactCompiler: true`)
- **Typed Routes**: Enabled (`experiments.typedRoutes: true`)
- Generated `/ios` and `/android` folders are gitignored — managed by EAS/Prebuild

## Rules

- Lint after completing work: `npx expo lint`
- Do not start the dev server — user manages it
- Use `@/` import alias for all `src/` imports
- Keep API communication in `src/services/` — do not scatter fetch calls across components
- Follow the shared package boundary:
  - generic shared types go in `@loyal-labs/shared`
  - Grid runtime helpers go in `@loyal-labs/grid-core`
  - WebAuthn/passkey browser flow logic stays in `passkey`
