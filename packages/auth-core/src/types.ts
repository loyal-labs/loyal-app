import type {
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

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type AuthRuntimeConfig = {
  authBaseUrl: string;
  fetch?: FetchLike;
};

export type ApiOutcome<T = unknown> = {
  ok: boolean;
  status: number;
  body: T;
};

export type AuthClient = {
  startEmailAuth: (
    payload: StartEmailAuthRequest
  ) => Promise<ApiOutcome<StartEmailAuthResponse | unknown>>;
  verifyEmailAuth: (
    payload: VerifyEmailAuthRequest
  ) => Promise<ApiOutcome<VerifyEmailAuthResponse | unknown>>;
  getAuthSession: () => Promise<ApiOutcome<GetAuthSessionResponse | unknown>>;
  logoutAuthSession: () => Promise<ApiOutcome<unknown>>;
  challengeWalletAuth: (
    payload: WalletChallengeRequest
  ) => Promise<ApiOutcome<WalletChallengeResponse | unknown>>;
  completeWalletAuth: (
    payload: WalletCompleteRequest
  ) => Promise<ApiOutcome<WalletCompleteResponse | unknown>>;
};
