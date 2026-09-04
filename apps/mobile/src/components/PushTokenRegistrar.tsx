import { useEffect, useRef } from "react";

import { useWallet } from "@/lib/wallet/wallet-provider";
import {
  registerForPushNotifications,
  registerPushToken,
} from "@/services/notifications";
import { loginOneSignal } from "@/services/onesignal";

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
    // Map the OneSignal subscription to the wallet (external ID) so pushes
    // can target it. Independent of the Expo token below — a permission or
    // token failure there must not lose the identity mapping.
    void loginOneSignal(publicKey);
    void (async () => {
      const token = await registerForPushNotifications();
      if (!token) {
        // registerForPushNotifications already logged the specific
        // failure (permission, projectId, FCM). This message just
        // confirms the registrar saw the publicKey and gave up.
        console.warn(
          "[push] Registrar skipped: no token produced for wallet",
          publicKey.slice(0, 8),
        );
        return;
      }
      await registerPushToken(token, publicKey);
      console.log(
        "[push] Registrar completed for wallet",
        publicKey.slice(0, 8),
      );
    })();
  }, [publicKey]);

  return null;
}
