import Constants from "expo-constants";
import * as Updates from "expo-updates";

// Runtime-constant feature flags for the published build.

// Seeker Season / Solana Week quests are hidden ONLY in the public Solana dApp
// Store build (channel "dapp-store" / DAPP_STORE_BUILD=true, surfaced as
// `extra.isDappStoreBuild` by app.config.ts). Internal preview/development and
// the Play Store build keep quests visible for testing. While hidden: the
// Quests tab is deactivated (icon stays, tap is inert), the Quests screen
// redirects home, and the quest-completion notifications never mount or poll.
//
// Updates.channel is the primary gate: it is baked into the native build and
// cannot be overridden by an OTA update. The `extra.isDappStoreBuild` check is
// evaluated from app.config.ts at `eas build`/`eas update` publish time — an
// `eas update` run without DAPP_STORE_BUILD=true in the shell env ships
// `false` and (alone) would un-hide quests, which is exactly the incident this
// double gate prevents.
//
// The Solana-side reporting is gated separately in the backend (a kill-switch
// plus a tester-wallet allowlist so preview testers still complete quests
// end-to-end) — see docs/quests-launch-toggle.md for the full picture.
export const QUESTS_ENABLED =
  Updates.channel !== "dapp-store" &&
  Constants.expoConfig?.extra?.isDappStoreBuild !== true;
