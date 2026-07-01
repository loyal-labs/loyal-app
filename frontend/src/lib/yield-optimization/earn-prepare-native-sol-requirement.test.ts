import { describe, expect, test } from "bun:test";
import type {
  SmartAccountNativeSolRequirement,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
  SmartAccountPreparedEarnUsdcDeposit,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import {
  hydratePreparedEarnUsdcAutodepositSetup,
  serializePreparedEarnUsdcAutodepositSetup,
} from "./earn-autodeposit-prepare-contracts.shared";
import {
  hydratePreparedEarnUsdcDeposit,
  serializePreparedEarnUsdcDeposit,
} from "./earn-deposit-prepare-contracts.shared";

const PROGRAM_ID = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const PAYER = new PublicKey("11111111111111111111111111111113");
const ACCOUNT = new PublicKey("11111111111111111111111111111117");

const nativeSolRequirement: SmartAccountNativeSolRequirement = {
  balanceLamports: "1000",
  canProceed: false,
  deficitLamports: "4500",
  items: [
    {
      account: ACCOUNT.toBase58(),
      kind: "policy_rent",
      label: "Policy rent",
      lamports: "5500",
      stage: "policy",
    },
  ],
  payer: PAYER.toBase58(),
  requiredLamports: "5500",
};

function prepared(operation: string) {
  return {
    instructions: [],
    lookupTableAccounts: [],
    operation,
    payer: PAYER,
    programId: PROGRAM_ID,
    requiresConfirmation: true,
  };
}

describe("Earn prepare native SOL requirement wire contracts", () => {
  test("preserves deposit native SOL requirement", () => {
    const deposit = {
      kaminoSetupAccountCount: 0,
      kaminoSetupRentLamports: "0",
      kaminoSetupRequired: false,
      nativeSolRequirement,
      persistence: {
        cluster: "mainnet-beta",
        delegatedSigner: PAYER.toBase58(),
        depositMint: ACCOUNT.toBase58(),
        kaminoLiquidityMints: [],
        kaminoMarkets: [],
        liquidityMint: ACCOUNT.toBase58(),
        market: ACCOUNT.toBase58(),
        policyAccount: ACCOUNT.toBase58(),
        policyId: "7",
        policyInitialization: "reuse",
        policySeed: "7",
        principalAmountRaw: "1000000",
        riskProfile: "safe",
        routeModes: [],
        settings: ACCOUNT.toBase58(),
        stableMints: [],
        targetReserve: ACCOUNT.toBase58(),
        targetSupplyApyBps: null,
        universePreset: "canonical_stable_kamino",
        vaultIndex: 1,
        vaultPubkey: ACCOUNT.toBase58(),
        walletAddress: PAYER.toBase58(),
      },
      policy: {
        account: ACCOUNT,
        id: BigInt(7),
        sameMintInstructionConstraintIndexes: [0, 1],
        seed: BigInt(7),
      },
      prepared: prepared("earnUsdcDeposit"),
      targetReserve: {
        liquidityMint: ACCOUNT,
        market: ACCOUNT,
        obligation: ACCOUNT,
        reserve: ACCOUNT,
        supplyApyBps: null,
      },
      vault: {
        accountIndex: 1,
        collateralAta: null,
        pubkey: ACCOUNT,
        usdcAta: ACCOUNT,
      },
    } as SmartAccountPreparedEarnUsdcDeposit;

    expect(
      hydratePreparedEarnUsdcDeposit(serializePreparedEarnUsdcDeposit(deposit))
        .nativeSolRequirement
    ).toEqual(nativeSolRequirement);
  });

  test("preserves autodeposit setup native SOL requirement", () => {
    const setup = {
      authorityInitializationRequired: false,
      nativeSolRequirement,
      persistence: {
        amountPerPeriodRaw: "1000000",
        cluster: "mainnet-beta",
        delegatedSigner: PAYER.toBase58(),
        expiryTimestamp: "0",
        liquidityMint: ACCOUNT.toBase58(),
        minimumDelegatorBalanceRaw: null,
        nonce: "42",
        periodLengthSeconds: "2592000",
        policyAccount: ACCOUNT.toBase58(),
        policyId: "7",
        policySeed: "7",
        recurringDelegation: ACCOUNT.toBase58(),
        settings: ACCOUNT.toBase58(),
        startTimestamp: "1",
        subscriptionAuthority: ACCOUNT.toBase58(),
        subscriptionAuthorityInitialization: "exists",
        subscriptionDelegatee: ACCOUNT.toBase58(),
        vaultIndex: 1,
        vaultPubkey: ACCOUNT.toBase58(),
        vaultUsdcAta: ACCOUNT.toBase58(),
        walletAddress: PAYER.toBase58(),
        walletUsdcAta: ACCOUNT.toBase58(),
      },
      policy: {
        account: ACCOUNT,
        id: BigInt(7),
        seed: BigInt(7),
      },
      prepared: prepared("earnUsdcAutodepositCreatePolicy"),
      stage: "create_policy",
      subscription: {
        amountPerPeriodRaw: BigInt(1_000_000),
        authority: ACCOUNT,
        expiryTimestamp: BigInt(0),
        nonce: BigInt(42),
        periodLengthSeconds: BigInt(2_592_000),
        recurringDelegation: ACCOUNT,
        startTimestamp: BigInt(1),
      },
      vault: {
        accountIndex: 1,
        pubkey: ACCOUNT,
        usdcAta: ACCOUNT,
      },
    } as SmartAccountPreparedEarnUsdcAutodepositSetup;

    expect(
      hydratePreparedEarnUsdcAutodepositSetup(
        serializePreparedEarnUsdcAutodepositSetup(setup)
      ).nativeSolRequirement
    ).toEqual(nativeSolRequirement);
  });
});
