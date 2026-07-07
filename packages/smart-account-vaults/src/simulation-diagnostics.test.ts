import { describe, expect, mock, test } from "bun:test";
import {
  generated,
  pda,
  type PreparedLoyalSmartAccountsOperation,
} from "@loyal-labs/loyal-smart-accounts-core";
import type { Connection, VersionedTransaction } from "@solana/web3.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

import { getPreparedSimulationDiagnosticError } from "./simulation-diagnostics";

const programId = new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG");
const settingsPda = new PublicKey("11111111111111111111111111111112");
const feePayer = new PublicKey("11111111111111111111111111111113");
const recipient = new PublicKey("11111111111111111111111111111114");

function createSettingsAccount(policySeed: BN | null) {
  const [data] = generated.Settings.fromArgs({
    accountUtilization: 0,
    archivalAuthority: null,
    archivableAfter: new BN(0),
    bump: 255,
    policySeed,
    reserved2: 0,
    seed: new BN(0),
    settingsAuthority: feePayer,
    signers: [],
    staleTransactionIndex: new BN(0),
    threshold: 1,
    timeLock: 0,
    transactionIndex: new BN(0),
  }).serialize();

  return {
    data,
    executable: false,
    lamports: 1,
    owner: programId,
    rentEpoch: 0,
  };
}

function createPrepared(
  simulationDiagnostics: PreparedLoyalSmartAccountsOperation<string>["simulationDiagnostics"]
): PreparedLoyalSmartAccountsOperation<string> {
  return {
    instructions: [
      SystemProgram.transfer({
        fromPubkey: feePayer,
        lamports: 1,
        toPubkey: recipient,
      }),
    ],
    lookupTableAccounts: [],
    operation: "testOperation",
    payer: feePayer,
    programId,
    requiresConfirmation: true,
    ...(simulationDiagnostics ? { simulationDiagnostics } : {}),
  };
}

describe("prepared simulation diagnostics", () => {
  test("identifies the missing policy PDA for a stale Earn setup PolicyCreate", async () => {
    const expectedPolicyPda = pda.getPolicyPda({
      policySeed: 2,
      programId,
      settingsPda,
    })[0];
    const includedPolicyPda = pda.getPolicyPda({
      policySeed: 3,
      programId,
      settingsPda,
    })[0];
    const getAccountInfo = mock(async () => createSettingsAccount(new BN(1)));
    const connection = {
      getAccountInfo,
    } as unknown as Connection;

    const diagnostic = await getPreparedSimulationDiagnosticError({
      connection,
      logs: [
        `Program ${programId.toBase58()} failed: custom program error: 0x1788`,
      ],
      originalError: new Error("wallet rejected"),
      prepared: createPrepared({
        includedPolicyAccounts: [includedPolicyPda.toBase58()],
        kind: "earnPolicyCreateMissingAccount",
        policyAccount: includedPolicyPda.toBase58(),
        policySeed: "3",
        policyStage: "setup",
        programId: programId.toBase58(),
        settingsPda: settingsPda.toBase58(),
      }),
      simulationErr: { InstructionError: [0, { Custom: 0x1788 }] },
      transaction: {} as VersionedTransaction,
      translatedError: Object.assign(new Error("MissingAccount"), {
        name: "MissingAccount",
      }),
    });

    expect(diagnostic).toBeInstanceOf(Error);
    expect(diagnostic?.message).toContain(
      `Missing policy account ${expectedPolicyPda.toBase58()} for expected next policy seed 2`
    );
    expect(diagnostic?.message).toContain(
      `includes policy account(s): ${includedPolicyPda.toBase58()}`
    );
    expect(getAccountInfo).toHaveBeenCalledWith(settingsPda, "confirmed");
  });
});
