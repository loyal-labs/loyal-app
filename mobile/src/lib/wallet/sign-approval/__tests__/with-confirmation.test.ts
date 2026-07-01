import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import type { Signer } from "../../signer";
import type { SignApprovalContextValue, SignApprovalRequest } from "../types";
import { LocalKeypairSigner } from "../../signer";
import {
  UserRejectedSigningError,
  withConfirmation,
} from "../with-confirmation";

type AnyTx = Transaction | VersionedTransaction;

function makeSeedVaultSigner(): Signer & {
  mocks: {
    signMessage: jest.Mock;
    signTransaction: jest.Mock;
    signAllTransactions: jest.Mock;
  };
} {
  const publicKey = Keypair.generate().publicKey;
  const mocks = {
    signMessage: jest.fn(async (bytes: Uint8Array) => bytes.slice(0, 64)),
    signTransaction: jest.fn(async (tx: AnyTx) => tx),
    signAllTransactions: jest.fn(async (txs: AnyTx[]) => txs),
  };

  const signer: Signer = {
    publicKey,
    kind: "seed-vault",
    signMessage: mocks.signMessage,
    signTransaction: <T extends AnyTx>(tx: T) =>
      mocks.signTransaction(tx) as Promise<T>,
    signAllTransactions: <T extends AnyTx>(txs: T[]) =>
      mocks.signAllTransactions(txs) as Promise<T[]>,
  };

  return Object.assign(signer, { mocks });
}

function makeCtx() {
  const requests: SignApprovalRequest[] = [];
  let nextDecision = true;

  const requestApproval: SignApprovalContextValue["requestApproval"] = (
    request
  ) => {
    requests.push(request);
    return Promise.resolve(nextDecision);
  };

  return {
    ctx: { requestApproval } satisfies SignApprovalContextValue,
    requests,
    setDecision: (approved: boolean) => {
      nextDecision = approved;
    },
  };
}

function buildTransferTx(payer: Keypair = Keypair.generate()) {
  const to = Keypair.generate();
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111112",
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: to.publicKey,
      lamports: LAMPORTS_PER_SOL,
    })
  );
  return tx;
}

describe("withConfirmation", () => {
  it("asks for approval before a local keypair signTransaction call", async () => {
    const keypair = Keypair.generate();
    const signer = new LocalKeypairSigner(keypair);
    const { ctx, requests } = makeCtx();
    const wrapped = withConfirmation(signer, ctx, {
      title: "Send 1 SOL",
    });
    expect(wrapped).not.toBe(signer);

    await wrapped.signTransaction(buildTransferTx(keypair));

    expect(requests).toHaveLength(1);
    expect(requests[0]?.kind).toBe("transaction");
  });

  it("throws and does not call the keypair signer when rejected", async () => {
    const keypair = Keypair.generate();
    const inner = new LocalKeypairSigner(keypair);
    const signTransactionSpy = jest.spyOn(inner, "signTransaction");
    const { ctx, setDecision } = makeCtx();
    setDecision(false);
    const wrapped = withConfirmation(inner, ctx);

    await expect(
      wrapped.signTransaction(buildTransferTx(keypair))
    ).rejects.toBeInstanceOf(UserRejectedSigningError);
    expect(signTransactionSpy).not.toHaveBeenCalled();
  });

  it("asks for approval before a seed-vault signTransaction call", async () => {
    const inner = makeSeedVaultSigner();
    const { ctx, requests } = makeCtx();
    const wrapped = withConfirmation(inner, ctx, {
      title: "Shield 4 USDC",
      subtitle: "Loyal → Kamino",
    });

    const tx = buildTransferTx();
    await wrapped.signTransaction(tx);

    expect(inner.mocks.signTransaction).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.kind).toBe("transaction");
  });

  it("throws UserRejectedSigningError when the user rejects", async () => {
    const inner = makeSeedVaultSigner();
    const { ctx, setDecision } = makeCtx();
    setDecision(false);
    const wrapped = withConfirmation(inner, ctx);

    await expect(
      wrapped.signTransaction(buildTransferTx())
    ).rejects.toBeInstanceOf(UserRejectedSigningError);
    expect(inner.mocks.signTransaction).not.toHaveBeenCalled();
  });

  it("asks once for a batch of transactions", async () => {
    const inner = makeSeedVaultSigner();
    const { ctx, requests } = makeCtx();
    const wrapped = withConfirmation(inner, ctx);

    const batch = [buildTransferTx(), buildTransferTx()];
    await wrapped.signAllTransactions(batch);

    expect(inner.mocks.signAllTransactions).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.kind).toBe("transaction");
  });

  it("asks for approval before a signMessage call", async () => {
    const inner = makeSeedVaultSigner();
    const { ctx, requests } = makeCtx();
    const wrapped = withConfirmation(inner, ctx, { title: "Sign in to Jup" });

    const bytes = new Uint8Array([1, 2, 3, 4]);
    await wrapped.signMessage(bytes);

    expect(inner.mocks.signMessage).toHaveBeenCalledTimes(1);
    expect(requests[0]?.kind).toBe("message");
  });
});
