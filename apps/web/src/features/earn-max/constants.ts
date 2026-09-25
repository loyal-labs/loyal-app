// Earn MAX display constants. The strategy marketing name and the fallback
// APY shown before the real forecast lands (also the logged-out teaser). The
// logged-out Strategies/Stats rail is fully mocked until a public stats feed
// exists (ASK-2242).
export const EARN_MAX_STRATEGY_NAME = "RWA Loop";
export const EARN_MAX_FALLBACK_APY_BPS = 2048;

// Invited users see only this backend. "voltr" = the pooled Voltr RWA vault
// (smart-account vault index 2); "legacy" = the per-user Rust Earn MAX
// (vault index 0), kept unused until it is deleted.
export const EARN_MAX_BACKEND: "voltr" | "legacy" = "voltr";
