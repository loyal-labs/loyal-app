import type {
  SmartAccountEarnCrossMintSwapPolicyMetadata,
  SmartAccountPreparedEarnCrossMintSwapPolicies,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import {
  hydratePreparedOperation,
  serializePreparedOperation,
  type WirePreparedLoyalSmartAccountsOperation,
} from "@/lib/smart-accounts/prepared-operation-wire.shared";

export const DEFAULT_AUTOSWAP_MAX_SLIPPAGE_BPS = 50;
export const DEFAULT_AUTOSWAP_DAILY_CAP_RAW = BigInt(100_000_000);
export const MIN_AUTOSWAP_DAILY_CAP_RAW = BigInt(1_000_000);
export const MAX_AUTOSWAP_DAILY_CAP_RAW = BigInt(1_000_000_000);

export type WireEarnCrossMintSwapPolicy = {
  prepared?: WirePreparedLoyalSmartAccountsOperation;
  existing: boolean;
  policy: {
    account: string;
    id: string;
    seed: string;
  };
  sourceShard: "classic" | "token_2022";
  persistence: SmartAccountEarnCrossMintSwapPolicyMetadata;
};

export type WirePreparedEarnCrossMintSwapPolicies = {
  policies: readonly [WireEarnCrossMintSwapPolicy, WireEarnCrossMintSwapPolicy];
  vault: {
    accountIndex: 1;
    pubkey: string;
  };
  maxSlippageBps: number;
  dailySourceMintSpendingCap: string;
};

export type EarnCrossMintPolicyPrepareResponse = {
  preparedPolicies: WirePreparedEarnCrossMintSwapPolicies;
};

export type EarnCrossMintDeletePrepareResponse = {
  expectedGeneration: string;
  prepared?: WirePreparedLoyalSmartAccountsOperation;
  policies: readonly [string, string];
  status: "off" | "prepared";
};

export type EarnCrossMintToggleRequest = {
  enabled: boolean;
  expectedGeneration: string;
};

export type EarnCrossMintToggleResponse = {
  enabled: boolean;
  generation: string;
  status: "on" | "paused";
};

export type EarnCrossMintPolicyConfirmRequest = {
  policies: readonly [
    {
      account: string;
      seed: string;
      sourceShard: "classic" | "token_2022";
      signature?: string;
      finalizedSlot?: string;
    },
    {
      account: string;
      seed: string;
      sourceShard: "classic" | "token_2022";
      signature?: string;
      finalizedSlot?: string;
    }
  ];
  maxSlippageBps: number;
  dailySourceMintSpendingCap: string;
};

export function serializePreparedEarnCrossMintSwapPolicies(
  prepared: SmartAccountPreparedEarnCrossMintSwapPolicies
): WirePreparedEarnCrossMintSwapPolicies {
  const serializePolicy = (
    policy: SmartAccountPreparedEarnCrossMintSwapPolicies["policies"][number]
  ): WireEarnCrossMintSwapPolicy => ({
    prepared: policy.prepared
      ? serializePreparedOperation(policy.prepared)
      : undefined,
    existing: policy.existing,
    policy: {
      account: policy.policy.account.toBase58(),
      id: policy.policy.id.toString(),
      seed: policy.policy.seed.toString(),
    },
    sourceShard: policy.sourceShard,
    persistence: policy.persistence,
  });
  return {
    policies: [
      serializePolicy(prepared.policies[0]),
      serializePolicy(prepared.policies[1]),
    ],
    vault: {
      accountIndex: prepared.vault.accountIndex,
      pubkey: prepared.vault.pubkey.toBase58(),
    },
    maxSlippageBps: prepared.maxSlippageBps,
    dailySourceMintSpendingCap: prepared.dailySourceMintSpendingCap.toString(),
  };
}

export function hydratePreparedEarnCrossMintSwapPolicies(
  wire: WirePreparedEarnCrossMintSwapPolicies
): SmartAccountPreparedEarnCrossMintSwapPolicies {
  const hydratePolicy = (policy: WireEarnCrossMintSwapPolicy) => ({
    prepared: policy.prepared
      ? hydratePreparedOperation(policy.prepared)
      : undefined,
    existing: policy.existing,
    policy: {
      account: new PublicKey(policy.policy.account),
      id: BigInt(policy.policy.id),
      seed: BigInt(policy.policy.seed),
    },
    sourceShard: policy.sourceShard,
    persistence: policy.persistence,
  });
  return {
    policies: [
      hydratePolicy(wire.policies[0]),
      hydratePolicy(wire.policies[1]),
    ],
    vault: {
      accountIndex: wire.vault.accountIndex,
      pubkey: new PublicKey(wire.vault.pubkey),
    },
    maxSlippageBps: wire.maxSlippageBps,
    dailySourceMintSpendingCap: BigInt(wire.dailySourceMintSpendingCap),
  };
}

export function parseEarnCrossMintRiskInput(value: unknown): {
  maxSlippageBps: number;
  dailySourceMintSpendingCap: bigint;
} {
  if (!value || typeof value !== "object") {
    throw new Error("Autoswap settings are required.");
  }
  const input = value as Record<string, unknown>;
  const maxSlippageBps = input.maxSlippageBps;
  if (
    typeof maxSlippageBps !== "number" ||
    !Number.isInteger(maxSlippageBps) ||
    maxSlippageBps !== DEFAULT_AUTOSWAP_MAX_SLIPPAGE_BPS
  ) {
    throw new Error("Autoswap currently supports exactly 0.5% max slippage.");
  }
  if (typeof input.dailySourceMintSpendingCap !== "string") {
    throw new Error("dailySourceMintSpendingCap must be a base-unit string.");
  }
  const dailySourceMintSpendingCap = BigInt(input.dailySourceMintSpendingCap);
  if (
    dailySourceMintSpendingCap < MIN_AUTOSWAP_DAILY_CAP_RAW ||
    dailySourceMintSpendingCap > MAX_AUTOSWAP_DAILY_CAP_RAW
  ) {
    throw new Error(
      "Daily Autoswap cap must be between $1 and $1,000 per stablecoin."
    );
  }
  return { maxSlippageBps, dailySourceMintSpendingCap };
}
