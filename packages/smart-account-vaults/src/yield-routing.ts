import BN from "bn.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { generated } from "@loyal-labs/loyal-smart-accounts";

export const KAMINO_LEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);

export const KAMINO_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR = Uint8Array.from([
  169, 201, 30, 126, 6, 205, 102, 68,
]);

export const KAMINO_REDEEM_RESERVE_COLLATERAL_DISCRIMINATOR = Uint8Array.from([
  234, 117, 181, 125, 185, 142, 220, 29,
]);

export type SmartAccountYieldRoutingKaminoReserve = {
  reserve: PublicKey;
  market: PublicKey;
  liquidityMint: PublicKey;
};

export type SmartAccountYieldRoutingPolicyAddresses = {
  rebalance: PublicKey;
};

export type SmartAccountYieldRoutingPolicySeeds = {
  rebalance: bigint;
};

export type BuildKaminoRebalancePolicyCreationPayloadArgs = {
  accountIndex: number;
  vault: PublicKey;
  reserves: SmartAccountYieldRoutingKaminoReserve[];
  klendProgramId?: PublicKey;
};

function uniquePubkeys(pubkeys: PublicKey[]): PublicKey[] {
  const unique = new Map<string, PublicKey>();

  for (const pubkey of pubkeys) {
    unique.set(pubkey.toBase58(), pubkey);
  }

  return [...unique.values()];
}

function pubkeyConstraint(
  accountIndex: number,
  pubkeys: PublicKey[],
  owner: PublicKey | null = null
): generated.AccountConstraint {
  return {
    accountIndex,
    accountConstraint: {
      __kind: "Pubkey",
      fields: [uniquePubkeys(pubkeys)],
    },
    owner,
  };
}

function kaminoDepositInstructionConstraint(args: {
  vault: PublicKey;
  reserves: SmartAccountYieldRoutingKaminoReserve[];
  klendProgramId: PublicKey;
}): generated.InstructionConstraint {
  return {
    programId: args.klendProgramId,
    accountConstraints: [
      pubkeyConstraint(0, [args.vault]),
      pubkeyConstraint(
        1,
        args.reserves.map((reserve) => reserve.reserve)
      ),
      pubkeyConstraint(
        2,
        args.reserves.map((reserve) => reserve.market)
      ),
      pubkeyConstraint(
        4,
        args.reserves.map((reserve) => reserve.liquidityMint),
        TOKEN_PROGRAM_ID
      ),
      pubkeyConstraint(9, [TOKEN_PROGRAM_ID]),
      pubkeyConstraint(10, [TOKEN_PROGRAM_ID]),
    ],
    dataConstraints: [
      {
        dataOffset: new BN(0),
        dataValue: {
          __kind: "U8Slice",
          fields: [KAMINO_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR],
        },
        operator: generated.DataOperator.Equals,
      },
    ],
  };
}

function kaminoRedeemInstructionConstraint(args: {
  vault: PublicKey;
  reserves: SmartAccountYieldRoutingKaminoReserve[];
  klendProgramId: PublicKey;
}): generated.InstructionConstraint {
  return {
    programId: args.klendProgramId,
    accountConstraints: [
      pubkeyConstraint(0, [args.vault]),
      pubkeyConstraint(
        1,
        args.reserves.map((reserve) => reserve.market)
      ),
      pubkeyConstraint(
        2,
        args.reserves.map((reserve) => reserve.reserve)
      ),
      pubkeyConstraint(
        4,
        args.reserves.map((reserve) => reserve.liquidityMint),
        TOKEN_PROGRAM_ID
      ),
      pubkeyConstraint(9, [TOKEN_PROGRAM_ID]),
      pubkeyConstraint(10, [TOKEN_PROGRAM_ID]),
    ],
    dataConstraints: [
      {
        dataOffset: new BN(0),
        dataValue: {
          __kind: "U8Slice",
          fields: [KAMINO_REDEEM_RESERVE_COLLATERAL_DISCRIMINATOR],
        },
        operator: generated.DataOperator.Equals,
      },
    ],
  };
}

export function buildKaminoRebalancePolicyCreationPayload(
  args: BuildKaminoRebalancePolicyCreationPayloadArgs
): generated.PolicyCreationPayload {
  if (args.reserves.length === 0) {
    throw new Error("At least one Kamino reserve is required.");
  }

  const klendProgramId = args.klendProgramId ?? KAMINO_LEND_PROGRAM_ID;

  return {
    __kind: "ProgramInteraction",
    fields: [
      {
        accountIndex: args.accountIndex,
        instructionsConstraints: [
          kaminoRedeemInstructionConstraint({
            vault: args.vault,
            reserves: args.reserves,
            klendProgramId,
          }),
          kaminoDepositInstructionConstraint({
            vault: args.vault,
            reserves: args.reserves,
            klendProgramId,
          }),
        ],
        preHook: null,
        postHook: null,
        spendingLimits: [],
      },
    ],
  };
}
