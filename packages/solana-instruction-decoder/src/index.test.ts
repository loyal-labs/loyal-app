import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, test } from "bun:test";
import { Buffer } from "buffer";

import { decodeSolanaInstruction, decodeSolanaTransaction } from "./index";

const SMART_ACCOUNT_PROGRAM_ID = "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG";

describe("solana instruction decoder", () => {
  test("decodes legacy system transfer transactions", () => {
    const from = PublicKey.unique();
    const to = PublicKey.unique();
    const transaction = new Transaction({
      feePayer: from,
      recentBlockhash: PublicKey.unique().toBase58(),
    }).add(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports: 1_500_000_000,
      })
    );

    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    const decoded = decodeSolanaTransaction(serialized);

    expect(decoded.error).toBeNull();
    expect(decoded.instructions).toHaveLength(1);
    expect(decoded.instructions[0]?.title).toBe("Transfer SOL");
    expect(decoded.instructions[0]?.description).toContain("1.5 SOL");
  });

  test("names smart account approval instructions", () => {
    const decoded = decodeSolanaInstruction({
      programId: SMART_ACCOUNT_PROGRAM_ID,
      data: Buffer.from([136, 108, 102, 85, 98, 114, 7, 147, 0]),
      keys: [
        { pubkey: PublicKey.unique() },
        { pubkey: PublicKey.unique(), isSigner: true },
        { pubkey: PublicKey.unique(), isWritable: true },
      ],
    });

    expect(decoded.title).toBe("Approve smart account proposal");
    expect(decoded.instructionName).toBe("ApproveProposal");
    expect(decoded.accounts[1]?.label).toBe("Signer");
  });
});
