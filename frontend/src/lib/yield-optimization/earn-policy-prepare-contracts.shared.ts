import type {
  SmartAccountEarnUsdcYieldRoutingPolicyMetadata,
  SmartAccountPreparedEarnUsdcYieldRoutingPolicy,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import {
  hydratePreparedOperation,
  serializePreparedOperation,
  type WirePreparedLoyalSmartAccountsOperation,
} from "@/lib/smart-accounts/prepared-operation-wire.shared";

export type WireSmartAccountPreparedEarnUsdcYieldRoutingPolicy = {
  persistence: SmartAccountEarnUsdcYieldRoutingPolicyMetadata;
  policy: {
    account: string;
    id: string;
    seed: string;
  };
  prepared: WirePreparedLoyalSmartAccountsOperation;
  targetReserve: {
    liquidityMint: string;
    market: string;
    reserve: string;
  };
  vault: {
    accountIndex: 1;
    pubkey: string;
  };
};

export type EarnPolicyPrepareResponse = {
  preparedPolicy: WireSmartAccountPreparedEarnUsdcYieldRoutingPolicy;
};

export function serializePreparedEarnUsdcYieldRoutingPolicy(
  preparedPolicy: SmartAccountPreparedEarnUsdcYieldRoutingPolicy
): WireSmartAccountPreparedEarnUsdcYieldRoutingPolicy {
  return {
    persistence: preparedPolicy.persistence,
    policy: {
      account: preparedPolicy.policy.account.toBase58(),
      id: preparedPolicy.policy.id.toString(),
      seed: preparedPolicy.policy.seed.toString(),
    },
    prepared: serializePreparedOperation(preparedPolicy.prepared),
    targetReserve: {
      liquidityMint: preparedPolicy.targetReserve.liquidityMint.toBase58(),
      market: preparedPolicy.targetReserve.market.toBase58(),
      reserve: preparedPolicy.targetReserve.reserve.toBase58(),
    },
    vault: {
      accountIndex: preparedPolicy.vault.accountIndex,
      pubkey: preparedPolicy.vault.pubkey.toBase58(),
    },
  };
}

export function hydratePreparedEarnUsdcYieldRoutingPolicy(
  wire: WireSmartAccountPreparedEarnUsdcYieldRoutingPolicy
): SmartAccountPreparedEarnUsdcYieldRoutingPolicy {
  return {
    persistence: wire.persistence,
    policy: {
      account: new PublicKey(wire.policy.account),
      id: BigInt(wire.policy.id),
      seed: BigInt(wire.policy.seed),
    },
    prepared: hydratePreparedOperation(wire.prepared),
    targetReserve: {
      liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
      market: new PublicKey(wire.targetReserve.market),
      reserve: new PublicKey(wire.targetReserve.reserve),
    },
    vault: {
      accountIndex: wire.vault.accountIndex,
      pubkey: new PublicKey(wire.vault.pubkey),
    },
  };
}
