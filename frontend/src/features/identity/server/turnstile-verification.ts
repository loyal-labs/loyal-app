import "server-only";

import {
  getOptionalEnv,
  resolveAppEnvironment,
  type EnvSource,
} from "@/lib/core/config/shared";

const APP_ENVIRONMENT_ENV_NAME = "NEXT_PUBLIC_APP_ENVIRONMENT";
const TURNSTILE_SITE_KEY_ENV_NAME = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
const TURNSTILE_SECRET_KEY_ENV_NAME = "TURNSTILE_SECRET_KEY";

/** Must match LOCAL_TURNSTILE_BYPASS_TOKEN in lib/core/config/public.ts. */
const LOCAL_BYPASS_TOKEN = "local-bypass";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileVerification =
  | { ok: true }
  | { ok: false; reason: string };

type SiteverifyResponse = {
  success: boolean;
  "error-codes"?: string[];
};

type VerifyDependencies = {
  env?: EnvSource;
  fetchImpl?: typeof fetch;
};

/**
 * Server-side enforcement for Cloudflare Turnstile. Mirrors the client mode
 * resolution in `lib/core/config/public.ts`:
 *
 * - `local`  → bypass mode: the bypass token must be present (so the step is
 *   still required) but no network round-trip is made.
 * - site key set → enforce: the token is verified against Cloudflare. Missing
 *   token, missing secret, an invalid token, or an unreachable verifier all
 *   fail closed.
 * - no site key (non-local) → misconfigured: verification is skipped (parity
 *   with the client, which auto-skips when Turnstile is not configured), logged
 *   loudly so it is noticed.
 *
 * The mode is resolved from server env only — a client-supplied token can never
 * downgrade it.
 */
export async function verifyTurnstileToken(
  args: { token: string | undefined; remoteIp?: string | null },
  dependencies: VerifyDependencies = {}
): Promise<TurnstileVerification> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const appEnvironment = resolveAppEnvironment(
    getOptionalEnv(env, APP_ENVIRONMENT_ENV_NAME)
  );

  if (appEnvironment === "local") {
    return args.token === LOCAL_BYPASS_TOKEN
      ? { ok: true }
      : { ok: false, reason: "missing_turnstile_token" };
  }

  const siteKey = getOptionalEnv(env, TURNSTILE_SITE_KEY_ENV_NAME);
  if (!siteKey) {
    console.warn(
      "[turnstile] verification skipped — NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set"
    );
    return { ok: true };
  }

  const secretKey = getOptionalEnv(env, TURNSTILE_SECRET_KEY_ENV_NAME);
  if (!secretKey) {
    console.error(
      "[turnstile] TURNSTILE_SECRET_KEY is not set; rejecting sign-in"
    );
    return { ok: false, reason: "turnstile_secret_missing" };
  }

  if (!args.token) {
    return { ok: false, reason: "missing_turnstile_token" };
  }

  const formData = new URLSearchParams();
  formData.set("secret", secretKey);
  formData.set("response", args.token);
  if (args.remoteIp) {
    formData.set("remoteip", args.remoteIp);
  }

  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });

    if (!response.ok) {
      return { ok: false, reason: "turnstile_verify_unavailable" };
    }

    const payload = (await response.json()) as SiteverifyResponse;
    return payload.success
      ? { ok: true }
      : { ok: false, reason: "turnstile_verification_failed" };
  } catch {
    return { ok: false, reason: "turnstile_verify_unavailable" };
  }
}
