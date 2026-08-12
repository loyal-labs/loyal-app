import "server-only";

import type { PrivateTransferAnalyticsCronStats } from "../types";
import { syncGaslessClaimHistory } from "./gasless-claims-sync";
import { syncPrivateTransferHistory } from "./history-sync";
import { refreshPrivateTransferVaultSnapshot } from "./vault-snapshot";

export async function runPrivateTransferAnalyticsCron(): Promise<PrivateTransferAnalyticsCronStats> {
  const [gaslessClaims, history, vaults] = await Promise.all([
    syncGaslessClaimHistory(),
    syncPrivateTransferHistory(),
    refreshPrivateTransferVaultSnapshot(),
  ]);

  return {
    gaslessClaims,
    history,
    vaults,
  };
}

export const runPrivateTransferAnalyticsSync = runPrivateTransferAnalyticsCron;
