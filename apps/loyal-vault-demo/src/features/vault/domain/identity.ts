/** Public pinned identities and wallet input validation. Safe in browser and server code. */
import { address, isAddress, type Address } from "@solana/kit";

export const VAULT_IDENTITY = {
  cluster: "mainnet-beta" as const,
  expectedGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  vault: address("HXtk15EA5pBg3rSKxBm8sWPExScPkTknSRp37fXNHgNA"),
  voltrProgram: address("vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8"),
  assetMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  assetDecimals: 6,
  /** Pilot limit must also be installed in Voltr before deposits open. */
  pilotDepositCapRaw: 100_000_000n,
  lpMint: address("6tNheTBYSpQkfMLhcczKgmTLSGffK54npKMG1WQR2tvb"),
  lpDecimals: 9,
  manager: address("ST999VUTo5QExYEX9bz1oDDoKGkjXG9zpphy4Hj7VWh"),
  smartAccountSettings: address("5YQ78RwqukvCcykpmjmgRFmbEUeAgLpuVDxx1xNZnHD6"),
  smartAccountIndex: 0,
  tokenProgram: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  associatedTokenProgram: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  /** Runtime manifest claims more than one strategy lane; lanes are not assumed here. */
  knownStrategyCandidates: [
    address("DCpR24Eb6xCWxDyaZvCBTkadkxCB2vkqJN1EfYNWtLxY"),
    address("4MetvifzuZShQ5zUhff4mVvwpu3kfKcqYfuY8pW7Zy9B"),
  ],
  /** Chain time for coherent accounting: Clock sysvar, unix seconds at offset 32. */
  clockSysvar: address("SysvarC1ock11111111111111111111111111111111"),
  /**
   * The custom adaptor keeps its configuration in the strategy account itself
   * (owner = custom adaptor program, 472 bytes, layout v2).
   */
  adaptorConfigStrategy: address("DCpR24Eb6xCWxDyaZvCBTkadkxCB2vkqJN1EfYNWtLxY"),
  reportTicket: address("8zdYvAsntUxgaSY4CBh2Kmqf5EhUYi13eAMK6yinyJiq"),
  /** Adaptor programs the runtime catalog has named, by strategy. */
  expectedAdaptorProgramByStrategy: {
    "DCpR24Eb6xCWxDyaZvCBTkadkxCB2vkqJN1EfYNWtLxY": "FSj27QT2PtP7365pQRtgSAwSwk5h2m2ATCBoXQjwTSxW",
    "4MetvifzuZShQ5zUhff4mVvwpu3kfKcqYfuY8pW7Zy9B": "3pnpK9nrs1R65eMV1wqCXkDkhSgN18xb1G5pgYPwoZjJ",
  } as Readonly<Record<string, string>>,
} as const;

export type ParsedWallet = { ok: true; wallet: Address } | { ok: false; reason: string };

/**
 * Strict wallet parsing: a syntactically valid address is required, and the
 * pinned vault/program/mint identities are rejected as wallet input because
 * they are never user wallets.
 */
export function parseWalletParam(value: string | null | undefined): ParsedWallet {
  if (!value || value.trim().length === 0) {
    return { ok: false, reason: "wallet query parameter is required" };
  }
  const candidate = value.trim();
  if (!isAddress(candidate)) {
    return { ok: false, reason: "wallet is not a valid Solana address" };
  }
  const parsed = address(candidate);
  const forbidden: ReadonlyArray<[Address, string]> = [
    [VAULT_IDENTITY.vault, "vault"],
    [VAULT_IDENTITY.lpMint, "LP mint"],
    [VAULT_IDENTITY.assetMint, "asset mint"],
    [VAULT_IDENTITY.voltrProgram, "Voltr program"],
  ];
  for (const [identity, label] of forbidden) {
    if (parsed === identity) {
      return { ok: false, reason: `wallet must not be the ${label}` };
    }
  }
  return { ok: true, wallet: parsed };
}


/** Display labels from the pinned route/fleet catalog; not price or routing authority. */
export const TOKEN_LABELS: Readonly<Record<string, string>> = {
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": "PYUSD",
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH": "USDG",
  "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH": "CASH",
};
