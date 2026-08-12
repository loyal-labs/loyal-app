export type ConfirmedWithdrawalTransactionProof = {
  reserveDebitAmountRaw: bigint;
  vaultIdleDeltaRaw: bigint;
  vaultIdleTokenAccount: string;
  walletTransferAmountRaw: bigint;
};

type WithdrawalProofInput = {
  sourceAmountRaw?: bigint | null;
  sourceType?: "reserve" | "idle" | null;
  withdrawnAmountRaw: bigint;
};

export function applyConfirmedWithdrawalTransactionProof<
  TInput extends WithdrawalProofInput
>(args: {
  input: TInput;
  proof: ConfirmedWithdrawalTransactionProof;
}): TInput & {
  confirmedReserveDebitAmountRaw?: bigint;
  confirmedVaultIdleDeltaRaw: bigint;
  confirmedVaultIdleTokenAccount: string;
  confirmedWalletTransferAmountRaw: bigint;
} {
  const sourceType = args.input.sourceType ?? "reserve";

  return {
    ...args.input,
    confirmedVaultIdleDeltaRaw: args.proof.vaultIdleDeltaRaw,
    confirmedVaultIdleTokenAccount: args.proof.vaultIdleTokenAccount,
    confirmedWalletTransferAmountRaw: args.proof.walletTransferAmountRaw,
    withdrawnAmountRaw: args.proof.walletTransferAmountRaw,
    ...(sourceType === "reserve"
      ? {
          confirmedReserveDebitAmountRaw: args.proof.reserveDebitAmountRaw,
          sourceAmountRaw:
            args.input.sourceAmountRaw ?? args.proof.reserveDebitAmountRaw,
        }
      : {}),
  };
}
