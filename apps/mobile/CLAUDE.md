# Mobile App — CLAUDE.md

## Overview

Expo React Native mobile app for Loyal. Uses Expo SDK 54, React Native 0.81, Expo Router (file-based routing), and NativeWind v5 (Tailwind CSS) for styling.

## Commands

```bash
npx expo start --clear     # Start dev server (requires dev client build)
npx expo lint              # ESLint
npm test                   # Jest unit tests
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
```

## Architecture

### Directory Structure

```
mobile/
  app/                     # Expo Router file-based routes
    _layout.tsx            # Root layout (fonts, splash, navigation)
    index.tsx              # Home screen (chat list)
    +not-found.tsx         # 404 screen
    login/                 # Login flow (phone → code → password)
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
- **API layer**: All API calls go through `src/services/api.ts`, which reads base URL from `src/config/env.ts`
- **Styling**: NativeWind v5 (Tailwind CSS v4) — use `className` prop on components from `src/tw/` wrappers
- **SVGs**: Imported as React components via `react-native-svg-transformer` (configured in `metro.config.js`)
- **Animations**: Lottie via `@lottiefiles/dotlottie-react` and `lottie-react-native`

### Environment Variables

Expo uses `EXPO_PUBLIC_` prefix for client-accessible env vars.

**Local development** (`.env`, gitignored):
```env
EXPO_PUBLIC_API_BASE_URL=https://your-app.vercel.app
```

**EAS builds** (`eas.json` env blocks — source of truth for cloud builds):
```env
EXPO_PUBLIC_API_BASE_URL=https://solana-telegram-transactions.vercel.app
```

- `.env` files are NOT uploaded to EAS build servers — `eas.json` is the only way to set env vars for EAS builds
- `src/config/env.ts` provides a hardcoded fallback if neither source sets the var
- Non-public env vars (no `EXPO_PUBLIC_` prefix) are build-time only, not embedded in the JS bundle

### Metro Configuration

- Custom `metro.config.js` extends Expo defaults with:
  - **Monorepo support**: `watchFolders` includes `../packages/shared`
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

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
