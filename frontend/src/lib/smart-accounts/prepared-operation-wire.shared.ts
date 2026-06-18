import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

export type WirePreparedInstruction = {
  dataBase64: string;
  keys: {
    isSigner: boolean;
    isWritable: boolean;
    pubkey: string;
  }[];
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

export type WirePreparedLoyalSmartAccountsOperation = {
  instructions: WirePreparedInstruction[];
  lookupTableAccounts: WireAddressLookupTableAccount[];
  operation: string;
  payer: string;
  programId: string;
  requiresConfirmation: boolean;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function serializePreparedOperation(
  prepared: PreparedLoyalSmartAccountsOperation<string>
): WirePreparedLoyalSmartAccountsOperation {
  return {
    instructions: prepared.instructions.map((instruction) => ({
      dataBase64: bytesToBase64(instruction.data),
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

export function hydratePreparedOperation(
  wire: WirePreparedLoyalSmartAccountsOperation
): PreparedLoyalSmartAccountsOperation<string> {
  return {
    instructions: wire.instructions.map(
      (instruction) =>
        new TransactionInstruction({
          data: Buffer.from(base64ToBytes(instruction.dataBase64)),
          keys: instruction.keys.map((key) => ({
            isSigner: key.isSigner,
            isWritable: key.isWritable,
            pubkey: new PublicKey(key.pubkey),
          })),
          programId: new PublicKey(instruction.programId),
        })
    ),
    lookupTableAccounts: wire.lookupTableAccounts.map(
      (account) =>
        new AddressLookupTableAccount({
          key: new PublicKey(account.key),
          state: {
            addresses: account.state.addresses.map(
              (address) => new PublicKey(address)
            ),
            authority: account.state.authority
              ? new PublicKey(account.state.authority)
              : undefined,
            deactivationSlot: BigInt(account.state.deactivationSlot),
            lastExtendedSlot: account.state.lastExtendedSlot,
            lastExtendedSlotStartIndex:
              account.state.lastExtendedSlotStartIndex,
          },
        })
    ),
    operation: wire.operation,
    payer: new PublicKey(wire.payer),
    programId: new PublicKey(wire.programId),
    requiresConfirmation: wire.requiresConfirmation,
  };
}
