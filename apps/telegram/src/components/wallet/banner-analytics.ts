import {
  WALLET_ANALYTICS_EVENTS,
  WALLET_ANALYTICS_PATH,
} from "@/app/telegram/wallet/wallet-analytics";
import { track } from "@/lib/core/analytics";

export function trackWalletBannerPress(bannerId: string): void {
  track(WALLET_ANALYTICS_EVENTS.pressWalletBanner, {
    path: WALLET_ANALYTICS_PATH,
    banner_id: bannerId,
  });
}

export function trackWalletBannerClose(bannerId: string): void {
  track(WALLET_ANALYTICS_EVENTS.closeWalletBanner, {
    path: WALLET_ANALYTICS_PATH,
    banner_id: bannerId,
  });
}
