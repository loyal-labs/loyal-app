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
  emailAuthModeSchema,
  embeddedPasskeyErrorMessageSchema,
  embeddedPasskeyMessageSchema,
  embeddedPasskeyMessageTypeSchema,
  embeddedPasskeySuccessMessageSchema,
  getAuthSessionResponseSchema,
  sessionKeyBackendSchema,
  sessionKeySchema,
  startEmailAuthRequestSchema,
  startEmailAuthResponseSchema,
  startPasskeySessionResponseSchema,
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
export {
  extractApiErrorMessage,
  extractSessionUrl,
  parseApiErrorDetails,
} from "./errors";
export type {
  AuthMethod,
  AuthSessionUser,
  EmailAuthMode,
  EmbeddedPasskeyMessage,
  GetAuthSessionResponse,
  StartEmailAuthRequest,
  StartEmailAuthResponse,
  StartPasskeySessionResponse,
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
  StartPasskeyRegistrationInput,
  StartPasskeySignInInput,
} from "./types";
