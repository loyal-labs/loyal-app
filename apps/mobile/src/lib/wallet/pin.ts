export const WALLET_PIN_LENGTH = 4;

export function isValidWalletPin(pin: string): boolean {
  return new RegExp(`^\\d{${WALLET_PIN_LENGTH}}$`).test(pin);
}

