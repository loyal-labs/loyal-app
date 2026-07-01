// Canonical dApp categories used by:
//   - admin dashboard (/admin/dapps form + seed script)
//   - mobile in-app browser (groups tiles under section headers)
//   - any future surfaces that list curated dApps
//
// Ordered to match the browser home grouping order. Mobile renders
// categories in this order and within each category sorts by display_order.
// Uses em-dash (U+2014) to match the v0.1 allowlist document.

export const TRUSTED_DAPP_CATEGORIES = [
  "DEX — Aggregators",
  "Yield",
  "Liquid Staking",
  "NFT Marketplaces",
  "Launchpads",
  "Bridges",
  "Fiat Onramps",
  "Explorers",
  "Utilities",
  "DePIN",
  "Gaming",
  "Stablecoins / RWA",
  "Wallets",
] as const;

export type TrustedDappCategory = (typeof TRUSTED_DAPP_CATEGORIES)[number];

export function isTrustedDappCategory(
  value: unknown
): value is TrustedDappCategory {
  return (
    typeof value === "string" &&
    (TRUSTED_DAPP_CATEGORIES as readonly string[]).includes(value)
  );
}
