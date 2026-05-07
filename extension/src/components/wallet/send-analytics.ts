export const SEND_EVENTS = {
  sendFunds: "Send Funds",
  sendFundsFailed: "Send Funds Failed",
} as const;

export const SEND_METHODS = {
  walletAddress: "wallet_address",
  telegramUsername: "telegram_username",
} as const;

export type SendMethod = (typeof SEND_METHODS)[keyof typeof SEND_METHODS];

export function getSendMethod(recipient: string): SendMethod {
  if (recipient.startsWith("@")) {
    return SEND_METHODS.telegramUsername;
  }
  return SEND_METHODS.walletAddress;
}
