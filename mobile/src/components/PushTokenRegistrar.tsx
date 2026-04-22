import { useEffect, useRef } from "react";

import { useWallet } from "@/lib/wallet/wallet-provider";
import {
  registerForPushNotifications,
  registerPushToken,
} from "@/services/notifications";

/**
 * Re-registers the Expo push token whenever the wallet public key changes.
 * Gated on wallet availability so we don't prompt for notification
 * permission before onboarding completes.
 */
export function PushTokenRegistrar(): null {
  const { publicKey } = useWallet();
  const lastRegisteredPublicKey = useRef<string | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    if (lastRegisteredPublicKey.current === publicKey) return;

    lastRegisteredPublicKey.current = publicKey;
    void (async () => {
      const token = await registerForPushNotifications();
      if (token) {
        await registerPushToken(token, publicKey);
      }
    })();
  }, [publicKey]);

  return null;
}
