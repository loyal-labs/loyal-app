export const WALLET_SETUP_EVENTS = {
  walletCreated: "Wallet Created",
  walletImported: "Wallet Imported",
  walletUnlocked: "Wallet Unlocked",
  walletLocked: "Wallet Locked",
  walletReset: "Wallet Reset",
} as const;

export const LOCK_METHODS = {
  manual: "manual",
  autoTimeout: "auto_timeout",
  screenLock: "screen_lock",
} as const;

export type LockMethod = (typeof LOCK_METHODS)[keyof typeof LOCK_METHODS];
