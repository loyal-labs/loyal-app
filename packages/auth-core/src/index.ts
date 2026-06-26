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
  serializedSolanaSignInOutputSchema,
  serializedWalletAccountSchema,
  solanaSignInInputSchema,
  startEmailAuthRequestSchema,
  startEmailAuthResponseSchema,
  verifyEmailAuthRequestSchema,
  verifyEmailAuthResponseSchema,
  walletAuthKindSchema,
  walletChallengeRequestSchema,
  walletChallengeResponseSchema,
  walletCompleteRequestSchema,
  walletCompleteResponseSchema,
  walletMessageChallengeRequestSchema,
  walletMessageChallengeResponseSchema,
  walletMessageCompleteRequestSchema,
  walletSiwsChallengeRequestSchema,
  walletSiwsChallengeResponseSchema,
  walletSiwsCompleteRequestSchema,
} from "./contracts";
export {
  buildWalletAuthMessage,
  legacyWalletChallengeTokenClaimsSchema,
  WALLET_AUTH_CHALLENGE_TOKEN_TYPE,
  WALLET_AUTH_MESSAGE_VERSION,
  WALLET_AUTH_SIWS_STATEMENT,
  walletChallengeTokenClaimsSchema,
  walletMessageChallengeTokenClaimsSchema,
  walletSiwsChallengeTokenClaimsSchema,
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
  SerializedSolanaSignInOutput,
  SerializedWalletAccount,
  SolanaSignInInputJson,
  WalletAuthKind,
  WalletChallengeRequest,
  WalletChallengeResponse,
  WalletCompleteRequest,
  WalletCompleteResponse,
  WalletMessageChallengeRequest,
  WalletMessageChallengeResponse,
  WalletMessageCompleteRequest,
  WalletSiwsChallengeRequest,
  WalletSiwsChallengeResponse,
  WalletSiwsCompleteRequest,
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
