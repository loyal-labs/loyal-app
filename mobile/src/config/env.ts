import { getSolanaEndpoints, resolveSolanaEnv } from "@loyal-labs/solana-rpc";

// API base URL — points to the deployed Next.js app
// In development, use your local network IP or tunnel URL
// In production, use the deployed Vercel URL
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  "https://solana-telegram-transactions.vercel.app";
const GRID_AUTH_BASE_URL =
  process.env.EXPO_PUBLIC_GRID_AUTH_BASE_URL ?? "https://auth.askloyal.com";
const SOLANA_ENV = resolveSolanaEnv(process.env.EXPO_PUBLIC_SOLANA_ENV);

// Earn backend (the web `frontend` app at https://askloyal.com) — hosts the
// wallet-signed mobile Earn deposit/state endpoints (merged to main via PR
// #342). Distinct from API_BASE_URL, which points at the chat/wallet `/app`
// backend.
const EARN_API_BASE_URL =
  process.env.EXPO_PUBLIC_EARN_API_BASE_URL ?? "https://askloyal.com";
// Native loading metrics normally use the Earn frontend's same server-only
// ClickStack relay. The separate override lets the emulator verifier point
// only telemetry at its loopback relay while real Earn requests keep using the
// configured backend.
const OBSERVABILITY_BASE_URL =
  process.env.EXPO_PUBLIC_OBSERVABILITY_BASE_URL ?? EARN_API_BASE_URL;
// Vercel deployment-protection bypass — only needed for protected preview
// deploys (e.g. a staging branch). Production askloyal.com is public, so this
// is empty by default; set EXPO_PUBLIC_VERCEL_PROTECTION_BYPASS to test against
// a protected deploy. Sent as the `x-vercel-protection-bypass` header only when
// non-empty.
const VERCEL_PROTECTION_BYPASS =
  process.env.EXPO_PUBLIC_VERCEL_PROTECTION_BYPASS ?? "";
// Sponsored Earn deposits (PR #452 backend): the device signs but the server
// fee-pays and sends. Rollback switch — anything but "true" keeps the
// self-paid sign-and-send flow, and the flow also falls back per-deposit when
// the backend doesn't return a sponsor fee payer.
const EARN_SPONSORED_DEPOSITS =
  process.env.EXPO_PUBLIC_EARN_SPONSORED_DEPOSITS === "true";

// Hardcoded identity for MVP (auth deferred)
const TELEGRAM_USER_ID = "2131567542";

const MIXPANEL_TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN ?? "";

// OneSignal App ID (dashboard > Settings > Keys & IDs). No fallback on
// purpose — OneSignal init is skipped entirely when unset.
const ONESIGNAL_APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? "";

export const env = {
  apiBaseUrl: API_BASE_URL,
  earnApiBaseUrl: EARN_API_BASE_URL,
  observabilityBaseUrl: OBSERVABILITY_BASE_URL,
  earnSponsoredDeposits: EARN_SPONSORED_DEPOSITS,
  vercelProtectionBypass: VERCEL_PROTECTION_BYPASS,
  gridAuthBaseUrl: GRID_AUTH_BASE_URL,
  solanaEnv: SOLANA_ENV,
  solanaRpcEndpoint: getSolanaEndpoints(SOLANA_ENV).rpcEndpoint,
  telegramUserId: TELEGRAM_USER_ID,
  mixpanelToken: MIXPANEL_TOKEN,
  oneSignalAppId: ONESIGNAL_APP_ID,
} as const;
