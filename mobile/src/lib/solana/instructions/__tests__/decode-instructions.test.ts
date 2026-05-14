import {
  Keypair,
  LAMPORTS_PER_SOL,
  MessageV0,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

import {
  decodeMessageBase64,
  decodeMessageBytes,
  decodeTransactionBase64,
  decodeTransactionInstructions,
} from "../decode-instructions";
import { programDisplayName, truncateAddress } from "../known-programs";

const DUMMY_BLOCKHASH = "11111111111111111111111111111112";

function buildLegacyTransferTx(fromPk: PublicKey, toPk: PublicKey, sol: number) {
  const tx = new Transaction({
    feePayer: fromPk,
    recentBlockhash: DUMMY_BLOCKHASH,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: fromPk,
      toPubkey: toPk,
      lamports: sol * LAMPORTS_PER_SOL,
    }),
  );
  return tx;
}

function toBase64(tx: Transaction | VersionedTransaction): string {
  const bytes =
    tx instanceof VersionedTransaction
      ? tx.serialize()
      : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return Buffer.from(bytes).toString("base64");
}

describe("truncateAddress", () => {
  it("returns short addresses unchanged", () => {
    expect(truncateAddress("short")).toBe("short");
  });

  it("truncates long addresses to first4…last4", () => {
    const full = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
    expect(truncateAddress(full)).toBe("ABCD…7890");
  });
});

describe("programDisplayName", () => {
  it("returns friendly name for known programs", () => {
    expect(programDisplayName("11111111111111111111111111111111")).toBe(
      "System Program",
    );
    expect(
      programDisplayName("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
    ).toBe("Jupiter v6");
  });

  it("returns truncated address for unknown programs", () => {
    const unknown = "8pw4skSNbcz46XYm47zzDJXEpcyoUg6a28e27YECRfnp";
    expect(programDisplayName(unknown)).toBe("8pw4…Rfnp");
  });
});

describe("decodeTransactionInstructions", () => {
  const from = Keypair.generate();
  const to = Keypair.generate();

  it("describes legacy System transfer with human-readable SOL amount", () => {
    const tx = buildLegacyTransferTx(from.publicKey, to.publicKey, 1.5);
    const result = decodeTransactionInstructions(tx);
    expect(result).toHaveLength(1);
    expect(result[0].program).toBe("System Program");
    expect(result[0].description).toMatch(/^Transfer 1\.5 SOL to /);
    expect(result[0].description).toContain(to.publicKey.toBase58().slice(0, 4));
  });

  it("labels Token Program instructions by known program name", () => {
    const tokenProgramId = new PublicKey(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );
    const tx = new Transaction({
      feePayer: from.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
    });
    tx.add(
      new TransactionInstruction({
        programId: tokenProgramId,
        keys: [{ pubkey: to.publicKey, isSigner: false, isWritable: true }],
        data: Buffer.from([3, 0, 0, 0]),
      }),
    );
    const [summary] = decodeTransactionInstructions(tx);
    expect(summary.program).toBe("Token Program");
    expect(summary.description).toBe("Token Program instruction");
  });

  it("labels unknown programs with truncated address", () => {
    const unknownProgram = Keypair.generate().publicKey;
    const tx = new Transaction({
      feePayer: from.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
    });
    tx.add(
      new TransactionInstruction({
        programId: unknownProgram,
        keys: [{ pubkey: to.publicKey, isSigner: false, isWritable: true }],
        data: Buffer.from([]),
      }),
    );
    const [summary] = decodeTransactionInstructions(tx);
    const base58 = unknownProgram.toBase58();
    expect(summary.program).toBe(`${base58.slice(0, 4)}…${base58.slice(-4)}`);
    expect(summary.description).toMatch(/^Instruction to /);
  });

  it("decodes versioned transactions with multiple instructions", () => {
    const message = MessageV0.compile({
      payerKey: from.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: from.publicKey,
          toPubkey: to.publicKey,
          lamports: 2 * LAMPORTS_PER_SOL,
        }),
        new TransactionInstruction({
          programId: new PublicKey(
            "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
          ),
          keys: [],
          data: Buffer.from("hello", "utf8"),
        }),
      ],
    });
    const vtx = new VersionedTransaction(message);
    const result = decodeTransactionInstructions(vtx);
    expect(result).toHaveLength(2);
    expect(result[0].program).toBe("System Program");
    expect(result[0].description).toMatch(/^Transfer 2 SOL to /);
    expect(result[1].program).toBe("Memo");
    expect(result[1].description).toBe("Memo instruction");
  });
});

describe("decodeTransactionBase64", () => {
  it("round-trips through base64", () => {
    const from = Keypair.generate();
    const to = Keypair.generate();
    const tx = buildLegacyTransferTx(from.publicKey, to.publicKey, 0.25);
    const result = decodeTransactionBase64(toBase64(tx));
    expect(result).toHaveLength(1);
    expect(result[0].description).toMatch(/^Transfer 0\.25 SOL to /);
  });

  it("returns a failure summary when base64 is malformed", () => {
    const result = decodeTransactionBase64("!!!not-base64!!!");
    expect(result).toEqual([
      { program: "Unknown", description: "Failed to decode transaction" },
    ]);
  });
});

describe("decodeMessageBytes / decodeMessageBase64", () => {
  it("returns printable text unchanged", () => {
    const bytes = new Uint8Array(Buffer.from("Sign me plz", "utf8"));
    expect(decodeMessageBytes(bytes)).toBe("Sign me plz");
  });

  it("falls back to hex when bytes are non-printable", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0xff]);
    expect(decodeMessageBytes(bytes)).toBe("00 01 ff");
  });

  it("decodes base64-encoded messages", () => {
    const base64 = Buffer.from("Hello world", "utf8").toString("base64");
    expect(decodeMessageBase64(base64)).toBe("Hello world");
  });
});
