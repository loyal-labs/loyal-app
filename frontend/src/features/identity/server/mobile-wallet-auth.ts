import "server-only";

import { WalletAuthError } from "./wallet-auth-errors";
import {
  decodeWalletAddress,
  verifyWalletSignature,
} from "./wallet-auth-signature";

// Wallet-signed auth for the native mobile app. The web sign-in flow is gated
// by Cloudflare Turnstile (a browser CAPTCHA a native client cannot produce),
// so mobile authenticates each Earn request by signing a short, purpose-scoped
// message with the wallet key instead of minting a full session. The server
// reconstructs the exact message from the request fields and verifies the
// Ed25519 signature, plus a freshness window to bound replay.
//
// NOTE (abuse): the deposit-prepare path triggers sponsored smart-account
// provisioning (costs SOL). A valid signature proves control of *that* wallet,
// so an attacker cannot grief arbitrary wallets, but could still burn sponsor
// funds by signing with many throwaway wallets. Add rate-limiting / an
// app-attestation gate before this is exposed outside staging.
const MOBILE_AUTH_MAX_AGE_MS = 5 * 60 * 1000;
const MOBILE_AUTH_MAX_FUTURE_SKEW_MS = 60 * 1000;

export type MobileWalletAuthPurpose =
  | "earn-deposit-prepare"
  | "earn-deposit-confirm"
  | "earn-withdraw-prepare"
  | "earn-withdraw-confirm"
  | "earn-autodeposit-setup-prepare"
  | "earn-autodeposit-setup-confirm"
  | "earn-autodeposit-floor-confirm"
  | "earn-autodeposit-toggle-confirm"
  | "earn-autodeposit-close-prepare"
  | "earn-autodeposit-close-confirm"
  | "earn-autodeposit-sweep-execute"
  | "earn-refund-prepare";

export type MobileWalletAuthFields = {
  walletAddress: string;
  signature: string;
  issuedAt: string;
};

// Deterministic message the mobile client signs and the server rebuilds. Keep
// this in sync with the mobile signer (`earn-auth.ts`). The purpose scopes the
// signature so a prepare signature can't be replayed against confirm.
export function buildMobileWalletAuthMessage(args: {
  purpose: MobileWalletAuthPurpose;
  walletAddress: string;
  issuedAt: string;
}): string {
  return [
    "Loyal Mobile Earn",
    `purpose: ${args.purpose}`,
    `wallet: ${args.walletAddress}`,
    `issuedAt: ${args.issuedAt}`,
  ].join("\n");
}

function parseMobileWalletAuthFields(body: unknown): MobileWalletAuthFields {
  if (typeof body !== "object" || body === null) {
    throw new WalletAuthError("Missing mobile wallet auth fields.", {
      code: "invalid_mobile_auth",
      status: 400,
    });
  }
  const { walletAddress, signature, issuedAt } = body as Record<
    string,
    unknown
  >;
  if (
    typeof walletAddress !== "string" ||
    typeof signature !== "string" ||
    typeof issuedAt !== "string"
  ) {
    throw new WalletAuthError("Missing mobile wallet auth fields.", {
      code: "invalid_mobile_auth",
      status: 400,
    });
  }
  return { walletAddress, signature, issuedAt };
}

// Verifies a mobile wallet-signed request and returns the authenticated wallet
// address. Throws `WalletAuthError` (with an HTTP status) on any failure.
//
// `purpose` may list several accepted purposes: confirm endpoints also accept
// the flow's prepare-purpose signature (within the freshness window) so the
// device signs ONE auth message per flow instead of one per request. The
// signature is verified against each candidate message; order them
// most-likely-first.
export async function authenticateMobileWalletRequest(args: {
  body: unknown;
  purpose: MobileWalletAuthPurpose | readonly MobileWalletAuthPurpose[];
  now?: () => number;
}): Promise<{ walletAddress: string }> {
  const { walletAddress, signature, issuedAt } = parseMobileWalletAuthFields(
    args.body
  );

  // Throws a 400 WalletAuthError when the address isn't a valid 32-byte key.
  decodeWalletAddress(walletAddress);

  const issuedAtMs = Date.parse(issuedAt);
  if (Number.isNaN(issuedAtMs)) {
    throw new WalletAuthError("issuedAt is not a valid timestamp.", {
      code: "invalid_mobile_auth",
      status: 400,
    });
  }
  const now = (args.now ?? Date.now)();
  if (issuedAtMs - now > MOBILE_AUTH_MAX_FUTURE_SKEW_MS) {
    throw new WalletAuthError("Signed request timestamp is in the future.", {
      code: "stale_mobile_auth",
      status: 401,
    });
  }
  if (now - issuedAtMs > MOBILE_AUTH_MAX_AGE_MS) {
    throw new WalletAuthError("Signed request has expired.", {
      code: "stale_mobile_auth",
      status: 401,
    });
  }

  const purposes = Array.isArray(args.purpose) ? args.purpose : [args.purpose];
  for (const purpose of purposes) {
    const message = buildMobileWalletAuthMessage({
      purpose,
      walletAddress,
      issuedAt,
    });
    const verified = await verifyWalletSignature({
      walletAddress,
      message,
      signature,
    });
    if (verified) {
      return { walletAddress };
    }
  }

  throw new WalletAuthError("Wallet signature could not be verified.", {
    code: "invalid_mobile_signature",
    status: 401,
  });
}
