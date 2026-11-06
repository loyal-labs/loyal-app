// The two Loyal vaults Backyard lists. Both run on the same Loyal worker
// (loyal-yield-routing go/workers/internal/backyard/vault.go); each has its
// own Squads account and its own route row in the yield database.

export type BackyardVault = {
  slug: "earn" | "looping";
  name: string;
  short: string;
  custody: string;
  voltrVault: string;
  lpMint: string;
  squads: string;
  routeKey: string;
  /** Plain-words NAV cadence, from the worker config. */
  navCadence: string;
};

export const BACKYARD_VAULTS: BackyardVault[] = [
  {
    slug: "earn",
    name: "Loyal RWA Multiply USDC",
    short: "Non-custodial",
    custody:
      "Non-custodial. A custom NAV adaptor; funds move only within Squads policies.",
    voltrVault: "HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA",
    lpMint: "6tNheTBYSpQkfMLhcczKgmTLSGffK54npKMG1WQR2tvb",
    squads: "ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh",
    routeKey: "rwa-multiply:ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh",
    navCadence: "at least hourly, and within 60 s after any capital move",
  },
  {
    slug: "looping",
    name: "Loyal Looping",
    short: "Custodial",
    custody:
      "Custodial. Voltr Trustful adaptor; NAV is reported by the manager.",
    voltrVault: "GrHZD15bMiUwrVPsmBwz8GRoQeDZN6wNEQVdW8k8SxV1",
    lpMint: "5MAGdiFcSQumjZX5BDh3LqHyFog5auvEBXXJezDXAArg",
    squads: "6HTfVjwk5FfW4GH67hmEen7VHeURdB5EJj6E429qTrUY",
    routeKey: "backyard:6HTfVjwk5FfW4GH67hmEen7VHeURdB5EJj6E429qTrUY",
    navCadence:
      "at least hourly, and whenever the book moves more than 50 bps from the last report",
  },
];

export function findBackyardVault(slug: string) {
  return BACKYARD_VAULTS.find((vault) => vault.slug === slug) ?? null;
}

// Kamino reserves per lane, from the worker's route catalog
// (go/workers/internal/backyard/route_catalog.go).
export const LANES: Record<
  string,
  { collateralReserve: string; debtReserve: string; market: string }
> = {
  "AUTO/AUTO/PYUSD": {
    collateralReserve: "G85AgoBdW8zSQBq5i4E8aBLCDdRYGgK44CzU1d1NdBzX",
    debtReserve: "6A8D3ExQ4CdiZTBmij7MScUeKsgs6mSHksYzJbiY61FM",
    market: "Btu8835QDYgdTnMJJBSidbfQhrZzryZbMhCpty6h6Xdk",
  },
  "AUTO/AUTO/wYLDS": {
    collateralReserve: "G85AgoBdW8zSQBq5i4E8aBLCDdRYGgK44CzU1d1NdBzX",
    debtReserve: "34GJjXf7jGTdNL8Yw1HtqWSVvfX6JTsft3UsuFFUL7VU",
    market: "Btu8835QDYgdTnMJJBSidbfQhrZzryZbMhCpty6h6Xdk",
  },
  "Maple/syrupUSDC/USDC": {
    collateralReserve: "AwCyCPZYJSZ93xcVKNK7jR8e1BHzJXq1D4bReNuh9woY",
    debtReserve: "Atj6UREVWa7WxbF2EMKNyfmYUY1U1txughe2gjhcPDCo",
    market: "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y",
  },
  "OnRe/ONyc/USDC": {
    collateralReserve: "6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ",
    debtReserve: "AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z",
    market: "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8",
  },
  "Prime/PRIME/USDC": {
    collateralReserve: "BUTND9T7Ux4KR8RAEgd4WoZwnP7xA279oA1y3iPVcvSh",
    debtReserve: "9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu",
    market: "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA",
  },
};

/** The lane the worker sizes new capital into first (#731). */
export const DEFAULT_LANE = "OnRe/ONyc/USDC";

// Debt reserves shown in "Borrowing room".
export const BORROW_LANES = [
  "AUTO/AUTO/PYUSD",
  "OnRe/ONyc/USDC",
  "Maple/syrupUSDC/USDC",
] as const;
