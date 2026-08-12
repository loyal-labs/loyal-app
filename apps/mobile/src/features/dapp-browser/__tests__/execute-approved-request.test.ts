import nacl from "tweetnacl";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import type { PendingApproval } from "../model/types";

import { executeApprovedRequest } from "../bridge/execute-approved-request";
import { LocalKeypairSigner } from "@/lib/wallet/signer";

const mockGetWalletSigner = jest.fn();
const mockSendRawTransaction = jest.fn();

jest.mock("@/lib/solana/wallet/wallet-details", () => ({
  getWalletSigner: () => mockGetWalletSigner(),
}));

jest.mock("@/lib/solana/rpc/connection", () => ({
  getConnection: () => ({
    sendRawTransaction: mockSendRawTransaction,
  }),
}));

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

type ApprovalVariant =
  | { type: "connect" }
  | { type: "signMessage"; messageBase64: string }
  | {
      type: "signTransaction" | "signAndSendTransaction";
      transactionBase64: string;
    };

function buildApproval(variant: ApprovalVariant): PendingApproval {
  const base = {
    requestId: "req-1",
    origin: "https://jup.ag",
    trustState: "trusted" as const,
  };
  switch (variant.type) {
    case "connect":
      return { ...base, type: "connect" };
    case "signMessage":
      return {
        ...base,
        type: "signMessage",
        messageBase64: variant.messageBase64,
      };
    case "signTransaction":
    case "signAndSendTransaction":
      return {
        ...base,
        type: variant.type,
        transactionBase64: variant.transactionBase64,
      };
  }
}

describe("executeApprovedRequest", () => {
  beforeEach(() => {
    mockGetWalletSigner.mockReset();
    mockSendRawTransaction.mockReset();
  });

  it("returns the signer public key for connect approvals", async () => {
    const signer = new LocalKeypairSigner(Keypair.generate());
    mockGetWalletSigner.mockResolvedValue(signer);

    await expect(
      executeApprovedRequest(buildApproval({ type: "connect" }))
    ).resolves.toEqual({
      publicKey: signer.publicKey.toBase58(),
    });
  });

  it("signs base64-encoded messages and returns a base64 signature", async () => {
    const signerKeypair = Keypair.generate();
    mockGetWalletSigner.mockResolvedValue(
      new LocalKeypairSigner(signerKeypair)
    );
    const message = new TextEncoder().encode("hello from loyal");

    const result = await executeApprovedRequest(
      buildApproval({
        type: "signMessage",
        messageBase64: toBase64(message),
      })
    );

    expect(result).toHaveProperty("signature");
    const signature = Buffer.from(
      (result as { signature: string }).signature,
      "base64"
    );

    expect(
      nacl.sign.detached.verify(
        message,
        signature,
        signerKeypair.publicKey.toBytes()
      )
    ).toBe(true);
  });

  it("signs legacy transactions and returns the signed transaction as base64", async () => {
    const signerKeypair = Keypair.generate();
    mockGetWalletSigner.mockResolvedValue(
      new LocalKeypairSigner(signerKeypair)
    );

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: signerKeypair.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      })
    );
    transaction.feePayer = signerKeypair.publicKey;
    transaction.recentBlockhash = new PublicKey(
      "11111111111111111111111111111112"
    ).toBase58();

    const result = await executeApprovedRequest(
      buildApproval({
        type: "signTransaction",
        transactionBase64: transaction
          .serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          })
          .toString("base64"),
      })
    );

    const signedTransaction = Transaction.from(
      Buffer.from(
        (result as { signedTransaction: string }).signedTransaction,
        "base64"
      )
    );

    expect(signedTransaction.verifySignatures()).toBe(true);
    expect(signedTransaction.signatures[0].publicKey.toBase58()).toBe(
      signerKeypair.publicKey.toBase58()
    );
  });

  it("signs and sends versioned transactions through the shared RPC connection", async () => {
    const signerKeypair = Keypair.generate();
    mockGetWalletSigner.mockResolvedValue(
      new LocalKeypairSigner(signerKeypair)
    );
    mockSendRawTransaction.mockResolvedValue("sent-signature");

    const versionedTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signerKeypair.publicKey,
        recentBlockhash: new PublicKey(
          "11111111111111111111111111111112"
        ).toBase58(),
        instructions: [
          SystemProgram.transfer({
            fromPubkey: signerKeypair.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1,
          }),
        ],
      }).compileToV0Message()
    );

    await expect(
      executeApprovedRequest(
        buildApproval({
          type: "signAndSendTransaction",
          transactionBase64: toBase64(versionedTransaction.serialize()),
        })
      )
    ).resolves.toEqual({
      signature: "sent-signature",
    });

    expect(mockSendRawTransaction).toHaveBeenCalledTimes(1);
    const rawTransaction = mockSendRawTransaction.mock
      .calls[0][0] as Uint8Array;
    const signedTransaction = VersionedTransaction.deserialize(rawTransaction);
    expect(Array.from(signedTransaction.signatures[0])).not.toEqual(
      Array(64).fill(0)
    );
  });
});
