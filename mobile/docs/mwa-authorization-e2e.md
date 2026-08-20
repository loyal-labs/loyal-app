# MWA authorization recovery verifier

`verify:mwa-authorization:e2e` is an explicit, opt-in Android emulator check for
the Earn withdrawal wallet-authorization boundary. It builds and runs the real
development APK on an API-35 AVD, temporarily installs a local fixture route,
and makes the MWA bridge reject with `{ code: -1, message: ... }`.

The route calls the real `executeEarnWithdraw` path until wallet authorization,
then exercises the same `MwaSigner` transaction wrapper without creating or
sending a transaction. A localhost proxy captures lifecycle events and rejects
all backend/RPC requests. The check asserts SecureStore cleanup, reconnect copy,
`wallet_authorization_expired`, no HTTP status, and no native code/message leak.

It uses no wallet, private key, production API, chain RPC, or funds. The script
owns only an emulator it starts; it clears app data, removes ADB reverse mappings,
stops Metro, restores temporary source/generated files, and removes its temp log
on success.

Prerequisites: Bun/npm dependencies, Android SDK (`adb`, `emulator`), Java 21,
and an API-35 AVD named `SkyVerse_API_35` (override with
`MOBILE_MWA_AUTHORIZATION_AVD`). Run only when an emulator/build check is
intended:

```sh
cd mobile
bun run verify:mwa-authorization:e2e
```
