import {
  extractApiErrorMessage,
  parseApiErrorDetails,
  walletChallengeResponseSchema,
  walletCompleteResponseSchema,
} from "@loyal-labs/auth-core";
import type {
  AuthSessionUser,
  WalletChallengeRequest,
  WalletChallengeResponse,
  WalletCompleteRequest,
} from "@loyal-labs/auth-core";

import {
  walletSessionResponseSchema,
  type WalletSessionResponse,
} from "@/features/identity/wallet-session-contracts";

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

export type AuthApiClient = {
  challengeWalletAuth(
    payload: WalletChallengeRequest
  ): Promise<WalletChallengeResponse>;
  completeWalletAuth(payload: WalletCompleteRequest): Promise<AuthSessionUser>;
  getSession(): Promise<WalletSessionResponse | null>;
  refreshSession(): Promise<WalletSessionResponse | null>;
  logout(): Promise<void>;
};

type ApiOutcome = {
  ok: boolean;
  status: number;
  body: unknown;
};

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

async function parseResponseBody(response: Response): Promise<unknown> {
  const bodyText = await response.text();
  if (!bodyText) {
    return null;
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

async function callLocalAuthEndpoint(
  endpoint: string,
  init: RequestInit
): Promise<ApiOutcome> {
  const response = await fetch(endpoint, {
    ...init,
    credentials: "include",
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await parseResponseBody(response),
  };
}

function assertSuccessfulResponse<T>(
  outcome: ApiOutcome,
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

export function createAuthApiClient(): AuthApiClient {
  return {
    async challengeWalletAuth(payload) {
      const outcome = await callLocalAuthEndpoint("/api/auth/wallet/challenge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      return assertSuccessfulResponse(outcome, walletChallengeResponseSchema, {
        invalidResponseMessage:
          "The auth server returned an invalid wallet challenge response.",
        errorCode: "wallet_auth_challenge_failed",
      });
    },

    async completeWalletAuth(payload) {
      const outcome = await callLocalAuthEndpoint("/api/auth/wallet/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
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

    async getSession() {
      const outcome = await callLocalAuthEndpoint("/api/auth/session", {
        method: "GET",
      });
      if (!outcome.ok) {
        if (outcome.status === 401) {
          return null;
        }

        throw new AuthApiClientError(extractApiErrorMessage(outcome.body), {
          code: toErrorCode(outcome.body, "wallet_auth_session_failed"),
          status: outcome.status,
          details: parseApiErrorDetails(outcome.body),
        });
      }

      const parsed = walletSessionResponseSchema.safeParse(outcome.body);
      if (!parsed.success) {
        throw new AuthApiClientError(
          "The auth server returned an invalid wallet session response.",
          {
            code: "wallet_auth_session_invalid_response",
            status: 502,
          }
        );
      }

      return parsed.data;
    },

    async refreshSession() {
      const outcome = await callLocalAuthEndpoint("/api/auth/session/refresh", {
        method: "POST",
      });
      if (!outcome.ok) {
        if (outcome.status === 401) {
          return null;
        }

        throw new AuthApiClientError(extractApiErrorMessage(outcome.body), {
          code: toErrorCode(outcome.body, "wallet_auth_refresh_failed"),
          status: outcome.status,
          details: parseApiErrorDetails(outcome.body),
        });
      }

      const parsed = walletSessionResponseSchema.safeParse(outcome.body);
      if (!parsed.success) {
        throw new AuthApiClientError(
          "The auth server returned an invalid wallet refresh response.",
          {
            code: "wallet_auth_refresh_invalid_response",
            status: 502,
          }
        );
      }

      return parsed.data;
    },

    async logout() {
      const outcome = await callLocalAuthEndpoint("/api/auth/logout", {
        method: "POST",
      });
      if (outcome.ok) {
        return;
      }

      throw new AuthApiClientError(extractApiErrorMessage(outcome.body), {
        code: toErrorCode(outcome.body, "wallet_auth_logout_failed"),
        status: outcome.status,
        details: parseApiErrorDetails(outcome.body),
      });
    },
  };
}
