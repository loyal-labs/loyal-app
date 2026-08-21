// Shared contract with ASK-2202: event names and props must stay identical on
// both branches. track() auto-prefixes "[mobile] ".
export const WALLET_CONNECT_EVENTS = {
  pressed: "wallet_connect_pressed",
  returned: "wallet_connect_returned",
  failed: "wallet_connect_failed",
} as const;

export type WalletConnectProvider = "mwa" | "phantom" | "solflare";

export type WalletConnectSurface = "onboarding";
