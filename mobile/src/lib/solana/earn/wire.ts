import type {
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
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
