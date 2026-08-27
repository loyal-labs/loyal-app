export const APP_AUTODEPOSIT_EVENT_TARGET_ID_MAX = BigInt("999999999999");

export const APP_AUTODEPOSIT_BOOTSTRAP_EVENT_SOURCES = [
  "app_autodeposit_artifact_reconcile",
  "app_autodeposit_setup_confirm",
  "mobile_autodeposit_artifact_reconcile",
] as const;

export function isAppAutodepositBootstrapEventSource(
  source: string
): boolean {
  return APP_AUTODEPOSIT_BOOTSTRAP_EVENT_SOURCES.some(
    (candidate) => candidate === source
  );
}

export function createBootstrapWalletBalanceEventId(targetId: bigint): bigint {
  if (targetId <= BigInt(0) || targetId > APP_AUTODEPOSIT_EVENT_TARGET_ID_MAX) {
    throw new Error(
      `Autodeposit target ID ${targetId.toString()} is outside the reserved App event ID range.`
    );
  }
  return -targetId;
}
