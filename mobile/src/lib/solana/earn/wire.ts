import type {
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
} from "@loyal-labs/smart-account-vaults";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

// Wire shape of a prepared smart-account operation, as serialized by the
// backend (`prepared-operation-wire.shared.ts`). Mobile hydrates server-prepared
// operations back into web3.js objects, and serializes device-prepared
// autodeposit operations into the same shape so the confirm endpoints can
// rebuild the canonical payload from the echoed object.

export type WirePreparedInstruction = {
  dataBase64: string;
  keys: { isSigner: boolean; isWritable: boolean; pubkey: string }[];
  programId: string;
};

export type WireAddressLookupTableAccount = {
  key: string;
  state: {
    addresses: string[];
    authority: string | null;
    deactivationSlot: string;
    lastExtendedSlot: number;
    lastExtendedSlotStartIndex: number;
  };
};

export type WirePreparedOperation = {
  instructions: WirePreparedInstruction[];
  lookupTableAccounts: WireAddressLookupTableAccount[];
  operation: string;
  payer: string;
  programId: string;
  requiresConfirmation: boolean;
};

export type HydratedPreparedOperation = {
  instructions: readonly TransactionInstruction[];
  lookupTableAccounts: readonly AddressLookupTableAccount[];
  payer: PublicKey;
};

// The SDK-prepared operation fields the wire format carries. Structural so
// `PreparedLoyalSmartAccountsOperation` values pass without importing that type.
export type SerializablePreparedOperation = {
  instructions: readonly TransactionInstruction[];
  lookupTableAccounts: readonly AddressLookupTableAccount[];
  operation: string;
  payer: PublicKey;
  programId: PublicKey;
  requiresConfirmation: boolean;
};

// Mirror of the backend `serializePreparedOperation`
// (`prepared-operation-wire.shared.ts`) — keep the shapes in sync.
export function serializePreparedOperation(
  prepared: SerializablePreparedOperation,
): WirePreparedOperation {
  return {
    instructions: prepared.instructions.map((instruction) => ({
      dataBase64: Buffer.from(instruction.data).toString("base64"),
      keys: instruction.keys.map((key) => ({
        isSigner: key.isSigner,
        isWritable: key.isWritable,
        pubkey: key.pubkey.toBase58(),
      })),
      programId: instruction.programId.toBase58(),
    })),
    lookupTableAccounts: prepared.lookupTableAccounts.map((account) => ({
      key: account.key.toBase58(),
      state: {
        addresses: account.state.addresses.map((address) => address.toBase58()),
        authority: account.state.authority?.toBase58() ?? null,
        deactivationSlot: account.state.deactivationSlot.toString(),
        lastExtendedSlot: account.state.lastExtendedSlot,
        lastExtendedSlotStartIndex: account.state.lastExtendedSlotStartIndex,
      },
    })),
    operation: prepared.operation,
    payer: prepared.payer.toBase58(),
    programId: prepared.programId.toBase58(),
    requiresConfirmation: prepared.requiresConfirmation,
  };
}

// Wire form of a device-prepared autodeposit setup stage, matching the backend
// `serializePreparedEarnUsdcAutodepositSetup` (`earn-autodeposit-prepare-
// contracts.shared.ts`) — `setup/confirm` hydrates this exact shape.
export function serializePreparedEarnAutodepositSetup(
  setup: SmartAccountPreparedEarnUsdcAutodepositSetup,
) {
  return {
    authorityInitializationRequired: setup.authorityInitializationRequired,
    nativeSolRequirement: setup.nativeSolRequirement,
    persistence: setup.persistence,
    policy: {
      account: setup.policy.account?.toBase58() ?? null,
      id: setup.policy.id?.toString() ?? null,
      seed: setup.policy.seed?.toString() ?? null,
    },
    prepared: serializePreparedOperation(setup.prepared),
    stage: setup.stage,
    subscription: {
      amountPerPeriodRaw: setup.subscription.amountPerPeriodRaw.toString(),
      authority: setup.subscription.authority.toBase58(),
      expiryTimestamp: setup.subscription.expiryTimestamp.toString(),
      nonce: setup.subscription.nonce.toString(),
      periodLengthSeconds: setup.subscription.periodLengthSeconds.toString(),
      recurringDelegation: setup.subscription.recurringDelegation.toBase58(),
      startTimestamp: setup.subscription.startTimestamp.toString(),
    },
    vault: {
      accountIndex: setup.vault.accountIndex,
      pubkey: setup.vault.pubkey.toBase58(),
      usdcAta: setup.vault.usdcAta.toBase58(),
    },
  };
}

// Wire form of a device-prepared Earn deposit, matching the backend
// `serializePreparedEarnUsdcDeposit` (`earn-deposit-prepare-contracts.shared.ts`)
// — `deposit/confirm` hydrates this exact shape.
export function serializePreparedEarnUsdcDeposit(
  deposit: SmartAccountPreparedEarnUsdcDeposit,
) {
  return {
    kaminoSetupAccountCount: deposit.kaminoSetupAccountCount,
    kaminoSetupRentLamports: deposit.kaminoSetupRentLamports,
    kaminoSetupRequired: deposit.kaminoSetupRequired,
    nativeSolRequirement: deposit.nativeSolRequirement,
    persistence: deposit.persistence,
    policyFinalizePrepared: deposit.policyFinalizePrepared
      ? serializePreparedOperation(deposit.policyFinalizePrepared)
      : null,
    policy: {
      account: deposit.policy.account.toBase58(),
      id: deposit.policy.id.toString(),
      sameMintInstructionConstraintIndexes:
        deposit.policy.sameMintInstructionConstraintIndexes,
      seed: deposit.policy.seed.toString(),
    },
    ...(deposit.setupPolicy
      ? {
          setupPolicy: {
            account: deposit.setupPolicy.account.toBase58(),
            id: deposit.setupPolicy.id.toString(),
            initObligationInstructionConstraintIndex:
              deposit.setupPolicy.initObligationInstructionConstraintIndex,
            seed: deposit.setupPolicy.seed.toString(),
          },
        }
      : {}),
    policySetupPrepared: deposit.policySetupPrepared
      ? serializePreparedOperation(deposit.policySetupPrepared)
      : null,
    prepared: serializePreparedOperation(deposit.prepared),
    targetReserve: {
      liquidityMint: deposit.targetReserve.liquidityMint.toBase58(),
      liquidityTokenProgram:
        deposit.targetReserve.liquidityTokenProgram.toBase58(),
      market: deposit.targetReserve.market.toBase58(),
      obligation: deposit.targetReserve.obligation.toBase58(),
      reserve: deposit.targetReserve.reserve.toBase58(),
      supplyApyBps: deposit.targetReserve.supplyApyBps?.toString() ?? null,
    },
    vault: {
      accountIndex: deposit.vault.accountIndex,
      collateralAta: deposit.vault.collateralAta?.toBase58() ?? null,
      pubkey: deposit.vault.pubkey.toBase58(),
      usdcAta: deposit.vault.usdcAta.toBase58(),
    },
  };
}

// Wire form of a device-prepared autodeposit close, matching the backend
// `serializePreparedEarnUsdcAutodepositClose` — `close/confirm` hydrates it.
export function serializePreparedEarnAutodepositClose(
  close: SmartAccountPreparedEarnUsdcAutodepositClose,
) {
  return {
    persistence: close.persistence,
    policy: {
      account: close.policy.account.toBase58(),
    },
    prepared: serializePreparedOperation(close.prepared),
    subscription: {
      recurringDelegation: close.subscription.recurringDelegation.toBase58(),
    },
    vault: {
      accountIndex: close.vault.accountIndex,
      pubkey: close.vault.pubkey.toBase58(),
    },
  };
}

export function hydratePreparedOperation(
  wire: WirePreparedOperation,
): HydratedPreparedOperation {
  return {
    instructions: wire.instructions.map(
      (instruction) =>
        new TransactionInstruction({
          data: Buffer.from(instruction.dataBase64, "base64"),
          keys: instruction.keys.map((key) => ({
            isSigner: key.isSigner,
            isWritable: key.isWritable,
            pubkey: new PublicKey(key.pubkey),
          })),
          programId: new PublicKey(instruction.programId),
        }),
    ),
    lookupTableAccounts: wire.lookupTableAccounts.map(
      (account) =>
        new AddressLookupTableAccount({
          key: new PublicKey(account.key),
          state: {
            addresses: account.state.addresses.map(
              (address) => new PublicKey(address),
            ),
            authority: account.state.authority
              ? new PublicKey(account.state.authority)
              : undefined,
            deactivationSlot: BigInt(account.state.deactivationSlot),
            lastExtendedSlot: account.state.lastExtendedSlot,
            lastExtendedSlotStartIndex:
              account.state.lastExtendedSlotStartIndex,
          },
        }),
    ),
    payer: new PublicKey(wire.payer),
  };
}

// Wire form of a device-prepared Earn withdrawal, matching the backend
// `serializePreparedEarnUsdcWithdraw` (`earn-withdraw-prepare-contracts.shared.ts`)
// — `withdraw/confirm` hydrates this exact shape.
export function serializePreparedEarnUsdcWithdraw(
  withdraw: SmartAccountPreparedEarnUsdcWithdraw,
) {
  return {
    amountRaw: withdraw.amountRaw.toString(),
    autodepositClosePrepared: withdraw.autodepositClosePrepared
      ? serializePreparedEarnAutodepositClose(withdraw.autodepositClosePrepared)
      : null,
    mode: withdraw.mode,
    persistence: withdraw.persistence,
    policy: {
      account: withdraw.policy.account.toBase58(),
      id: withdraw.policy.id.toString(),
      sameMintInstructionConstraintIndexes:
        withdraw.policy.sameMintInstructionConstraintIndexes,
      seed: withdraw.policy.seed.toString(),
      withdrawInstructionConstraintIndex:
        withdraw.policy.withdrawInstructionConstraintIndex,
    },
    ...(withdraw.setupPolicy
      ? {
          setupPolicy: {
            account: withdraw.setupPolicy.account.toBase58(),
            id: withdraw.setupPolicy.id.toString(),
            seed: withdraw.setupPolicy.seed.toString(),
          },
        }
      : {}),
    prepared: serializePreparedOperation(withdraw.prepared),
    withdrawSteps: withdraw.withdrawSteps.map((step) => ({
      // Reserve/collateral step fields are null for idle-only withdrawals
      // (vault stablecoin balance with no Kamino position).
      accountingReserve: step.accountingReserve
        ? {
            liquidityMint: step.accountingReserve.liquidityMint.toBase58(),
            market: step.accountingReserve.market.toBase58(),
            obligation: step.accountingReserve.obligation.toBase58(),
            reserve: step.accountingReserve.reserve.toBase58(),
          }
        : null,
      amountRaw: step.amountRaw.toString(),
      collateralAta: step.collateralAta?.toBase58() ?? null,
      executionReserve: step.executionReserve
        ? {
            liquidityMint: step.executionReserve.liquidityMint.toBase58(),
            market: step.executionReserve.market.toBase58(),
            reserve: step.executionReserve.reserve.toBase58(),
          }
        : null,
      mode: step.mode,
      persistence: step.persistence,
      prepared: serializePreparedOperation(step.prepared),
      reserveWithdrawals: step.reserveWithdrawals,
      stepCount: step.stepCount,
      stepIndex: step.stepIndex,
    })),
    targetReserve: withdraw.targetReserve
      ? {
          liquidityMint: withdraw.targetReserve.liquidityMint.toBase58(),
          liquidityTokenProgram:
            withdraw.targetReserve.liquidityTokenProgram.toBase58(),
          market: withdraw.targetReserve.market.toBase58(),
          obligation: withdraw.targetReserve.obligation.toBase58(),
          reserve: withdraw.targetReserve.reserve.toBase58(),
        }
      : null,
    vault: {
      accountIndex: withdraw.vault.accountIndex,
      collateralAta: withdraw.vault.collateralAta?.toBase58() ?? null,
      pubkey: withdraw.vault.pubkey.toBase58(),
      usdcAta: withdraw.vault.usdcAta.toBase58(),
    },
  };
}
