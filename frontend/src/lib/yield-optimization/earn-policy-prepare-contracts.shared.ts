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
  finalizePrepared?: WirePreparedLoyalSmartAccountsOperation;
  persistence: SmartAccountEarnUsdcYieldRoutingPolicyMetadata;
  policy: {
    account: string;
    id: string;
    seed: string;
  };
  setupPolicy: {
    account: string;
    id: string;
    initObligationInstructionConstraintIndex: 0;
    seed: string;
  };
  prepared: WirePreparedLoyalSmartAccountsOperation;
  targetReserve: {
    liquidityMint: string;
    market: string;
    obligation: string;
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
    finalizePrepared: preparedPolicy.finalizePrepared
      ? serializePreparedOperation(preparedPolicy.finalizePrepared)
      : undefined,
    persistence: preparedPolicy.persistence,
    policy: {
      account: preparedPolicy.policy.account.toBase58(),
      id: preparedPolicy.policy.id.toString(),
      seed: preparedPolicy.policy.seed.toString(),
    },
    setupPolicy: {
      account: preparedPolicy.setupPolicy.account.toBase58(),
      id: preparedPolicy.setupPolicy.id.toString(),
      initObligationInstructionConstraintIndex:
        preparedPolicy.setupPolicy.initObligationInstructionConstraintIndex,
      seed: preparedPolicy.setupPolicy.seed.toString(),
    },
    prepared: serializePreparedOperation(preparedPolicy.prepared),
    targetReserve: {
      liquidityMint: preparedPolicy.targetReserve.liquidityMint.toBase58(),
      market: preparedPolicy.targetReserve.market.toBase58(),
      obligation: preparedPolicy.targetReserve.obligation.toBase58(),
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
    finalizePrepared: wire.finalizePrepared
      ? hydratePreparedOperation(wire.finalizePrepared)
      : undefined,
    persistence: wire.persistence,
    policy: {
      account: new PublicKey(wire.policy.account),
      id: BigInt(wire.policy.id),
      seed: BigInt(wire.policy.seed),
    },
    setupPolicy: {
      account: new PublicKey(wire.setupPolicy.account),
      id: BigInt(wire.setupPolicy.id),
      initObligationInstructionConstraintIndex:
        wire.setupPolicy.initObligationInstructionConstraintIndex,
      seed: BigInt(wire.setupPolicy.seed),
    },
    prepared: hydratePreparedOperation(wire.prepared),
    targetReserve: {
      liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
      market: new PublicKey(wire.targetReserve.market),
      obligation: new PublicKey(wire.targetReserve.obligation),
      reserve: new PublicKey(wire.targetReserve.reserve),
    },
    vault: {
      accountIndex: wire.vault.accountIndex,
      pubkey: new PublicKey(wire.vault.pubkey),
    },
  };
}
