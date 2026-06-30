import Constants from "expo-constants";

// Runtime-constant feature flags for the published build.

// Seeker Season / Solana Week quests are hidden ONLY in the public Solana dApp
// Store build (channel "dapp-store" / DAPP_STORE_BUILD=true, surfaced as
// `extra.isDappStoreBuild` by app.config.ts). Internal preview/development and
// the Play Store build keep quests visible for testing. While hidden: the
// Quests tab is deactivated (icon stays, tap is inert), the Quests screen
// redirects home, and the quest-completion notifications never mount or poll.
//
// The Solana-side reporting is gated separately in the backend (a kill-switch
// plus a tester-wallet allowlist so preview testers still complete quests
// end-to-end) — see docs/quests-launch-toggle.md for the full picture.
export const QUESTS_ENABLED =
  Constants.expoConfig?.extra?.isDappStoreBuild !== true;
