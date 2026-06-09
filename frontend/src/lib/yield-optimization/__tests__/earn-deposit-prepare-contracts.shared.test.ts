import { describe, expect, test } from "bun:test";
import { LoyalCluster } from "@loyal/actions";
import type { SmartAccountPreparedEarnUsdcDeposit } from "@loyal-labs/smart-account-vaults";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

import {
  hydratePreparedEarnUsdcDeposit,
  parseEarnDepositPrepareRequestBody,
  serializePreparedEarnUsdcDeposit,
} from "../earn-deposit-prepare-contracts.shared";

describe("earn deposit prepare contracts", () => {
  test("parses positive raw deposit amounts", () => {
    expect(
      parseEarnDepositPrepareRequestBody({ amountRaw: "1000000" })
    ).toEqual({
      amountRaw: BigInt(1_000_000),
    });
  });

  test("rejects non-positive raw deposit amounts", () => {
    expect(() =>
      parseEarnDepositPrepareRequestBody({ amountRaw: "0" })
    ).toThrow("amountRaw must be greater than 0.");
  });

  test("round-trips prepared deposit collateral ATA metadata", () => {
    const programId = PublicKey.unique();
    const walletAddress = PublicKey.unique();
    const vaultPubkey = PublicKey.unique();
    const collateralAta = PublicKey.unique();
    const usdcAta = PublicKey.unique();
    const preparedDeposit: SmartAccountPreparedEarnUsdcDeposit = {
      kaminoSetupAccountCount: 1,
      kaminoSetupRentLamports: "100",
      kaminoSetupRequired: true,
      persistence: {
        cluster: LoyalCluster.Devnet,
        depositMint: PublicKey.unique().toBase58(),
        liquidityMint: PublicKey.unique().toBase58(),
        market: PublicKey.unique().toBase58(),
        policyAccount: PublicKey.unique().toBase58(),
        policyId: "1",
        policyInitialization: "create",
        policySeed: "1",
        principalAmountRaw: "1000000",
        settings: PublicKey.unique().toBase58(),
        targetReserve: PublicKey.unique().toBase58(),
        targetSupplyApyBps: null,
        vaultIndex: 1,
        vaultPubkey: vaultPubkey.toBase58(),
        walletAddress: walletAddress.toBase58(),
      },
      policy: {
        account: PublicKey.unique(),
        id: BigInt(1),
        sameMintInstructionConstraintIndexes: [0, 1],
        seed: BigInt(1),
      },
      prepared: {
        instructions: [
          new TransactionInstruction({
            keys: [],
            programId,
          }),
        ],
        lookupTableAccounts: [],
        operation: "earnUsdcDeposit",
        payer: walletAddress,
        programId,
        requiresConfirmation: true,
      },
      targetReserve: {
        liquidityMint: PublicKey.unique(),
        market: PublicKey.unique(),
        reserve: PublicKey.unique(),
        supplyApyBps: null,
      },
      vault: {
        accountIndex: 1,
        collateralAta,
        pubkey: vaultPubkey,
        usdcAta,
      },
    };

    const wire = serializePreparedEarnUsdcDeposit(preparedDeposit);
    const hydrated = hydratePreparedEarnUsdcDeposit(wire);

    expect(wire.vault.collateralAta).toBe(collateralAta.toBase58());
    expect(hydrated.vault.collateralAta?.toBase58()).toBe(
      collateralAta.toBase58()
    );
  });
});
