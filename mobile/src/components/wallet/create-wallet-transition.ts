export const CREATE_WALLET_CONFIRM_DELAY_MS = 500;

export type CreateWalletScreenStep = "pin" | "confirm";

export type CreateWalletBackTarget = "chooser" | "pin";

export function getCreateWalletBackTarget(
  step: CreateWalletScreenStep,
): CreateWalletBackTarget {
  return step === "pin" ? "chooser" : "pin";
}

export function scheduleCreateWalletConfirmTransition(
  pin: string,
  onTransition: (pin: string) => void,
): () => void {
  const timeoutId = setTimeout(() => {
    onTransition(pin);
  }, CREATE_WALLET_CONFIRM_DELAY_MS);

  return () => clearTimeout(timeoutId);
}

export function scheduleCreateWalletDeferredAction(
  onDeferred: () => void,
): () => void {
  const timeoutId = setTimeout(() => {
    onDeferred();
  }, CREATE_WALLET_CONFIRM_DELAY_MS);

  return () => clearTimeout(timeoutId);
}
