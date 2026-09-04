import { describe, expect, test } from "bun:test";
import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import {
  hydratePreparedOperation,
  serializePreparedOperation,
} from "./prepared-operation-wire.shared";

const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const settingsPda = new PublicKey("11111111111111111111111111111112");
const payer = new PublicKey("11111111111111111111111111111113");
const recipient = new PublicKey("11111111111111111111111111111114");

describe("prepared operation wire format", () => {
  test("preserves simulation diagnostics metadata", () => {
    const prepared: PreparedLoyalSmartAccountsOperation<string> = {
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer,
          lamports: 1,
          toPubkey: recipient,
        }),
      ],
      lookupTableAccounts: [],
      operation: "testOperation",
      payer,
      programId,
      requiresConfirmation: true,
      simulationDiagnostics: {
        includedPolicyAccounts: [recipient.toBase58()],
        kind: "earnPolicyCreateMissingAccount",
        policyAccount: recipient.toBase58(),
        policySeed: "3",
        policyStage: "setup",
        programId: programId.toBase58(),
        settingsPda: settingsPda.toBase58(),
      },
    };

    const hydrated = hydratePreparedOperation(
      serializePreparedOperation(prepared)
    );

    expect(hydrated.simulationDiagnostics).toEqual(
      prepared.simulationDiagnostics
    );
  });
});
