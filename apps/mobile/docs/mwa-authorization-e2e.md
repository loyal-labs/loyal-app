# MWA authorization recovery verifier

`verify:mwa-authorization:e2e` is an explicit, opt-in Android emulator check
for the Mobile Wallet Adapter authorization-expired path. It temporarily adds a
development-only route and a fixture to the checkout, builds and runs the real
development APK, then restores both files before exiting. The fixture rejects
the signing call with the plain object shape delivered by the React Native
bridge (`{ code: -1, message: ... }`); it does not install a wallet, use a
private key, send a transaction, or call production APIs.

Prerequisites:

- Bun/npm dependencies installed in `apps/mobile`.
- Android SDK with `adb`, `emulator`, Java 21, and an API-35 AVD named
  `SkyVerse_API_35` (override with `MOBILE_MWA_AUTHORIZATION_AVD`).
- A machine capable of building the Expo development APK.

Run only when an emulator/build check is intended:

```sh
cd apps/mobile
bun run verify:mwa-authorization:e2e
```

The verifier owns an emulator it starts, Metro, local telemetry proxy, ADB
reverse mappings, generated Android output, and temporary source changes. It
clears the app and removes those resources during cleanup. A pre-existing
emulator or generated `android/` directory is left in place.
