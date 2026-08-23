import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

import { clusterConfigFor } from "./cluster.ts";
import {
  createProgramInteractionPolicyInstruction,
  updateProgramInteractionPolicyInstruction,
} from "./internal/squads.ts";
import { LoyalCluster } from "./types.ts";

const SMART_ACCOUNT_SEED = new TextEncoder().encode("smart_account");
const FARM_USER_SEED = new TextEncoder().encode("user");

export const EARN_MAX_MANIFEST_VERSION = "earn-max-v1";
export const EARN_MAX_VAULT_INDEX = 0;

const KLEND = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const FARMS = new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MARKET = new PublicKey("6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y");
const COLLATERAL_RESERVE = new PublicKey("AwCyCPZYJSZ93xcVKNK7jR8e1BHzJXq1D4bReNuh9woY");
const DEBT_RESERVE = new PublicKey("Atj6UREVWa7WxbF2EMKNyfmYUY1U1txughe2gjhcPDCo");
const COLLATERAL_MINT = new PublicKey("AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj");
const CLAIM_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const DEBT_FARM = new PublicKey("87gUNr8LwYJCT25HjPEHnrfBBjwEMAjfqCfnKcJNqy9Y");

const REFRESH_RESERVE = [2, 218, 138, 235, 79, 201, 25, 102] as const;
const REFRESH_OBLIGATION = [33, 132, 147, 228, 151, 192, 72, 89] as const;
const DEPOSIT = [216, 224, 191, 27, 204, 151, 102, 175] as const;
const BORROW = [161, 128, 143, 245, 171, 199, 194, 6] as const;
const REPAY = [116, 174, 213, 76, 180, 53, 210, 144] as const;
const WITHDRAW = [235, 52, 119, 152, 149, 197, 20, 7] as const;
const SHARED_ACCOUNTS_ROUTE = [193, 32, 155, 51, 65, 214, 156, 129] as const;

export type EarnMaxTopology = {
  vault: PublicKey;
  claimCustody: PublicKey;
  collateralCustody: PublicKey;
  obligation: PublicKey;
  debtFarmUser: PublicKey;
  market: PublicKey;
  collateralReserve: PublicKey;
  debtReserve: PublicKey;
  collateralMint: PublicKey;
  claimMint: PublicKey;
  debtFarm: PublicKey;
};

export type EarnMaxPolicyPreparation = {
  family: "deposit" | "borrow" | "forward_swap" | "reverse_swap" | "repay" | "withdraw";
  seed: bigint;
  policy: PublicKey;
  instruction: TransactionInstruction;
  updateInstruction: TransactionInstruction;
};

function associatedToken(owner: PublicKey, mint: PublicKey): PublicKey {
  const config = clusterConfigFor(LoyalCluster.MainnetBeta);
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN.toBytes(), mint.toBytes()],
    config.associatedTokenProgramId
  )[0];
}

export function deriveEarnMaxTopology(settings: PublicKey): EarnMaxTopology {
  const config = clusterConfigFor(LoyalCluster.MainnetBeta);
  const vault = PublicKey.findProgramAddressSync(
    [SMART_ACCOUNT_SEED, settings.toBytes(), SMART_ACCOUNT_SEED, Uint8Array.of(EARN_MAX_VAULT_INDEX)],
    config.squadsSmartAccountProgramId
  )[0];
  const obligation = PublicKey.findProgramAddressSync(
    [
      Uint8Array.of(1),
      Uint8Array.of(0),
      vault.toBytes(),
      MARKET.toBytes(),
      COLLATERAL_MINT.toBytes(),
      CLAIM_MINT.toBytes(),
    ],
    KLEND
  )[0];
  const debtFarmUser = PublicKey.findProgramAddressSync(
    [FARM_USER_SEED, DEBT_FARM.toBytes(), obligation.toBytes()],
    FARMS
  )[0];
  return {
    vault,
    claimCustody: associatedToken(vault, CLAIM_MINT),
    collateralCustody: associatedToken(vault, COLLATERAL_MINT),
    obligation,
    debtFarmUser,
    market: MARKET,
    collateralReserve: COLLATERAL_RESERVE,
    debtReserve: DEBT_RESERVE,
    collateralMint: COLLATERAL_MINT,
    claimMint: CLAIM_MINT,
    debtFarm: DEBT_FARM,
  };
}

function sliceEquals(value: readonly number[]) {
  return {
    dataOffset: BigInt(0),
    dataValue: { type: "u8Slice" as const, value },
    operator: "equals" as const,
  };
}

function pubkey(accountIndex: number, ...pubkeys: PublicKey[]) {
  return { accountIndex, kind: { type: "pubkey" as const, pubkeys } };
}

export function createEarnMaxPolicyManifest(input: {
  authority: PublicKey;
  delegatedSigner: PublicKey;
  settings: PublicKey;
}): readonly EarnMaxPolicyPreparation[] {
  const config = clusterConfigFor(LoyalCluster.MainnetBeta);
  const topology = deriveEarnMaxTopology(input.settings);
  const refreshReserve = {
    programId: KLEND,
    accountConstraints: [pubkey(0, COLLATERAL_RESERVE, DEBT_RESERVE)],
    dataConstraints: [sliceEquals(REFRESH_RESERVE)],
  };
  const refreshObligation = {
    programId: KLEND,
    accountConstraints: [pubkey(1, topology.obligation)],
    dataConstraints: [sliceEquals(REFRESH_OBLIGATION)],
  };
  const policy = (
    family: EarnMaxPolicyPreparation["family"],
    seed: bigint,
    finalConstraint: Parameters<typeof createProgramInteractionPolicyInstruction>[2][number]
  ): EarnMaxPolicyPreparation => {
    const instruction = createProgramInteractionPolicyInstruction(
      config,
      {
        settings: input.settings,
        authority: input.authority,
        delegatedSigner: input.delegatedSigner,
        accountIndex: EARN_MAX_VAULT_INDEX,
        vault: topology.vault,
      },
      family.includes("swap")
        ? [finalConstraint]
        : [refreshReserve, refreshObligation, finalConstraint],
      seed
    );
    const policy = instruction.keys[5]!.pubkey;
    return {
      family,
      seed,
      policy,
      instruction,
      updateInstruction: updateProgramInteractionPolicyInstruction(
        config,
        {
          settings: input.settings,
          authority: input.authority,
          delegatedSigner: input.delegatedSigner,
          accountIndex: EARN_MAX_VAULT_INDEX,
          vault: topology.vault,
        },
        family.includes("swap")
          ? [finalConstraint]
          : [refreshReserve, refreshObligation, finalConstraint],
        policy
      ),
    };
  };

  return [
    policy("deposit", BigInt(32), {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault), pubkey(1, topology.obligation),
        pubkey(4, COLLATERAL_RESERVE), pubkey(9, topology.collateralCustody),
        pubkey(11, TOKEN), pubkey(12, TOKEN), pubkey(14, KLEND), pubkey(15, KLEND),
      ],
      dataConstraints: [sliceEquals(DEPOSIT)],
    }),
    policy("repay", BigInt(33), {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault), pubkey(1, topology.obligation), pubkey(3, DEBT_RESERVE),
        pubkey(6, topology.claimCustody), pubkey(7, TOKEN), pubkey(9, topology.debtFarmUser),
        pubkey(10, DEBT_FARM), pubkey(12, FARMS),
      ],
      dataConstraints: [sliceEquals(REPAY)],
    }),
    policy("borrow", BigInt(34), {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault), pubkey(1, topology.obligation), pubkey(4, DEBT_RESERVE),
        pubkey(8, topology.claimCustody), pubkey(10, TOKEN), pubkey(12, topology.debtFarmUser),
        pubkey(13, DEBT_FARM), pubkey(14, FARMS),
      ],
      dataConstraints: [sliceEquals(BORROW)],
    }),
    policy("forward_swap", BigInt(35), {
      programId: config.jupiterV6ProgramId,
      accountConstraints: [
        pubkey(0, TOKEN), pubkey(2, topology.vault), pubkey(3, topology.claimCustody),
        pubkey(6, topology.collateralCustody), pubkey(7, CLAIM_MINT),
        pubkey(8, COLLATERAL_MINT), pubkey(9, config.jupiterV6ProgramId),
        pubkey(10, config.jupiterV6ProgramId),
      ],
      dataConstraints: [sliceEquals(SHARED_ACCOUNTS_ROUTE)],
    }),
    policy("withdraw", BigInt(36), {
      programId: KLEND,
      accountConstraints: [
        pubkey(0, topology.vault), pubkey(1, topology.obligation),
        pubkey(4, COLLATERAL_RESERVE), pubkey(9, topology.collateralCustody),
        pubkey(11, TOKEN), pubkey(12, TOKEN), pubkey(14, KLEND), pubkey(15, KLEND),
      ],
      dataConstraints: [sliceEquals(WITHDRAW)],
    }),
    policy("reverse_swap", BigInt(44), {
      programId: config.jupiterV6ProgramId,
      accountConstraints: [
        pubkey(0, TOKEN), pubkey(2, topology.vault), pubkey(3, topology.collateralCustody),
        pubkey(6, topology.claimCustody), pubkey(7, COLLATERAL_MINT),
        pubkey(8, CLAIM_MINT), pubkey(9, config.jupiterV6ProgramId),
        pubkey(10, config.jupiterV6ProgramId),
      ],
      dataConstraints: [sliceEquals(SHARED_ACCOUNTS_ROUTE)],
    }),
  ];
}
