import {
  isValidSolanaAddress,
  isValidTelegramUsername,
} from "@/components/wallet/SendSheet";

export const WALLET_ANALYTICS_PATH = "/telegram/wallet";

export const WALLET_ANALYTICS_EVENTS = {
  openSend: 'Open "Send"',
  sendFunds: "Send Funds",
  sendFundsFailed: "Send Funds Failed",
  openReceive: 'Open "Receive"',
  openSwap: 'Open "Swap"',
  openSecureSwap: 'Open "Secure swap"',
  swapTokens: "Swap tokens",
  swapTokensFailed: "Swap tokens Failed",
  claimFunds: "Claim funds",
  pressWalletBanner: 'Press "Wallet banner"',
  closeWalletBanner: 'Close "Wallet banner"',
} as const;

export const SEND_METHODS = {
  telegram: "telegram",
  walletAddress: "wallet_address",
  unknown: "unknown",
} as const;

export const SWAP_METHODS = {
  regular: "regular",
  secure: "secure",
} as const;

export const CLAIM_SOURCES = {
  manual: "manual",
  auto: "auto",
} as const;

export type SendMethod = (typeof SEND_METHODS)[keyof typeof SEND_METHODS];
export type SwapMethod = (typeof SWAP_METHODS)[keyof typeof SWAP_METHODS];
export type ClaimSource = (typeof CLAIM_SOURCES)[keyof typeof CLAIM_SOURCES];

export function getAnalyticsErrorProperties(error: unknown): {
  error_name: string;
  error_message: string;
} {
  if (error instanceof Error) {
    return {
      error_name: error.name || "Error",
      error_message: error.message || "Unknown error",
    };
  }

  return {
    error_name: "UnknownError",
    error_message: typeof error === "string" ? error : "Unknown error",
  };
}

export function getSendMethod(recipient: string): SendMethod {
  const trimmedRecipient = recipient.trim();

  if (isValidSolanaAddress(trimmedRecipient)) {
    return SEND_METHODS.walletAddress;
  }

  if (isValidTelegramUsername(trimmedRecipient)) {
    return SEND_METHODS.telegram;
  }

  return SEND_METHODS.unknown;
}
