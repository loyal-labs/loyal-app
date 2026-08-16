// Runtime-constant feature flags for the published build.

// Seeker Season / Solana Week quests are PUBLIC as of the Solana Mobile launch
// (2026-07-08): the Quests tab, screen, and completion notifications are
// enabled in every build, including the dApp Store one. This constant is the
// reveal lever described in docs/quests-launch-toggle.md — before the launch it
// derived from the build channel/`extra.isDappStoreBuild` to hide quests in the
// dApp Store build only, and had to become unconditionally `true` for the OTA
// reveal because the channel gate is baked into the native build. The backend
// reporting kill-switch (SOLANA_WEEK_QUESTS_ENABLED on Vercel) flips separately.
export const QUESTS_ENABLED: boolean = true;
