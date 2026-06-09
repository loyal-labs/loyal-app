import { describe, expect, test } from "bun:test";
import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  hydratePreparedOperation,
  serializePreparedOperation,
} from "../prepared-operation-wire.shared";

describe("prepared operation wire serialization", () => {
  test("round-trips instructions and lookup table accounts", () => {
    const payer = new PublicKey("11111111111111111111111111111112");
    const programId = new PublicKey("11111111111111111111111111111113");
    const signer = new PublicKey("11111111111111111111111111111114");
    const writable = new PublicKey("11111111111111111111111111111115");
    const readonly = new PublicKey("11111111111111111111111111111116");
    const lookupTable = new AddressLookupTableAccount({
      key: new PublicKey("11111111111111111111111111111117"),
      state: {
        addresses: [signer, writable, readonly],
        authority: new PublicKey("11111111111111111111111111111118"),
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: 42,
        lastExtendedSlotStartIndex: 7,
      },
    });
    const prepared: PreparedLoyalSmartAccountsOperation<"testOperation"> = {
      instructions: [
        new TransactionInstruction({
          data: Buffer.from([0, 1, 2, 253, 254, 255]),
          keys: [
            { isSigner: true, isWritable: true, pubkey: signer },
            { isSigner: false, isWritable: true, pubkey: writable },
            { isSigner: false, isWritable: false, pubkey: readonly },
          ],
          programId,
        }),
      ],
      lookupTableAccounts: [lookupTable],
      operation: "testOperation",
      payer,
      programId,
      requiresConfirmation: true,
    };

    const hydrated = hydratePreparedOperation(
      serializePreparedOperation(prepared)
    );

    expect(hydrated.operation).toBe(prepared.operation);
    expect(hydrated.payer.toBase58()).toBe(payer.toBase58());
    expect(hydrated.programId.toBase58()).toBe(programId.toBase58());
    expect(hydrated.requiresConfirmation).toBe(true);
    expect([...hydrated.instructions[0].data]).toEqual([
      0, 1, 2, 253, 254, 255,
    ]);
    expect(hydrated.instructions[0].programId.toBase58()).toBe(
      programId.toBase58()
    );
    expect(
      hydrated.instructions[0].keys.map((key) => ({
        isSigner: key.isSigner,
        isWritable: key.isWritable,
        pubkey: key.pubkey.toBase58(),
      }))
    ).toEqual([
      { isSigner: true, isWritable: true, pubkey: signer.toBase58() },
      { isSigner: false, isWritable: true, pubkey: writable.toBase58() },
      { isSigner: false, isWritable: false, pubkey: readonly.toBase58() },
    ]);
    expect(hydrated.lookupTableAccounts[0].key.toBase58()).toBe(
      lookupTable.key.toBase58()
    );
    expect(
      hydrated.lookupTableAccounts[0].state.addresses.map((address) =>
        address.toBase58()
      )
    ).toEqual([signer.toBase58(), writable.toBase58(), readonly.toBase58()]);
    expect(
      hydrated.lookupTableAccounts[0].state.authority?.toBase58()
    ).toBe(lookupTable.state.authority?.toBase58());
    expect(
      hydrated.lookupTableAccounts[0].state.deactivationSlot
    ).toBe(lookupTable.state.deactivationSlot);
    expect(hydrated.lookupTableAccounts[0].state.lastExtendedSlot).toBe(42);
    expect(
      hydrated.lookupTableAccounts[0].state.lastExtendedSlotStartIndex
    ).toBe(7);
  });
});
