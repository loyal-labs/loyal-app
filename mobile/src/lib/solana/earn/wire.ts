import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

// Wire shape of a prepared smart-account operation, as serialized by the
// backend (`prepared-operation-wire.shared.ts`). Mobile hydrates it back into
// web3.js objects to build/sign/send the transaction on-device — no SDK needed.

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
  instructions: TransactionInstruction[];
  lookupTableAccounts: AddressLookupTableAccount[];
  payer: PublicKey;
};

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
