import type { TrustedDappCategory } from "@loyal-labs/shared";

// v0.1 allowlist seed — mirrors `mobile/dapp-allowlist-v0.1 (1).md`.
// `displayOrder` uses the master numbering from that document so the
// curated order is preserved across envs. Keep this file append-only;
// version the file name when the allowlist is next bumped.

export type AllowlistSeedEntry = {
  name: string;
  host: string;
  category: TrustedDappCategory;
  displayOrder: number;
};

export const ALLOWLIST_SEED: AllowlistSeedEntry[] = [
  // DEX — Aggregators
  {
    name: "Jupiter",
    host: "jup.ag",
    category: "DEX — Aggregators",
    displayOrder: 1,
  },
  {
    name: "Raydium",
    host: "raydium.io",
    category: "DEX — Aggregators",
    displayOrder: 2,
  },
  {
    name: "Orca",
    host: "orca.so",
    category: "DEX — Aggregators",
    displayOrder: 3,
  },
  {
    name: "Meteora",
    host: "meteora.ag",
    category: "DEX — Aggregators",
    displayOrder: 4,
  },
  {
    name: "Lifinity",
    host: "lifinity.io",
    category: "DEX — Aggregators",
    displayOrder: 5,
  },
  {
    name: "Saber",
    host: "saber.so",
    category: "DEX — Aggregators",
    displayOrder: 6,
  },
  {
    name: "Invariant",
    host: "invariant.app",
    category: "DEX — Aggregators",
    displayOrder: 7,
  },
  {
    name: "FluxBeam",
    host: "fluxbeam.xyz",
    category: "DEX — Aggregators",
    displayOrder: 8,
  },
  {
    name: "Phoenix",
    host: "phoenix.trade",
    category: "DEX — Aggregators",
    displayOrder: 9,
  },
  {
    name: "GooseFX",
    host: "goosefx.io",
    category: "DEX — Aggregators",
    displayOrder: 10,
  },
  {
    name: "Drift",
    host: "drift.trade",
    category: "DEX — Aggregators",
    displayOrder: 11,
  },
  {
    name: "Zeta Markets",
    host: "zeta.markets",
    category: "DEX — Aggregators",
    displayOrder: 12,
  },
  {
    name: "Mango Markets",
    host: "mango.markets",
    category: "DEX — Aggregators",
    displayOrder: 13,
  },
  {
    name: "Adrena",
    host: "adrena.xyz",
    category: "DEX — Aggregators",
    displayOrder: 14,
  },
  {
    name: "Flash Trade",
    host: "flash.trade",
    category: "DEX — Aggregators",
    displayOrder: 15,
  },
  {
    name: "Cypher Protocol",
    host: "cypher.trade",
    category: "DEX — Aggregators",
    displayOrder: 16,
  },
  {
    name: "Parcl",
    host: "parcl.co",
    category: "DEX — Aggregators",
    displayOrder: 17,
  },
  {
    name: "BullX Neo",
    host: "neo.bullx.io",
    category: "DEX — Aggregators",
    displayOrder: 45,
  },
  {
    name: "Photon",
    host: "photon-sol.tinyastro.io",
    category: "DEX — Aggregators",
    displayOrder: 46,
  },
  {
    name: "Axiom",
    host: "axiom.trade",
    category: "DEX — Aggregators",
    displayOrder: 47,
  },
  {
    name: "GMGN",
    host: "gmgn.ai",
    category: "DEX — Aggregators",
    displayOrder: 48,
  },

  // Yield
  {
    name: "MarginFi",
    host: "marginfi.com",
    category: "Yield",
    displayOrder: 18,
  },
  { name: "Save", host: "save.finance", category: "Yield", displayOrder: 19 },
  {
    name: "Texture Finance",
    host: "texture.finance",
    category: "Yield",
    displayOrder: 20,
  },
  {
    name: "Kamino",
    host: "kamino.finance",
    category: "Yield",
    displayOrder: 21,
  },
  { name: "Lulo", host: "lulo.fi", category: "Yield", displayOrder: 22 },
  {
    name: "Exponent",
    host: "exponent.finance",
    category: "Yield",
    displayOrder: 23,
  },
  { name: "RateX", host: "rate-x.io", category: "Yield", displayOrder: 24 },
  {
    name: "Symmetry",
    host: "symmetry.fi",
    category: "Yield",
    displayOrder: 25,
  },

  // Liquid Staking
  {
    name: "Marinade",
    host: "marinade.finance",
    category: "Liquid Staking",
    displayOrder: 26,
  },
  {
    name: "Jito",
    host: "jito.network",
    category: "Liquid Staking",
    displayOrder: 27,
  },
  {
    name: "Sanctum",
    host: "sanctum.so",
    category: "Liquid Staking",
    displayOrder: 28,
  },
  {
    name: "BlazeStake",
    host: "stake.solblaze.org",
    category: "Liquid Staking",
    displayOrder: 29,
  },
  {
    name: "Solayer",
    host: "solayer.org",
    category: "Liquid Staking",
    displayOrder: 30,
  },
  {
    name: "Fragmetric",
    host: "fragmetric.xyz",
    category: "Liquid Staking",
    displayOrder: 31,
  },
  {
    name: "Jito Restaking",
    host: "restaking.jito.network",
    category: "Liquid Staking",
    displayOrder: 32,
  },

  // NFT Marketplaces
  {
    name: "Magic Eden",
    host: "magiceden.io",
    category: "NFT Marketplaces",
    displayOrder: 33,
  },
  {
    name: "Tensor",
    host: "tensor.trade",
    category: "NFT Marketplaces",
    displayOrder: 34,
  },
  {
    name: "Solanart",
    host: "solanart.io",
    category: "NFT Marketplaces",
    displayOrder: 35,
  },
  {
    name: "Exchange.art",
    host: "exchange.art",
    category: "NFT Marketplaces",
    displayOrder: 36,
  },
  {
    name: "Metaplex",
    host: "metaplex.com",
    category: "NFT Marketplaces",
    displayOrder: 37,
  },
  {
    name: "Holaplex",
    host: "holaplex.com",
    category: "NFT Marketplaces",
    displayOrder: 38,
  },

  // Launchpads
  {
    name: "Pump.fun",
    host: "pump.fun",
    category: "Launchpads",
    displayOrder: 39,
  },
  {
    name: "LaunchLab",
    host: "launchlab.raydium.io",
    category: "Launchpads",
    displayOrder: 40,
  },
  {
    name: "Believe",
    host: "believe.app",
    category: "Launchpads",
    displayOrder: 41,
  },
  {
    name: "MetaDAO",
    host: "metadao.fi",
    category: "Launchpads",
    displayOrder: 42,
  },
  {
    name: "Daos.fun",
    host: "daos.fun",
    category: "Launchpads",
    displayOrder: 43,
  },

  // Bridges
  {
    name: "Wormhole Portal",
    host: "portalbridge.com",
    category: "Bridges",
    displayOrder: 49,
  },
  {
    name: "deBridge",
    host: "debridge.finance",
    category: "Bridges",
    displayOrder: 50,
  },
  {
    name: "Mayan Finance",
    host: "mayan.finance",
    category: "Bridges",
    displayOrder: 51,
  },
  {
    name: "Allbridge",
    host: "allbridge.io",
    category: "Bridges",
    displayOrder: 52,
  },

  // Fiat Onramps
  {
    name: "MoonPay",
    host: "moonpay.com",
    category: "Fiat Onramps",
    displayOrder: 53,
  },
  {
    name: "Ramp",
    host: "ramp.network",
    category: "Fiat Onramps",
    displayOrder: 54,
  },
  {
    name: "Coinflow",
    host: "coinflow.cash",
    category: "Fiat Onramps",
    displayOrder: 55,
  },
  {
    name: "Kado",
    host: "kado.money",
    category: "Fiat Onramps",
    displayOrder: 56,
  },

  // Explorers
  {
    name: "Solscan",
    host: "solscan.io",
    category: "Explorers",
    displayOrder: 61,
  },
  {
    name: "SolanaFM",
    host: "solana.fm",
    category: "Explorers",
    displayOrder: 62,
  },
  {
    name: "Solana Explorer",
    host: "explorer.solana.com",
    category: "Explorers",
    displayOrder: 63,
  },

  // Utilities
  {
    name: "Step Finance",
    host: "app.step.finance",
    category: "Utilities",
    displayOrder: 64,
  },
  {
    name: "Sonar Watch",
    host: "sonar.watch",
    category: "Utilities",
    displayOrder: 65,
  },
  {
    name: "Assetdash",
    host: "assetdash.com",
    category: "Utilities",
    displayOrder: 66,
  },
  {
    name: "SolanaHub",
    host: "solanahub.app",
    category: "Utilities",
    displayOrder: 67,
  },
  {
    name: "DeFiLlama",
    host: "defillama.com",
    category: "Utilities",
    displayOrder: 68,
  },
  {
    name: "Helius",
    host: "helius.dev",
    category: "Utilities",
    displayOrder: 69,
  },
  {
    name: "Anchor",
    host: "anchor-lang.com",
    category: "Utilities",
    displayOrder: 70,
  },
  {
    name: "Solana Cookbook",
    host: "solanacookbook.com",
    category: "Utilities",
    displayOrder: 71,
  },
  {
    name: "Solana Docs",
    host: "docs.solana.com",
    category: "Utilities",
    displayOrder: 72,
  },
  {
    name: "Streamflow",
    host: "streamflow.finance",
    category: "Utilities",
    displayOrder: 44,
  },
  {
    name: "Tiplink",
    host: "tiplink.io",
    category: "Utilities",
    displayOrder: 57,
  },
  { name: "Zebec", host: "zebec.io", category: "Utilities", displayOrder: 58 },
  {
    name: "SNS (Bonfida)",
    host: "sns.id",
    category: "Utilities",
    displayOrder: 73,
  },
  {
    name: "AllDomains",
    host: "alldomains.id",
    category: "Utilities",
    displayOrder: 74,
  },
  {
    name: "Squads",
    host: "squads.so",
    category: "Utilities",
    displayOrder: 85,
  },
  {
    name: "Dialect",
    host: "dialect.to",
    category: "Utilities",
    displayOrder: 87,
  },
  {
    name: "Pyth Network",
    host: "pyth.network",
    category: "Utilities",
    displayOrder: 93,
  },
  {
    name: "Switchboard",
    host: "switchboard.xyz",
    category: "Utilities",
    displayOrder: 94,
  },
  {
    name: "Arcium",
    host: "arcium.com",
    category: "Utilities",
    displayOrder: 99,
  },
  {
    name: "Superteam",
    host: "superteam.fun",
    category: "Utilities",
    displayOrder: 100,
  },

  // DePIN
  { name: "Helium", host: "helium.com", category: "DePIN", displayOrder: 75 },
  {
    name: "Render Network",
    host: "rendernetwork.com",
    category: "DePIN",
    displayOrder: 76,
  },
  {
    name: "Hivemapper",
    host: "hivemapper.com",
    category: "DePIN",
    displayOrder: 77,
  },
  { name: "Nosana", host: "nosana.io", category: "DePIN", displayOrder: 78 },
  { name: "io.net", host: "io.net", category: "DePIN", displayOrder: 79 },
  { name: "Grass", host: "grass.io", category: "DePIN", displayOrder: 80 },

  // Gaming
  {
    name: "Star Atlas",
    host: "staratlas.com",
    category: "Gaming",
    displayOrder: 81,
  },
  {
    name: "Genopets",
    host: "genopets.me",
    category: "Gaming",
    displayOrder: 82,
  },
  { name: "Aurory", host: "aurory.io", category: "Gaming", displayOrder: 83 },
  {
    name: "Photo Finish Live",
    host: "photofinish.live",
    category: "Gaming",
    displayOrder: 84,
  },

  // Stablecoins / RWA
  {
    name: "Ondo Finance",
    host: "ondo.finance",
    category: "Stablecoins / RWA",
    displayOrder: 89,
  },
  {
    name: "Perena",
    host: "perena.org",
    category: "Stablecoins / RWA",
    displayOrder: 90,
  },
  {
    name: "Etherfuse",
    host: "etherfuse.com",
    category: "Stablecoins / RWA",
    displayOrder: 91,
  },
  {
    name: "Circle",
    host: "circle.com",
    category: "Stablecoins / RWA",
    displayOrder: 92,
  },

  // Wallets
  {
    name: "Phantom",
    host: "phantom.com",
    category: "Wallets",
    displayOrder: 95,
  },
  {
    name: "Solflare",
    host: "solflare.com",
    category: "Wallets",
    displayOrder: 96,
  },
  {
    name: "Backpack",
    host: "backpack.app",
    category: "Wallets",
    displayOrder: 97,
  },
  {
    name: "Loyal",
    host: "askloyal.com",
    category: "Wallets",
    displayOrder: 98,
  },
];
