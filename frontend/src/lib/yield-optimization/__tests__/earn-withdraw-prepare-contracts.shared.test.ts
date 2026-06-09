import { describe, expect, test } from "bun:test";
import { LoyalCluster } from "@loyal/actions";
import type { SmartAccountPreparedEarnUsdcWithdraw } from "@loyal-labs/smart-account-vaults";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  hydratePreparedEarnUsdcWithdraw,
  parseEarnWithdrawPrepareRequestBody,
  serializePreparedEarnUsdcWithdraw,
} from "../earn-withdraw-prepare-contracts.shared";

describe("earn withdraw prepare contracts", () => {
  test("parses positive raw withdrawal amounts and modes", () => {
    expect(
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "1000000",
        mode: "full",
      })
    ).toEqual({
      amountRaw: BigInt(1_000_000),
      mode: "full",
    });
  });

  test("rejects non-positive raw withdrawal amounts", () => {
    expect(() =>
      parseEarnWithdrawPrepareRequestBody({
        amountRaw: "0",
        mode: "partial",
      })
    ).toThrow("amountRaw must be greater than 0.");
  });

  test("round-trips full-withdraw sweep metadata", () => {
    const programId = PublicKey.unique();
    const walletAddress = PublicKey.unique();
    const vaultPubkey = PublicKey.unique();
    const preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw = {
      amountRaw: BigInt(1_000_000),
      mode: "full",
      persistence: {
        cluster: LoyalCluster.Devnet,
        liquidityMint: PublicKey.unique().toBase58(),
        market: PublicKey.unique().toBase58(),
        mode: "full",
        policyAccount: PublicKey.unique().toBase58(),
        policyId: "1",
        policySeed: "1",
        settings: PublicKey.unique().toBase58(),
        targetReserve: PublicKey.unique().toBase58(),
        vaultIndex: 1,
        vaultPubkey: vaultPubkey.toBase58(),
        kaminoWithdrawAmountRaw: "1000001",
        vaultCollateralCleanupIncluded: false,
        vaultUsdcRemainderRaw: "1",
        walletAddress: walletAddress.toBase58(),
        walletTransferAmountRaw: "1000002",
        withdrawnAmountRaw: "1000000",
      },
      policy: {
        account: PublicKey.unique(),
        id: BigInt(1),
        sameMintInstructionConstraintIndexes: [0, 1],
        seed: BigInt(1),
        withdrawInstructionConstraintIndex: 0,
      },
      prepared: {
        instructions: [
          new TransactionInstruction({
            keys: [],
            programId,
          }),
        ],
        lookupTableAccounts: [],
        operation: "earnUsdcWithdraw",
        payer: walletAddress,
        programId,
        requiresConfirmation: true,
      },
      targetReserve: {
        liquidityMint: PublicKey.unique(),
        market: PublicKey.unique(),
        reserve: PublicKey.unique(),
      },
      vault: {
        accountIndex: 1,
        collateralAta: PublicKey.unique(),
        pubkey: vaultPubkey,
        usdcAta: PublicKey.unique(),
      },
    };

    const wire = serializePreparedEarnUsdcWithdraw(preparedWithdraw);
    const hydrated = hydratePreparedEarnUsdcWithdraw(wire);

    expect(wire.persistence).toMatchObject({
      kaminoWithdrawAmountRaw: "1000001",
      vaultCollateralCleanupIncluded: false,
      vaultUsdcRemainderRaw: "1",
      walletTransferAmountRaw: "1000002",
      withdrawnAmountRaw: "1000000",
    });
    expect(hydrated.persistence.kaminoWithdrawAmountRaw).toBe("1000001");
    expect(hydrated.persistence.vaultCollateralCleanupIncluded).toBe(false);
    expect(hydrated.persistence.vaultUsdcRemainderRaw).toBe("1");
    expect(hydrated.persistence.walletTransferAmountRaw).toBe("1000002");
  });
});
