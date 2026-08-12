export const VERIFY_ANALYTICS_PATH = "/telegram/verify";

export const VERIFY_ANALYTICS_EVENTS = {
  openEnableBiometrics: 'Open "Enable Biometrics"',
  openVerify: 'Open "Verify"',
  verifyBiometrics: "Verify Biometrics",
  verifyBiometricsFailed: "Verify Biometrics Failed",
} as const;

export const VERIFY_BIOMETRICS_OUTCOMES = {
  authorized: "authorized",
  denied: "denied",
  error: "error",
  not_available: "not_available",
} as const;

export type VerifyBiometricsOutcome =
  (typeof VERIFY_BIOMETRICS_OUTCOMES)[keyof typeof VERIFY_BIOMETRICS_OUTCOMES];
