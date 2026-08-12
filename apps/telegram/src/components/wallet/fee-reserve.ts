import { NATIVE_SOL_MINT, SOLANA_FEE_SOL } from "@/lib/constants";

export type WalletSendFlow = "direct-sol-send" | "private-send";

export type WalletSwapFlow =
  | "swap"
  | "shield-native-sol"
  | "shield-token"
  | "unshield-native-sol"
  | "unshield-token";

const FEE_TX_COUNT_BY_SEND_FLOW: Record<WalletSendFlow, number> = {
  "direct-sol-send": 1,
  "private-send": 3,
};

const FEE_TX_COUNT_BY_SWAP_FLOW: Record<WalletSwapFlow, number> = {
  swap: 1,
  "shield-native-sol": 6,
  "shield-token": 4,
  "unshield-native-sol": 5,
  "unshield-token": 3,
};

export function getSendFeeReserveSol(flow: WalletSendFlow): number {
  return FEE_TX_COUNT_BY_SEND_FLOW[flow] * SOLANA_FEE_SOL;
}

export function getSwapFeeReserveSol(flow: WalletSwapFlow): number {
  return FEE_TX_COUNT_BY_SWAP_FLOW[flow] * SOLANA_FEE_SOL;
}

export function getSwapFlowFeeProfile(params: {
  activeTab: "swap" | "secure";
  secureDirection: "shield" | "unshield";
  amountMint?: string | null;
}): {
  flow: WalletSwapFlow;
  amountAndFeeUseSameSolBalance: boolean;
} {
  if (params.activeTab === "swap") {
    return {
      flow: "swap",
      amountAndFeeUseSameSolBalance: params.amountMint === NATIVE_SOL_MINT,
    };
  }

  const isNativeSol = params.amountMint === NATIVE_SOL_MINT;
  if (params.secureDirection === "shield") {
    return {
      flow: isNativeSol ? "shield-native-sol" : "shield-token",
      amountAndFeeUseSameSolBalance: isNativeSol,
    };
  }

  return {
    flow: isNativeSol ? "unshield-native-sol" : "unshield-token",
    amountAndFeeUseSameSolBalance: false,
  };
}

export function hasEnoughSolForFee(
  feePayerSolBalance: number,
  feeReserveSol: number
): boolean {
  return feePayerSolBalance >= feeReserveSol;
}

export function getMaxAmountWithFeeReserve(params: {
  assetBalance: number;
  feePayerSolBalance: number;
  feeReserveSol: number;
  amountAndFeeUseSameSolBalance: boolean;
}): number {
  if (params.amountAndFeeUseSameSolBalance) {
    return Math.max(0, params.assetBalance - params.feeReserveSol);
  }

  return hasEnoughSolForFee(params.feePayerSolBalance, params.feeReserveSol)
    ? params.assetBalance
    : 0;
}
