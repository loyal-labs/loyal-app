import {
  getSolanaEndpoints,
  resolveSolanaEnv,
} from "@loyal-labs/solana-rpc";

// API base URL — points to the deployed Next.js app
// In development, use your local network IP or tunnel URL
// In production, use the deployed Vercel URL
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  "https://solana-telegram-transactions.vercel.app";
const GRID_AUTH_BASE_URL =
  process.env.EXPO_PUBLIC_GRID_AUTH_BASE_URL ??
  "https://auth.askloyal.com";
const SOLANA_ENV = resolveSolanaEnv(process.env.EXPO_PUBLIC_SOLANA_ENV);

// Earn backend (the web `frontend` app, e.g. https://staging.askloyal.com) —
// hosts the wallet-signed mobile Earn deposit endpoints. Distinct from
// API_BASE_URL, which points at the chat/wallet `/app` backend.
const EARN_API_BASE_URL =
  process.env.EXPO_PUBLIC_EARN_API_BASE_URL ?? "https://staging.askloyal.com";
// Vercel deployment-protection bypass for staging only. Sent as the
// `x-vercel-protection-bypass` header. Empty in production (no bypass).
const VERCEL_PROTECTION_BYPASS =
  process.env.EXPO_PUBLIC_VERCEL_PROTECTION_BYPASS ??
  "ohvA2MJaqX1VXu8zu1e14sDCLdHeF2YC";

// Hardcoded identity for MVP (auth deferred)
const TELEGRAM_USER_ID = "2131567542";

const MIXPANEL_TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN ?? "";

export const env = {
  apiBaseUrl: API_BASE_URL,
  earnApiBaseUrl: EARN_API_BASE_URL,
  vercelProtectionBypass: VERCEL_PROTECTION_BYPASS,
  gridAuthBaseUrl: GRID_AUTH_BASE_URL,
  solanaEnv: SOLANA_ENV,
  solanaRpcEndpoint: getSolanaEndpoints(SOLANA_ENV).rpcEndpoint,
  telegramUserId: TELEGRAM_USER_ID,
  mixpanelToken: MIXPANEL_TOKEN,
} as const;
