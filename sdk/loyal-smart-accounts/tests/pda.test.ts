import { describe, expect, it } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, pda } from "../index";
import { PDA_REGISTRY } from "../../loyal-smart-accounts-core/src/spec";

describe("pda helpers", () => {
  it("derives the program config PDA deterministically", () => {
    const [first, firstBump] = pda.getProgramConfigPda({});
    const [second, secondBump] = pda.getProgramConfigPda({});

    expect(first.toBase58()).toBe(second.toBase58());
    expect(firstBump).toBe(secondBump);
  });

  it("derives the transaction buffer PDA from consensus, creator, and buffer index", () => {
    const consensusPda = Keypair.generate().publicKey;
    const creator = Keypair.generate().publicKey;
    const bufferIndex = 7;

    const [derivedPda, derivedBump] = pda.getTransactionBufferPda({
      consensusPda,
      creator,
      bufferIndex,
    });
    const [manualPda, manualBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("smart_account"),
        consensusPda.toBytes(),
        Buffer.from("transaction_buffer"),
        creator.toBytes(),
        Uint8Array.from([bufferIndex]),
      ],
      PROGRAM_ID
    );

    expect(derivedPda.toBase58()).toBe(manualPda.toBase58());
    expect(derivedBump).toBe(manualBump);
  });

  it("keeps named helpers aligned with the registry surface", () => {
    expect(Object.keys(PDA_REGISTRY).sort()).toEqual([
      "batchTransaction",
      "ephemeralSigner",
      "policy",
      "programConfig",
      "settings",
      "smartAccount",
      "spendingLimit",
      "transaction",
      "transactionBuffer",
      "proposal",
    ].sort());

    expect(typeof pda.getProgramConfigPda).toBe("function");
    expect(typeof pda.getSettingsPda).toBe("function");
    expect(typeof pda.getSmartAccountPda).toBe("function");
    expect(typeof pda.getTransactionPda).toBe("function");
    expect(typeof pda.getProposalPda).toBe("function");
    expect(typeof pda.getBatchTransactionPda).toBe("function");
    expect(typeof pda.getEphemeralSignerPda).toBe("function");
    expect(typeof pda.getSpendingLimitPda).toBe("function");
    expect(typeof pda.getTransactionBufferPda).toBe("function");
    expect(typeof pda.getPolicyPda).toBe("function");
  });
});
