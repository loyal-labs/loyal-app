import "server-only";

import type { AuthenticatedPrincipal } from "./auth-session";

/**
 * Deterministic dev-only principal used when APP_ENVIRONMENT=local and
 * the real auth cookie cannot be resolved (cross-domain cookie limitation).
 */
export const LOCAL_DEV_PRINCIPAL: AuthenticatedPrincipal = {
  provider: "solana",
  authMethod: "wallet",
  subjectAddress: "LocalDevUser000000000000000000000000000000000",
  walletAddress: "LocalDevUser000000000000000000000000000000000",
  smartAccountAddress: "LocalDevSmartAccount0000000000000000000000000",
  settingsPda: "LocalDevSettingsPda000000000000000000000000000",
};
