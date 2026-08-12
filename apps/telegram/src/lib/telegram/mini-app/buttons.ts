import { hapticFeedback } from "@telegram-apps/sdk-react";

import { BaseButtonOptions } from "@/types/telegram";

export type MainButtonOptions = BaseButtonOptions & {
  onClick?: () => void;
};

export type SecondaryButtonOptions = BaseButtonOptions & {
  onClick?: () => void;
  position?: string;
};

// --- Reactive button state store ---

export type SingleButtonState = {
  text: string;
  isEnabled: boolean;
  onClick: (() => void) | null;
  showLoader: boolean;
};

export type ButtonBarState = {
  main: SingleButtonState | null;
  secondary: SingleButtonState | null;
};

let buttonBarState: ButtonBarState = { main: null, secondary: null };
const listeners = new Set<() => void>();

function emitChange() {
  // Create new reference so useSyncExternalStore detects the change
  buttonBarState = { ...buttonBarState };
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeButtonState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getButtonStateSnapshot(): ButtonBarState {
  return buttonBarState;
}

// --- Haptic-wrapped click handler ---

function wrapWithHaptic(onClick?: () => void): (() => void) | null {
  if (!onClick) return null;
  return () => {
    try {
      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("medium");
      }
    } catch {
      // Haptic not available outside Telegram
    }
    onClick();
  };
}

// --- Immediate DOM sync ---
// React re-renders are async (useEffect → store update → scheduled render).
// To avoid the button bar lingering after a modal closes, we directly toggle
// the DOM element's display before React catches up.

const BUTTON_BAR_ID = "bottom-button-bar";

function syncDomVisibility() {
  const el = document.getElementById(BUTTON_BAR_ID);
  if (!el) return;
  const hasButtons = !!(buttonBarState.main || buttonBarState.secondary);
  el.style.display = hasButtons ? "flex" : "none";
}

// --- Public API (unchanged signatures) ---

export const showMainButton = (options: MainButtonOptions): boolean => {
  buttonBarState = {
    ...buttonBarState,
    main: {
      text: options.text,
      isEnabled: options.isEnabled ?? true,
      onClick: wrapWithHaptic(options.onClick),
      showLoader: options.showLoader ?? false,
    },
  };
  syncDomVisibility();
  emitChange();
  return true;
};

export const hideMainButton = (): boolean => {
  buttonBarState = {
    ...buttonBarState,
    main: null,
  };
  syncDomVisibility();
  emitChange();
  return true;
};

export const showSecondaryButton = (
  options: SecondaryButtonOptions
): boolean => {
  buttonBarState = {
    ...buttonBarState,
    secondary: {
      text: options.text,
      isEnabled: options.isEnabled ?? true,
      onClick: wrapWithHaptic(options.onClick),
      showLoader: options.showLoader ?? false,
    },
  };
  syncDomVisibility();
  emitChange();
  return true;
};

export const hideSecondaryButton = (): boolean => {
  buttonBarState = {
    ...buttonBarState,
    secondary: null,
  };
  syncDomVisibility();
  emitChange();
  return true;
};

export const hideAllButtons = (): void => {
  hideMainButton();
  hideSecondaryButton();
};

// --- Preset button combinations ---

type ButtonStyleOptions = Pick<
  BaseButtonOptions,
  "backgroundColor" | "textColor"
>;

type WalletButtonsBaseOptions = {
  mainStyle?: ButtonStyleOptions;
  secondaryStyle?: ButtonStyleOptions;
};

type WalletHomeButtonsOptions = WalletButtonsBaseOptions & {
  onSend: () => void;
  onReceive: () => void;
};

type WalletReceiveButtonsOptions = WalletButtonsBaseOptions & {
  onShare: () => void;
};

export const showWalletHomeButtons = ({
  onSend,
  onReceive,
  mainStyle,
  secondaryStyle,
}: WalletHomeButtonsOptions): boolean => {
  const mainShown = showMainButton({
    text: "Send",
    onClick: onSend,
    ...(mainStyle ?? {}),
  });

  const secondaryShown = showSecondaryButton({
    text: "Receive",
    position: "left",
    onClick: onReceive,
    ...(secondaryStyle ?? {}),
  });

  return mainShown && secondaryShown;
};

export const showReceiveShareButton = ({
  onShare,
  mainStyle,
}: WalletReceiveButtonsOptions): boolean => {
  const mainShown = showMainButton({
    text: "Share",
    onClick: onShare,
    ...(mainStyle ?? {}),
  });

  return mainShown;
};

type TransactionDetailsButtonsOptions = WalletButtonsBaseOptions & {
  onApprove: () => void;
  onIgnore: () => void;
};

export const showTransactionDetailsButtons = ({
  onApprove,
  onIgnore,
  mainStyle,
  secondaryStyle,
}: TransactionDetailsButtonsOptions): boolean => {
  const mainShown = showMainButton({
    text: "Claim",
    onClick: onApprove,
    ...(mainStyle ?? {}),
  });

  const secondaryShown = showSecondaryButton({
    text: "Ignore",
    position: "left",
    onClick: onIgnore,
    ...(secondaryStyle ?? {}),
  });

  return mainShown && secondaryShown;
};
