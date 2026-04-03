import { storage } from "#imports";

// Firefox MV2 lacks browser.storage.session — fall back to local storage.
// import.meta.env.FIREFOX is a compile-time constant set by WXT.
const SESSION_AREA = import.meta.env.FIREFOX ? "local" : "session";

export const networkSelection = storage.defineItem<"mainnet" | "devnet">(
  "local:network",
  { fallback: "mainnet" },
);

export const isWalletUnlocked = storage.defineItem<boolean>(
  `${SESSION_AREA}:walletUnlocked`,
  { fallback: false },
);

export const connectedExternalWallet = storage.defineItem<string | null>(
  "local:externalWalletPubkey",
  { fallback: null },
);

export const activeWalletSource = storage.defineItem<"builtin" | "external">(
  "local:walletSource",
  { fallback: "builtin" },
);

export const isBalanceHidden = storage.defineItem<boolean>(
  "local:balanceHidden",
  { fallback: false },
);

/** Auto-lock timeout in minutes. 0 = never. */
export const autoLockTimeout = storage.defineItem<number>(
  "local:autoLockTimeout",
  { fallback: 15 },
);

/** Extension view mode: sidebar or popup */
export const viewMode = storage.defineItem<"sidebar" | "popup">(
  "local:viewMode",
  { fallback: "sidebar" },
);

/** Epoch ms of last user interaction while unlocked. */
export const lastActivityAt = storage.defineItem<number>(
  `${SESSION_AREA}:lastActivityAt`,
  { fallback: 0 },
);

/** Origins that the user has approved for dApp connect */
export const connectedDappOrigins = storage.defineItem<string[]>(
  "local:connectedDappOrigins",
  { fallback: [] },
);

/** Pending dApp approval request shown in the popup/sidepanel */
export const pendingDappApproval = storage.defineItem<{
  id: string;
  kind: "connect" | "signTransaction" | "signMessage";
  origin: string;
  favicon?: string;
} | null>(
  `${SESSION_AREA}:pendingDappApproval`,
  { fallback: null },
);

/** Whether the user has completed (or skipped) the onboarding carousel */
export const onboardingCompleted = storage.defineItem<boolean>(
  "local:onboardingCompleted",
  { fallback: false },
);

/** Credential version: null = legacy 4-digit PIN, 2 = password. */
export const credentialVersion = storage.defineItem<number | null>(
  "local:credentialVersion",
  { fallback: null },
);

/** Number of consecutive failed unlock attempts. Reset on success. */
export const failedPinAttempts = storage.defineItem<number>(
  "local:failedPinAttempts",
  { fallback: 0 },
);

/** Epoch ms until which PIN entry is locked. 0 = not locked. */
export const pinLockedUntil = storage.defineItem<number>(
  "local:pinLockedUntil",
  { fallback: 0 },
);

/** Full dApp request payload for signing (stored so background can sign after approval) */
export const pendingDappRequestPayload = storage.defineItem<{
  type: "DAPP_SIGN_TRANSACTION_REQUEST" | "DAPP_SIGN_MESSAGE_REQUEST";
  id: string;
  transaction?: string; // base64
  message?: string; // base64
} | null>(
  `${SESSION_AREA}:pendingDappRequestPayload`,
  { fallback: null },
);
