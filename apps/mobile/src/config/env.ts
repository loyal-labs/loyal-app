import { getSolanaEndpoints, resolveSolanaEnv } from "@loyal-labs/solana-rpc";

// API base URL — points to the deployed Next.js app
// In development, use your local network IP or tunnel URL
// In production, use the deployed Vercel URL
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  "https://solana-telegram-transactions.vercel.app";
const SOLANA_ENV = resolveSolanaEnv(process.env.EXPO_PUBLIC_SOLANA_ENV);

// Hardcoded identity for MVP (auth deferred)
const TELEGRAM_USER_ID = "2131567542";

const MIXPANEL_TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN ?? "";

export const env = {
  apiBaseUrl: API_BASE_URL,
  solanaEnv: SOLANA_ENV,
  solanaRpcEndpoint: getSolanaEndpoints(SOLANA_ENV).rpcEndpoint,
  telegramUserId: TELEGRAM_USER_ID,
  mixpanelToken: MIXPANEL_TOKEN,
} as const;
