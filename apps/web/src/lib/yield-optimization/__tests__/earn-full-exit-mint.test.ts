import { describe, expect, it } from "bun:test";
import { PublicKey } from "@solana/web3.js";

import { selectFullExitForMint } from "../earn-full-exit-mint";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYUSD = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";

const reserveSource = (liquidityMint: string, amountRaw: bigint, id: string) =>
  ({
    amountRaw,
    id,
    liquidityMint,
    market: "BJnbcRHqvppTyGesLzWASGKnmnF1wq9jZu6ExrjT7wvF",
    reserve: id,
    sourceId: `reserve:${id}`,
    tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    type: "reserve",
  } as never);

const idleSource = (mint: string, amountRaw: bigint, tokenAccount: string) =>
  ({
    amountRaw,
    id: tokenAccount,
    mint,
    sourceId: `idle:${tokenAccount}`,
    tokenAccount,
    tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    type: "idle",
  } as never);

const target = (liquidityMint: string) => ({
  liquidityMint: new PublicKey(liquidityMint),
});

describe("selectFullExitForMint", () => {
  it("totals and unwinds only the holdings sharing the exit mint", () => {
    const result = selectFullExitForMint({
      exitMint: PYUSD,
      sources: [
        reserveSource(
          PYUSD,
          BigInt(79_790_000),
          "11111111111111111111111111111111"
        ),
        reserveSource(
          USDC,
          BigInt(20_000_000),
          "So11111111111111111111111111111111111111112"
        ),
        idleSource(
          PYUSD,
          BigInt(1_990_000),
          "SysvarC1ock11111111111111111111111111111111"
        ),
      ],
      targets: [target(PYUSD), target(USDC)],
    });

    // The USDC holding must not inflate a PYUSD withdrawal amount.
    expect(result.amountRaw).toBe(BigInt(81_780_000));
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.liquidityMint.toBase58()).toBe(PYUSD);
  });

  it("keeps every holding when the vault holds one mint", () => {
    const result = selectFullExitForMint({
      exitMint: USDC,
      sources: [
        reserveSource(
          USDC,
          BigInt(20_000_000),
          "11111111111111111111111111111111"
        ),
        idleSource(
          USDC,
          BigInt(5_000_000),
          "SysvarC1ock11111111111111111111111111111111"
        ),
      ],
      targets: [target(USDC)],
    });

    expect(result.amountRaw).toBe(BigInt(25_000_000));
    expect(result.targets).toHaveLength(1);
  });
});
