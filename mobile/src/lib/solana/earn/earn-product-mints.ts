import { PublicKey } from "@solana/web3.js";

// Mobile mirror of the web Earn product catalog
// (`apps/web/src/lib/yield-optimization/earn-product-mints.shared.ts` on
// main): the ordered stablecoin set Earn can deposit into and withdraw from,
// with each mint's owning token program. Every Earn product mint is
// 6-decimal, so the existing raw<->USD math holds for all of them.
//
// Mint/program literals are inlined (same convention as
// earn-position-display.ts; canonical PublicKeys live in @loyal-labs/actions)
// so leaf flow modules can import this without dragging the env/rpc/spl-token
// graphs into their test suites.

export const EARN_PRODUCT_DECIMALS = 6;

const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export type EarnProductAsset = {
  symbol: string;
  mint: string;
  tokenProgramId: PublicKey;
};

// Product order — the deposit selector renders in this order within each
// funded/empty group. CASH/USDG/PYUSD are Token-2022; the distinction decides
// ATA derivation and which token program transaction legs reference, so
// getting it wrong fails on-chain — keep in sync with the web catalog's
// TOKEN_2022_STABLECOINS.
const MAINNET_ASSETS: EarnProductAsset[] = [
  {
    symbol: "CASH",
    mint: "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH",
    tokenProgramId: TOKEN_2022_PROGRAM,
  },
  {
    symbol: "USDG",
    mint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    tokenProgramId: TOKEN_2022_PROGRAM,
  },
  {
    symbol: "PYUSD",
    mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    tokenProgramId: TOKEN_2022_PROGRAM,
  },
  {
    symbol: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenProgramId: TOKEN_PROGRAM,
  },
  {
    symbol: "USDT",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    tokenProgramId: TOKEN_PROGRAM,
  },
  {
    symbol: "USDS",
    mint: "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
    tokenProgramId: TOKEN_PROGRAM,
  },
];

const DEVNET_ASSETS: EarnProductAsset[] = [
  {
    symbol: "USDC",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    tokenProgramId: TOKEN_PROGRAM,
  },
];

// ponytail: no enabled-set env mirror — the server rejects disabled mints
// with 409 earn_mint_not_enabled; add EXPO_PUBLIC_EARN_ENABLED_STABLECOINS
// parsing if a client-side rollout gate is ever needed.

// Product list for the app's configured Solana env (pass `env.solanaEnv`).
// Localnet has no Earn product mints; fall back to the mainnet catalog so dev
// builds still render a coherent selector.
export function getEarnProductAssets(solanaEnv: string): EarnProductAsset[] {
  return solanaEnv === "devnet" ? DEVNET_ASSETS : MAINNET_ASSETS;
}

// The withdraw prepare-context serializes reserve targets without their token
// program, so hydrators re-derive it from the mint (cluster-agnostic — mint
// addresses are distinct across clusters). ponytail: unknown mints fall back
// to the classic token program with a warning — right for any classic-SPL
// stable added server-side before this catalog updates, and a Token-2022
// straggler still fails loudly in the SDK's reserve validation.
export function tokenProgramForEarnMint(mint: string): PublicKey {
  const asset =
    MAINNET_ASSETS.find((candidate) => candidate.mint === mint) ??
    DEVNET_ASSETS.find((candidate) => candidate.mint === mint);
  if (!asset) {
    console.warn(
      `[earn] ${mint} is not in the Earn product catalog; assuming the classic token program`,
    );
    return TOKEN_PROGRAM;
  }
  return asset.tokenProgramId;
}
