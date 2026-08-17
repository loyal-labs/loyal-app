import "server-only";

import { createHash } from "node:crypto";

import {
  generateChallenge,
  validateChallenge,
  type ChallengeResult,
  type ValidateChallengeBody,
  type ValidateChallengeResult,
} from "capjs-core";

import {
  getOptionalEnv,
  resolveAppEnvironment,
  type EnvSource,
} from "@/lib/core/config/shared";

import { consumeCaptchaKey, putCaptchaKey } from "./captcha-key-store";

const CAP_SECRET_ENV_NAME = "CAP_SECRET";
const APP_ENVIRONMENT_ENV_NAME = "NEXT_PUBLIC_APP_ENVIRONMENT";

/** Binds challenges to the wallet sign-in flow on both generate and validate. */
const CHALLENGE_SCOPE = "wallet-signin";

const NONCE_KEY_PREFIX = "cap-nonce:";
const TOKEN_KEY_PREFIX = "cap-token:";

export function getCapSecret(env: EnvSource = process.env): string | undefined {
  return getOptionalEnv(env, CAP_SECRET_ENV_NAME);
}

/** Proof-of-work + instrumentation challenge for the widget. */
export function createCapChallenge(secret: string): Promise<ChallengeResult> {
  return generateChallenge(secret, {
    scope: CHALLENGE_SCOPE,
    instrumentation: true,
  });
}

/**
 * Validates a solved challenge (with single-use nonce consumption) and stores
 * the redeem token key so `verifyCaptchaToken` can consume it exactly once.
 */
export async function redeemCapChallenge(
  secret: string,
  body: ValidateChallengeBody
): Promise<ValidateChallengeResult> {
  const result = await validateChallenge(secret, body, {
    scope: CHALLENGE_SCOPE,
    consumeNonce: (signatureHex, ttlMs) =>
      putCaptchaKey(
        `${NONCE_KEY_PREFIX}${signatureHex}`,
        new Date(Date.now() + ttlMs)
      ),
  });

  if (result.success && result.tokenKey) {
    await putCaptchaKey(
      `${TOKEN_KEY_PREFIX}${result.tokenKey}`,
      new Date(result.expires)
    );
  }

  return result;
}

export type CaptchaVerification = { ok: true } | { ok: false; reason: string };

/** The default capjs-core redeem token is `id:secret`; the stored key hashes
 *  the secret half so a DB leak alone can't mint valid tokens. */
function deriveCapTokenKey(token: string): string | null {
  const [id, verificationToken] = token.split(":");
  if (!(id && verificationToken)) {
    return null;
  }
  return `${id}:${createHash("sha256")
    .update(verificationToken)
    .digest("hex")}`;
}

/**
 * Server-side enforcement for the Cap captcha. Mirrors the client mode
 * resolution in `lib/core/config/public.ts`:
 *
 * - local app environment → bypass: local API and UI work can authenticate
 *   without solving a captcha, matching the previous Turnstile behavior.
 * - `CAP_SECRET` set → enforce: the redeem token is consumed from the
 *   single-use store. Missing, forged, expired, replayed tokens and an
 *   unreachable store all fail closed.
 * - no secret outside local → misconfigured and fail closed.
 *
 * The mode is resolved from server env only — a client-supplied token can
 * never downgrade it.
 */
export async function verifyCaptchaToken(
  args: { token: string | undefined },
  dependencies: { env?: EnvSource } = {}
): Promise<CaptchaVerification> {
  const env = dependencies.env ?? process.env;
  const appEnvironment = resolveAppEnvironment(
    getOptionalEnv(env, APP_ENVIRONMENT_ENV_NAME)
  );
  if (appEnvironment === "local") {
    return { ok: true };
  }

  const secret = getCapSecret(env);
  if (!secret) {
    return { ok: false, reason: "captcha_verify_unavailable" };
  }

  if (!args.token) {
    return { ok: false, reason: "missing_captcha_token" };
  }

  const tokenKey = deriveCapTokenKey(args.token);
  if (!tokenKey) {
    return { ok: false, reason: "captcha_verification_failed" };
  }

  try {
    const consumed = await consumeCaptchaKey(`${TOKEN_KEY_PREFIX}${tokenKey}`);
    return consumed
      ? { ok: true }
      : { ok: false, reason: "captcha_verification_failed" };
  } catch {
    return { ok: false, reason: "captcha_verify_unavailable" };
  }
}
