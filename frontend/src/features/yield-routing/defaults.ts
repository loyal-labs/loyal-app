import type { SolanaEnv } from "@loyal-labs/solana-rpc";

export type YieldRoutingDefaultReserve = {
  label: string;
  reserve: string;
  market: string;
  liquidityMint: string;
};

export type YieldRoutingDefaults = {
  routeMint: string;
  delegatedSigner: string | null;
  reserves: YieldRoutingDefaultReserve[];
};

const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const MAINNET_USDC_RESERVES: YieldRoutingDefaultReserve[] = [
  {
    label: "Kamino Prime USDC",
    reserve: "9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu",
    market: "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA",
    liquidityMint: MAINNET_USDC_MINT,
  },
];

const DEVNET_USDC_RESERVES: YieldRoutingDefaultReserve[] = [
  {
    label: "Kamino Devnet USDC",
    reserve: "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy",
    market: "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J",
    liquidityMint: DEVNET_USDC_MINT,
  },
];

export function getYieldRoutingDefaults(args: {
  solanaEnv: SolanaEnv;
  delegatedSigner?: string | null;
}): YieldRoutingDefaults | null {
  if (args.solanaEnv !== "mainnet" && args.solanaEnv !== "devnet") {
    return null;
  }

  const delegatedSigner = args.delegatedSigner?.trim() || null;
  const isMainnet = args.solanaEnv === "mainnet";

  return {
    routeMint: isMainnet ? MAINNET_USDC_MINT : DEVNET_USDC_MINT,
    delegatedSigner,
    reserves: isMainnet ? MAINNET_USDC_RESERVES : DEVNET_USDC_RESERVES,
  };
}
