// Runtime-constant feature flags for the published build.

import { Platform } from "react-native";

// Seeker Season / Solana Week quests are PUBLIC as of the Solana Mobile launch
// (2026-07-08): the Quests tab, screen, and completion notifications are
// enabled in every build, including the dApp Store one. This constant is the
// reveal lever described in docs/quests-launch-toggle.md — before the launch it
// derived from the build channel/`extra.isDappStoreBuild` to hide quests in the
// dApp Store build only, and had to become unconditionally `true` for the OTA
// reveal because the channel gate is baked into the native build. The backend
// reporting kill-switch (SOLANA_WEEK_QUESTS_ENABLED on Vercel) flips separately.
//
// Off on iOS: the campaign ended 2026-07-15 and the tab now renders only
// finished, non-interactive cards whose copy names the Seeker handset
// ("Deposit $5 to Earn with Seeker Wallet"). App Review Guideline 2.3.10
// prohibits referencing other mobile platforms/devices in app UI, and a tab of
// spent promotion also reads as 2.1 incomplete. Flip back on once there is a
// live round with iOS-neutral copy.
export const QUESTS_ENABLED: boolean = Platform.OS !== "ios";
