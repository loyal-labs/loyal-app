import React, { useState } from "react";
import { Buffer } from "buffer";
import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { useSwap } from "../../src/hooks/use-swap";
import { fixtureOwner } from "./swap-wallet";

export function SwapProbe() {
  const [snapshot, setSnapshot] = useState({
    owner: fixtureOwner.toBase58(),
    balances: [
      { mint: "input", amount: 10 },
      { mint: "output", amount: 0 },
    ],
  });
  const swap = useSwap(snapshot);
  Object.assign(window, {
    Buffer,
    swapFixture: {
      quote: () =>
        swap.getQuote("input", "output", "1", "input", 6, 6, "output"),
      execute: () => swap.executeSwap(),
      ready: Boolean(swap.quote),
      update: (
        input: number,
        output: number,
        owner = fixtureOwner.toBase58()
      ) =>
        setSnapshot({
          owner,
          balances: [
            { mint: "input", amount: input },
            { mint: "output", amount: output },
          ],
        }),
      transaction: Buffer.from(
        new VersionedTransaction(
          new TransactionMessage({
            payerKey: fixtureOwner,
            recentBlockhash: fixtureOwner.toBase58(),
            instructions: [],
          }).compileToV0Message()
        ).serialize()
      ).toString("base64"),
    },
  });
  return (
    <output aria-label="Swap balances">
      {snapshot.balances
        .map((item) => `${item.mint}: ${item.amount}`)
        .join(", ")}
    </output>
  );
}
