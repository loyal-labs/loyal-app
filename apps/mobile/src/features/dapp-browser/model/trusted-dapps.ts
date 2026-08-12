import type { TrustedDapp } from "./types";

// Minimal offline fallback shown when `/api/mobile/dapps` fails or hasn't
// loaded yet. The full allowlist is admin-managed in the DB; don't keep
// this in sync by hand beyond the small set of anchors users expect to
// see immediately on first launch.
export const TRUSTED_DAPPS: TrustedDapp[] = [
  {
    origin: "https://jup.ag",
    name: "Jupiter",
    startUrl: "https://jup.ag",
    category: "DEX — Aggregators",
  },
];
