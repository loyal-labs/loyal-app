import type { PublicKey } from "@solana/web3.js";

import type { SelectedEarnWithdrawSource } from "./earn-withdraw-input-resolution.server";

// A withdrawal source carries its mint under a different key per kind.
export function sourceLiquidityMint(
  source: SelectedEarnWithdrawSource
): string {
  return source.type === "idle" ? source.mint : source.liquidityMint;
}

// Narrow a full exit to the holdings that share one liquidity mint, and total
// only those.
//
// The SDK builds a full withdrawal around a single liquidity mint — one vault
// ATA, one wallet ATA, one token program — and rejects any target that
// disagrees, so handing it a mixed-mint vault failed the whole withdrawal
// instead of part of it. The optimizer rebalances across stablecoins and users
// can deposit a second one, so a mixed vault is normal. Unwind the selected
// mint now; the balance that remains keeps the position open and the user
// exits it on the next pass.
export function selectFullExitForMint<
  T extends { liquidityMint: PublicKey }
>(args: {
  exitMint: string;
  sources: SelectedEarnWithdrawSource[];
  targets: T[];
}): { amountRaw: bigint; targets: T[] } {
  return {
    amountRaw: args.sources
      .filter((source) => sourceLiquidityMint(source) === args.exitMint)
      .reduce((total, source) => total + source.amountRaw, BigInt(0)),
    targets: args.targets.filter(
      (target) => target.liquidityMint.toBase58() === args.exitMint
    ),
  };
}
