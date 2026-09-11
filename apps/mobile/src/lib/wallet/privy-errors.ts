// Privy's SDK errors carry developer-facing text ("use `useLinkWithEmail`
// if..."). Map the codes we can act on to user copy; never show the raw text.
const BY_CODE: Record<string, string> = {
  invalid_credentials: "That code is incorrect. Check it and try again.",
  too_many_requests: "Too many attempts. Wait a minute and try again.",
  user_does_not_exist:
    "No wallet found for this account. Use Create New Wallet instead.",
  signup_disabled:
    "No wallet found for this account. Use Create New Wallet instead.",
  linked_to_another_user: "This account is already linked to another wallet.",
  disallowed_login_method: "This sign-in method is not available.",
  allowlist_rejected: "This account is not allowed to sign in.",
  invalid_native_app_id: "This build is not authorized for sign-in.",
  client_request_timeout: "Sign-in timed out. Check your connection and try again.",
  embedded_wallet_creation_error: "Could not create the wallet. Try again.",
  embedded_wallet_needs_recovery:
    "This wallet needs recovery on this device. Try again or contact support.",
};

const FALLBACK = "Sign-in failed. Please try again.";

export function privyErrorMessage(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown; name?: unknown };
  if (typeof e?.code === "string" && BY_CODE[e.code]) return BY_CODE[e.code];
  const message = typeof e?.message === "string" ? e.message : "";
  if (/network request failed|failed to fetch/i.test(message)) {
    return "No connection. Check your network and try again.";
  }
  // Privy SDK errors carry a `code`; plain Errors thrown by our own code are
  // already written for users (wallet mismatch, no wallet app, ...).
  if (typeof e?.code === "string") return FALLBACK;
  return message || FALLBACK;
}
