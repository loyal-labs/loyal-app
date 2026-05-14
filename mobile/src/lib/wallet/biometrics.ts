import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const BIOMETRIC_PIN_KEY = "wallet_biometric_password";
const BIOMETRIC_ENABLED_KEY = "wallet_biometric_enabled";

export async function isBiometricAvailable(): Promise<boolean> {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return false;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return enrolled;
}

export async function getBiometricType(): Promise<"faceid" | "fingerprint" | "none"> {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION))
    return "faceid";
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT))
    return "fingerprint";
  return "none";
}

export async function enableBiometrics(pin: string): Promise<boolean> {
  const available = await isBiometricAvailable();
  if (!available) return false;

  await SecureStore.setItemAsync(BIOMETRIC_PIN_KEY, pin, {
    requireAuthentication: true,
    authenticationPrompt: "Authenticate to enable biometric unlock",
  });
  await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true");
  return true;
}

export async function disableBiometrics(): Promise<void> {
  await SecureStore.deleteItemAsync(BIOMETRIC_PIN_KEY);
  await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
}

export async function isBiometricEnabled(): Promise<boolean> {
  const value = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
  return value === "true";
}

export async function authenticateWithBiometrics(): Promise<string | null> {
  try {
    const pin = await SecureStore.getItemAsync(BIOMETRIC_PIN_KEY, {
      requireAuthentication: true,
      authenticationPrompt: "Unlock your wallet",
    });
    return pin;
  } catch {
    return null;
  }
}
