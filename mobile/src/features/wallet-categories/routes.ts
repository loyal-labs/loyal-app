import type { Href } from "expo-router";

export function buildStablecoinsHref(): Href {
  return "/wallet/stablecoins" as Href;
}

export function buildCryptoHref(): Href {
  return "/wallet/crypto" as Href;
}

// Earn lives on the home tab (the route group's index).
export function buildEarnHref(): Href {
  return "/(tabs)" as Href;
}
