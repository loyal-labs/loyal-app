import bs58 from "bs58";
import { Buffer } from "buffer";

import type { Signer } from "@/lib/wallet/signer";

import { EarnApiError, type EarnAuthFields } from "./earn-api";

export type EarnAuthPurpose =
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
  | "earn-autodeposit-sweep-execute";

// Must stay byte-for-byte in sync with the backend `buildMobileWalletAuthMessage`
// (`frontend/src/features/identity/server/mobile-wallet-auth.ts`). The server
// rebuilds this exact string from the request fields and verifies the signature.
function buildEarnAuthMessage(args: {
  purpose: EarnAuthPurpose;
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

// Signs a purpose-scoped, time-stamped message with the wallet so the backend
// can authenticate the request without a session (Turnstile-free).
export async function signEarnAuth(
  signer: Signer,
  purpose: EarnAuthPurpose,
): Promise<EarnAuthFields> {
  const walletAddress = signer.publicKey.toBase58();
  const issuedAt = new Date().toISOString();
  const message = buildEarnAuthMessage({ purpose, walletAddress, issuedAt });
  const signature = await signer.signMessage(Buffer.from(message, "utf8"));
  return { walletAddress, signature: bs58.encode(signature), issuedAt };
}

// Auth-failure codes worth one retry with a freshly signed message: the reused
// flow auth aged past the backend's 5-minute freshness window, or the backend
// predates flow-auth reuse and only accepts the exact purpose.
const RETRYABLE_AUTH_CODES = new Set([
  "stale_mobile_auth",
  "invalid_mobile_signature",
]);

// Runs an Earn API call with the flow's already-signed auth message — the
// backend's confirm endpoints accept the flow's prepare signature, so one
// wallet prompt covers prepare + confirms. If the backend rejects the reuse,
// signs a fresh `purpose`-scoped auth once (one extra prompt) and retries.
export async function withEarnAuth<T>(
  signer: Signer,
  flowAuth: EarnAuthFields,
  purpose: EarnAuthPurpose,
  call: (auth: EarnAuthFields) => Promise<T>,
): Promise<T> {
  try {
    return await call(flowAuth);
  } catch (error) {
    if (
      error instanceof EarnApiError &&
      error.code !== undefined &&
      RETRYABLE_AUTH_CODES.has(error.code)
    ) {
      return call(await signEarnAuth(signer, purpose));
    }
    throw error;
  }
}
