import { PublicKey } from "@solana/web3.js";
import {
  JUPITER_SWAP_DISCRIMINATOR,
  JUPITER_SWAP_SLIPPAGE_BPS_OFFSET,
  KAMINO_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR,
  KAMINO_LEND_PROGRAM_ID,
  KAMINO_WITHDRAW_RESERVE_LIQUIDITY_DISCRIMINATOR,
  SUBSCRIPTIONS_PROGRAM_ID,
  SUBSCRIPTIONS_TRANSFER_RECURRING,
  SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR,
  SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET,
  SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET,
  SUBSCRIPTION_TRANSFER_DELEGATOR_OFFSET,
  SUBSCRIPTION_TRANSFER_MINT_OFFSET,
} from "../constants.ts";
import {
  CONFIG_SEED,
  SWAP_EXACT_IN,
  SWAP_EXACT_IN_MAX_FEE_BPS_DATA_OFFSET,
  SWAP_EXACT_IN_TAG_OFFSET,
  swapExactInAccounts,
} from "../generated/loyal-hub-abi.ts";
import type { LoyalClusterConfig } from "../cluster.ts";
import type { U64Amount } from "../types.ts";
import {
  deriveSubscriptionAuthority,
  deriveSubscriptionEventAuthority,
  normalizeU64,
} from "../subscriptions.ts";
import type {
  AccountConstraint,
  DataConstraint,
  InstructionConstraint,
} from "./squads.ts";

const SPL_TOKEN_ACCOUNT_AUTHORITY_OFFSET = BigInt(32);
const SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET = BigInt(64);

export function kaminoWithdrawConstraint(
  config: LoyalClusterConfig,
  vault: PublicKey,
  markets: readonly PublicKey[],
  liquidityMints: readonly PublicKey[],
  lendProgramId = KAMINO_LEND_PROGRAM_ID,
  discriminator: readonly number[] = KAMINO_WITHDRAW_RESERVE_LIQUIDITY_DISCRIMINATOR
): InstructionConstraint {
  return {
    programId: lendProgramId,
    accountConstraints: [
      pubkeyConstraint(0, [vault]),
      pubkeyConstraint(1, uniquePubkeys(markets)),
      pubkeyConstraint(4, uniquePubkeys(liquidityMints), config.tokenProgramId),
      splTokenAuthorityConstraint(8, vault, config.tokenProgramId),
      pubkeyConstraint(10, [config.tokenProgramId]),
    ],
    dataConstraints: discriminatorConstraint(discriminator),
  };
}

export function kaminoDepositConstraint(
  config: LoyalClusterConfig,
  vault: PublicKey,
  markets: readonly PublicKey[],
  liquidityMints: readonly PublicKey[],
  lendProgramId = KAMINO_LEND_PROGRAM_ID,
  discriminator: readonly number[] = KAMINO_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR
): InstructionConstraint {
  return {
    programId: lendProgramId,
    accountConstraints: [
      pubkeyConstraint(0, [vault]),
      pubkeyConstraint(2, uniquePubkeys(markets)),
      pubkeyConstraint(4, uniquePubkeys(liquidityMints), config.tokenProgramId),
      splTokenAuthorityConstraint(8, vault, config.tokenProgramId),
      pubkeyConstraint(10, [config.tokenProgramId]),
    ],
    dataConstraints: discriminatorConstraint(discriminator),
  };
}

export function jupiterConstraint(
  config: LoyalClusterConfig,
  vault: PublicKey,
  allowedMints: readonly PublicKey[],
  maxSlippageBps: number
): InstructionConstraint {
  const mints = uniquePubkeys(allowedMints);
  return {
    programId: config.jupiterV6ProgramId,
    accountConstraints: [
      pubkeyConstraint(0, [vault]),
      splTokenAuthorityConstraint(1, vault, config.tokenProgramId),
      splTokenAuthorityConstraint(2, vault, config.tokenProgramId),
      pubkeyConstraint(3, mints, config.tokenProgramId),
      pubkeyConstraint(4, mints, config.tokenProgramId),
      pubkeyConstraint(5, [config.tokenProgramId]),
    ],
    dataConstraints: [
      dataSliceEquals(BigInt(0), JUPITER_SWAP_DISCRIMINATOR),
      dataU16LeLessThanOrEqualTo(
        BigInt(JUPITER_SWAP_SLIPPAGE_BPS_OFFSET),
        maxSlippageBps
      ),
    ],
  };
}

export function loyalHubConstraint(
  config: LoyalClusterConfig,
  vault: PublicKey,
  allowedMints: readonly PublicKey[],
  maxFeeBps: number
): InstructionConstraint {
  const mints = uniquePubkeys(allowedMints);
  return {
    programId: config.loyalHubSwapProgramId,
    accountConstraints: [
      pubkeyConstraint(
        swapExactInAccounts.CONFIG,
        [deriveLoyalHubConfig(config.loyalHubSwapProgramId)],
        config.loyalHubSwapProgramId
      ),
      pubkeyConstraint(swapExactInAccounts.USER_VAULT, [vault]),
      accountDataConstraint(
        swapExactInAccounts.HUB_INPUT,
        config.tokenProgramId
      ),
      accountDataConstraint(
        swapExactInAccounts.HUB_OUTPUT,
        config.tokenProgramId
      ),
      splTokenAuthorityConstraint(
        swapExactInAccounts.USER_INPUT,
        vault,
        config.tokenProgramId
      ),
      splTokenAuthorityConstraint(
        swapExactInAccounts.USER_OUTPUT,
        vault,
        config.tokenProgramId
      ),
      pubkeyConstraint(
        swapExactInAccounts.INPUT_MINT,
        mints,
        config.tokenProgramId
      ),
      pubkeyConstraint(
        swapExactInAccounts.OUTPUT_MINT,
        mints,
        config.tokenProgramId
      ),
      pubkeyConstraint(swapExactInAccounts.HUB_AUTHORIZER, [
        config.loyalHubAuthorizer,
      ]),
      pubkeyConstraint(swapExactInAccounts.TOKEN_PROGRAM, [
        config.tokenProgramId,
      ]),
    ],
    dataConstraints: [
      dataU8Equals(BigInt(SWAP_EXACT_IN_TAG_OFFSET), SWAP_EXACT_IN),
      dataU16LeLessThanOrEqualTo(
        BigInt(SWAP_EXACT_IN_MAX_FEE_BPS_DATA_OFFSET),
        maxFeeBps
      ),
    ],
  };
}

export function subscriptionSweepConstraint(
  config: LoyalClusterConfig,
  delegator: PublicKey,
  vault: PublicKey,
  mint: PublicKey,
  delegatorUsdcAta: PublicKey,
  vaultUsdcAta: PublicKey,
  maxAmountPerPeriodRaw: U64Amount,
  minimumDelegatorBalanceRaw?: U64Amount
): InstructionConstraint {
  const subscriptionAuthority = deriveSubscriptionAuthority(delegator, mint);
  const eventAuthority = deriveSubscriptionEventAuthority();

  return {
    programId: SUBSCRIPTIONS_PROGRAM_ID,
    accountConstraints: [
      recurringDelegationAccountConstraint(
        delegator,
        vault,
        subscriptionAuthority,
        mint,
        maxAmountPerPeriodRaw
      ),
      pubkeyConstraint(1, [subscriptionAuthority], SUBSCRIPTIONS_PROGRAM_ID),
      pubkeyConstraint(2, [delegatorUsdcAta], config.tokenProgramId),
      ...delegatorTokenBalanceConstraints(
        config.tokenProgramId,
        minimumDelegatorBalanceRaw
      ),
      pubkeyConstraint(3, [vaultUsdcAta], config.tokenProgramId),
      pubkeyConstraint(4, [mint], config.tokenProgramId),
      pubkeyConstraint(5, [config.tokenProgramId]),
      pubkeyConstraint(6, [vault]),
      pubkeyConstraint(7, [eventAuthority]),
      pubkeyConstraint(8, [SUBSCRIPTIONS_PROGRAM_ID]),
    ],
    dataConstraints: [
      dataU8Equals(BigInt(0), SUBSCRIPTIONS_TRANSFER_RECURRING),
      dataSliceEquals(BigInt(SUBSCRIPTION_TRANSFER_DELEGATOR_OFFSET), [
        ...delegator.toBytes(),
      ]),
      dataSliceEquals(BigInt(SUBSCRIPTION_TRANSFER_MINT_OFFSET), [
        ...mint.toBytes(),
      ]),
    ],
  };
}

export function deriveLoyalHubConfig(loyalHubProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], loyalHubProgramId)[0];
}

function pubkeyConstraint(
  accountIndex: number,
  pubkeys: readonly PublicKey[],
  owner?: PublicKey
) {
  return {
    accountIndex,
    kind: { type: "pubkey" as const, pubkeys: [...pubkeys] },
    owner,
  };
}

function accountDataConstraint(accountIndex: number, owner?: PublicKey) {
  return {
    accountIndex,
    kind: { type: "accountData" as const, dataConstraints: [] },
    owner,
  };
}

function splTokenAuthorityConstraint(
  accountIndex: number,
  authority: PublicKey,
  tokenProgramId: PublicKey
) {
  return {
    accountIndex,
    kind: {
      type: "accountData" as const,
      dataConstraints: [
        dataSliceEquals(SPL_TOKEN_ACCOUNT_AUTHORITY_OFFSET, [
          ...authority.toBytes(),
        ]),
      ],
    },
    owner: tokenProgramId,
  };
}

function delegatorTokenBalanceConstraints(
  tokenProgramId: PublicKey,
  minimumBalanceRaw?: U64Amount
): AccountConstraint[] {
  if (minimumBalanceRaw === undefined) {
    return [];
  }

  return [
    {
      accountIndex: 2,
      kind: {
        type: "accountData" as const,
        dataConstraints: [
          dataU64LeGreaterThanOrEqualTo(
            SPL_TOKEN_ACCOUNT_AMOUNT_OFFSET,
            normalizeU64(minimumBalanceRaw, "minimumDelegatorBalanceRaw")
          ),
        ],
      },
      owner: tokenProgramId,
    },
  ];
}

function recurringDelegationAccountConstraint(
  delegator: PublicKey,
  vault: PublicKey,
  subscriptionAuthority: PublicKey,
  mint: PublicKey,
  maxAmountPerPeriodRaw: U64Amount
) {
  return {
    accountIndex: 0,
    kind: {
      type: "accountData" as const,
      dataConstraints: [
        dataU8Equals(
          BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET),
          SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR
        ),
        dataSliceEquals(
          BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET),
          [...delegator.toBytes()]
        ),
        dataSliceEquals(
          BigInt(SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET),
          [...vault.toBytes()]
        ),
        dataSliceEquals(
          BigInt(SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET),
          [...subscriptionAuthority.toBytes()]
        ),
        dataSliceEquals(BigInt(SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET), [
          ...mint.toBytes(),
        ]),
        dataU64LeLessThanOrEqualTo(
          BigInt(SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET),
          normalizeU64(maxAmountPerPeriodRaw, "maxAmountPerPeriodRaw")
        ),
      ],
    },
    owner: SUBSCRIPTIONS_PROGRAM_ID,
  };
}

function discriminatorConstraint(
  discriminator: readonly number[]
): DataConstraint[] {
  return [dataSliceEquals(BigInt(0), discriminator)];
}

function dataSliceEquals(
  offset: bigint,
  bytes: readonly number[]
): DataConstraint {
  return {
    dataOffset: offset,
    dataValue: { type: "u8Slice", value: [...bytes] },
    operator: "equals",
  };
}

function dataU8Equals(offset: bigint, value: number): DataConstraint {
  return {
    dataOffset: offset,
    dataValue: { type: "u8", value },
    operator: "equals",
  };
}

function dataU16LeLessThanOrEqualTo(
  offset: bigint,
  value: number
): DataConstraint {
  return {
    dataOffset: offset,
    dataValue: { type: "u16Le", value },
    operator: "lessThanOrEqualTo",
  };
}

function dataU64LeGreaterThanOrEqualTo(
  offset: bigint,
  value: bigint
): DataConstraint {
  return {
    dataOffset: offset,
    dataValue: { type: "u64Le", value },
    operator: "greaterThanOrEqualTo",
  };
}

function dataU64LeLessThanOrEqualTo(
  offset: bigint,
  value: bigint
): DataConstraint {
  return {
    dataOffset: offset,
    dataValue: { type: "u64Le", value },
    operator: "lessThanOrEqualTo",
  };
}

export function uniquePubkeys(pubkeys: readonly PublicKey[]): PublicKey[] {
  const seen = new Set<string>();
  const unique: PublicKey[] = [];
  for (const pubkey of pubkeys) {
    const key = pubkey.toBase58();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(pubkey);
  }
  return unique;
}
