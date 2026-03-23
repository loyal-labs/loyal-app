import { describe, expect, it } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { pda, spec } from "../index";

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

  it("derives transaction buffer PDAs", () => {
    const [bufferPda] = pda.getTransactionBufferPda({
      consensusPda: Keypair.generate().publicKey,
      creator: Keypair.generate().publicKey,
      bufferIndex: 1,
    });

    expect(bufferPda.toBase58()).toBeTruthy();
  });
});
