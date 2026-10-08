// Earn MAX display constants. APY is always the realized Voltr vault APY
// (dash until it exists). The logged-out Strategies/Stats rail is still a
// design mock until a public stats feed exists (ASK-2242).
export const EARN_MAX_STRATEGY_NAME = "RWA Loop";

// Invited users see only this backend. "voltr" = the pooled Voltr RWA vault
// (smart-account vault index 2); "legacy" = the per-user Rust Earn MAX
// (vault index 0), kept unused until it is deleted.
export const EARN_MAX_BACKEND: "voltr" | "legacy" = "voltr";
