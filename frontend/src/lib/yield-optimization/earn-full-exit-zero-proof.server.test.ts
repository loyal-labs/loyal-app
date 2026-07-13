import { describe, expect, mock, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";

mock.module("server-only", () => ({}));

mock.module("./yield-deposit-repository.server", () => ({
  EARN_FINAL_EXIT_IDLE_DUST_TOLERANCE_RAW: BigInt(10_000),
}));

const { verifyEarnFullExitZeroBalances } = await import(
  "./earn-full-exit-zero-proof.server"
);

const programId = new PublicKey("11111111111111111111111111111112");
const settingsPda = new PublicKey("11111111111111111111111111111113");
const vaultPda = new PublicKey("11111111111111111111111111111114");
const vaultUsdcAta = new PublicKey("11111111111111111111111111111115");
const collateralAta = new PublicKey("11111111111111111111111111111116");
const usdcMint = new PublicKey("11111111111111111111111111111117");
const collateralMint = new PublicKey("11111111111111111111111111111118");

const connection = {
  getTokenAccountsByOwner: async () => ({ context: { slot: 500 }, value: [] }),
};

function createHolding(args: {
  amountRaw: string;
  kind: "idle" | "kamino";
  reserve?: string | null;
}) {
  return {
    amountRaw: args.amountRaw,
    kind: args.kind,
    label: args.kind === "idle" ? "Idle Balance" : "Kamino",
    liquidityMint: usdcMint.toBase58(),
    market: args.kind === "idle" ? null : programId.toBase58(),
    marketName: "USDC",
    observedAt: "2026-07-13T00:00:00.000Z",
    observedSlot: "500",
    provenance: {},
    reserve: args.reserve ?? null,
    supplyApyBps: null,
  };
}

function createHoldingsSnapshot(
  holdings: ReturnType<typeof createHolding>[],
  observedSlot = "500"
) {
  return {
    currentTotalAmountRaw: holdings
      .reduce((total, holding) => total + BigInt(holding.amountRaw), BigInt(0))
      .toString(),
    holdings,
    observedAt: "2026-07-13T00:00:00.000Z",
    observedSlot,
    provenance: {
      accountCount: 1,
      chunkCount: 1,
      commitment: "confirmed" as const,
      source: "rpc_getMultipleAccounts" as const,
      watchedAccounts: [],
    },
  };
}

function createVaultSnapshot(args: {
  collateralAmountRaw?: bigint;
  idleAmountRaw?: bigint;
}) {
  return {
    lamports: BigInt(0),
    tokenAccounts: [
      {
        address: vaultUsdcAta,
        amountRaw: args.idleAmountRaw ?? BigInt(0),
        isUsdc: true,
        lamports: 1,
        mint: usdcMint,
      },
      {
        address: collateralAta,
        amountRaw: args.collateralAmountRaw ?? BigInt(0),
        isUsdc: false,
        lamports: 1,
        mint: collateralMint,
      },
    ],
    vaultPda,
    vaultUsdcAta,
  };
}

function createInput() {
  return {
    cluster: "mainnet-beta" as never,
    connection: connection as never,
    minContextSlot: 500,
    policy: {
      account: programId.toBase58(),
      seed: "7",
      vaultIndex: 1,
      vaultPubkey: vaultPda.toBase58(),
    },
    programId,
    settingsPda,
  };
}

describe("Earn full-exit zero proof", () => {
  test("keeps closure blocked when a second policy reserve is still positive", async () => {
    const secondReserve = new PublicKey(
      "11111111111111111111111111111119"
    ).toBase58();
    const fetchHoldingsSnapshot = mock(
      async (input: Record<string, unknown>) => {
        expect(input.minContextSlot).toBe(500);
        expect(input.requireCompleteReserveReads).toBe(true);
        return createHoldingsSnapshot([
          createHolding({
            amountRaw: "25",
            kind: "kamino",
            reserve: secondReserve,
          }),
        ]);
      }
    );

    const proof = await verifyEarnFullExitZeroBalances(createInput(), {
      fetchHoldingsSnapshot: fetchHoldingsSnapshot as never,
      fetchVaultSnapshot: async () => createVaultSnapshot({}),
    });

    expect(proof.status).toBe("full_exit_incomplete");
    expect(proof.remainingHoldings).toEqual([
      expect.objectContaining({ amountRaw: "25", reserve: secondReserve }),
    ]);
  });

  test("rejects a stale RPC context instead of authorizing closure", async () => {
    await expect(
      verifyEarnFullExitZeroBalances(createInput(), {
        fetchHoldingsSnapshot: async () =>
          createHoldingsSnapshot([], "499") as never,
        fetchVaultSnapshot: async () => createVaultSnapshot({}),
      })
    ).rejects.toThrow(
      "Earn full-exit proof was observed before the withdrawal confirmation slot."
    );
  });

  test("retries minimum-context RPC lag and remains retryable on failure", async () => {
    const slotLagError = Object.assign(
      new Error("Minimum context slot has not been reached"),
      { code: -32_016 }
    );
    const fetchHoldingsSnapshot = mock(async () => {
      throw slotLagError;
    });
    const sleep = mock(async () => {});

    await expect(
      verifyEarnFullExitZeroBalances(createInput(), {
        fetchHoldingsSnapshot: fetchHoldingsSnapshot as never,
        fetchVaultSnapshot: async () => createVaultSnapshot({}),
        sleep,
      })
    ).rejects.toBe(slotLagError);
    expect(fetchHoldingsSnapshot).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test("allows the separate close phase only when reserves are zero and idle is dust", async () => {
    const proof = await verifyEarnFullExitZeroBalances(createInput(), {
      fetchHoldingsSnapshot: async () =>
        createHoldingsSnapshot([
          createHolding({ amountRaw: "9999", kind: "idle" }),
        ]) as never,
      fetchVaultSnapshot: async () =>
        createVaultSnapshot({ idleAmountRaw: BigInt(9999) }),
    });

    expect(proof).toMatchObject({
      closeableTokenAccounts: [collateralAta.toBase58()],
      idleAmountRaw: "9999",
      idleReadsAgree: true,
      status: "policy_close_required",
    });
  });

  test("blocks closure when independent idle-account reads disagree", async () => {
    const proof = await verifyEarnFullExitZeroBalances(createInput(), {
      fetchHoldingsSnapshot: async () => createHoldingsSnapshot([]) as never,
      fetchVaultSnapshot: async () =>
        createVaultSnapshot({ idleAmountRaw: BigInt(1) }),
    });

    expect(proof).toMatchObject({
      idleAmountRaw: "1",
      idleReadsAgree: false,
      status: "full_exit_incomplete",
    });
  });
});
