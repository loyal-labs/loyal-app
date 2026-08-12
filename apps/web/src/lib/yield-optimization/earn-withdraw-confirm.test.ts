import { expect, test } from "bun:test";

import { applyConfirmedWithdrawalTransactionProof } from "./earn-withdraw-proof.shared";

test("[earn-withdraw-exact-output] records confirmed credit without erasing requested intent", () => {
  const result = applyConfirmedWithdrawalTransactionProof({
    input: {
      requestedWithdrawAmountRaw: BigInt(100_000_000),
      sourceType: "reserve",
      sourceAmountRaw: BigInt(100_000_000),
      withdrawnAmountRaw: BigInt(100_000_000),
    },
    proof: {
      reserveDebitAmountRaw: BigInt(95_150_000),
      vaultIdleDeltaRaw: BigInt(0),
      vaultIdleTokenAccount: "vault-usdc-ata",
      walletTransferAmountRaw: BigInt(95_150_000),
    },
  });

  expect(result.requestedWithdrawAmountRaw).toBe(BigInt(100_000_000));
  expect(result.withdrawnAmountRaw).toBe(BigInt(95_150_000));
  expect(result.confirmedWalletTransferAmountRaw).toBe(BigInt(95_150_000));
});
