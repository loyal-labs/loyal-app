import {
  createAuthClient,
  extractApiErrorMessage,
  extractSessionUrl,
  getAuthSessionResponseSchema,
  parseApiErrorDetails,
  startPasskeySessionResponseSchema,
  startEmailAuthResponseSchema,
  verifyEmailAuthResponseSchema,
  walletChallengeResponseSchema,
  walletCompleteResponseSchema,
} from "@loyal-labs/auth-core";
import type {
  AuthClient,
  AuthSessionUser,
  StartEmailAuthRequest,
  StartEmailAuthResponse,
  StartPasskeySignInInput,
  VerifyEmailAuthRequest,
  WalletChallengeRequest,
  WalletChallengeResponse,
  WalletCompleteRequest,
} from "@loyal-labs/auth-core";

import { getPublicEnv } from "@/lib/core/config/public";

export class AuthApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string[];

  constructor(
    message: string,
    options: { code: string; status: number; details?: string[] }
  ) {
    super(message);
    this.name = "AuthApiClientError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details ?? [];
  }
}

function withPasskeyEmbedParams(url: string): string {
  const baseOrigin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const nextUrl = new URL(url, baseOrigin);
  nextUrl.searchParams.set("embed", "1");
  nextUrl.searchParams.set("autostart", "1");
  return nextUrl.toString();
}

export type SharedAuthApiClient = {
  startEmailAuth(payload: StartEmailAuthRequest): Promise<StartEmailAuthResponse>;
  verifyEmailAuth(payload: VerifyEmailAuthRequest): Promise<AuthSessionUser>;
  startPasskeySignIn(payload: StartPasskeySignInInput): Promise<string>;
  getSession(): Promise<AuthSessionUser | null>;
  logout(): Promise<void>;
};

export type WalletAuthApiClient = {
  challengeWalletAuth(
    payload: WalletChallengeRequest
  ): Promise<WalletChallengeResponse>;
  completeWalletAuth(payload: WalletCompleteRequest): Promise<AuthSessionUser>;
};

export type AuthApiClient = SharedAuthApiClient & WalletAuthApiClient;

function toErrorCode(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "code" in payload.error &&
    typeof payload.error.code === "string"
  ) {
    return payload.error.code;
  }

  return fallback;
}

function assertSuccessfulResponse<T>(
  outcome: {
    ok: boolean;
    status: number;
    body: unknown;
  },
  schema: {
    safeParse: (
      value: unknown
    ) => { success: true; data: T } | { success: false };
  },
  options: {
    invalidResponseMessage: string;
    errorCode: string;
  }
): T {
  if (!outcome.ok) {
    throw new AuthApiClientError(extractApiErrorMessage(outcome.body), {
      code: toErrorCode(outcome.body, options.errorCode),
      status: outcome.status,
      details: parseApiErrorDetails(outcome.body),
    });
  }

  const parsed = schema.safeParse(outcome.body);
  if (!parsed.success) {
    throw new AuthApiClientError(options.invalidResponseMessage, {
      code: `${options.errorCode}_invalid_response`,
      status: 502,
    });
  }

  return parsed.data;
}

export function createSharedAuthApiClient(
  rawClient: AuthClient = createAuthClient({
    authBaseUrl: getPublicEnv().gridAuthBaseUrl ?? "",
  })
): SharedAuthApiClient {
  return {
    async startEmailAuth(payload) {
      const outcome = await rawClient.startEmailAuth(payload);
      return assertSuccessfulResponse(outcome, startEmailAuthResponseSchema, {
        invalidResponseMessage: "The auth server returned an invalid start response.",
        errorCode: "email_auth_start_failed",
      });
    },

    async verifyEmailAuth(payload) {
      const outcome = await rawClient.verifyEmailAuth(payload);
      const parsed = assertSuccessfulResponse(
        outcome,
        verifyEmailAuthResponseSchema,
        {
          invalidResponseMessage:
            "The auth server returned an invalid verify response.",
          errorCode: "email_auth_verify_failed",
        }
      );

      return parsed.user;
    },

    async startPasskeySignIn(payload) {
      const outcome = await rawClient.startPasskeySignIn(payload);
      if (!outcome.ok) {
        throw new AuthApiClientError(extractApiErrorMessage(outcome.body), {
          code: toErrorCode(outcome.body, "passkey_sign_in_start_failed"),
          status: outcome.status,
          details: parseApiErrorDetails(outcome.body),
        });
      }

      const parsed = startPasskeySessionResponseSchema.safeParse(outcome.body);
      if (parsed.success) {
        return withPasskeyEmbedParams(parsed.data.url);
      }

      const extractedUrl = extractSessionUrl(outcome.body);
      if (extractedUrl) {
        return withPasskeyEmbedParams(extractedUrl);
      }

      throw new AuthApiClientError(
        "The auth server returned an invalid passkey start response.",
        {
          code: "passkey_sign_in_start_invalid_response",
          status: 502,
        }
      );
    },

    async getSession() {
      const outcome = await rawClient.getAuthSession();
      if (!outcome.ok) {
        if (outcome.status === 401) {
          return null;
        }

        throw new AuthApiClientError(extractApiErrorMessage(outcome.body), {
          code: toErrorCode(outcome.body, "email_auth_session_failed"),
          status: outcome.status,
          details: parseApiErrorDetails(outcome.body),
        });
      }

      const parsed = getAuthSessionResponseSchema.safeParse(outcome.body);
      if (!parsed.success) {
        throw new AuthApiClientError(
          "The auth server returned an invalid session response.",
          {
            code: "email_auth_session_invalid_response",
            status: 502,
          }
        );
      }

      return parsed.data.user;
    },

    async logout() {
      const outcome = await rawClient.logoutAuthSession();
      if (outcome.ok) {
        return;
      }

      throw new AuthApiClientError(extractApiErrorMessage(outcome.body), {
        code: toErrorCode(outcome.body, "email_auth_logout_failed"),
        status: outcome.status,
        details: parseApiErrorDetails(outcome.body),
      });
    },
  };
}

export function createWalletAuthApiClient(
  rawClient: AuthClient = createAuthClient({
    authBaseUrl: "",
  })
): WalletAuthApiClient {
  return {
    async challengeWalletAuth(payload) {
      const outcome = await rawClient.challengeWalletAuth(payload);
      return assertSuccessfulResponse(outcome, walletChallengeResponseSchema, {
        invalidResponseMessage:
          "The auth server returned an invalid wallet challenge response.",
        errorCode: "wallet_auth_challenge_failed",
      });
    },

    async completeWalletAuth(payload) {
      const outcome = await rawClient.completeWalletAuth(payload);
      const parsed = assertSuccessfulResponse(
        outcome,
        walletCompleteResponseSchema,
        {
          invalidResponseMessage:
            "The auth server returned an invalid wallet completion response.",
          errorCode: "wallet_auth_complete_failed",
        }
      );

      return parsed.user;
    },
  };
}

export function createAuthApiClient(args?: {
  sharedClient?: SharedAuthApiClient;
  walletClient?: WalletAuthApiClient;
}): AuthApiClient {
  const sharedClient = args?.sharedClient ?? createSharedAuthApiClient();
  const walletClient = args?.walletClient ?? createWalletAuthApiClient();

  return {
    ...sharedClient,
    ...walletClient,
  };
}
