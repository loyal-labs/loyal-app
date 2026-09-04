import { describe, expect, it } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { pda, PROGRAM_ID, spec } from "../index";

describe("loyal-smart-accounts-core", () => {
  it("derives the same program config PDA deterministically", () => {
    const [first, firstBump] = pda.getProgramConfigPda({});
    const [second, secondBump] = pda.getProgramConfigPda({});

    expect(first.toBase58()).toBe(second.toBase58());
    expect(firstBump).toBe(secondBump);
  });

  it("exposes the canonical operation registry coverage helpers", () => {
    expect(spec.getOperationsForFeature("execution").length).toBeGreaterThan(0);
    expect(spec.findOperationCoverageIssues()).toEqual({
      missingMappings: [],
      duplicateExports: [],
    });
  });

  it("derives transaction buffer PDAs from the canonical seed tuple", () => {
    const consensusPda = Keypair.generate().publicKey;
    const creator = Keypair.generate().publicKey;
    const bufferIndex = 1;

    const [bufferPda, bump] = pda.getTransactionBufferPda({
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

    expect(bufferPda.toBase58()).toBe(manualPda.toBase58());
    expect(bump).toBe(manualBump);
  });
});
