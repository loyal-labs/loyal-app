export { buildAuthUrl, callAuthEndpoint, createAuthClient } from "./auth";
export {
  AUTH_SESSION_COOKIE_NAME,
  authSessionTokenClaimsSchema,
  createAuthSessionTokenClaims,
  mapAuthSessionTokenClaimsToUser,
} from "./session";
export {
  authMethodSchema,
  authRoutePaths,
  authSessionUserSchema,
  getAuthSessionResponseSchema,
  startEmailAuthRequestSchema,
  startEmailAuthResponseSchema,
  verifyEmailAuthRequestSchema,
  verifyEmailAuthResponseSchema,
  walletChallengeRequestSchema,
  walletChallengeResponseSchema,
  walletCompleteRequestSchema,
  walletCompleteResponseSchema,
} from "./contracts";
export {
  buildWalletAuthMessage,
  WALLET_AUTH_CHALLENGE_TOKEN_TYPE,
  WALLET_AUTH_MESSAGE_VERSION,
  walletChallengeTokenClaimsSchema,
} from "./wallet";
export { extractApiErrorMessage, parseApiErrorDetails } from "./errors";
export type {
  AuthMethod,
  AuthSessionUser,
  GetAuthSessionResponse,
  StartEmailAuthRequest,
  StartEmailAuthResponse,
  VerifyEmailAuthRequest,
  VerifyEmailAuthResponse,
  WalletChallengeRequest,
  WalletChallengeResponse,
  WalletCompleteRequest,
  WalletCompleteResponse,
} from "./contracts";
export type { AuthSessionTokenClaimsData } from "./session";
export type {
  WalletAuthMessageInput,
  WalletChallengeTokenClaimsData,
} from "./wallet";
export type {
  ApiOutcome,
  AuthClient,
  AuthRuntimeConfig,
  FetchLike,
} from "./types";
