export const FRONTEND_ANALYTICS_EVENTS = {
  authSignInPressed: "auth_sign_in_pressed",
  authSignInSucceeded: "auth_sign_in_succeeded",
  authLogout: "auth_logout",
  chatThreadCreated: "chat_thread_created",
  siteDocsOpened: "site_docs_opened",
  siteLinkOpened: "site_link_opened",
  walletPortfolioOpened: "wallet_portfolio_opened",
  walletReceivePressed: "wallet_receive_pressed",
  walletSendPressed: "wallet_send_pressed",
  walletSendCompleted: "wallet_send_completed",
  walletSwapPressed: "wallet_swap_pressed",
  walletSwapCompleted: "wallet_swap_completed",
  walletShieldPressed: "wallet_shield_pressed",
  walletShieldCompleted: "wallet_shield_completed",
} as const;

export type FrontendAnalyticsEventName =
  (typeof FRONTEND_ANALYTICS_EVENTS)[keyof typeof FRONTEND_ANALYTICS_EVENTS];

export type WalletSidebarTab = "portfolio" | "receive" | "send" | "swap";

export type AuthSignInPressedSource = "header" | "hero_card";
export type WalletSidebarOpenSource = "hero_action_card" | "sidebar_quick_action";
export type OutboundLinkSource = string;

export const DOCS_HOSTNAME = "docs.askloyal.com";
export const TRACKED_DOWNLOAD_PATTERN = /\.(csv|docx?|pdf|txt|xlsx?|zip)$/i;

export function getFrontendPageViewEventName(pathname: string): string {
  return `View ${pathname}`;
}
