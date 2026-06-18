import { qrScanner } from "@telegram-apps/sdk";

import { isInMiniApp } from "./index";

const canUseQrScanner = (): boolean => {
  if (!isInMiniApp()) return false;

  try {
    return qrScanner.isSupported();
  } catch (error) {
    console.error("Failed to check QR scanner support", error);
    return false;
  }
};

export const openQrScanner = async (
  onCaptured?: (qr: string) => void
): Promise<void> => {
  if (!canUseQrScanner()) return;

  if (!qrScanner.open.isAvailable()) {
    console.warn("QR scanner is not available in this environment");
    return;
  }

  const promise = qrScanner.open({
    text: "Scan the QR",
    onCaptured(qr: string) {
      onCaptured?.(qr);
      qrScanner.close();
    },
  });

  await promise;
};
